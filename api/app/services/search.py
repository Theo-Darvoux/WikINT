import uuid

from meilisearch_python_sdk.models.search import SearchParams
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.meilisearch import meili_client
from app.models.material import MaterialLike
from app.models.directory import DirectoryLike


async def perform_search(
    db: AsyncSession, query: str, page: int = 1, limit: int = 10, current_user_id: uuid.UUID | None = None
) -> dict:
    offset = (page - 1) * limit

    # 1. Prepare search terms for custom boosting logic (matching api_search.py logic)
    query_clean = query.strip().lower()
    search_terms = [t for t in query_clean.split() if len(t) >= 2]

    # 2. Perform a multi-search request to Meilisearch with ranking scores enabled
    results = await meili_client.multi_search(
        [
            SearchParams(index_uid="materials", q=query, offset=offset, limit=limit * 2, show_ranking_score=True),
            SearchParams(index_uid="directories", q=query, offset=offset, limit=limit * 2, show_ranking_score=True),
        ]
    )

    from typing import Any, cast
    res_any = cast(Any, results)
    materials_res = res_any[0] if isinstance(results, list) else res_any.results[0]
    directories_res = res_any[1] if isinstance(results, list) else res_any.results[1]

    liked_material_ids: set[uuid.UUID] = set()
    liked_directory_ids: set[uuid.UUID] = set()
    if current_user_id:
        m_stmt = select(MaterialLike.material_id).where(MaterialLike.user_id == current_user_id)
        m_res = await db.execute(m_stmt)
        liked_material_ids = {row[0] for row in m_res.all()}

        d_stmt = select(DirectoryLike.directory_id).where(DirectoryLike.user_id == current_user_id)
        d_res = await db.execute(d_stmt)
        liked_directory_ids = {row[0] for row in d_res.all()}

    items = []

    def calculate_boost(hit: dict, is_dir: bool) -> float:
        boost = 0.0
        # For materials it's 'title', for directories it's 'name'
        title = (hit.get("title") or hit.get("name") or "").lower()
        
        # Priority 1: Exact matches on the full query
        if title == query_clean:
            boost += 0.5
        elif title.startswith(query_clean):
            boost += 0.2

        # Priority 2: Term Coverage (like api_search.py)
        matched_terms = 0
        for term in search_terms:
            if term in title:
                matched_terms += 1
                if title.startswith(term):
                    boost += 0.05
        
        if len(search_terms) > 1 and matched_terms >= len(search_terms):
            boost += 0.3 # Multi-term query success

        if is_dir and title == query_clean:
            boost += 0.1

        return boost

    # 3. Process and score Materials
    for hit in materials_res.hits:
        hit["search_type"] = "material"
        if "id" in hit:
            try:
                hit_id = uuid.UUID(hit["id"])
                hit["is_liked"] = hit_id in liked_material_ids
            except ValueError:
                hit["is_liked"] = False
        
        ms_score = hit.get("_rankingScore", 0.0)
        hit["_wikint_score"] = ms_score + calculate_boost(hit, False)
        items.append(hit)

    # 4. Process and score Directories
    for hit in directories_res.hits:
        hit["search_type"] = "directory"
        if "id" in hit:
            try:
                hit_id = uuid.UUID(hit["id"])
                hit["is_liked"] = hit_id in liked_directory_ids
            except ValueError:
                hit["is_liked"] = False
        
        ms_score = hit.get("_rankingScore", 0.0)
        hit["_wikint_score"] = ms_score + calculate_boost(hit, True)
        items.append(hit)

    # 5. Sort by relevance and apply limit
    items.sort(key=lambda x: x.get("_wikint_score", 0), reverse=True)
    combined = items[:limit]

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
