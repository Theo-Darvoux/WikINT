from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")
engine = create_async_engine(
    settings.database_url,
    echo=settings.is_dev,
    **({} if _is_sqlite else {"pool_size": 20, "max_overflow": 10}),
)

async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    import typing
    async with async_session_factory() as session:
        jobs: list[tuple[typing.Any, ...]] = []
        session.info["post_commit_jobs"] = jobs
        try:
            yield session
            await session.commit()

            if jobs:
                import logging

                import app.core.redis as redis_core

                db_logger = logging.getLogger("wikint")

                if redis_core.arq_pool:
                    for job in jobs:
                        try:
                            await redis_core.arq_pool.enqueue_job(*job)
                        except Exception as e:
                            db_logger.critical(
                                "CRITICAL: Failed to enqueue background job after commit: %s. Job data: %s",
                                e,
                                job,
                            )
                else:
                    db_logger.critical(
                        "CRITICAL: No arq_pool available to enqueue jobs after commit. Jobs: %s",
                        jobs,
                    )
        except Exception:
            await session.rollback()
            raise
