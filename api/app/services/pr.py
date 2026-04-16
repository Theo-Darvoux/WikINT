import re
import typing
import uuid
from collections import defaultdict
from datetime import UTC

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload
from sqlalchemy.orm.attributes import flag_modified

from app.core.exceptions import BadRequestError, ConflictError, NotFoundError
from app.models.directory import Directory
from app.models.material import Material, MaterialVersion
from app.models.pull_request import PRStatus, PullRequest
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


async def _enqueue_deindex_material_recursive(db: AsyncSession, material_id: uuid.UUID) -> None:
    """Recursively find all material attachments and their system directories to de-index them."""
    # 1. Find all descendant materials (recursive attachments)
    mat_cte = (
        select(Material.id)
        .where(Material.id == material_id)
        .cte(name="descendant_mats", recursive=True)
    )
    mat_alias = aliased(Material)
    mat_cte = mat_cte.union_all(
        select(mat_alias.id).join(mat_cte, mat_alias.parent_material_id == mat_cte.c.id)
    )

    all_mat_ids = (await db.scalars(select(mat_cte.c.id))).all()

    # 2. Find all associated system directories (attachments folders)
    # These directories are named "attachments:{material_id}"
    sys_dir_names = [f"attachments:{mid}" for mid in all_mat_ids]
    sys_dir_ids = (
        await db.scalars(select(Directory.id).where(Directory.name.in_(sys_dir_names)))
    ).all()

    # 3. Enqueue all discovered items
    for mid in all_mat_ids:
        db.info.setdefault("post_commit_jobs", []).append(
            ("delete_indexed_item", "materials", str(mid))
        )
    for did in sys_dir_ids:
        db.info.setdefault("post_commit_jobs", []).append(
            ("delete_indexed_item", "directories", str(did))
        )


async def _enqueue_reindex_directory_recursive(db: AsyncSession, directory_id: uuid.UUID) -> None:
    """Enqueue index_directory for a directory and all its descendants, plus their materials."""
    dir_cte = (
        select(Directory.id)
        .where(Directory.id == directory_id)
        .cte(name="reindex_descendant_dirs", recursive=True)
    )
    dir_alias = aliased(Directory)
    dir_cte = dir_cte.union_all(
        select(dir_alias.id).join(dir_cte, dir_alias.parent_id == dir_cte.c.id)
    )

    all_dir_ids = (await db.scalars(select(dir_cte.c.id))).all()

    mat_ids = (
        await db.scalars(select(Material.id).where(Material.directory_id.in_(all_dir_ids)))
    ).all()

    seen: set[tuple[str, str]] = db.info.setdefault("post_commit_job_keys", set())

    for did in all_dir_ids:
        key = ("index_directory", str(did))
        if key not in seen:
            seen.add(key)
            db.info.setdefault("post_commit_jobs", []).append(("index_directory", did))

    for mid in mat_ids:
        key = ("index_material", str(mid))
        if key not in seen:
            seen.add(key)
            db.info.setdefault("post_commit_jobs", []).append(("index_material", mid))


async def _enqueue_deindex_directory_recursive(db: AsyncSession, directory_id: uuid.UUID) -> None:
    """Recursively find all subdirectories and materials (including attachments) to de-index them."""
    # 1. Find all descendant directories (recursive subfolders)
    dir_cte = (
        select(Directory.id)
        .where(Directory.id == directory_id)
        .cte(name="descendant_dirs", recursive=True)
    )
    dir_alias = aliased(Directory)
    dir_cte = dir_cte.union_all(
        select(dir_alias.id).join(dir_cte, dir_alias.parent_id == dir_cte.c.id)
    )

    all_dir_ids = (await db.scalars(select(dir_cte.c.id))).all()

    # 2. Find all materials directly in these directories
    mat_ids = (
        await db.scalars(select(Material.id).where(Material.directory_id.in_(all_dir_ids)))
    ).all()

    # 3. For each material, perform recursive de-indexing (handles attachments in system dirs)
    for mid in mat_ids:
        await _enqueue_deindex_material_recursive(db, mid)

    # 4. Enqueue the directories themselves (dedup via set)
    seen_deindex: set[tuple[str, str, str]] = db.info.setdefault("post_commit_deindex_keys", set())
    for did in all_dir_ids:
        key = ("delete_indexed_item", "directories", str(did))
        if key not in seen_deindex:
            seen_deindex.add(key)
            db.info.setdefault("post_commit_jobs", []).append(key)


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


async def _resolve_thumbnail_key(db: AsyncSession, cas_file_key: str) -> str | None:
    """Return the thumbnail_key stored in the uploads table for the given CAS file key.

    When a file is processed by the upload pipeline the resulting WebP thumbnail
    path is persisted in `uploads.thumbnail_key` (e.g. ``thumbnails/<sha256>.webp``).
    This key must be copied to `MaterialVersion.thumbnail_key` so the thumbnail
    endpoint can serve it — previously this step was missing, causing all newly
    uploaded materials to have no thumbnail.
    """
    from app.models.upload import Upload as _Upload

    return await db.scalar(
        select(_Upload.thumbnail_key)
        .where(_Upload.final_key == cas_file_key)
        .where(_Upload.thumbnail_key.isnot(None))
        .order_by(_Upload.updated_at.desc())
        .limit(1)
    )


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

        # Resolve thumbnail_key from the upload record (CAS V2: keyed by final_key)
        thumbnail_key_val = await _resolve_thumbnail_key(db, file_key) if file_key.startswith("cas/") else None

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
            thumbnail_key=thumbnail_key_val,
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

                # Resolve thumbnail_key from the upload record
                att_thumb_key = await _resolve_thumbnail_key(db, att_fk) if att_fk.startswith("cas/") else None

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
                    thumbnail_key=att_thumb_key,
                )
                db.add(v)
                await db.flush()

                if v.file_key and v.file_key.startswith("cas/") and v.cas_sha256:
                    from app.core.cas import increment_cas_ref
                    from app.core.redis import redis_client

                    await increment_cas_ref(redis_client, v.cas_sha256)

    seen: set[tuple[str, str]] = db.info.setdefault("post_commit_job_keys", set())
    key = ("index_material", str(mat_id))
    if key not in seen:
        seen.add(key)
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

        # Resolve thumbnail_key from the upload record (CAS V2: keyed by final_key)
        edit_thumbnail_key = await _resolve_thumbnail_key(db, file_key) if file_key.startswith("cas/") else None

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
            thumbnail_key=edit_thumbnail_key,
        )
        mat.current_version += 1
        db.add(mv)
        await db.flush()

        if mv.file_key and mv.file_key.startswith("cas/") and mv.cas_sha256:
            from app.core.cas import increment_cas_ref
            from app.core.redis import redis_client

            await increment_cas_ref(redis_client, mv.cas_sha256)

    seen: set[tuple[str, str]] = db.info.setdefault("post_commit_job_keys", set())
    key = ("index_material", str(mat.id))
    if key not in seen:
        seen.add(key)
        db.info.setdefault("post_commit_jobs", []).append(("index_material", mat.id))

    return mat.id


async def _soft_delete_material_tree(db: AsyncSession, mat: Material) -> None:
    """Soft-delete a material and its attachment subtree (system dir + child materials)."""
    from datetime import datetime

    now = datetime.now(UTC)
    mat.deleted_at = now

    versions = await db.scalars(
        select(MaterialVersion)
        .where(MaterialVersion.material_id == mat.id)
        .execution_options(include_deleted=True)
    )
    for v in versions:
        v.deleted_at = now

    sys_dir = await db.scalar(select(Directory).where(Directory.name == f"attachments:{mat.id}"))
    if sys_dir:
        sys_dir.deleted_at = now
        att_mats = (
            await db.scalars(select(Material).where(Material.directory_id == sys_dir.id))
        ).all()
        for att in att_mats:
            att.deleted_at = now
            att_versions = await db.scalars(
                select(MaterialVersion)
                .where(MaterialVersion.material_id == att.id)
                .execution_options(include_deleted=True)
            )
            for av in att_versions:
                av.deleted_at = now


async def _exec_delete_material(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    mat_id = _resolve(str(p["material_id"]), id_map)
    mat = await db.scalar(select(Material).where(Material.id == mat_id))
    if not mat:
        raise NotFoundError("Material not found")

    deleted_id = mat.id

    await _enqueue_deindex_material_recursive(db, deleted_id)
    await _soft_delete_material_tree(db, mat)

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

    seen: set[tuple[str, str]] = db.info.setdefault("post_commit_job_keys", set())
    key = ("index_directory", str(d.id))
    if key not in seen:
        seen.add(key)
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

    name_or_slug_changed = p.get("name") is not None
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

    if name_or_slug_changed:
        # Rename propagates ancestor_path to all descendants — reindex the whole subtree.
        await _enqueue_reindex_directory_recursive(db, dir_obj.id)
    else:
        seen: set[tuple[str, str]] = db.info.setdefault("post_commit_job_keys", set())
        key = ("index_directory", str(dir_obj.id))
        if key not in seen:
            seen.add(key)
            db.info.setdefault("post_commit_jobs", []).append(("index_directory", dir_obj.id))

    return dir_obj.id


async def _soft_delete_directory_tree(db: AsyncSession, directory_id: uuid.UUID) -> None:
    """Soft-delete a directory and its entire subtree (children, materials, versions)."""
    from datetime import datetime

    now = datetime.now(UTC)

    dir_cte = (
        select(Directory.id)
        .where(Directory.id == directory_id)
        .cte(name="soft_del_dirs", recursive=True)
    )
    dir_alias = aliased(Directory)
    dir_cte = dir_cte.union_all(
        select(dir_alias.id).join(dir_cte, dir_alias.parent_id == dir_cte.c.id)
    )
    all_dir_ids = (await db.scalars(select(dir_cte.c.id))).all()

    for did in all_dir_ids:
        d = await db.get(Directory, did)
        if d:
            d.deleted_at = now

    mat_rows = (
        await db.scalars(select(Material).where(Material.directory_id.in_(all_dir_ids)))
    ).all()
    for mat in mat_rows:
        await _soft_delete_material_tree(db, mat)


async def _exec_delete_directory(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    dir_id = _resolve(str(p["directory_id"]), id_map)
    dir_obj = await db.scalar(select(Directory).where(Directory.id == dir_id))
    if not dir_obj:
        raise NotFoundError("Directory not found")

    deleted_id = dir_obj.id

    await _enqueue_deindex_directory_recursive(db, deleted_id)
    await _soft_delete_directory_tree(db, deleted_id)

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
        # Moving a directory changes ancestor_path for the whole subtree.
        await _enqueue_reindex_directory_recursive(db, dir_obj.id)
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
        seen: set[tuple[str, str]] = db.info.setdefault("post_commit_job_keys", set())
        key = ("index_material", str(mat.id))
        if key not in seen:
            seen.add(key)
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


async def _capture_pre_state(
    db: AsyncSession,
    op_type: str,
    op: dict[str, typing.Any],
    id_map: dict[str, uuid.UUID],
) -> dict[str, typing.Any] | None:
    """Snapshot the entity state before mutation for revertable ops."""
    pre: dict[str, typing.Any] = {}

    if op_type == "edit_material":
        mat_id = _resolve(str(op["material_id"]), id_map)
        mat = await db.scalar(
            select(Material).where(Material.id == mat_id).options(selectinload(Material.tags))
        )
        if not mat:
            return None
        pre = {
            "title": mat.title,
            "slug": mat.slug,
            "type": mat.type,
            "description": mat.description,
            "metadata": mat.metadata_,
            "tags": [t.name for t in mat.tags],
            "current_version": mat.current_version,
            "directory_id": str(mat.directory_id) if mat.directory_id else None,
        }
        if op.get("file_key"):
            latest_mv = await db.scalar(
                select(MaterialVersion)
                .where(MaterialVersion.material_id == mat.id)
                .order_by(MaterialVersion.version_number.desc())
                .limit(1)
            )
            if latest_mv:
                pre["prev_version_number"] = latest_mv.version_number
                pre["prev_file_key"] = latest_mv.file_key
                pre["prev_file_name"] = latest_mv.file_name
                pre["prev_cas_sha256"] = latest_mv.cas_sha256
        return pre

    if op_type == "edit_directory":
        dir_id = _resolve(str(op["directory_id"]), id_map)
        d = await db.scalar(
            select(Directory).where(Directory.id == dir_id).options(selectinload(Directory.tags))
        )
        if not d:
            return None
        return {
            "name": d.name,
            "slug": d.slug,
            "type": d.type,
            "description": d.description,
            "metadata": d.metadata_,
            "tags": [t.name for t in d.tags],
            "parent_id": str(d.parent_id) if d.parent_id else None,
        }

    if op_type == "move_item":
        target_id = _resolve(str(op["target_id"]), id_map)
        if op["target_type"] == "directory":
            d = await db.scalar(select(Directory).where(Directory.id == target_id))
            if d:
                return {
                    "target_type": "directory",
                    "prev_parent_id": str(d.parent_id) if d.parent_id else None,
                }
        else:
            mat = await db.scalar(select(Material).where(Material.id == target_id))
            if mat:
                return {
                    "target_type": "material",
                    "prev_directory_id": str(mat.directory_id) if mat.directory_id else None,
                    "prev_slug": mat.slug,
                }

    return None


async def apply_pr(db: AsyncSession, pr: PullRequest, apply_user_id: uuid.UUID) -> None:
    """
    Execute all operations in a batch PR.  Operations are topologically sorted
    so that temp_id producers run before consumers, then executed sequentially
    within a single DB transaction.

    The original pr.payload is never mutated.  After execution, pr.applied_result
    is set to an enriched copy of the sorted operations, each annotated with:
      - result_id:          UUID string of the created/edited/deleted item
      - result_browse_path: slug-path usable as /browse/<path>
      - pre_state:          snapshot of the entity before mutation (for edit/move ops)
    """
    if pr.applied_result is not None:
        return

    from datetime import datetime

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

        # Capture pre-state before mutation (for revertable edits/moves)
        pre_state: dict[str, typing.Any] | None = None
        if op_type in ("edit_material", "edit_directory", "move_item"):
            pre_state = await _capture_pre_state(db, op_type, op, id_map)

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
        if pre_state is not None:
            enriched["pre_state"] = pre_state
        if is_delete and pre_delete_browse_path:
            enriched["result_browse_path"] = pre_delete_browse_path
        elif not is_delete:
            try:
                browse_path = await _build_browse_path(db, op_type, result_id)
                if browse_path:
                    enriched["result_browse_path"] = browse_path
            except Exception:
                pass

        result_ops.append(enriched)

    pr.applied_result = result_ops
    flag_modified(pr, "applied_result")
    pr.approved_at = datetime.now(UTC)


# ---------------------------------------------------------------------------
# Revert executors (Phase 5)
# ---------------------------------------------------------------------------


async def _exec_undelete_material(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    """Restore a soft-deleted material and its attachment subtree."""
    mat_id = _resolve(str(p["material_id"]), id_map)
    mat = await db.scalar(
        select(Material)
        .where(Material.id == mat_id)
        .execution_options(include_deleted=True)
    )
    if not mat:
        raise NotFoundError("Material not found (even among deleted)")

    mat.deleted_at = None

    versions = await db.scalars(
        select(MaterialVersion)
        .where(MaterialVersion.material_id == mat.id)
        .execution_options(include_deleted=True)
    )
    for v in versions:
        v.deleted_at = None

    sys_dir = await db.scalar(
        select(Directory)
        .where(Directory.name == f"attachments:{mat.id}")
        .execution_options(include_deleted=True)
    )
    if sys_dir:
        sys_dir.deleted_at = None
        att_mats = (
            await db.scalars(
                select(Material)
                .where(Material.directory_id == sys_dir.id)
                .execution_options(include_deleted=True)
            )
        ).all()
        for att in att_mats:
            att.deleted_at = None
            att_vs = await db.scalars(
                select(MaterialVersion)
                .where(MaterialVersion.material_id == att.id)
                .execution_options(include_deleted=True)
            )
            for av in att_vs:
                av.deleted_at = None

    seen: set[tuple[str, str]] = db.info.setdefault("post_commit_job_keys", set())
    key = ("index_material", str(mat.id))
    if key not in seen:
        seen.add(key)
        db.info.setdefault("post_commit_jobs", []).append(("index_material", mat.id))

    return mat.id


async def _exec_undelete_directory(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    """Restore a soft-deleted directory and its entire subtree."""
    dir_id = _resolve(str(p["directory_id"]), id_map)

    dir_cte = (
        select(Directory.id)
        .where(Directory.id == dir_id)
        .execution_options(include_deleted=True)
        .cte(name="undelete_dirs", recursive=True)
    )
    dir_alias = aliased(Directory)
    dir_cte = dir_cte.union_all(
        select(dir_alias.id)
        .where(dir_alias.parent_id == dir_cte.c.id)
        .execution_options(include_deleted=True)
    )
    all_dir_ids = (
        await db.scalars(
            select(dir_cte.c.id).execution_options(include_deleted=True)
        )
    ).all()

    for did in all_dir_ids:
        d = await db.scalar(
            select(Directory).where(Directory.id == did).execution_options(include_deleted=True)
        )
        if d:
            d.deleted_at = None

    mat_rows = (
        await db.scalars(
            select(Material)
            .where(Material.directory_id.in_(all_dir_ids))
            .execution_options(include_deleted=True)
        )
    ).all()
    for mat in mat_rows:
        mat.deleted_at = None
        vs = await db.scalars(
            select(MaterialVersion)
            .where(MaterialVersion.material_id == mat.id)
            .execution_options(include_deleted=True)
        )
        for v in vs:
            v.deleted_at = None

    await _enqueue_reindex_directory_recursive(db, dir_id)
    return dir_id


async def _exec_revert_edit_material(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    """Revert a material to its pre-PR state using the captured pre_state snapshot."""
    mat_id = _resolve(str(p["material_id"]), id_map)
    pre = p.get("pre_state", {})
    mat = await db.scalar(
        select(Material).where(Material.id == mat_id).options(selectinload(Material.tags))
    )
    if not mat:
        raise NotFoundError("Material not found")

    mat.title = pre["title"]
    mat.slug = pre["slug"]
    mat.type = pre["type"]
    mat.description = pre.get("description")
    mat.metadata_ = pre.get("metadata", {})

    if "tags" in pre:
        await get_or_create_tags(db, pre["tags"])
        normalized = [t.strip().lower() for t in pre["tags"] if t.strip()]
        if normalized:
            tag_result = await db.execute(select(Tag).where(Tag.name.in_(normalized)))
            mat.tags = list(tag_result.scalars().all())
        else:
            mat.tags = []

    if pre.get("prev_version_number") is not None:
        versions_to_drop = await db.scalars(
            select(MaterialVersion)
            .where(
                MaterialVersion.material_id == mat.id,
                MaterialVersion.version_number > pre["prev_version_number"],
            )
        )
        for v in versions_to_drop:
            if v.cas_sha256 and v.file_key and v.file_key.startswith("cas/"):
                from app.core.cas import decrement_cas_ref
                from app.core.redis import redis_client

                await decrement_cas_ref(redis_client, v.cas_sha256)
            await db.delete(v)

        mat.current_version = pre["prev_version_number"]

    await db.flush()

    seen: set[tuple[str, str]] = db.info.setdefault("post_commit_job_keys", set())
    key = ("index_material", str(mat.id))
    if key not in seen:
        seen.add(key)
        db.info.setdefault("post_commit_jobs", []).append(("index_material", mat.id))

    return mat.id


async def _exec_revert_edit_directory(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    """Revert a directory to its pre-PR state."""
    dir_id = _resolve(str(p["directory_id"]), id_map)
    pre = p.get("pre_state", {})
    d = await db.scalar(
        select(Directory).where(Directory.id == dir_id).options(selectinload(Directory.tags))
    )
    if not d:
        raise NotFoundError("Directory not found")

    name_changed = d.name != pre["name"]
    d.name = pre["name"]
    d.slug = pre["slug"]
    d.type = pre["type"]
    d.description = pre.get("description")
    d.metadata_ = pre.get("metadata", {})

    if "tags" in pre:
        await get_or_create_tags(db, pre["tags"])
        normalized = [t.strip().lower() for t in pre["tags"] if t.strip()]
        if normalized:
            tag_result = await db.execute(select(Tag).where(Tag.name.in_(normalized)))
            d.tags = list(tag_result.scalars().all())
        else:
            d.tags = []

    await db.flush()

    if name_changed:
        await _enqueue_reindex_directory_recursive(db, d.id)
    else:
        seen: set[tuple[str, str]] = db.info.setdefault("post_commit_job_keys", set())
        key = ("index_directory", str(d.id))
        if key not in seen:
            seen.add(key)
            db.info.setdefault("post_commit_jobs", []).append(("index_directory", d.id))

    return d.id


async def _exec_revert_move_item(
    db: AsyncSession, p: dict[str, typing.Any], pr: PullRequest, id_map: dict[str, uuid.UUID]
) -> uuid.UUID:
    """Move an item back to its pre-PR location."""
    target_id = _resolve(str(p["target_id"]), id_map)
    pre = p.get("pre_state", {})

    if pre.get("target_type") == "directory":
        d = await db.scalar(select(Directory).where(Directory.id == target_id))
        if not d:
            raise NotFoundError("Directory not found")
        prev_parent = uuid.UUID(pre["prev_parent_id"]) if pre.get("prev_parent_id") else None
        d.parent_id = prev_parent
        await db.flush()
        await _enqueue_reindex_directory_recursive(db, d.id)
        return d.id
    else:
        mat = await db.scalar(select(Material).where(Material.id == target_id))
        if not mat:
            raise NotFoundError("Material not found")
        prev_dir = uuid.UUID(pre["prev_directory_id"]) if pre.get("prev_directory_id") else None
        mat.directory_id = prev_dir
        mat.slug = pre.get("prev_slug") or await _unique_material_slug(
            db, prev_dir, mat.title, exclude_id=mat.id
        )
        await db.flush()
        seen: set[tuple[str, str]] = db.info.setdefault("post_commit_job_keys", set())
        key = ("index_material", str(mat.id))
        if key not in seen:
            seen.add(key)
            db.info.setdefault("post_commit_jobs", []).append(("index_material", mat.id))
        return mat.id


_REVERT_EXECUTORS: dict[
    str,
    typing.Callable[
        [AsyncSession, dict[str, typing.Any], PullRequest, dict[str, uuid.UUID]],
        typing.Coroutine[typing.Any, typing.Any, uuid.UUID],
    ],
] = {
    "create_material": _exec_delete_material,
    "create_directory": _exec_delete_directory,
    "edit_material": _exec_revert_edit_material,
    "edit_directory": _exec_revert_edit_directory,
    "delete_material": _exec_undelete_material,
    "delete_directory": _exec_undelete_directory,
    "move_item": _exec_revert_move_item,
}


def _build_reverse_ops(applied_result: list[dict[str, typing.Any]]) -> list[dict[str, typing.Any]]:
    """Build the list of reverse operations from an applied_result, in reverse order."""
    reverse_ops: list[dict[str, typing.Any]] = []

    for enriched in reversed(applied_result):
        op_type = str(enriched.get("op", ""))
        result_id = enriched.get("result_id")
        pre_state = enriched.get("pre_state")

        if op_type == "create_material":
            reverse_ops.append({"op": "delete_material", "material_id": result_id})
        elif op_type == "create_directory":
            reverse_ops.append({"op": "delete_directory", "directory_id": result_id})
        elif op_type == "edit_material":
            reverse_ops.append({
                "op": "edit_material",
                "material_id": result_id,
                "pre_state": pre_state,
            })
        elif op_type == "edit_directory":
            reverse_ops.append({
                "op": "edit_directory",
                "directory_id": result_id,
                "pre_state": pre_state,
            })
        elif op_type == "delete_material":
            reverse_ops.append({"op": "undelete_material", "material_id": result_id})
        elif op_type == "delete_directory":
            reverse_ops.append({"op": "undelete_directory", "directory_id": result_id})
        elif op_type == "move_item":
            reverse_ops.append({
                "op": "move_item",
                "target_id": result_id,
                "target_type": enriched.get("target_type"),
                "pre_state": pre_state,
            })

    return reverse_ops


# Dispatch table for revert ops — maps the REVERSE op name to its executor.
_REVERT_DISPATCH: dict[
    str,
    typing.Callable[
        [AsyncSession, dict[str, typing.Any], PullRequest, dict[str, uuid.UUID]],
        typing.Coroutine[typing.Any, typing.Any, uuid.UUID],
    ],
] = {
    "delete_material": _exec_delete_material,
    "delete_directory": _exec_delete_directory,
    "edit_material": _exec_revert_edit_material,
    "edit_directory": _exec_revert_edit_directory,
    "undelete_material": _exec_undelete_material,
    "undelete_directory": _exec_undelete_directory,
    "move_item": _exec_revert_move_item,
}


async def revert_pr(
    db: AsyncSession,
    original_pr: PullRequest,
    admin_user_id: uuid.UUID,
) -> PullRequest:
    """
    Create and immediately apply a revert PR that undoes all operations
    from the original PR. The original is marked as reverted.
    """
    from datetime import datetime

    if original_pr.applied_result is None:
        raise BadRequestError("PR has no applied_result — cannot revert (legacy PR without pre-state snapshot)")

    # Check that all edit/move ops have pre_state
    for enriched in original_pr.applied_result:
        op_type = str(enriched.get("op", ""))
        if op_type in ("edit_material", "edit_directory", "move_item") and not enriched.get("pre_state"):
            raise BadRequestError(
                f"Operation '{op_type}' in PR is missing pre_state snapshot — "
                "cannot revert (legacy PR approved before revert support was added)"
            )

    reverse_ops = _build_reverse_ops(original_pr.applied_result)

    revert = PullRequest(
        id=uuid.uuid4(),
        type="revert",
        status=PRStatus.APPROVED,
        title=f"Revert: {original_pr.title}",
        description=f"Automatic revert of PR \"{original_pr.title}\" (id: {original_pr.id})",
        payload=reverse_ops,
        summary_types=list({op["op"] for op in reverse_ops}),
        author_id=admin_user_id,
        reviewed_by=admin_user_id,
        reverts_pr_id=original_pr.id,
        approved_at=datetime.now(UTC),
    )
    db.add(revert)
    await db.flush()

    id_map: dict[str, uuid.UUID] = {}
    result_ops: list[dict[str, typing.Any]] = []

    for op in reverse_ops:
        op_type = str(op["op"])
        executor = _REVERT_DISPATCH.get(op_type)
        if not executor:
            raise BadRequestError(f"No revert executor for op type: {op_type}")

        result_id = await executor(db, op, revert, id_map)

        enriched_rev: dict[str, typing.Any] = dict(op)
        enriched_rev["result_id"] = str(result_id)
        try:
            bp = await _build_browse_path(db, op_type, result_id)
            if bp:
                enriched_rev["result_browse_path"] = bp
        except Exception:
            pass
        result_ops.append(enriched_rev)

    revert.applied_result = result_ops
    flag_modified(revert, "applied_result")

    original_pr.reverted_by_pr_id = revert.id

    return revert
