from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.is_dev,
    pool_size=20,
    max_overflow=10,
)

async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        session.info["post_commit_jobs"] = []
        try:
            yield session
            await session.commit()

            jobs = session.info.get("post_commit_jobs", [])
            if jobs:
                import app.core.redis as redis_core

                if redis_core.arq_pool:
                    for job in jobs:
                        await redis_core.arq_pool.enqueue_job(*job)
        except Exception:
            await session.rollback()
            raise
