from __future__ import annotations

import logging
import typing
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings

logger = logging.getLogger("wikint")


async def reset_daily_views(ctx: dict[typing.Any, typing.Any]) -> None:
    """Accumulate today's view counts into the 14-day rolling counter, then reset daily counters.

    Run order matters: views_14d is incremented first so that the data is never
    lost if the process crashes between the two operations.  Because both columns
    are updated in a single SQL statement the operation is effectively atomic at
    the row level.
    """
    from app.models.material import Material

    engine = create_async_engine(settings.database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        now = datetime.now(UTC)

        # Accumulate today's views into the 14-day counter, then zero out the
        # daily counter.  Only rows with activity are touched to keep the UPDATE
        # as narrow as possible.
        result = await db.execute(
            update(Material)
            .where(Material.views_today > 0)
            .values(
                views_14d=Material.views_14d + Material.views_today,
                views_today=0,
                last_view_reset=now,
            )
        )
        await db.commit()

        rowcount = getattr(result, "rowcount", 0)
        logger.info(
            "Daily view reset: accumulated and cleared views_today on %d materials", rowcount
        )

    await engine.dispose()


async def reset_14d_views(ctx: dict[typing.Any, typing.Any]) -> None:
    """Reset the 14-day rolling view counter to zero for all materials.

    Scheduled to run on the 1st and 15th of each month (approximately every
    14 days) so that the counter genuinely reflects a two-week window rather
    than accumulating indefinitely.
    """
    from app.models.material import Material

    engine = create_async_engine(settings.database_url)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        result = await db.execute(
            update(Material).where(Material.views_14d > 0).values(views_14d=0)
        )
        await db.commit()

        rowcount = getattr(result, "rowcount", 0)
        logger.info("14-day view reset: cleared views_14d on %d materials", rowcount)

    await engine.dispose()
