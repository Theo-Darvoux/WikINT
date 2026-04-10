import asyncio

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import async_session_factory
from app.models.directory import Directory
from app.models.pull_request import PullRequest


async def check_recent_directories():
    async with async_session_factory() as db:
        # Check for pending PRs
        pr_stmt = select(PullRequest).where(PullRequest.status == "pending").order_by(PullRequest.created_at.desc()).limit(5)
        prs = (await db.execute(pr_stmt)).scalars().all()
        print(f"--- Pending PRs ({len(prs)}) ---")
        for pr in prs:
            print(f"ID: {pr.id}, Author: {pr.author_id}, Created: {pr.created_at}")

        # Check for recently created directories
        dir_stmt = select(Directory).options(selectinload(Directory.tags)).order_by(Directory.created_at.desc()).limit(10)
        dirs = (await db.execute(dir_stmt)).scalars().all()
        print(f"\n--- Recent Directories ({len(dirs)}) ---")
        for d in dirs:
            tags = [t.name for t in d.tags]
            print(f"ID: {d.id}, Name: {d.name}, Tags: {tags}, Created: {d.created_at}")

if __name__ == "__main__":
    asyncio.run(check_recent_directories())
