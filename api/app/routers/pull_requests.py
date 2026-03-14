import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.dependencies.auth import get_current_user
from app.models.pull_request import PRComment, PRStatus, PRVote, PullRequest
from app.models.user import User, UserRole
from app.schemas.pull_request import (
    PRCommentCreate,
    PRCommentOut,
    PullRequestCreate,
    PullRequestOut,
)
from app.services.notification import notify_user
from app.services.pr import apply_pr

router = APIRouter(prefix="/api/pull-requests", tags=["pull-requests"])


@router.post("", response_model=PullRequestOut)
async def create_pull_request(
    data: PullRequestCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PullRequestOut:
    # Check 5 open PR limit for non-privileged users
    if current_user.role not in [UserRole.BUREAU, UserRole.VIEUX]:
        open_count = await db.scalar(
            select(func.count())
            .select_from(PullRequest)
            .where(
                PullRequest.author_id == current_user.id,
                PullRequest.status == PRStatus.OPEN,
            )
        )
        if open_count and open_count >= 5:
            raise BadRequestError("You have reached the limit of 5 open pull requests")

    # Validate file_key ownership and attachment nesting
    from app.models.material import Material

    user_upload_prefix = f"uploads/{current_user.id}/"
    for op in data.operations:
        # Ensure file_keys belong to the submitting user
        file_key = getattr(op, "file_key", None)
        if file_key and not file_key.startswith(user_upload_prefix):
            raise BadRequestError("file_key does not belong to you")

        if op.op == "create_material":
            # Check attachment file_keys too
            for att in getattr(op, "attachments", []):
                att_fk = att.get("file_key") if isinstance(att, dict) else None
                if att_fk and not att_fk.startswith(user_upload_prefix):
                    raise BadRequestError("Attachment file_key does not belong to you")

            pmid = getattr(op, "parent_material_id", None)
            if pmid and isinstance(pmid, uuid.UUID):
                parent_mat = await db.scalar(
                    select(Material).where(Material.id == pmid)
                )
                if parent_mat and parent_mat.parent_material_id is not None:
                    raise BadRequestError(
                        "Cannot attach a material to another attachment"
                    )

    # Serialize operations to list[dict]
    ops_payload = [op.model_dump(mode="json") for op in data.operations]
    summary_types = sorted({op.op for op in data.operations})

    pr = PullRequest(
        id=uuid.uuid4(),
        type="batch",
        status=PRStatus.OPEN,
        title=data.title,
        description=data.description,
        payload=ops_payload,
        summary_types=summary_types,
        author_id=current_user.id,
    )
    db.add(pr)
    await db.flush()

    # Auto-approve for privileged users
    if current_user.role in [UserRole.BUREAU, UserRole.VIEUX]:
        pr.status = PRStatus.APPROVED
        pr.reviewed_by = current_user.id
        await apply_pr(db, pr, current_user.id)
        await db.flush()

    await db.refresh(pr)
    await db.refresh(pr, ["author"])
    pr.vote_score = 0
    pr.user_vote = 0
    return pr


@router.get("", response_model=list[PullRequestOut])
async def list_pull_requests(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    status: str | None = None,
    type: str | None = None,
    author_id: uuid.UUID | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
) -> list[PullRequestOut]:
    stmt = select(PullRequest)
    if status:
        stmt = stmt.where(PullRequest.status == status)
    if type:
        stmt = stmt.where(PullRequest.type == type)
    if author_id:
        stmt = stmt.where(PullRequest.author_id == author_id)

    stmt = (
        stmt.order_by(desc(PullRequest.created_at))
        .offset((page - 1) * limit)
        .limit(limit)
    )
    result = await db.execute(stmt)
    prs = result.scalars().all()

    out = []
    for pr in prs:
        await db.refresh(pr, ["author"])
        score = (
            await db.scalar(
                select(func.sum(PRVote.value)).where(PRVote.pr_id == pr.id)
            )
            or 0
        )
        user_vote = (
            await db.scalar(
                select(PRVote.value).where(
                    PRVote.pr_id == pr.id, PRVote.user_id == current_user.id
                )
            )
            or 0
        )
        pr.vote_score = score
        pr.user_vote = user_vote
        out.append(pr)
    return out


@router.get("/for-item", response_model=list[PullRequestOut])
async def list_pull_requests_for_item(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    target_type: str = Query(alias="targetType"),
    target_id: str = Query(alias="targetId"),
) -> list[PullRequestOut]:
    """
    Search within the JSONB array payload for operations referencing
    the given target item.  Uses a lateral jsonb_array_elements query.
    """
    stmt = select(PullRequest).where(PullRequest.status == PRStatus.OPEN)

    if target_type == "material":
        # Search payload array for ops that reference this material_id
        stmt = stmt.where(
            text(
                "EXISTS (SELECT 1 FROM jsonb_array_elements(payload) elem "
                "WHERE elem->>'material_id' = :tid "
                "OR elem->>'parent_material_id' = :tid)"
            ).bindparams(tid=target_id)
        )
    elif target_type == "directory":
        stmt = stmt.where(
            text(
                "EXISTS (SELECT 1 FROM jsonb_array_elements(payload) elem "
                "WHERE elem->>'directory_id' = :tid "
                "OR elem->>'parent_id' = :tid)"
            ).bindparams(tid=target_id)
        )
    else:
        raise BadRequestError("Invalid targetType")

    result = await db.execute(stmt)
    prs = result.scalars().all()

    out = []
    for pr in prs:
        await db.refresh(pr, ["author"])
        score = (
            await db.scalar(
                select(func.sum(PRVote.value)).where(PRVote.pr_id == pr.id)
            )
            or 0
        )
        user_vote = (
            await db.scalar(
                select(PRVote.value).where(
                    PRVote.pr_id == pr.id, PRVote.user_id == current_user.id
                )
            )
            or 0
        )
        pr.vote_score = score
        pr.user_vote = user_vote
        out.append(pr)

    return out


@router.get("/{id}", response_model=PullRequestOut)
async def get_pull_request(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PullRequestOut:
    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    await db.refresh(pr, ["author"])
    score = (
        await db.scalar(
            select(func.sum(PRVote.value)).where(PRVote.pr_id == pr.id)
        )
        or 0
    )
    user_vote = (
        await db.scalar(
            select(PRVote.value).where(
                PRVote.pr_id == pr.id, PRVote.user_id == current_user.id
            )
        )
        or 0
    )
    pr.vote_score = score
    pr.user_vote = user_vote
    return pr


@router.post("/{id}/vote")
async def vote_pull_request(
    id: uuid.UUID,
    value: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    if value not in [-1, 0, 1]:
        raise BadRequestError("Vote value must be -1, 0, or 1")

    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    if pr.author_id == current_user.id:
        raise ForbiddenError("You cannot vote on your own pull request")

    if pr.status != PRStatus.OPEN:
        raise BadRequestError("Cannot vote on a closed pull request")

    vote = await db.scalar(
        select(PRVote).where(PRVote.pr_id == id, PRVote.user_id == current_user.id)
    )
    if vote:
        vote.value = value
    else:
        vote = PRVote(
            id=uuid.uuid4(), pr_id=id, user_id=current_user.id, value=value
        )
        db.add(vote)

    await db.flush()

    score = (
        await db.scalar(
            select(func.sum(PRVote.value)).where(PRVote.pr_id == pr.id)
        )
        or 0
    )

    if pr.author_id != current_user.id:
        await notify_user(
            db,
            pr.author_id,
            "pr_voted",
            f'Your PR "{pr.title}" received a vote',
            link=f"/pull-requests/{pr.id}",
        )

    if score >= 5:
        pr.status = PRStatus.APPROVED
        pr.reviewed_by = None
        await apply_pr(db, pr, current_user.id)
        await notify_user(
            db,
            pr.author_id,
            "pr_approved",
            f'Your PR "{pr.title}" was auto-approved',
            link=f"/pull-requests/{pr.id}",
        )

    return {"status": "ok", "vote_score": score}


@router.post("/{id}/approve")
async def approve_pull_request(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    if current_user.role not in [UserRole.MEMBER, UserRole.BUREAU, UserRole.VIEUX]:
        raise ForbiddenError("Moderator rights required")

    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    if pr.status != PRStatus.OPEN:
        raise BadRequestError("Pull request is not open")

    pr.status = PRStatus.APPROVED
    pr.reviewed_by = current_user.id

    await apply_pr(db, pr, current_user.id)
    await notify_user(
        db,
        pr.author_id,
        "pr_approved",
        f'Your PR "{pr.title}" was approved',
        link=f"/pull-requests/{pr.id}",
    )
    return {"status": "ok"}


@router.post("/{id}/reject")
async def reject_pull_request(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    if current_user.role not in [UserRole.MEMBER, UserRole.BUREAU, UserRole.VIEUX]:
        raise ForbiddenError("Moderator rights required")

    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    if pr.status != PRStatus.OPEN:
        raise BadRequestError("Pull request is not open")

    pr.status = PRStatus.REJECTED
    pr.reviewed_by = current_user.id

    # Clean up uploaded files from all operations in the batch
    from app.core.minio import delete_object

    for op in pr.payload:
        fk = op.get("file_key")
        if fk and str(fk).startswith("uploads/"):
            try:
                await delete_object(str(fk))
            except Exception:
                pass
        # Also clean attachment file_keys
        for att in op.get("attachments", []):
            att_fk = att.get("file_key")
            if att_fk and str(att_fk).startswith("uploads/"):
                try:
                    await delete_object(str(att_fk))
                except Exception:
                    pass

    await notify_user(
        db,
        pr.author_id,
        "pr_rejected",
        f'Your PR "{pr.title}" was rejected',
        link=f"/pull-requests/{pr.id}",
    )
    return {"status": "ok"}


@router.get("/{id}/diff")
async def get_pull_request_diff(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    # Collect file_keys from all operations
    file_ops = [op for op in pr.payload if op.get("file_key")]
    if not file_ops:
        return {"diff": None}

    return {"diff": f"{len(file_ops)} file(s) changed."}


@router.get("/{id}/preview")
async def get_pull_request_preview(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    op_index: int = Query(0, ge=0, alias="opIndex"),
) -> dict:
    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    if op_index >= len(pr.payload):
        raise BadRequestError("Operation index out of range")

    op = pr.payload[op_index]
    if not op.get("file_key"):
        raise NotFoundError("No file to preview for this operation")

    from app.core.minio import generate_presigned_get

    file_key = op["file_key"]
    # After approval, files are moved from uploads/ to materials/
    if pr.status == "approved" and file_key.startswith("uploads/"):
        file_key = file_key.replace("uploads/", "materials/", 1)

    url = await generate_presigned_get(file_key)
    return {"url": url}


@router.get("/{id}/comments", response_model=list[PRCommentOut])
async def list_pull_request_comments(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[PRCommentOut]:
    stmt = (
        select(PRComment)
        .where(PRComment.pr_id == id)
        .order_by(PRComment.created_at)
    )
    res = await db.execute(stmt)
    comments = res.scalars().all()
    for c in comments:
        await db.refresh(c, ["author"])
    return comments


@router.post("/{id}/comments", response_model=PRCommentOut)
async def create_pull_request_comment(
    id: uuid.UUID,
    data: PRCommentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PRCommentOut:
    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    c = PRComment(
        id=uuid.uuid4(),
        pr_id=id,
        author_id=current_user.id,
        body=data.body,
        parent_id=data.parent_id,
    )
    db.add(c)
    await db.flush()
    await db.refresh(c, ["author"])

    if data.parent_id:
        parent = await db.scalar(
            select(PRComment).where(PRComment.id == data.parent_id)
        )
        if parent and parent.author_id != current_user.id:
            await notify_user(
                db,
                parent.author_id,
                "pr_comment_reply",
                f'Someone replied to your comment on "{pr.title}"',
                link=f"/pull-requests/{pr.id}",
            )

    return c

