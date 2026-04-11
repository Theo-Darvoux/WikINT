import asyncio
from sqlalchemy import select
from app.core.database import async_session_factory
from app.models.material import MaterialVersion
from app.core.storage import init_s3_client, default_bucket, storage_backend

async def run():
    await init_s3_client()
    async with async_session_factory() as db:
        res = await db.execute(select(MaterialVersion).where(MaterialVersion.id == "cdf0d589-eb54-4359-870f-f9bfa88f9cf6"))
        mv = res.scalar_one_or_none()
        if not mv:
            print("Not found.")
            return
            
        print(f"File key: {mv.file_key}")
        
        stat = await storage_backend.stat_object(default_bucket, mv.file_key)
        if stat:
            print(f"Size in storage: {stat.size} bytes")
        else:
            print("File not found in storage!")
        
asyncio.run(run())
