import logging
import uuid
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import delete, desc, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core.database import get_db
from app.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from app.core.storage import object_exists
from app.dependencies.auth import get_current_user
from app.models.material import Material, MaterialVersion
from app.models.pull_request import PRComment, PRFileClaim, PRStatus, PullRequest
from app.models.security import VirusScanResult
from app.models.upload import Upload
from app.models.user import User, UserRole
from app.schemas.pull_request import (
    PRCommentCreate,
    PRCommentOut,
    PullRequestCreate,
    PullRequestOut,
    RejectRequest,
)
from app.services.notification import notify_user
from app.services.pr import apply_pr

logger = logging.getLogger("wikint")

router = APIRouter(prefix="/api/pull-requests", tags=["pull-requests"])


@router.post("", response_model=PullRequestOut, status_code=201)
async def create_pull_request(
    data: PullRequestCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PullRequestOut:
    is_privileged = current_user.role in (UserRole.MODERATOR, UserRole.BUREAU, UserRole.VIEUX)

    if not is_privileged:
        if len(data.operations) > 50:
            raise BadRequestError("You can include at most 50 changes per contribution")
        for op in data.operations:
            if (
                getattr(op, "op", None) == "create_material"
                and len(getattr(op, "attachments", [])) > 50
            ):
                raise BadRequestError("You can add at most 50 attachments per document")
    else:
        if len(data.operations) > 500:
            raise BadRequestError("You can include at most 500 changes per contribution")

    # Open PR limit for non-bureau/vieux users (moderators are subject to this limit
    # only for their own contributions; they can approve any number of others' PRs)
    if current_user.role not in (UserRole.BUREAU, UserRole.VIEUX, UserRole.MODERATOR):
        open_count = await db.scalar(
            select(func.count())
            .select_from(PullRequest)
            .where(
                PullRequest.author_id == current_user.id,
                PullRequest.status == PRStatus.OPEN,
            )
        )
        if open_count and open_count >= 5:
            raise BadRequestError(
                "You already have 5 contributions pending review. "
                "Wait for one to be reviewed before submitting another."
            )

    # Validate file_key ownership.
    # V2 CAS keys (cas/{hmac}) are shared — ownership is verified via the
    # Upload table (the user must have a clean Upload row with that final_key).
    user_upload_prefix = f"uploads/{current_user.id}/"
    cas_prefix = "cas/"
    keys_to_check: set[str] = set()
    for op in data.operations:
        file_key = getattr(op, "file_key", None)
        if file_key:
            if not (file_key.startswith(user_upload_prefix) or file_key.startswith(cas_prefix)):
                raise BadRequestError("One of the attached files does not belong to your account")
            keys_to_check.add(file_key)

        if op.op == "create_material":
            for att in getattr(op, "attachments", []):
                att_fk = (
                    att.file_key
                    if hasattr(att, "file_key")
                    else (att.get("file_key") if isinstance(att, dict) else None)
                )
                if att_fk:
                    if not (att_fk.startswith(user_upload_prefix) or att_fk.startswith(cas_prefix)):
                        raise BadRequestError("One of the attachment files does not belong to your account")
                    keys_to_check.add(att_fk)

            pmid = getattr(op, "parent_material_id", None)
            if pmid and isinstance(pmid, uuid.UUID):
                parent_mat = await db.scalar(select(Material).where(Material.id == pmid))
                if parent_mat and parent_mat.parent_material_id is not None:
                    raise BadRequestError("Cannot attach a material to another attachment")

    if keys_to_check:
        # 1. Validate existence in storage
        import asyncio

        existence_results = await asyncio.gather(*(object_exists(k) for k in keys_to_check))
        for key, exists in zip(keys_to_check, existence_results):
            if not exists:
                raise BadRequestError(
                    "One or more uploaded files could not be found. "
                    "They may have expired — try uploading again."
                )

        # 2. Verify scan results via DB (Issue S6)
        # For CAS keys: verify the user has a clean Upload row with this final_key
        stmt = select(Upload.final_key).where(
            Upload.final_key.in_(list(keys_to_check)),
            Upload.status == "clean",
            Upload.user_id == current_user.id,
        )
        clean_keys = set(await db.scalars(stmt))
        for key in keys_to_check:
            if key not in clean_keys:
                raise BadRequestError(
                    "One or more files are still being processed or could not be verified. "
                    "Please wait a moment and try again."
                )

    # Serialize operations to list[dict]
    ops_payload = [op.model_dump(mode="json") for op in data.operations]
    summary_types = sorted({op.op for op in data.operations})

    has_file = any(
        op_dict.get("file_key")
        or any(
            isinstance(att, dict) and att.get("file_key")
            for att in (op_dict.get("attachments") or [])
        )
        for op_dict in ops_payload
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

    # Claim file keys atomically via DB unique constraint.
    # This replaces the previous Redis global lock + JSONB scan approach:
    # the PRIMARY KEY on pr_file_claims.file_key means any concurrent PR
    # trying to claim the same file will get an IntegrityError.
    if keys_to_check:
        for fk in keys_to_check:
            db.add(PRFileClaim(file_key=fk, pr_id=pr.id))
        try:
            await db.flush()
        except IntegrityError:
            raise BadRequestError(
                "One or more files are already included in another pending contribution. "
                "Please wait for that contribution to be reviewed first."
            )

    # Auto-approve for privileged users if their setting is enabled
    if current_user.role in (UserRole.BUREAU, UserRole.VIEUX) and current_user.auto_approve:
        pr.status = PRStatus.APPROVED
        pr.reviewed_by = current_user.id
        await apply_pr(db, pr, current_user.id)
        # Release claims immediately — PR is already approved
        await db.execute(delete(PRFileClaim).where(PRFileClaim.pr_id == pr.id))
        await db.flush()

    await db.refresh(pr, ["author", "created_at", "updated_at"])
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
    base_stmt = select(PullRequest)
    if status:
        base_stmt = base_stmt.where(PullRequest.status == status)
    if type:
        base_stmt = base_stmt.where(PullRequest.type == type)
    if author_id:
        base_stmt = base_stmt.where(PullRequest.author_id == author_id)

    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    total_count = await db.scalar(count_stmt) or 0
    response.headers["X-Total-Count"] = str(total_count)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    stmt = (
        base_stmt.options(selectinload(PullRequest.author))
        .order_by(desc(PullRequest.created_at))
        .offset((page - 1) * limit)
        .limit(limit)
    )
    result = await db.execute(stmt)
    prs = result.scalars().all()

    return [PullRequestOut.model_validate(pr) for pr in prs]


@router.get("/for-item", response_model=list[PullRequestOut])
async def list_pull_requests_for_item(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    target_type: str = Query(alias="targetType"),
    target_id: str = Query(alias="targetId"),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
) -> list[PullRequestOut]:
    """
    Search within the JSONB array payload for operations referencing
    the given target item.  Uses a lateral jsonb_array_elements query.
    """
    base_stmt = select(PullRequest).options(selectinload(PullRequest.author)).where(
        PullRequest.status == PRStatus.OPEN
    )

    if db.bind.dialect.name == "sqlite":
        # SQLite fallback: fetch all open PRs and filter in Python
        result = await db.execute(base_stmt.order_by(desc(PullRequest.created_at)))
        prs = result.scalars().all()
        filtered = []
        for pr in prs:
            match = False
            for op in pr.payload:
                if target_type == "material":
                    if (
                        op.get("material_id") == target_id
                        or op.get("parent_material_id") == target_id
                    ):
                        match = True
                        break
                elif target_type == "directory":
                    if target_id == "root":
                        if (
                            (op.get("op") == "create_material" and op.get("directory_id") is None)
                            or (op.get("op") == "create_directory" and op.get("parent_id") is None)
                            or (op.get("op") == "move_item" and op.get("new_parent_id") is None)
                        ):
                            match = True
                            break
                    else:
                        if (
                            op.get("directory_id") == target_id
                            or op.get("parent_id") == target_id
                            or op.get("new_parent_id") == target_id
                        ):
                            match = True
                            break
            if match:
                filtered.append(pr)
        total_count = len(filtered)
        prs = filtered[(page - 1) * limit : page * limit]
    else:
        if target_type == "material":
            stmt = base_stmt.where(
                text(
                    "EXISTS (SELECT 1 FROM jsonb_array_elements(payload) elem "
                    "WHERE elem->>'material_id' = :tid "
                    "OR elem->>'parent_material_id' = :tid)"
                ).bindparams(tid=target_id)
            )
        elif target_type == "directory":
            if target_id == "root":
                stmt = base_stmt.where(
                    text(
                        "EXISTS (SELECT 1 FROM jsonb_array_elements(payload) elem "
                        "WHERE (elem->>'op' = 'create_material' AND elem->>'directory_id' IS NULL) "
                        "OR (elem->>'op' = 'create_directory' AND elem->>'parent_id' IS NULL) "
                        "OR (elem->>'op' = 'move_item' AND elem->>'new_parent_id' IS NULL))"
                    )
                )
            else:
                stmt = base_stmt.where(
                    text(
                        "EXISTS (SELECT 1 FROM jsonb_array_elements(payload) elem "
                        "WHERE elem->>'directory_id' = :tid "
                        "OR elem->>'parent_id' = :tid "
                        "OR elem->>'new_parent_id' = :tid)"
                    ).bindparams(tid=target_id)
                )
        else:
            raise BadRequestError("Invalid targetType")

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total_count = await db.scalar(count_stmt) or 0

        paginated_stmt = (
            stmt.order_by(desc(PullRequest.created_at))
            .offset((page - 1) * limit)
            .limit(limit)
        )
        result = await db.execute(paginated_stmt)
        prs = result.scalars().all()

    response.headers["X-Total-Count"] = str(total_count)
    response.headers["Access-Control-Expose-Headers"] = "X-Total-Count"

    return [PullRequestOut.model_validate(pr) for pr in prs]


@router.get("/{id}", response_model=PullRequestOut)
async def get_pull_request(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PullRequestOut:
    pr = await db.scalar(
        select(PullRequest).options(joinedload(PullRequest.author)).where(PullRequest.id == id)
    )
    if not pr:
        raise NotFoundError("Pull request not found")
    return PullRequestOut.model_validate(pr)

@router.post("/{id}/approve")
async def approve_pull_request(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, Any]:
    if current_user.role not in (UserRole.MODERATOR, UserRole.BUREAU, UserRole.VIEUX):
        raise ForbiddenError("Moderator rights required")

    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    if pr.status != PRStatus.OPEN:
        raise BadRequestError("This contribution is no longer open")

    pr.status = PRStatus.APPROVED
    pr.reviewed_by = current_user.id

    await apply_pr(db, pr, current_user.id)

    # Release file claims — files have been moved to their permanent locations
    await db.execute(delete(PRFileClaim).where(PRFileClaim.pr_id == pr.id))

    await db.commit()

    if pr.author_id:
        await notify_user(
            db,
            pr.author_id,
            "pr_approved",
            f'Your contribution "{pr.title}" was published',
            link=f"/pull-requests/{pr.id}",
        )
    return {"status": "ok"}


@router.post("/{id}/reject")
async def reject_pull_request(
    id: uuid.UUID,
    data: RejectRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, Any]:
    if current_user.role not in (UserRole.MODERATOR, UserRole.BUREAU, UserRole.VIEUX):
        raise ForbiddenError("Moderator rights required")

    pr = await db.scalar(select(PullRequest).where(PullRequest.id == id))
    if not pr:
        raise NotFoundError("Pull request not found")

    if pr.status != PRStatus.OPEN:
        raise BadRequestError("This contribution is no longer open")

    pr.status = PRStatus.REJECTED
    pr.reviewed_by = current_user.id
    pr.rejection_reason = data.reason

    # Collect uploads/ staging files to delete via background worker.
    # CAS keys are not deleted here — the upload cleanup worker handles
    # CAS ref decrements when upload rows expire.
    uploads_to_delete: list[str] = []
    for op in pr.payload:
        fk = op.get("file_key")
        if fk and str(fk).startswith("uploads/"):
            uploads_to_delete.append(str(fk))
        attachments = op.get("attachments")
        if isinstance(attachments, list):
            for att in attachments:
                att_fk = att.get("file_key") if isinstance(att, dict) else None
                if att_fk and str(att_fk).startswith("uploads/"):
                    uploads_to_delete.append(str(att_fk))

    if uploads_to_delete:
        db.info["post_commit_jobs"].append(("delete_storage_objects", uploads_to_delete))

    # Release file claims so the same files can be referenced by future PRs
    await db.execute(delete(PRFileClaim).where(PRFileClaim.pr_id == pr.id))

    await db.commit()

    if pr.author_id:
        await notify_user(
            db,
            pr.author_id,
            "pr_rejected",
            f'Your contribution "{pr.title}" was not accepted',
            link=f"/pull-requests/{pr.id}",
        )
    return {"status": "ok"}


@router.get("/{id}/diff")
async def get_pull_request_diff(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, Any]:
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
) -> dict[str, Any]:
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

    file_key = op.get("file_key")
    file_name = op.get("file_name")
    file_mime_type = op.get("file_mime_type")

    # Handle move_item preview resolution
    if not file_key and op.get("op") == "move_item" and op.get("target_type") == "material":
        target_id_raw = op.get("target_id")
        if target_id_raw:
            target_id_str = str(target_id_raw)
            if target_id_str.startswith("$"):
                # Reference to a temp_id in the same PR (e.g. moving a newly created item)
                source_op = next((o for o in pr.payload if o.get("temp_id") == target_id_str), None)
                if source_op:
                    file_key = cast(str | None, source_op.get("file_key"))
                    file_name = cast(str | None, source_op.get("file_name"))
                    file_mime_type = cast(str | None, source_op.get("file_mime_type"))
            else:
                # Reference to a real material UUID
                try:
                    target_uuid = uuid.UUID(target_id_str)
                    # Fetch latest material version
                    mv = await db.scalar(
                        select(MaterialVersion)
                        .where(MaterialVersion.material_id == target_uuid)
                        .order_by(desc(MaterialVersion.version_number))
                        .limit(1)
                    )
                    if mv:
                        file_key = mv.file_key
                        file_name = mv.file_name
                        file_mime_type = mv.file_mime_type
                except (ValueError, TypeError):
                    pass

    if not file_key:
        raise NotFoundError("No file to preview for this operation")

    from app.core.storage import generate_presigned_get

    file_key_str = cast(str, file_key)
    file_name_str = cast(str | None, file_name)
    file_mime_type_str = cast(str | None, file_mime_type)

    # Legacy V1: after approval, files were moved from uploads/ to materials/
    if pr.status == "approved" and file_key_str.startswith("uploads/"):
        file_key_str = file_key_str.replace("uploads/", "materials/", 1)

    # Refuse to serve unscanned quarantine files
    if file_key_str.startswith("quarantine/"):
        raise BadRequestError("File is still being processed and cannot be previewed yet.")

    url = await generate_presigned_get(
        file_key_str,
        filename=file_name_str,
        content_type=file_mime_type_str,
    )
    return {
        "url": url,
        "file_name": file_name_str,
        "file_mime_type": file_mime_type_str,
    }


@router.get("/{id}/comments", response_model=list[PRCommentOut])
async def list_pull_request_comments(
    id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[PRCommentOut]:
    stmt = (
        select(PRComment)
        .options(joinedload(PRComment.author))
        .where(PRComment.pr_id == id)
        .order_by(PRComment.created_at)
    )
    res = await db.execute(stmt)
    comments = list(res.scalars().all())
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
