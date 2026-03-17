import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from redis.asyncio import Redis
from sqlalchemy import desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.minio import object_exists
from app.core.redis import get_redis
from app.dependencies.auth import get_current_user
from app.models.material import Material
from app.models.pull_request import PRComment, PRStatus, PRVote, PullRequest
from app.models.security import VirusScanResult
from app.models.user import User, UserRole
from app.schemas.pull_request import (
    PRCommentCreate,
    PRCommentOut,
    PRVoteIn,
    PullRequestCreate,
    PullRequestOut,
)
from app.services.notification import notify_user
from app.services.pr import apply_pr

_SCAN_CACHE_PREFIX = "upload:scanned:"

router = APIRouter(prefix="/api/pull-requests", tags=["pull-requests"])


@router.post("", response_model=PullRequestOut, status_code=201)
async def create_pull_request(
    data: PullRequestCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    redis: Annotated[Redis, Depends(get_redis)],
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
    user_upload_prefix = f"uploads/{current_user.id}/"
    for op in data.operations:
        # Ensure file_keys belong to the submitting user
        file_key = getattr(op, "file_key", None)
        if file_key and not file_key.startswith(user_upload_prefix):
            raise BadRequestError("file_key does not belong to you")

        if op.op == "create_material":
            # Check attachment file_keys too
            for att in getattr(op, "attachments", []):
                att_fk = (
                    att.file_key
                    if hasattr(att, "file_key")
                    else (att.get("file_key") if isinstance(att, dict) else None)
                )
                if att_fk and not att_fk.startswith(user_upload_prefix):
                    raise BadRequestError("Attachment file_key does not belong to you")

            pmid = getattr(op, "parent_material_id", None)
            if pmid and isinstance(pmid, uuid.UUID):
                parent_mat = await db.scalar(select(Material).where(Material.id == pmid))
                if parent_mat and parent_mat.parent_material_id is not None:
                    raise BadRequestError("Cannot attach a material to another attachment")

    # Validate that all referenced file_keys actually exist in storage
    for op in data.operations:
        fk = getattr(op, "file_key", None)
        if fk:
            if not await object_exists(fk):
                raise BadRequestError(f"File not found in storage: {fk}")
        for att in getattr(op, "attachments", []):
            att_fk = (
                att.file_key
                if hasattr(att, "file_key")
                else (att.get("file_key") if isinstance(att, dict) else None)
            )
            if att_fk:
                if not await object_exists(att_fk):
                    raise BadRequestError(f"Attachment file not found in storage: {att_fk}")

    # Verify every file has been scanned (prevents bypassing complete_upload)
    for op in data.operations:
        fk = getattr(op, "file_key", None)
        if fk and not await redis.get(f"{_SCAN_CACHE_PREFIX}{fk}"):
            raise BadRequestError(f"File has not been scanned: {fk}")
        for att in getattr(op, "attachments", []):
            att_fk = (
                att.file_key
                if hasattr(att, "file_key")
                else (att.get("file_key") if isinstance(att, dict) else None)
            )
            if att_fk and not await redis.get(f"{_SCAN_CACHE_PREFIX}{att_fk}"):
                raise BadRequestError(f"Attachment file has not been scanned: {att_fk}")

    # Prevent file_key reuse across open PRs
    all_file_keys: set[str] = set()
    for op in data.operations:
        fk = getattr(op, "file_key", None)
        if fk:
            all_file_keys.add(fk)
        for att in getattr(op, "attachments", []):
            att_fk = (
                att.file_key
                if hasattr(att, "file_key")
                else (att.get("file_key") if isinstance(att, dict) else None)
            )
            if att_fk:
                all_file_keys.add(att_fk)

    if all_file_keys:
        for fk in all_file_keys:
            if db.bind.dialect.name == "sqlite":
                # SQLite doesn't support the jsonb_array_elements/->> syntax.
                # Since this is primarily for tests, we do a Python-based check.
                stmt = select(PullRequest.payload).where(PullRequest.status == PRStatus.OPEN)
                res_payloads = await db.scalars(stmt)
                for p_list in res_payloads:
                    for op_item in p_list:
                        if op_item.get("file_key") == fk:
                            raise BadRequestError(
                                "File is already referenced by another open pull request"
                            )
                        for att_item in op_item.get("attachments", []):
                            if att_item.get("file_key") == fk:
                                raise BadRequestError(
                                    "File is already referenced by another open pull request"
                                )
            else:
                # PostgreSQL optimized path
                conflict = await db.scalar(
                    select(PullRequest.id).where(
                        PullRequest.status == PRStatus.OPEN,
                        text(
                            "EXISTS (SELECT 1 FROM jsonb_array_elements(payload) elem "
                            "WHERE elem->>'file_key' = :fk "
                            "OR EXISTS (SELECT 1 FROM jsonb_array_elements("
                            "COALESCE(elem->'attachments', '[]'::jsonb)) att "
                            "WHERE att->>'file_key' = :fk))"
                        ).bindparams(fk=fk),
                    )
                )
                if conflict:
                    raise BadRequestError("File is already referenced by another open pull request")

    # Serialize operations to list[dict]
    ops_payload = [op.model_dump(mode="json") for op in data.operations]
    summary_types = sorted({op.op for op in data.operations})

    # Files are already scanned clean by upload/complete — mark as CLEAN
    has_file = any(
        op.get("file_key")
        or any(
            (att.get("file_key") if isinstance(att, dict) else None)
            for att in op.get("attachments", [])
        )
        for op in ops_payload
    )

    pr = PullRequest(
        id=uuid.uuid4(),
        type="batch",
        status=PRStatus.OPEN,
        title=data.title,
        description=data.description,
        payload=ops_payload,
        summary_types=summary_types,
        author_id=current_user.id,
        virus_scan_result=VirusScanResult.CLEAN if has_file else VirusScanResult.SKIPPED,
    )
    db.add(pr)
    await db.flush()

    # Auto-approve for privileged users
    if current_user.role in [UserRole.BUREAU, UserRole.VIEUX]:
        pr.status = PRStatus.APPROVED
        pr.reviewed_by = current_user.id
        await apply_pr(db, pr, current_user.id)
        await db.flush()

    await db.refresh(pr, ["author", "created_at", "updated_at"])
    setattr(pr, "vote_score", 0)
    setattr(pr, "user_vote", 0)
    return PullRequestOut.model_validate(pr)


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

    stmt = stmt.order_by(desc(PullRequest.created_at)).offset((page - 1) * limit).limit(limit)
    result = await db.execute(stmt)
    prs = result.scalars().all()

    out = []
    for pr in prs:
        await db.refresh(pr, ["author"])
        score = await db.scalar(select(func.sum(PRVote.value)).where(PRVote.pr_id == pr.id)) or 0
        user_vote = (
            await db.scalar(
                select(PRVote.value).where(PRVote.pr_id == pr.id, PRVote.user_id == current_user.id)
            )
            or 0
        )
        setattr(pr, "vote_score", score)
        setattr(pr, "user_vote", user_vote)
        out.append(pr)
    return [PullRequestOut.model_validate(pr) for pr in out]


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
        score = await db.scalar(select(func.sum(PRVote.value)).where(PRVote.pr_id == pr.id)) or 0
        user_vote = (
            await db.scalar(
                select(PRVote.value).where(PRVote.pr_id == pr.id, PRVote.user_id == current_user.id)
            )
            or 0
        )
        setattr(pr, "vote_score", score)
        setattr(pr, "user_vote", user_vote)
        await db.refresh(pr, ["author", "created_at", "updated_at"])
        out.append(pr)

    return [PullRequestOut.model_validate(pr) for pr in out]


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
    score = await db.scalar(select(func.sum(PRVote.value)).where(PRVote.pr_id == pr.id)) or 0
    user_vote = (
        await db.scalar(
            select(PRVote.value).where(PRVote.pr_id == pr.id, PRVote.user_id == current_user.id)
        )
        or 0
    )
    setattr(pr, "vote_score", score)
    setattr(pr, "user_vote", user_vote)
    return PullRequestOut.model_validate(pr)


@router.post("/{id}/vote")
async def vote_pull_request(
    id: uuid.UUID,
    data: PRVoteIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    value = data.value
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
        vote = PRVote(id=uuid.uuid4(), pr_id=id, user_id=current_user.id, value=value)
        db.add(vote)

    await db.flush()

    score = await db.scalar(select(func.sum(PRVote.value)).where(PRVote.pr_id == pr.id)) or 0

    if pr.author_id and pr.author_id != current_user.id:
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
        if pr.author_id:
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
    if pr.author_id:
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

    if pr.author_id:
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
    stmt = select(PRComment).where(PRComment.pr_id == id).order_by(PRComment.created_at)
    res = await db.execute(stmt)
    comments = list(res.scalars().all())
    for c in comments:
        await db.refresh(c, ["author", "created_at", "updated_at"])
    return [PRCommentOut.model_validate(c) for c in comments]


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
        parent = await db.scalar(select(PRComment).where(PRComment.id == data.parent_id))
        if parent and parent.author_id and parent.author_id != current_user.id:
            await notify_user(
                db,
                parent.author_id,
                "pr_comment_reply",
                f'Someone replied to your comment on "{pr.title}"',
                link=f"/pull-requests/{pr.id}",
            )

    return c  # type: ignore[return-value]
