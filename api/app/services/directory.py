import re
import typing
import unicodedata
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError
from app.models.directory import Directory
from app.models.material import Material, MaterialVersion


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[-\s]+", "-", text).strip("-")


async def get_directory_paths(
    db: AsyncSession, directory_ids: set[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not directory_ids:
        return {}

    from sqlalchemy import String
    from sqlalchemy.orm import aliased

    base_case = (
        select(
            Directory.id,
            Directory.slug,
            Directory.parent_id,
            Directory.slug.cast(String).label("full_path"),
        )
        .where(Directory.parent_id.is_(None))
        .cte(name="dir_path_cte", recursive=True)
    )

    base_alias = aliased(base_case, name="p")
    dir_alias = aliased(Directory, name="d")

    recursive_case = select(
        dir_alias.id,
        dir_alias.slug,
        dir_alias.parent_id,
        (base_alias.c.full_path + "/" + dir_alias.slug).label("full_path"),
    ).join(base_alias, dir_alias.parent_id == base_alias.c.id)

    cte = base_case.union_all(recursive_case)
    stmt = select(cte.c.id, cte.c.full_path).where(cte.c.id.in_(directory_ids))
    result = await db.execute(stmt)

    return {row.id: row.full_path for row in result.all()}


async def get_root_directories(db: AsyncSession) -> dict[str, list[dict[str, typing.Any]]]:
    stmt = (
        select(Directory)
        .options(selectinload(Directory.tags))
        .where(Directory.parent_id.is_(None), Directory.is_system.is_(False))
        .order_by(Directory.sort_order, Directory.name)
    )
    result = await db.execute(stmt)
    directories = result.scalars().all()

    items = []
    for d in directories:
        dir_count = await db.scalar(
            select(func.count())
            .select_from(Directory)
            .where(Directory.parent_id == d.id, Directory.is_system.is_(False))
        )
        mat_count = await db.scalar(
            select(func.count())
            .select_from(Material)
            .where(Material.directory_id == d.id, Material.parent_material_id.is_(None))
        )
        item = {
            "id": str(d.id),
            "parent_id": str(d.parent_id) if d.parent_id else None,
            "name": d.name,
            "slug": d.slug,
            "type": d.type.value if hasattr(d.type, "value") else d.type,
            "description": d.description,
            "metadata": d.metadata_,
            "sort_order": d.sort_order,
            "is_system": d.is_system,
            "tags": [t.name for t in d.tags],
            "created_at": d.created_at,
            "child_directory_count": dir_count or 0,
            "child_material_count": mat_count or 0,
        }
        items.append(item)

    # Also fetch root-level materials (where directory_id is NULL)
    child_material = Material.__table__.alias("child_mat")
    att_count_subq = (
        select(func.count())
        .select_from(child_material)
        .where(child_material.c.parent_material_id == Material.id)
        .correlate(Material)
        .scalar_subquery()
        .label("attachment_count")
    )

    mat_stmt = (
        select(Material, MaterialVersion, att_count_subq)
        .options(selectinload(Material.tags))
        .outerjoin(
            MaterialVersion,
            (Material.id == MaterialVersion.material_id)
            & (Material.current_version == MaterialVersion.version_number),
        )
        .where(Material.directory_id.is_(None), Material.parent_material_id.is_(None))
        .order_by(Material.title)
    )
    mat_result = await db.execute(mat_stmt)

    materials_out = []
    for material, version, att_count in mat_result.all():
        mat_dict = {
            "id": material.id,
            "directory_id": material.directory_id,
            "title": material.title,
            "slug": material.slug,
            "description": material.description,
            "type": material.type,
            "current_version": material.current_version,
            "parent_material_id": material.parent_material_id,
            "author_id": material.author_id,
            "metadata": material.metadata_,
            "download_count": material.download_count,
            "tags": [t.name for t in material.tags],
            "created_at": material.created_at,
            "updated_at": material.updated_at,
            "attachment_count": att_count or 0,
        }

        if version:
            mat_dict["current_version_info"] = {
                "id": version.id,
                "material_id": version.material_id,
                "version_number": version.version_number,
                "file_key": version.file_key,
                "file_name": version.file_name,
                "file_size": version.file_size,
                "file_mime_type": version.file_mime_type,
                "diff_summary": version.diff_summary,
                "author_id": version.author_id,
                "pr_id": version.pr_id,
                "virus_scan_result": version.virus_scan_result,
                "created_at": version.created_at,
            }
        materials_out.append(mat_dict)

    return {"directories": items, "materials": materials_out}


async def get_directory_by_id(db: AsyncSession, directory_id: str | uuid.UUID) -> Directory:

    if isinstance(directory_id, str):
        import uuid

        directory_id = uuid.UUID(directory_id)
    result = await db.execute(
        select(Directory).options(selectinload(Directory.tags)).where(Directory.id == directory_id)
    )
    directory = result.scalar_one_or_none()
    if not directory:
        raise NotFoundError("Directory not found")
    return directory


async def get_directory_children(db: AsyncSession, directory_id: str | uuid.UUID) -> dict:

    if isinstance(directory_id, str):
        import uuid

        directory_id = uuid.UUID(directory_id)
    directory = await get_directory_by_id(db, directory_id)

    dir_stmt = (
        select(Directory)
        .options(selectinload(Directory.tags))
        .where(Directory.parent_id == directory.id, Directory.is_system.is_(False))
        .order_by(Directory.sort_order, Directory.name)
    )
    dir_result = await db.execute(dir_stmt)
    child_dirs = dir_result.scalars().all()

    dirs_with_counts = []
    for d in child_dirs:
        dir_count = await db.scalar(
            select(func.count())
            .select_from(Directory)
            .where(Directory.parent_id == d.id, Directory.is_system.is_(False))
        )
        mat_count = await db.scalar(
            select(func.count())
            .select_from(Material)
            .where(Material.directory_id == d.id, Material.parent_material_id.is_(None))
        )
        dirs_with_counts.append(
            {
                "id": str(d.id),
                "parent_id": str(d.parent_id) if d.parent_id else None,
                "name": d.name,
                "slug": d.slug,
                "type": d.type.value if hasattr(d.type, "value") else d.type,
                "description": d.description,
                "metadata": d.metadata_,
                "sort_order": d.sort_order,
                "is_system": d.is_system,
                "tags": [t.name for t in d.tags],
                "created_at": d.created_at,
                "child_directory_count": dir_count or 0,
                "child_material_count": mat_count or 0,
            }
        )

    # Fetch materials and their corresponding latest versions
    # Alias for the child-material (attachment) table to count attachments per material
    child_material = Material.__table__.alias("child_mat")
    att_count_subq = (
        select(func.count())
        .select_from(child_material)
        .where(child_material.c.parent_material_id == Material.id)
        .correlate(Material)
        .scalar_subquery()
        .label("attachment_count")
    )

    mat_stmt = (
        select(Material, MaterialVersion, att_count_subq)
        .options(selectinload(Material.tags))
        .outerjoin(
            MaterialVersion,
            (Material.id == MaterialVersion.material_id)
            & (Material.current_version == MaterialVersion.version_number),
        )
        .where(Material.directory_id == directory.id, Material.parent_material_id.is_(None))
        .order_by(Material.title)
    )
    mat_result = await db.execute(mat_stmt)

    materials_out = []
    for material, version, att_count in mat_result.all():
        mat_dict = {
            "id": material.id,
            "directory_id": material.directory_id,
            "title": material.title,
            "slug": material.slug,
            "description": material.description,
            "type": material.type,
            "current_version": material.current_version,
            "parent_material_id": material.parent_material_id,
            "author_id": material.author_id,
            "metadata": material.metadata_,
            "download_count": material.download_count,
            "tags": [t.name for t in material.tags],
            "created_at": material.created_at,
            "updated_at": material.updated_at,
            "attachment_count": att_count or 0,
        }

        if version:
            mat_dict["current_version_info"] = {
                "id": version.id,
                "material_id": version.material_id,
                "version_number": version.version_number,
                "file_key": version.file_key,
                "file_name": version.file_name,
                "file_size": version.file_size,
                "file_mime_type": version.file_mime_type,
                "diff_summary": version.diff_summary,
                "author_id": version.author_id,
                "pr_id": version.pr_id,
                "virus_scan_result": version.virus_scan_result,
                "created_at": version.created_at,
            }
        materials_out.append(mat_dict)

    return {"directories": dirs_with_counts, "materials": materials_out}


async def get_directory_path(db: AsyncSession, directory_id: str | uuid.UUID) -> list[dict]:

    if isinstance(directory_id, str):
        import uuid

        directory_id = uuid.UUID(directory_id)
    path: list[dict] = []
    current: Directory | None = await get_directory_by_id(db, directory_id)
    seen: set[uuid.UUID] = set()

    while current:
        if current.id in seen:
            break  # circular parent_id — stop traversal
        seen.add(current.id)
        path.insert(0, {"id": str(current.id), "name": current.name, "slug": current.slug})
        if current.parent_id:
            result = await db.execute(select(Directory).where(Directory.id == current.parent_id))
            current = result.scalar_one_or_none()
        else:
            break

    return path


async def resolve_browse_path(db: AsyncSession, path: str) -> dict:
    segments = [s for s in path.split("/") if s]

    if not segments:
        roots = await get_root_directories(db)
        return {"type": "directory_listing", "directories": roots, "materials": []}

    current_dir: Directory | None = None
    last_material: Material | None = None

    for i, segment in enumerate(segments):
        if segment == "attachments":
            if last_material is None:
                raise NotFoundError("Invalid path: 'attachments' without a material context")

            # If there are more segments after 'attachments', resolve a specific attachment
            remaining = segments[i + 1 :]
            if remaining:
                att_slug = remaining[0]
                att_result = await db.execute(
                    select(Material).where(
                        Material.slug == att_slug,
                        Material.parent_material_id == last_material.id,
                    )
                )
                attachment = att_result.scalar_one_or_none()
                if not attachment:
                    raise NotFoundError(f"Attachment '{att_slug}' not found")
                from app.services.material import get_material_with_version

                detail = await get_material_with_version(db, str(attachment.id))
                return {"type": "material", "material": detail}

            # No more segments — return the attachment listing
            result = await db.execute(
                select(Material, MaterialVersion)
                .options(selectinload(Material.tags))
                .outerjoin(
                    MaterialVersion,
                    (Material.id == MaterialVersion.material_id)
                    & (Material.current_version == MaterialVersion.version_number),
                )
                .where(Material.parent_material_id == last_material.id)
                .order_by(Material.title)
            )

            materials_out = []
            for material, version in result.all():
                mat_dict = {
                    "id": material.id,
                    "directory_id": material.directory_id,
                    "title": material.title,
                    "slug": material.slug,
                    "description": material.description,
                    "type": material.type,
                    "current_version": material.current_version,
                    "parent_material_id": material.parent_material_id,
                    "author_id": material.author_id,
                    "metadata": material.metadata_,
                    "download_count": material.download_count,
                    "created_at": material.created_at,
                    "updated_at": material.updated_at,
                    "attachment_count": 0,
                }
                if version:
                    mat_dict["current_version_info"] = {
                        "id": version.id,
                        "material_id": version.material_id,
                        "version_number": version.version_number,
                        "file_key": version.file_key,
                        "file_name": version.file_name,
                        "file_size": version.file_size,
                        "file_mime_type": version.file_mime_type,
                        "diff_summary": version.diff_summary,
                        "author_id": version.author_id,
                        "pr_id": version.pr_id,
                        "virus_scan_result": version.virus_scan_result,
                        "created_at": version.created_at,
                    }
                materials_out.append(mat_dict)

            return {
                "type": "attachment_listing",
                "materials": materials_out,
                "parent_material": last_material,
            }

        if current_dir is None:
            result = await db.execute(
                select(Directory)
                .options(selectinload(Directory.tags))
                .where(
                    Directory.slug == segment,
                    Directory.parent_id.is_(None),
                    Directory.is_system.is_(False),
                )
            )
        else:
            result = await db.execute(
                select(Directory)
                .options(selectinload(Directory.tags))
                .where(
                    Directory.slug == segment,
                    Directory.parent_id == current_dir.id,
                    Directory.is_system.is_(False),
                )
            )

        directory = result.scalar_one_or_none()
        if directory:
            current_dir = directory
            last_material = None
            continue

        # If no directory found, check for material in current_dir (or root if current_dir is None)
        mat_result = await db.execute(
            select(Material)
            .options(selectinload(Material.tags))
            .where(
                Material.slug == segment,
                Material.directory_id == (current_dir.id if current_dir else None),
                Material.parent_material_id.is_(None),
            )
        )
        material = mat_result.scalar_one_or_none()
        if material:
            last_material = material
            if i == len(segments) - 1:
                from app.services.material import get_material_with_version

                detail = await get_material_with_version(db, str(material.id))
                return {"type": "material", "material": detail}
            continue

        raise NotFoundError(f"Path segment '{segment}' not found")

    if current_dir:
        children = await get_directory_children(db, str(current_dir.id))
        return {
            "type": "directory_listing",
            "directory": current_dir,
            "directories": children["directories"],
            "materials": children["materials"],
        }

    raise NotFoundError("Path not found")
