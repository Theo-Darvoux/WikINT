import asyncio
from botocore.config import Config
import aioboto3

async def test():
    session = aioboto3.Session()
    # Mock settings
    s3_public_endpoint = "files.wikint.hypnos2026.fr"
    s3_access_key=""
    s3_secret_key=""
    s3_region="us-east-1"
    scheme = "https"

    config = Config(signature_version="s3v4")

    async with session.client("s3", endpoint_url=f"https://{s3_public_endpoint}", aws_access_key_id="test", aws_secret_access_key="test", region_name="us-east-1", config=config) as client:
        url = await client.generate_presigned_url(
            "put_object",
            Params={"Bucket": "wikint", "Key": "abc/def.pdf"},
            ExpiresIn=3600
        )
        print("Generated:", url)

asyncio.run(test())
