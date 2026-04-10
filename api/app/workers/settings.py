from arq.connections import RedisSettings
from arq.cron import cron

from app.config import settings
from app.workers.cleanup_uploads import cleanup_uploads
from app.workers.gdpr_cleanup import gdpr_cleanup
from app.workers.index_content import delete_indexed_item, index_directory, index_material
from app.workers.process_upload import process_upload
from app.workers.reconcile_multipart import reconcile_multipart_uploads
from app.workers.storage_ops import delete_storage_objects
from app.workers.webhook_dispatch import dispatch_webhook
from app.workers.year_rollover import year_rollover


async def startup(ctx: dict) -> None:
    import shutil

    if not shutil.which("bwrap"):
        raise RuntimeError(
            "bwrap (bubblewrap) is required but not found. Install it: apt install bubblewrap"
        )

    try:
        import oletools.olevba as _olevba

        _ = _olevba
    except ImportError:
        raise RuntimeError(
            "oletools is required for OLE2 macro detection. Install: pip install oletools"
        )

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.core.scanner import MalwareScanner

    scanner = MalwareScanner()
    scanner.initialize()
    ctx["scanner"] = scanner

    # Provide a DB session factory for workers that need to persist upload state.
    _is_sqlite = settings.database_url.startswith("sqlite")
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        **({} if _is_sqlite else {"pool_size": 5, "max_overflow": 2}),
    )
    ctx["db_engine"] = engine
    ctx["db_sessionmaker"] = async_sessionmaker(engine, expire_on_commit=False)


async def shutdown(ctx: dict) -> None:
    scanner = ctx.get("scanner")
    if scanner is not None:
        await scanner.close()

    engine = ctx.get("db_engine")
    if engine is not None:
        await engine.dispose()


# ── Queue name constants ──────────────────────────────────────────────────────

UPLOAD_FAST_QUEUE = "upload-fast"  # < 5 MiB files — dedicated fast workers
UPLOAD_SLOW_QUEUE = "upload-slow"  # ≥ 5 MiB files — dedicated slow workers


class WorkerSettings:
    """Main worker: handles all non-upload background tasks + fallback upload queue."""

    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions = [
        index_material,
        index_directory,
        delete_indexed_item,
        delete_storage_objects,
        process_upload,
        dispatch_webhook,
    ]
    cron_jobs = [
        cron(cleanup_uploads, hour=3, minute=0),
        cron(gdpr_cleanup, hour=4, minute=0),
        cron(year_rollover, month={9}, day=1, hour=2, minute=0),
        cron(reconcile_multipart_uploads, hour={2, 14}, minute=0),
    ]
    on_startup = startup
    on_shutdown = shutdown


class UploadFastWorkerSettings:
    """Dedicated worker for small uploads (< 5 MiB). Deploy separately for priority isolation."""

    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    queue_name = UPLOAD_FAST_QUEUE
    functions = [process_upload]
    on_startup = startup
    on_shutdown = shutdown


class UploadSlowWorkerSettings:
    """Dedicated worker for large uploads (≥ 5 MiB). Deploy separately to avoid starving fast queue."""

    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    queue_name = UPLOAD_SLOW_QUEUE
    functions = [process_upload]
    on_startup = startup
    on_shutdown = shutdown
