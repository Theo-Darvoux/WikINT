import logging
import uuid

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import async_session_factory
from app.core.meilisearch import meili_client
from app.models.directory import Directory
from app.models.material import Material

logger = logging.getLogger("wikint.workers.index_content")


def split_identifiers(text: str) -> str:
    import re
    if not text:
        return ""
    # Add space between letters and digits
    s = re.sub(r'([a-zA-Z]+)(\d+)', r'\1 \2', text)
    # Add space between digits and letters
    s = re.sub(r'(\d+)([a-zA-Z]+)', r'\1 \2', s)
    return s


async def index_material(ctx: dict, material_id: uuid.UUID) -> None:
    """Index or update a material in Meilisearch."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(Material)
            .options(selectinload(Material.tags), selectinload(Material.author))
            .where(Material.id == material_id)
        )
        material = result.scalar_one_or_none()
        if not material:
            logger.warning(f"Material {material_id} not found for indexing.")
            return

        from app.services.directory import get_directory_path
        
        ancestor_path = ""
        browse_path = "/browse"
        if material.directory_id:
            path_parts = await get_directory_path(db, material.directory_id)
            if path_parts:
                ancestor_path = " ".join(p["name"] for p in path_parts)
                browse_path += "/" + "/".join(p["slug"] for p in path_parts)
        
        browse_path += f"/{material.slug}"

        # Build extra searchable fields (identifiers)
        extra = f"{split_identifiers(material.title)} {split_identifiers(ancestor_path)}"

        doc = {
            "id": str(material.id),
            "title": material.title,
            "slug": material.slug,
            "description": material.description or "",
            "type": material.type,
            "tags": [t.name for t in material.tags] if material.tags else [],
            "authorName": material.author.display_name if material.author else None,
            "directory_id": str(material.directory_id) if material.directory_id else None,
            "created_at": material.created_at.isoformat() if material.created_at else None,
            "ancestor_path": ancestor_path,
            "extra_searchable": extra,
            "browse_path": browse_path,
        }
        await meili_client.index("materials").add_documents([doc])
        logger.info(f"Indexed material {material_id}")


async def index_directory(ctx: dict, directory_id: uuid.UUID) -> None:
    """Index or update a directory in Meilisearch."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(Directory)
            .options(selectinload(Directory.tags))
            .where(Directory.id == directory_id)
        )
        directory = result.scalar_one_or_none()
        if not directory:
            logger.warning(f"Directory {directory_id} not found for indexing.")
            return

        from app.services.directory import get_directory_path
        
        ancestor_path = ""
        browse_path = "/browse"
        if directory.parent_id:
            path_parts = await get_directory_path(db, directory.parent_id)
            if path_parts:
                ancestor_path = " ".join(p["name"] for p in path_parts)
                browse_path += "/" + "/".join(p["slug"] for p in path_parts)
        
        browse_path += f"/{directory.slug}"

        metadata = directory.metadata_ or {}
        code = metadata.get("code") or ""
        
        # Build extra searchable fields (identifiers)
        extra = f"{split_identifiers(directory.name)} {split_identifiers(code)} {split_identifiers(ancestor_path)}"

        doc = {
            "id": str(directory.id),
            "name": directory.name,
            "slug": directory.slug,
            "type": directory.type.value if directory.type else "folder",
            "description": directory.description or "",
            "tags": [t.name for t in directory.tags] if directory.tags else [],
            "code": code,
            "parent_id": str(directory.parent_id) if directory.parent_id else None,
            "created_at": directory.created_at.isoformat() if directory.created_at else None,
            "ancestor_path": ancestor_path,
            "extra_searchable": extra,
            "browse_path": browse_path,
        }
        await meili_client.index("directories").add_documents([doc])
        logger.info(f"Indexed directory {directory_id}")


async def delete_indexed_item(ctx: dict, index_name: str, item_id: str) -> None:
    """Delete an item from a specified Meilisearch index."""
    try:
        await meili_client.index(index_name).delete_document(item_id)
        logger.info(f"Deleted {item_id} from {index_name}")
    except Exception as e:
        logger.error(f"Failed to delete {item_id} from {index_name}: {e}")

