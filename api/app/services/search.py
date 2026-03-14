from meilisearch_python_sdk.models.search import SearchParams

from app.core.meilisearch import meili_client


async def perform_search(query: str, page: int = 1, limit: int = 10) -> dict:
    offset = (page - 1) * limit

    # Perform a multi-search request to Meilisearch
    results = await meili_client.multi_search([
        SearchParams(indexUid="materials", q=query, offset=offset, limit=limit),
        SearchParams(indexUid="directories", q=query, offset=offset, limit=limit),
    ])

    materials_res = results[0]
    directories_res = results[1]

    items = []

    for hit in materials_res.hits:
        hit["search_type"] = "material"
        items.append(hit)

    for hit in directories_res.hits:
        hit["search_type"] = "directory"
        items.append(hit)

    # Sort simple merger by score logic.
    # Meilisearch doesn't interleave them via multi_search, so we just return them sorted if we want to mix them.
    # Alternatively, just append them since they are often queried separately or we want to show directories first.
    # We'll just put directories first, then materials.

    sorted_items = [i for i in items if i["search_type"] == "directory"] + \
                   [i for i in items if i["search_type"] == "material"]

    # Apply pagination on the combined result. In a real highly-scaled system,
    # you'd federate the limit/offset properly, but for this scale, limit applied to both is acceptable.
    combined = sorted_items[:limit]

    return {
        "items": combined,
        "total": materials_res.estimated_total_hits + directories_res.estimated_total_hits,
        "page": page,
        "limit": limit
    }
