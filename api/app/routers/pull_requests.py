import asyncio
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from redis.asyncio import Redis
from sqlalchemy import desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.redis import get_redis
from app.core.storage import object_exists
from app.dependencies.auth import get_current_user
from app.models.material import Material
from app.models.pull_request import PRComment, PRStatus, PRVote, PullRequest
from app.models.security import VirusScanResult
from app.models.upload import Upload
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
_PR_CLAIM_LOCK_KEY = "lock:pr:create"

logger = logging.getLogger("wikint")

router = APIRouter(prefix="/api/pull-requests", tags=["pull-requests"])


@router.post("", response_model=PullRequestOut, status_code=201)
async def create_pull_request(
    data: PullRequestCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> PullRequestOut:
    if current_user.role not in (UserRole.MODERATOR, UserRole.BUREAU, UserRole.VIEUX):
        if len(data.operations) > 50:
            raise BadRequestError("Operations list should have at most 50 items")
        for op in data.operations:
            if (
                getattr(op, "op", None) == "create_material"
                and len(getattr(op, "attachments", [])) > 50
            ):
                raise BadRequestError("Attachments list should have at most 50 items")
    else:
        # Privileged users have a higher but finite limit (Issue S15)
        if len(data.operations) > 500:
            raise BadRequestError("Operations list should have at most 500 items")

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
    keys_to_check: set[str] = set()
    for op in data.operations:
        # Ensure file_keys belong to the submitting user
        file_key = getattr(op, "file_key", None)
        if file_key:
            if not file_key.startswith(user_upload_prefix):
                raise BadRequestError("file_key does not belong to you")
            keys_to_check.add(file_key)

        if op.op == "create_material":
            # Check attachment file_keys too
            for att in getattr(op, "attachments", []):
                att_fk = (
                    att.file_key
                    if hasattr(att, "file_key")
                    else (att.get("file_key") if isinstance(att, dict) else None)
                )
                if att_fk:
                    if not att_fk.startswith(user_upload_prefix):
                        raise BadRequestError("Attachment file_key does not belong to you")
                    keys_to_check.add(att_fk)

            pmid = getattr(op, "parent_material_id", None)
            if pmid and isinstance(pmid, uuid.UUID):
                parent_mat = await db.scalar(select(Material).where(Material.id == pmid))
                if parent_mat and parent_mat.parent_material_id is not None:
                    raise BadRequestError("Cannot attach a material to another attachment")

    if keys_to_check:
        # 1. Validate existence in storage
        existence_results = await asyncio.gather(*(object_exists(k) for k in keys_to_check))
        for key, exists in zip(keys_to_check, existence_results):
            if not exists:
                raise BadRequestError(f"File not found in storage: {key}")

        # 2. Verify scan results via DB (Issue S6)
        # Check if all keys exist in Upload table with status 'clean'
        stmt = select(Upload.final_key).where(
            Upload.final_key.in_(list(keys_to_check)), Upload.status == "clean"
        )
        clean_keys = set(await db.scalars(stmt))
        for key in keys_to_check:
            if key not in clean_keys:
                raise BadRequestError(f"File has not been scanned or is not clean: {key}")

    # Serialize operations to list[dict]
    ops_payload = [op.model_dump(mode="json") for op in data.operations]
    summary_types = sorted({op.op for op in data.operations})

    # Files are already scanned clean by upload/complete — mark as CLEAN
    has_file = False
    for op_dict in ops_payload:
        if op_dict.get("file_key"):
            has_file = True
            break
        attachments = op_dict.get("attachments")
        if isinstance(attachments, list):
            for att in attachments:
                if isinstance(att, dict) and att.get("file_key"):
                    has_file = True
                    break
        if has_file:
            break

    # ── File Claiming Check (Issue S5) ──
    # Ensure that multiple concurrent PR creations do not claim the same file_key.
    # Use the already-defined Redis lock to ensure atomicity.
    async with redis.lock(_PR_CLAIM_LOCK_KEY, timeout=10):
        if keys_to_check:
            for fk in keys_to_check:
                if db.bind.dialect.name == "sqlite":
                    stmt = select(PullRequest.payload).where(PullRequest.status == PRStatus.OPEN)
                    res_payloads = await db.scalars(stmt)
                    for p_list in res_payloads:
                        if not isinstance(p_list, list):
                            continue
                        for op_item in p_list:
                            if not isinstance(op_item, dict):
                                continue
                            if op_item.get("file_key") == fk:
                                raise BadRequestError(
                                    "File is already referenced by another open pull request"
                                )
                            att_list = op_item.get("attachments", [])
                            if isinstance(att_list, list):
                                for att_item in att_list:
                                    if isinstance(att_item, dict) and att_item.get("file_key") == fk:
                                        raise BadRequestError(
                                            "File is already referenced by another open pull request"
                                        )
                else:
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
                        raise BadRequestError(
                            "File is already referenced by another open pull request"
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

        # Commit here while holding the lock to ensure file claiming is durable
        await db.commit()

    await db.refresh(pr, ["author", "created_at", "updated_at"])
    setattr(pr, "vote_score", 0)
    setattr(pr, "user_vote", 0)
    return PullRequestOut.model_validate(pr)


@router.get("", response_model=list[PullRequestOut])
async def list_pull_requests(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    status: str | None = None,
    type: str | None = None,
    author_id: uuid.UUID | None = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
) -> list[PullRequestOut]:
    # Base statement for both count and data
    base_stmt = select(PullRequest)
    if status:
        base_stmt = base_stmt.where(PullRequest.status == status)
    if type:
        base_stmt = base_stmt.where(PullRequest.type == type)
    if author_id:
        base_stmt = base_stmt.where(PullRequest.author_id == author_id)

    # 1. Fetch total count (U6)
    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    total_count = await db.scalar(count_stmt) or 0
    response.headers["X-Total-Count"] = str(total_count)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    # 2. Fetch page data
    stmt = base_stmt.order_by(desc(PullRequest.created_at)).offset((page - 1) * limit).limit(limit)
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

    if db.bind.dialect.name == "sqlite":
        # SQLite fallback: fetch all open PRs and filter in Python
        # (U15) Privileged users have finite limit, so this is safe for dev
        stmt = select(PullRequest).where(PullRequest.status == PRStatus.OPEN)
        result = await db.execute(stmt)
        prs = result.scalars().all()
        filtered = []
        for pr in prs:
            match = False
            for op in pr.payload:
                if target_type == "material":
                    if op.get("material_id") == target_id or op.get("parent_material_id") == target_id:
                        match = True
                        break
                elif target_type == "directory":
                    if op.get("directory_id") == target_id or op.get("parent_id") == target_id:
                        match = True
                        break
            if match:
                filtered.append(pr)
        prs = filtered
    else:
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
    raise BadRequestError(
        "Voting on pull requests has been disabled. Only moderators can approve or reject PRs."
    )


@router.post("/{id}/approve")
async def approve_pull_request(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    if current_user.role not in [UserRole.MODERATOR, UserRole.BUREAU, UserRole.VIEUX]:
        raise ForbiddenError("Moderator rights required")

    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    if pr.status != PRStatus.OPEN:
        raise BadRequestError("Pull request is not open")

    pr.status = PRStatus.APPROVED
    pr.reviewed_by = current_user.id

    await apply_pr(db, pr, current_user.id)
    await db.commit()

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
    if current_user.role not in [UserRole.MODERATOR, UserRole.BUREAU, UserRole.VIEUX]:
        raise ForbiddenError("Moderator rights required")

    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    if pr.status != PRStatus.OPEN:
        raise BadRequestError("Pull request is not open")

    pr.status = PRStatus.REJECTED
    pr.reviewed_by = current_user.id

    # Clean up uploaded files from all operations in the batch
    from app.core.storage import delete_object

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

    await db.commit()

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

    # SECURITY (S13): Restrict preview access to author and moderators
    is_moderator = current_user.role in (UserRole.MODERATOR, UserRole.BUREAU, UserRole.VIEUX)
    if pr.author_id != current_user.id and not is_moderator:
        raise ForbiddenError("You are not authorized to preview this pull request")

    if op_index >= len(pr.payload):
        raise BadRequestError("Operation index out of range")

    op = pr.payload[op_index]
    if not op.get("file_key"):
        raise NotFoundError("No file to preview for this operation")

    from app.core.storage import generate_presigned_get

    file_key = op["file_key"]
    # After approval, files are moved from uploads/ to materials/
    if pr.status == "approved" and file_key.startswith("uploads/"):
        file_key = file_key.replace("uploads/", "materials/", 1)

    # Refuse to serve unscanned quarantine files
    if file_key.startswith("quarantine/"):
        raise BadRequestError("File is still being processed and cannot be previewed yet.")

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

    return PRCommentOut.model_validate(c)
