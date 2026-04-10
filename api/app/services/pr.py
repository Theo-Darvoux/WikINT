import re
import typing
import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError
from app.models.directory import Directory
from app.models.material import Material, MaterialVersion
from app.models.pull_request import PullRequest
from app.models.security import VirusScanResult
from app.models.tag import Tag
from app.services.directory import slugify
from app.services.tag import get_or_create_tags

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _is_temp_id(value: str | None) -> bool:
    """Check if a value is a $-prefixed temporary inter-reference ID."""
    return isinstance(value, str) and value.startswith("$")


def _resolve(value: str | None, id_map: dict[str, uuid.UUID]) -> uuid.UUID | None:
    """Resolve a value that may be a temp ID, a real UUID string, or None."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if _is_temp_id(s):
        resolved = id_map.get(s)
        if resolved is None:
            raise BadRequestError(f"Unresolved temp_id reference: {s}")
        return resolved
    try:
        return uuid.UUID(s)
    except ValueError:
        raise BadRequestError(f"Invalid UUID: {s}")


def _collect_temp_refs(op: dict[str, typing.Any]) -> set[str]:
    """Collect all $-prefixed references from an operation dict (not its own temp_id)."""
    refs: set[str] = set()
    for key, val in op.items():
        if key == "temp_id":
            continue
        if isinstance(val, str) and _is_temp_id(val):
            refs.add(val)
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, dict):
                    for v2 in item.values():
                        if isinstance(v2, str) and _is_temp_id(v2):
                            refs.add(v2)
    return refs


def _slug_pattern(base: str) -> re.Pattern[str]:
    """Compile a pattern matching exactly `base` or `base-<digits>`."""
    return re.compile(r"^" + re.escape(base) + r"(?:-\d+)?$")


async def _unique_material_slug(
    db: AsyncSession,
    directory_id: uuid.UUID | None,
    title: str,
    exclude_id: uuid.UUID | None = None,
) -> str:
    """Generate a slug unique within the directory, appending -2, -3, … on collision.

    Uses SELECT ... FOR UPDATE to prevent race conditions between concurrent
    PR applications. Post-filters the LIKE results to only count exact matches
    (`base` or `base-<digits>`), avoiding false collisions with slugs that
    merely share a prefix (e.g. `linear-algebra` vs `linear-algebra-notes`).
    """
    base = slugify(title) or "untitled"
    pattern = _slug_pattern(base)

    stmt = (
        select(Material.slug)
        .where((Material.slug == base) | Material.slug.like(f"{base}-%"))
        .with_for_update()
    )
    if directory_id is None:
        stmt = stmt.where(Material.directory_id.is_(None))
    else:
        stmt = stmt.where(Material.directory_id == directory_id)

    if exclude_id:
        stmt = stmt.where(Material.id != exclude_id)

    result = await db.execute(stmt)
    # Only count slugs that are exactly `base` or `base-N` (digits only).
    existing = {s for s in result.scalars().all() if pattern.match(s)}

    if base not in existing:
        return base
    for i in range(2, len(existing) + 100):
        candidate = f"{base}-{i}"
        if candidate not in existing:
            return candidate
    return f"{base}-{uuid.uuid4().hex[:8]}"


async def _unique_directory_slug(
    db: AsyncSession,
    parent_id: uuid.UUID | None,
    name: str,
    exclude_id: uuid.UUID | None = None,
) -> str:
    """Generate a slug unique among sibling directories.

    Uses SELECT ... FOR UPDATE to prevent race conditions. Same prefix-collision
    fix as _unique_material_slug.
    """
    base = slugify(name) or "untitled"
    pattern = _slug_pattern(base)

    stmt = (
        select(Directory.slug)
        .where((Directory.slug == base) | Directory.slug.like(f"{base}-%"))
        .with_for_update()
    )
    if parent_id is None:
        stmt = stmt.where(Directory.parent_id.is_(None))
    else:
        stmt = stmt.where(Directory.parent_id == parent_id)

    if exclude_id:
        stmt = stmt.where(Directory.id != exclude_id)

    result = await db.execute(stmt)
    existing = {s for s in result.scalars().all() if pattern.match(s)}

    if base not in existing:
        return base
    for i in range(2, len(existing) + 100):
        candidate = f"{base}-{i}"
        if candidate not in existing:
            return candidate
    return f"{base}-{uuid.uuid4().hex[:8]}"


def topo_sort_operations(operations: list[dict[str, typing.Any]]) -> list[dict[str, typing.Any]]:
    """
    Topologically sort operations so that any op defining a temp_id
    comes before ops referencing that temp_id.  Preserves submission
    order when there are no dependencies.
    """
    n = len(operations)
    # Build mapping: temp_id -> index of the defining op
    definer: dict[str, int] = {}
    for i, op in enumerate(operations):
        tid = op.get("temp_id")
        if tid:
            definer[tid] = i

    # Build adjacency: edges[i] = set of indices that must come before i
    deps: dict[int, set[int]] = defaultdict(set)
    for i, op in enumerate(operations):
        for ref in _collect_temp_refs(op):
            if ref in definer:
                deps[i].add(definer[ref])

    # Kahn's algorithm maintaining original order via index-based BFS
    in_degree = [0] * n
    for i in range(n):
        in_degree[i] = len(deps[i])

    queue: list[int] = [i for i in range(n) if in_degree[i] == 0]
    result: list[int] = []

    while queue:
        # Take the item with the lowest original index (stable order)
        queue.sort()
        idx = queue.pop(0)
        result.append(idx)
        # Release dependents
        for j in range(n):
            if idx in deps[j]:
                deps[j].discard(idx)
                in_degree[j] -= 1
                if in_degree[j] == 0:
                    queue.append(j)

    if len(result) != n:
        raise BadRequestError("Cyclic dependency detected among temp_id references")

    return [operations[i] for i in result]


async def _resolve_mime_type(
    file_key: str, payload: dict[str, typing.Any], s3_mime: str | None = None
) -> str:
    """Determine MIME type. Trusts S3 metadata or payload hint over re-scanning."""
    if s3_mime and s3_mime != "application/octet-stream":
        return s3_mime

    # Fall back to client-provided hint if S3 mime is generic
    return payload.get("file_mime_type") or "application/octet-stream"


async def _get_file_info(file_key: str) -> dict[str, typing.Any]:
    """Read the actual file size and content type from object storage."""
    from app.core.storage import get_object_info

    info = await get_object_info(file_key)
    return info


# ---------------------------------------------------------------------------
# Individual operation executors
# ---------------------------------------------------------------------------


async def _exec_create_material(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    tags = p.get("tags", [])
    await get_or_create_tags(db, tags)
    normalized = [t.strip().lower() for t in tags if t.strip()]
    tag_objs = []
    if normalized:
        tag_result = await db.execute(select(Tag).where(Tag.name.in_(normalized)))
        tag_objs = list(tag_result.scalars().all())

    mat_id = uuid.uuid4()
    directory_id = _resolve(str(p.get("directory_id")) if p.get("directory_id") else None, id_map)

    slug = await _unique_material_slug(db, directory_id, p["title"])
    m = Material(
        id=mat_id,
        directory_id=directory_id,
        title=p["title"],
        slug=slug,
        description=p.get("description"),
        type=p["type"],
        parent_material_id=_resolve(
            str(p["parent_material_id"]) if p.get("parent_material_id") else None,
            id_map,
        ),
        author_id=pr.author_id,
        metadata_=p.get("metadata", {}),
        tags=tag_objs,
    )
    db.add(m)
    await db.flush()

    if p.get("file_key"):
        file_key = str(p["file_key"])

        # CAS V2: file_key is already a cas/ key — no copy needed.
        # Get size/mime from the payload (populated by the upload flow)
        # with S3 HEAD fallback for legacy uploads/ keys.
        if file_key.startswith("cas/"):
            real_size = p.get("file_size") or 0
            mime_type = p.get("file_mime_type") or "application/octet-stream"
        else:
            # Legacy V1 path: uploads/ key — copy to materials/
            info = await _get_file_info(file_key)
            real_size = info["size"]
            mime_type = await _resolve_mime_type(file_key, p, s3_mime=info.get("content_type"))
            from app.core.storage import copy_object

            new_key = file_key.replace("uploads/", "materials/", 1)
            await copy_object(file_key, new_key)
            file_key = new_key
            db.info.setdefault("post_commit_jobs", []).append(
                ("delete_storage_objects", [str(p["file_key"])])
            )

        mv = MaterialVersion(
            id=uuid.uuid4(),
            material_id=m.id,
            version_number=1,
            file_key=file_key,
            file_name=p.get("file_name"),
            file_size=real_size,
            file_mime_type=mime_type,
            cas_sha256=p.get("content_sha256"),
            author_id=pr.author_id,
            pr_id=pr.id,
            virus_scan_result=VirusScanResult.CLEAN,
        )
        db.add(mv)
        await db.flush()

        # CAS V2: increment ref for the MaterialVersion, then schedule
        # decrement of the staging upload's ref post-commit.
        if mv.file_key and mv.file_key.startswith("cas/"):
            from app.core.cas import increment_cas_ref

            if mv.cas_sha256:
                from app.core.redis import redis_client

                await increment_cas_ref(redis_client, mv.cas_sha256)
            # The staging upload's CAS ref will be decremented when the
            # upload row expires or is cleaned up by the cleanup worker.

    # attachments
    if p.get("attachments"):
        sys_dir = Directory(
            id=uuid.uuid4(),
            name=f"attachments:{m.id}",
            slug=f"sys-attach-{m.id}",
            type="folder",
            is_system=True,
            created_by=pr.author_id,
        )
        db.add(sys_dir)
        await db.flush()

        for att in p["attachments"]:
            att_tags = att.get("tags", [])
            await get_or_create_tags(db, att_tags)
            att_slug = await _unique_material_slug(db, sys_dir.id, att["title"])
            att_m = Material(
                id=uuid.uuid4(),
                directory_id=sys_dir.id,
                title=att["title"],
                slug=att_slug,
                type=att["type"],
                parent_material_id=m.id,
                author_id=pr.author_id,
                tags=att_tags,
                metadata_=att.get("metadata", {}),
            )
            db.add(att_m)
            await db.flush()

            if att.get("file_key"):
                att_fk = str(att["file_key"])

                if att_fk.startswith("cas/"):
                    att_real_size = att.get("file_size") or 0
                    att_mime = att.get("file_mime_type") or "application/octet-stream"
                else:
                    att_info = await _get_file_info(att_fk)
                    att_real_size = att_info["size"]
                    att_mime = await _resolve_mime_type(
                        att_fk, att, s3_mime=att_info.get("content_type")
                    )
                    from app.core.storage import copy_object

                    new_att_fk = att_fk.replace("uploads/", "materials/", 1)
                    await copy_object(att_fk, new_att_fk)
                    db.info.setdefault("post_commit_jobs", []).append(
                        ("delete_storage_objects", [att_fk])
                    )
                    att_fk = new_att_fk

                v = MaterialVersion(
                    id=uuid.uuid4(),
                    material_id=att_m.id,
                    version_number=1,
                    file_key=att_fk,
                    file_name=att.get("file_name"),
                    file_size=att_real_size,
                    file_mime_type=att_mime,
                    cas_sha256=att.get("content_sha256"),
                    author_id=pr.author_id,
                    pr_id=pr.id,
                    virus_scan_result=VirusScanResult.CLEAN,
                )
                db.add(v)
                await db.flush()

                if v.file_key and v.file_key.startswith("cas/") and v.cas_sha256:
                    from app.core.cas import increment_cas_ref
                    from app.core.redis import redis_client

                    await increment_cas_ref(redis_client, v.cas_sha256)

    db.info.setdefault("post_commit_jobs", []).append(("index_material", mat_id))

    return mat_id


async def _exec_edit_material(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    mat_id = _resolve(str(p["material_id"]), id_map)
    mat = await db.scalar(
        select(Material).where(Material.id == mat_id).options(selectinload(Material.tags))
    )
    if not mat:
        raise NotFoundError("Material not found")

    if p.get("title") is not None:
        mat.title = p["title"]
        mat.slug = await _unique_material_slug(db, mat.directory_id, p["title"], exclude_id=mat.id)
    if p.get("type") is not None:
        mat.type = p["type"]
    if p.get("description") is not None:
        mat.description = p["description"]
    if p.get("tags") is not None:
        await get_or_create_tags(db, p["tags"])
        normalized = [t.strip().lower() for t in p["tags"] if t.strip()]
        tag_result = await db.execute(select(Tag).where(Tag.name.in_(normalized)))
        mat.tags = list(tag_result.scalars().all())
    if p.get("metadata") is not None:
        mat.metadata_ = p["metadata"]

    if p.get("file_key"):
        file_key = str(p["file_key"])

        # CAS V2: file_key is already a cas/ key — no copy needed.
        if file_key.startswith("cas/"):
            real_size = p.get("file_size") or 0
            mime_type = p.get("file_mime_type") or "application/octet-stream"
        else:
            info = await _get_file_info(file_key)
            real_size = info["size"]
            mime_type = await _resolve_mime_type(file_key, p, s3_mime=info.get("content_type"))
            from app.core.storage import copy_object

            new_key = file_key.replace("uploads/", "materials/", 1)
            await copy_object(file_key, new_key)
            file_key = new_key
            db.info.setdefault("post_commit_jobs", []).append(
                ("delete_storage_objects", [str(p["file_key"])])
            )

        # Optimistic locking (3.11): fetch the latest MaterialVersion to check version_lock
        # and to set the next value. Only enforced when the PR payload includes version_lock.
        from sqlalchemy import select as _sel

        _latest_mv = await db.scalar(
            _sel(MaterialVersion)
            .where(MaterialVersion.material_id == mat.id)
            .order_by(MaterialVersion.version_number.desc())
            .limit(1)
        )
        if "version_lock" in p and _latest_mv is not None:
            if _latest_mv.version_lock != p["version_lock"]:
                raise ConflictError(
                    f"Optimistic lock conflict on material {mat.id}: "
                    f"expected version_lock={p['version_lock']}, "
                    f"found {_latest_mv.version_lock}. "
                    "Another edit was applied after this PR was submitted."
                )

        _next_version_lock = (_latest_mv.version_lock + 1) if _latest_mv is not None else 0

        mv = MaterialVersion(
            id=uuid.uuid4(),
            material_id=mat.id,
            version_number=mat.current_version + 1,
            file_key=file_key,
            file_name=p.get("file_name"),
            file_size=real_size,
            file_mime_type=mime_type,
            cas_sha256=p.get("content_sha256"),
            author_id=pr.author_id,
            diff_summary=p.get("diff_summary"),
            pr_id=pr.id,
            virus_scan_result=VirusScanResult.CLEAN,
            version_lock=_next_version_lock,
        )
        mat.current_version += 1
        db.add(mv)
        await db.flush()

        if mv.file_key and mv.file_key.startswith("cas/") and mv.cas_sha256:
            from app.core.cas import increment_cas_ref
            from app.core.redis import redis_client

            await increment_cas_ref(redis_client, mv.cas_sha256)

    db.info.setdefault("post_commit_jobs", []).append(("index_material", mat.id))

    return mat.id


async def _exec_delete_material(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    mat_id = _resolve(str(p["material_id"]), id_map)
    mat = await db.scalar(select(Material).where(Material.id == mat_id))
    if not mat:
        raise NotFoundError("Material not found")

    deleted_id = mat.id

    # Collect file keys to delete / CAS refs to decrement
    file_keys_to_delete: list[str] = []
    versions = await db.scalars(
        select(MaterialVersion).where(MaterialVersion.material_id == deleted_id)
    )
    for v in versions:
        if v.file_key:
            file_keys_to_delete.append(v.file_key)

    await db.delete(mat)

    sys_dir = await db.scalar(select(Directory).where(Directory.name == f"attachments:{mat.id}"))
    if sys_dir:
        att_mats = await db.scalars(select(Material).where(Material.directory_id == sys_dir.id))
        att_mat_ids = [m.id for m in att_mats]
        if att_mat_ids:
            att_versions = await db.scalars(
                select(MaterialVersion).where(MaterialVersion.material_id.in_(att_mat_ids))
            )
            for av in att_versions:
                if av.file_key:
                    file_keys_to_delete.append(av.file_key)

        await db.delete(sys_dir)

    db.info.setdefault("post_commit_jobs", []).append(
        ("delete_indexed_item", "materials", str(deleted_id))
    )

    # CAS V2: delete_storage_objects already handles cas/ keys via ref
    # counting (decrement, only delete S3 object at ref_count=0).
    if file_keys_to_delete:
        db.info.setdefault("post_commit_jobs", []).append(
            ("delete_storage_objects", file_keys_to_delete)
        )

    return deleted_id


async def _exec_create_directory(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    tags = p.get("tags", [])
    tag_objs = []
    if tags:
        await get_or_create_tags(db, tags)
        normalized = [t.strip().lower() for t in tags if t.strip()]
        tag_result = await db.execute(select(Tag).where(Tag.name.in_(normalized)))
        tag_objs = list(tag_result.scalars().all())

    dir_id = uuid.uuid4()
    parent_id = _resolve(str(p["parent_id"]) if p.get("parent_id") else None, id_map)
    dir_slug = await _unique_directory_slug(db, parent_id, p["name"])
    d = Directory(
        id=dir_id,
        name=p["name"],
        slug=dir_slug,
        type=p.get("type", "folder"),
        description=p.get("description"),
        parent_id=parent_id,
        tags=tag_objs,
        metadata_=p.get("metadata", {}),
        created_by=pr.author_id,
    )
    db.add(d)
    await db.flush()

    db.info.setdefault("post_commit_jobs", []).append(("index_directory", d.id))

    return dir_id


async def _exec_edit_directory(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    dir_id = _resolve(str(p["directory_id"]), id_map)
    dir_obj = await db.scalar(
        select(Directory).where(Directory.id == dir_id).options(selectinload(Directory.tags))
    )
    if not dir_obj:
        raise NotFoundError("Directory not found")

    if p.get("name") is not None:
        dir_obj.name = p["name"]
        dir_obj.slug = await _unique_directory_slug(
            db, dir_obj.parent_id, p["name"], exclude_id=dir_obj.id
        )
    if p.get("type") is not None:
        dir_obj.type = p["type"]
    if p.get("description") is not None:
        dir_obj.description = p["description"]
    if p.get("tags") is not None:
        await get_or_create_tags(db, p["tags"])
        normalized = [t.strip().lower() for t in p["tags"] if t.strip()]
        tag_result = await db.execute(select(Tag).where(Tag.name.in_(normalized)))
        dir_obj.tags = list(tag_result.scalars().all())
    if p.get("metadata") is not None:
        dir_obj.metadata_ = p["metadata"]

    await db.flush()
    db.info.setdefault("post_commit_jobs", []).append(("index_directory", dir_obj.id))

    return dir_obj.id


async def _exec_delete_directory(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    dir_id = _resolve(str(p["directory_id"]), id_map)
    dir_obj = await db.scalar(select(Directory).where(Directory.id == dir_id))
    if not dir_obj:
        raise NotFoundError("Directory not found")

    deleted_id = dir_obj.id
    await db.delete(dir_obj)

    db.info.setdefault("post_commit_jobs", []).append(
        ("delete_indexed_item", "directories", str(deleted_id))
    )

    return deleted_id


async def _exec_move_item(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    target_id = _resolve(str(p["target_id"]), id_map)

    if p["target_type"] == "directory":
        dir_obj = await db.scalar(select(Directory).where(Directory.id == target_id))
        if not dir_obj:
            raise NotFoundError("Directory not found")
        new_parent_id = _resolve(
            str(p["new_parent_id"]) if p.get("new_parent_id") else None, id_map
        )
        # Reject self-move and circular ancestry
        if new_parent_id == target_id:
            raise BadRequestError("Cannot move a directory into itself")
        if new_parent_id is not None:
            # Walk up from new_parent to ensure target is not an ancestor
            check_id: uuid.UUID | None = new_parent_id
            seen: set[uuid.UUID] = set()
            while check_id:
                if check_id == target_id:
                    raise BadRequestError("Cannot move a directory into one of its own descendants")
                if check_id in seen:
                    break  # existing circular chain — stop
                seen.add(check_id)
                parent = await db.scalar(
                    select(Directory.parent_id).where(Directory.id == check_id)
                )
                check_id = parent
        dir_obj.parent_id = new_parent_id
        await db.flush()
        db.info.setdefault("post_commit_jobs", []).append(("index_directory", dir_obj.id))
        return dir_obj.id
    else:
        mat = await db.scalar(select(Material).where(Material.id == target_id))
        if not mat:
            raise NotFoundError("Material not found")
        new_parent = _resolve(str(p["new_parent_id"]) if p.get("new_parent_id") else None, id_map)
        mat.directory_id = new_parent
        # Re-slug to ensure uniqueness in new location
        mat.slug = await _unique_material_slug(db, new_parent, mat.title, exclude_id=mat.id)
        await db.flush()
        db.info.setdefault("post_commit_jobs", []).append(("index_material", mat.id))
        return mat.id


# Dispatch table
_EXECUTORS = {
    "create_material": _exec_create_material,
    "edit_material": _exec_edit_material,
    "delete_material": _exec_delete_material,
    "create_directory": _exec_create_directory,
    "edit_directory": _exec_edit_directory,
    "delete_directory": _exec_delete_directory,
    "move_item": _exec_move_item,
}


# ---------------------------------------------------------------------------
# Browse-path resolution (for post-approval links)
# ---------------------------------------------------------------------------


async def _build_browse_path(db: AsyncSession, op_type: str, result_id: uuid.UUID) -> str | None:
    """Build the slug-based browse path for a result item."""
    from app.services.directory import get_directory_path

    if "directory" in op_type:
        path_parts = await get_directory_path(db, result_id)
        if path_parts:
            return "/".join(p["slug"] for p in path_parts)
        return None

    if "material" in op_type:
        mat = await db.scalar(select(Material).where(Material.id == result_id))
        if not mat:
            return None
        if mat.directory_id is None:
            return mat.slug
        dir_parts = await get_directory_path(db, mat.directory_id)
        slugs = [p["slug"] for p in dir_parts]
        slugs.append(mat.slug)
        return "/".join(slugs)

    if op_type == "move_item":
        # Could be either; try directory first, then material
        d = await db.scalar(select(Directory).where(Directory.id == result_id))
        if d:
            path_parts = await get_directory_path(db, result_id)
            return "/".join(p["slug"] for p in path_parts) if path_parts else ""
        
        mat = await db.scalar(select(Material).where(Material.id == result_id))
        if mat:
            if mat.directory_id is None:
                return mat.slug
            dir_parts = await get_directory_path(db, mat.directory_id)
            slugs = [p["slug"] for p in dir_parts]
            slugs.append(mat.slug)
            return "/".join(slugs)

    return None


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


async def apply_pr(db: AsyncSession, pr: PullRequest, apply_user_id: uuid.UUID) -> None:
    """
    Execute all operations in a batch PR.  Operations are topologically sorted
    so that temp_id producers run before consumers, then executed sequentially
    within a single DB transaction.

    The original pr.payload is never mutated.  After execution, pr.applied_result
    is set to an enriched copy of the sorted operations, each annotated with:
      - result_id:          UUID string of the created/edited/deleted item
      - result_browse_path: slug-path usable as /browse/<path> (omitted for deletes
                            where the path could not be captured before deletion)
    """
    if pr.applied_result is not None:
        return

    sorted_ops = topo_sort_operations(list(pr.payload))
    id_map: dict[str, uuid.UUID] = {}
    result_ops: list[dict[str, typing.Any]] = []

    for op in sorted_ops:
        op_type = str(op.get("op") or op.get("pr_type") or "")  # pr_type for legacy rows
        if not op_type:
            raise BadRequestError(f"Operation missing 'op' field: {op}")

        executor = _EXECUTORS.get(op_type)
        if not executor:
            raise BadRequestError(f"Unknown operation type: {op_type}")

        is_delete = "delete" in op_type

        # For deletes, capture the browse path BEFORE the item is removed
        pre_delete_browse_path: str | None = None
        if is_delete:
            try:
                id_field = "directory_id" if "directory" in op_type else "material_id"
                raw_id = str(op.get(id_field, ""))
                target_uuid = _resolve(raw_id, id_map) if raw_id else None
                if target_uuid:
                    pre_delete_browse_path = await _build_browse_path(db, op_type, target_uuid)
            except Exception:
                pass

        result_id = await executor(db, op, pr, id_map)

        # Register temp_id -> real UUID for downstream inter-op references
        temp_id = str(op.get("temp_id")) if op.get("temp_id") else None
        if temp_id:
            id_map[temp_id] = result_id

        # Build the enriched operation record for applied_result
        enriched: dict[str, typing.Any] = dict(op)
        enriched["result_id"] = str(result_id)
        if is_delete and pre_delete_browse_path:
            enriched["result_browse_path"] = pre_delete_browse_path
        elif not is_delete:
            try:
                browse_path = await _build_browse_path(db, op_type, result_id)
                if browse_path:
                    enriched["result_browse_path"] = browse_path
            except Exception:
                pass  # non-critical; skip if path can't be resolved

        result_ops.append(enriched)

    # Store enriched results without touching the original payload
    pr.applied_result = result_ops
    flag_modified(pr, "applied_result")
