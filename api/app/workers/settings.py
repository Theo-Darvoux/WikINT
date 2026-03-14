from arq.connections import RedisSettings
from arq.cron import cron

from app.config import settings
from app.workers.cleanup_uploads import cleanup_uploads
from app.workers.gdpr_cleanup import gdpr_cleanup
from app.workers.index_content import delete_indexed_item, index_directory, index_material
from app.workers.process_upload import process_upload
from app.workers.year_rollover import year_rollover


async def startup(ctx: dict) -> None:
    pass


async def shutdown(ctx: dict) -> None:
    pass


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions = [process_upload, index_material, index_directory, delete_indexed_item]
    cron_jobs = [
        cron(cleanup_uploads, hour=3, minute=0),
        cron(gdpr_cleanup, hour=4, minute=0),
        cron(year_rollover, month={9}, day=1, hour=2, minute=0),
    ]
    on_startup = startup
    on_shutdown = shutdown

