import uuid

from meilisearch_python_sdk.models.search import SearchParams
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.meilisearch import meili_client
from app.models.material import MaterialLike


async def perform_search(
    db: AsyncSession, query: str, page: int = 1, limit: int = 10, current_user_id: uuid.UUID | None = None
) -> dict:
    offset = (page - 1) * limit

    # Perform a multi-search request to Meilisearch
    results = await meili_client.multi_search(
        [
            SearchParams(index_uid="materials", q=query, offset=offset, limit=limit),
            SearchParams(index_uid="directories", q=query, offset=offset, limit=limit),
        ]
    )

    from typing import Any, cast

    res_any = cast(Any, results)
    materials_res = res_any[0] if isinstance(results, list) else res_any.results[0]
    directories_res = res_any[1] if isinstance(results, list) else res_any.results[1]

    # Fetch liked materials if user is logged in
    liked_ids: set[uuid.UUID] = set()
    if current_user_id:
        stmt = select(MaterialLike.material_id).where(MaterialLike.user_id == current_user_id)
        res = await db.execute(stmt)
        liked_ids = {row[0] for row in res.all()}

    items = []

    for hit in materials_res.hits:
        hit["search_type"] = "material"
        if "id" in hit:
            try:
                hit_id = uuid.UUID(hit["id"])
                hit["is_liked"] = hit_id in liked_ids
            except ValueError:
                hit["is_liked"] = False
        items.append(hit)

    for hit in directories_res.hits:
        hit["search_type"] = "directory"
        items.append(hit)

    # Sort simple merger: directories first, then materials.
    sorted_items = [i for i in items if i["search_type"] == "directory"] + [
        i for i in items if i["search_type"] == "material"
    ]

    # Apply pagination on the combined result.
    combined = sorted_items[:limit]

    total_materials = (
        materials_res.estimated_total_hits if materials_res.estimated_total_hits is not None else 0
    )
    total_directories = (
        directories_res.estimated_total_hits
        if directories_res.estimated_total_hits is not None
        else 0
    )

    return {
        "items": combined,
        "total": total_materials + total_directories,
        "page": page,
        "limit": limit,
    }
