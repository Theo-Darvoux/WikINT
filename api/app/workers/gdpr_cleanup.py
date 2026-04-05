import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select

from app.models.user import User

logger = logging.getLogger("wikint")

GDPR_RETENTION_DAYS = 30


async def gdpr_cleanup(ctx: dict) -> None:
    logger.info("Running GDPR cleanup cron job")
    try:
        from app.core.database import async_session_factory

        cutoff = datetime.now(UTC) - timedelta(days=GDPR_RETENTION_DAYS)

        async with async_session_factory() as db:
            result = await db.execute(
                select(User).where(
                    User.deleted_at.is_not(None),
                    User.deleted_at <= cutoff,
                )
            )
            users_to_delete = result.scalars().all()

            if not users_to_delete:
                logger.info("No users to clean up")
                return

            for user in users_to_delete:
                logger.info("Hard-deleting user %s (%s)", user.id, user.email)
                await db.execute(delete(User).where(User.id == user.id))

            await db.commit()
            logger.info("GDPR cleanup complete: %d users hard-deleted", len(users_to_delete))

    except Exception as e:
        logger.error("GDPR cleanup failed: %s", e)
