import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError
from app.models.material import Material, MaterialVersion
from app.models.view_history import ViewHistory


def material_orm_to_dict(
    m: Material, *, attachment_count: int = 0, directory_path: str | None = None
) -> dict:
    """Convert a Material ORM instance to a plain dict safe for Pydantic validation.

    This avoids MissingGreenlet errors caused by SQLAlchemy lazy-loading
    relationship attributes when Pydantic inspects the object with
    ``from_attributes=True``.
    """
    path = directory_path
    if not path and "directory" in m.__dict__:
        path = m.directory.slug

    return {
        "id": m.id,
        "directory_id": m.directory_id,
        "directory_path": path,
        "title": m.title,
        "slug": m.slug,
        "description": m.description,
        "type": m.type,
        "current_version": m.current_version,
        "parent_material_id": m.parent_material_id,
        "author_id": m.author_id,
        "metadata": m.metadata_,
        "download_count": m.download_count,
        "tags": [t.name for t in m.tags] if "tags" in m.__dict__ else [],
        "created_at": m.created_at,
        "updated_at": m.updated_at,
        "attachment_count": attachment_count,
    }


async def get_material_by_id(db: AsyncSession, material_id: str | uuid.UUID) -> Material:

    if isinstance(material_id, str):
        import uuid

        material_id = uuid.UUID(material_id)
    result = await db.execute(
        select(Material).options(selectinload(Material.tags)).where(Material.id == material_id)
    )
    material = result.scalar_one_or_none()
    if not material:
        raise NotFoundError("Material not found")
    return material


def check_material_access(user_id: uuid.UUID, material: dict) -> None:
    """
    Authorization choke-point for material access.

    SECURITY: This function is currently a stub — it always permits access.
    Any authenticated user can reach any material regardless of ownership or
    future visibility/ACL fields.  When per-material access controls are
    introduced (e.g. a `visibility` or `published` flag, course enrollment
    checks, etc.) they MUST be enforced here so all call sites are covered.

    Do NOT add inline access checks at call sites; route them through this
    function instead.
    """
    # TODO: enforce material["visibility"], enrollment membership, etc. once
    # those fields exist on the Material model.
    _ = user_id, material  # suppress unused-variable warnings until implemented


async def get_material_file_info(db: AsyncSession, material_id: str | uuid.UUID) -> MaterialVersion:
    """Single JOIN query returning only the fields needed to serve a file."""
    if isinstance(material_id, str):
        material_id = uuid.UUID(material_id)
    result = await db.execute(
        select(MaterialVersion)
        .join(Material, Material.id == MaterialVersion.material_id)
        .where(
            Material.id == material_id,
            MaterialVersion.version_number == Material.current_version,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise NotFoundError("No file available")
    return version


async def get_material_with_version(db: AsyncSession, material_id: str | uuid.UUID) -> dict:

    if isinstance(material_id, str):
        import uuid

        material_id = uuid.UUID(material_id)
    material = await get_material_by_id(db, material_id)

    version_result = await db.execute(
        select(MaterialVersion).where(
            MaterialVersion.material_id == material.id,
            MaterialVersion.version_number == material.current_version,
        )
    )
    current_version = version_result.scalar_one_or_none()

    # Count attachments (child materials)
    att_count = (
        await db.scalar(
            select(func.count())
            .select_from(Material)
            .where(Material.parent_material_id == material.id)
        )
        or 0
    )

    return {
        "material": material_orm_to_dict(material, attachment_count=att_count),
        "current_version_info": current_version,
        "attachment_count": att_count,
    }


async def get_material_versions(
    db: AsyncSession, material_id: str | uuid.UUID
) -> list[MaterialVersion]:

    if isinstance(material_id, str):
        import uuid

        material_id = uuid.UUID(material_id)
    await get_material_by_id(db, material_id)
    result = await db.execute(
        select(MaterialVersion)
        .where(MaterialVersion.material_id == material_id)
        .order_by(MaterialVersion.version_number.desc())
    )
    return list(result.scalars().all())


async def get_material_version(
    db: AsyncSession, material_id: str, version_number: int
) -> MaterialVersion:
    import uuid as _uuid

    uid = _uuid.UUID(str(material_id))
    await get_material_by_id(db, material_id)
    result = await db.execute(
        select(MaterialVersion).where(
            MaterialVersion.material_id == uid,
            MaterialVersion.version_number == version_number,
        )
    )
    version = result.scalar_one_or_none()
    if not version:
        raise NotFoundError(f"Version {version_number} not found")
    return version


async def get_material_attachments(db: AsyncSession, material_id: str | uuid.UUID) -> list[dict]:

    if isinstance(material_id, str):
        import uuid

        material_id = uuid.UUID(material_id)
    await get_material_by_id(db, material_id)
    result = await db.execute(
        select(Material, MaterialVersion)
        .outerjoin(
            MaterialVersion,
            (Material.id == MaterialVersion.material_id)
            & (Material.current_version == MaterialVersion.version_number),
        )
        .where(Material.parent_material_id == material_id)
        .order_by(Material.title)
    )

    attachments_out = []
    for material, version in result.all():
        mat_dict = material_orm_to_dict(material)
        if version:
            mat_dict["current_version_info"] = version
        attachments_out.append(mat_dict)
    return attachments_out


async def increment_download_count(db: AsyncSession, material_id: str | uuid.UUID) -> Material:

    if isinstance(material_id, str):
        import uuid

        material_id = uuid.UUID(material_id)
    material = await get_material_by_id(db, material_id)
    material.download_count += 1
    await db.flush()
    return material


async def record_view(db: AsyncSession, user_id: str, material_id: str) -> None:
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    uid = uuid.UUID(str(user_id))
    mid = uuid.UUID(str(material_id))
    await get_material_by_id(db, mid)

    stmt = pg_insert(ViewHistory).values(
        id=uuid.uuid4(),
        user_id=uid,
        material_id=mid,
        viewed_at=datetime.now(UTC),
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_view_history_user_material",
        set_={"viewed_at": stmt.excluded.viewed_at},
    )
    await db.execute(stmt)
    await db.flush()
