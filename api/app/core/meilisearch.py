import logging

from meilisearch_python_sdk import AsyncClient
from meilisearch_python_sdk.errors import MeilisearchApiError
from meilisearch_python_sdk.models.settings import (
    MeilisearchSettings,
    MinWordSizeForTypos,
    TypoTolerance,
)

from app.config import settings

logger = logging.getLogger("wikint.meilisearch")

meili_client = AsyncClient(settings.meili_url, settings.meili_master_key)


async def setup_meilisearch() -> None:
    """Ensure Meilisearch indexes and settings are configured correctly."""

    typo_config = TypoTolerance(
        enabled=True,
        min_word_size_for_typos=MinWordSizeForTypos(one_typo=5, two_typos=9),
    )

    # 1. Materials index
    try:
        await meili_client.create_index("materials", primary_key="id")
        logger.info("Created 'materials' index in Meilisearch")
    except MeilisearchApiError as e:
        if e.code != "index_already_exists":
            logger.error(f"Error creating 'materials' index: {e}")
            raise

    materials_settings = MeilisearchSettings(
        searchable_attributes=[
            "title",
            "description",
            "tags",
            "slug",
            "type",
            "authorName",
            "ancestor_path",
            "extra_searchable",
        ],
        filterable_attributes=["type", "directory_id"],
        typo_tolerance=typo_config,
    )
    await meili_client.index("materials").update_settings(materials_settings)

    # 2. Directories index
    try:
        await meili_client.create_index("directories", primary_key="id")
        logger.info("Created 'directories' index in Meilisearch")
    except MeilisearchApiError as e:
        if e.code != "index_already_exists":
            logger.error(f"Error creating 'directories' index: {e}")
            raise

    directories_settings = MeilisearchSettings(
        searchable_attributes=[
            "name",
            "description",
            "slug",
            "type",
            "tags",
            "code",
            "ancestor_path",
            "extra_searchable",
        ],
        filterable_attributes=["parent_id", "type"],
        typo_tolerance=typo_config,
    )
    await meili_client.index("directories").update_settings(directories_settings)

    logger.info("Meilisearch settings applied.")
