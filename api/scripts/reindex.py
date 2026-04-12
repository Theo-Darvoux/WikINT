import asyncio
import argparse
import sys
import os
import uuid
from typing import Type
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("wikint.reindex")

# Ensure app is importable from the script's location
# Path assumes running from project root
sys.path.append(os.path.join(os.getcwd(), "api"))

try:
    from sqlalchemy import select
    from app.core.database import async_session_factory
    from app.core.meilisearch import meili_client
    from app.models.material import Material
    from app.models.directory import Directory
    from app.workers.index_content import index_material, index_directory
except ImportError as e:
    logger.error(f"Failed to import app modules. Ensure you run this script from the project root. Error: {e}")
    sys.exit(1)

async def audit_index(index_name: str, model_class: Type, batch_size: int = 100):
    """Audit an index and return list of orphan IDs."""
    logger.info(f"--- Auditing index: '{index_name}' ---")
    
    # Get total count first for better logging
    try:
        stats = await meili_client.index(index_name).get_stats()
        total_docs = stats.number_of_documents
        logger.info(f"Meilisearch reports {total_docs} documents in '{index_name}'.")
    except Exception as e:
        logger.debug(f"Could not get stats for '{index_name}': {e}")
        total_docs = "unknown"

    index = meili_client.index(index_name)
    offset = 0
    orphans = []
    total_checked = 0
    
    while True:
        try:
            docs = await index.get_documents(offset=offset, limit=batch_size)
        except Exception as e:
            logger.error(f"Failed to fetch documents from index '{index_name}': {e}")
            break
            
        if not docs.results:
            break
        
        doc_ids = []
        for doc in docs.results:
            # Handle both dict and object access (depends on SDK version/config)
            raw_id = None
            if isinstance(doc, dict):
                raw_id = doc.get("id")
            else:
                raw_id = getattr(doc, "id", None)
                
            if raw_id:
                try:
                    doc_ids.append(uuid.UUID(str(raw_id)))
                except (ValueError, TypeError):
                    continue

        if not doc_ids:
            # If we got results but none had valid IDs, we might be misconfigured
            # or hit a batch with unexpected format. Don't break, skip to next batch.
            logger.warning(f"No valid UUID IDs found in batch at offset {offset}.")
            if len(docs.results) < batch_size:
                break
            offset += batch_size
            continue
            
        async with async_session_factory() as db:
            result = await db.execute(
                select(model_class.id).where(model_class.id.in_(doc_ids))
            )
            existing_ids = result.scalars().all()
            
            existing_set = set(existing_ids)
            for doc_id in doc_ids:
                if doc_id not in existing_set:
                    orphans.append(str(doc_id))
        
        total_checked += len(docs.results)
        logger.info(f"Progress: {total_checked}/{total_docs} checked...")
        
        if len(docs.results) < batch_size:
            break
        offset += batch_size
            
    return orphans

async def perform_cleanup(dry_run: bool, batch_size: int = 100):
    """Remove orphan documents from Meilisearch."""
    for index_name, model in [("materials", Material), ("directories", Directory)]:
        orphans = await audit_index(index_name, model, batch_size=batch_size)
        if not orphans:
            logger.info(f"No orphans found in '{index_name}'. Index is in sync with DB.")
            continue
            
        logger.info(f"!!! Found {len(orphans)} orphans in '{index_name}'.")
        if dry_run:
            logger.info(f"[Dry Run] Would delete these IDs: {orphans[:20]}{'...' if len(orphans) > 20 else ''}")
        else:
            logger.info(f"Deleting {len(orphans)} orphans from '{index_name}'...")
            # Meilisearch supports batch delete
            await meili_client.index(index_name).delete_documents(orphans)
            logger.info(f"Successfully cleaned up '{index_name}'.")

async def perform_full_reindex(batch_size: int = 50):
    """Wipe indices and re-index everything from the database."""
    logger.warning("Performing FULL re-index. This will clear the existing indices and re-populate them.")
    
    for index_name in ["materials", "directories"]:
        logger.info(f"Clearing index: '{index_name}'...")
        await meili_client.index(index_name).delete_all_documents()
        
    # Re-index materials
    async with async_session_factory() as db:
        mat_ids = (await db.scalars(select(Material.id))).all()
        logger.info(f"Found {len(mat_ids)} materials in DB. Starting re-indexing...")
        for i, mid in enumerate(mat_ids):
            try:
                await index_material({}, mid)
            except Exception as e:
                logger.error(f"Failed to index material {mid}: {e}")
            if (i + 1) % batch_size == 0:
                logger.info(f"Indexed {i + 1}/{len(mat_ids)} materials...")
                
    # Re-index directories
    async with async_session_factory() as db:
        dir_ids = (await db.scalars(select(Directory.id))).all()
        logger.info(f"Found {len(dir_ids)} directories in DB. Starting re-indexing...")
        for i, did in enumerate(dir_ids):
            try:
                await index_directory({}, did)
            except Exception as e:
                logger.error(f"Failed to index directory {did}: {e}")
            if (i + 1) % batch_size == 0:
                logger.info(f"Indexed {i + 1}/{len(dir_ids)} directories...")

    logger.info("Full re-index complete!")

async def main():
    parser = argparse.ArgumentParser(description="WikINT Meilisearch Management Script")
    parser.add_argument("mode", choices=["audit", "cleanup", "prune", "full"], help="Mode of operation")
    parser.add_argument("--dry-run", action="store_true", help="Only for cleanup/prune mode: don't actually delete")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size for processing (default: 100)")
    parser.add_argument("--force", action="store_true", help="Skip confirmation for full re-index")
    
    args = parser.parse_args()
    
    if args.mode == "audit":
        for index_name, model in [("materials", Material), ("directories", Directory)]:
            orphans = await audit_index(index_name, model, batch_size=args.batch_size)
            if orphans:
                logger.info(f"!!! FOUND {len(orphans)} orphans in '{index_name}': {orphans[:20]}{'...' if len(orphans) > 20 else ''}")
            else:
                logger.info(f"Index '{index_name}' is CLEAN.")
                
    elif args.mode in ["cleanup", "prune"]:
        await perform_cleanup(dry_run=args.dry_run, batch_size=args.batch_size)
        
    elif args.mode == "full":
        if not args.force:
            confirm = input("Are you sure you want to WIPe and REBUILD the entire index? (y/N): ")
            if confirm.lower() != 'y':
                logger.info("Aborted.")
                return
        await perform_full_reindex(batch_size=args.batch_size)

if __name__ == "__main__":
    asyncio.run(main())
