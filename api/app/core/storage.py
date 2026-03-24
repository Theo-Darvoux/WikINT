from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlparse, urlunparse

import aioboto3
from botocore.config import Config as BotocoreConfig

from app.config import settings

_session = aioboto3.Session()

# Force SigV4 for all requests (required by R2 and MinIO >= 2022).
_s3_config = BotocoreConfig(signature_version="s3v4")

_s3: Any = None  # persistent client, set by init_s3_client()


async def init_s3_client() -> None:
    global _s3
    _s3 = await _session.client(
        "s3",
        endpoint_url=f"{'https' if settings.s3_use_ssl else 'http'}://{settings.s3_endpoint}",
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=_s3_config,
    ).__aenter__()


async def close_s3_client() -> None:
    global _s3
    if _s3:
        await _s3.__aexit__(None, None, None)
        _s3 = None


@asynccontextmanager
async def get_s3_client() -> AsyncGenerator:
    if _s3:
        yield _s3
        return

    async with _session.client(
        "s3",
        endpoint_url=f"{'https' if settings.s3_use_ssl else 'http'}://{settings.s3_endpoint}",
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=_s3_config,
    ) as client:
        yield client

def _rewrite_host(url: str, is_put: bool = False) -> str:
    """Rewrite host for local development. In production, we avoid rewriting S3 endpoint to Custom Domains for PUT, as R2 Custom Domains do not support presigned PUT requests."""
    if not settings.s3_public_endpoint:
        return url
    
    # Cloudflare R2 custom domains do not support presigned PUTs.
    # Therefore, we strictly don't rewrite if this is a production setup (public endpoint not containing "localhost") and it's a PUT request.
    if is_put and "localhost" not in settings.s3_public_endpoint:
        return url
        
    parsed = urlparse(url)
    scheme = "https" if "localhost" not in settings.s3_public_endpoint else "http"
    
    # If the user absolutely wants to use the custom domain for GETs, we must ensure the bucket name is stripped
    # from the path, because Cloudflare custom domains map directly to the bucket root.
    path = parsed.path
    if "localhost" not in settings.s3_public_endpoint:
        bucket_prefix = f"/{settings.s3_bucket}/"
        if path.startswith(bucket_prefix):
            path = path[len(bucket_prefix) - 1:] # Keep the leading slash: /uploads/...
            
    return urlunparse(parsed._replace(netloc=settings.s3_public_endpoint, scheme=scheme, path=path))

async def generate_presigned_put(
    file_key: str,
    content_type: str,
    ttl: int = 3600,
    content_length: int | None = None,
) -> str:
    params: dict = {
        "Bucket": settings.s3_bucket,
        "Key": file_key,
        "ContentType": content_type,
    }
    if content_length is not None:
        params["ContentLength"] = content_length
    async with get_s3_client() as client:
        url: str = await client.generate_presigned_url(
            "put_object",
            Params=params,
            ExpiresIn=ttl,
        )
        return _rewrite_host(url, is_put=True)

async def generate_presigned_get(file_key: str, ttl: int = 900) -> str:
    async with get_s3_client() as client:
        url: str = await client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": settings.s3_bucket,
                "Key": file_key,
            },
            ExpiresIn=ttl,
        )
        return _rewrite_host(url, is_put=False)


async def object_exists(file_key: str) -> bool:
    async with get_s3_client() as client:
        try:
            await client.head_object(Bucket=settings.s3_bucket, Key=file_key)
            return True
        except client.exceptions.ClientError:
            return False


async def get_object_info(file_key: str) -> dict:
    async with get_s3_client() as client:
        response = await client.head_object(Bucket=settings.s3_bucket, Key=file_key)
        return {
            "size": response["ContentLength"],
            "content_type": response["ContentType"],
        }


async def move_object(source_key: str, dest_key: str) -> None:
    async with get_s3_client() as client:
        await client.copy_object(
            Bucket=settings.s3_bucket,
            CopySource={"Bucket": settings.s3_bucket, "Key": source_key},
            Key=dest_key,
        )
        await client.delete_object(Bucket=settings.s3_bucket, Key=source_key)


async def copy_object(source_key: str, dest_key: str) -> None:
    async with get_s3_client() as client:
        await client.copy_object(
            Bucket=settings.s3_bucket,
            CopySource={"Bucket": settings.s3_bucket, "Key": source_key},
            Key=dest_key,
        )


async def delete_object(file_key: str) -> None:
    async with get_s3_client() as client:
        await client.delete_object(Bucket=settings.s3_bucket, Key=file_key)


async def read_full_object(file_key: str) -> bytes:
    """Read the entire object from storage into memory."""
    async with get_s3_client() as client:
        response = await client.get_object(Bucket=settings.s3_bucket, Key=file_key)
        return await response["Body"].read()


async def read_object_bytes(file_key: str, byte_count: int = 2048) -> bytes:
    async with get_s3_client() as client:
        try:
            response = await client.get_object(
                Bucket=settings.s3_bucket, Key=file_key, Range=f"bytes=0-{byte_count - 1}"
            )
            return await response["Body"].read()
        except client.exceptions.ClientError:
            return b""


async def update_object_content_type(file_key: str, content_type: str) -> None:
    async with get_s3_client() as client:
        await client.copy_object(
            Bucket=settings.s3_bucket,
            CopySource={"Bucket": settings.s3_bucket, "Key": file_key},
            Key=file_key,
            MetadataDirective="REPLACE",
            ContentType=content_type,
        )


@asynccontextmanager
async def stream_object(file_key: str) -> AsyncGenerator:
    """Yield S3 response body for chunked reading via ``await body.read(size)``."""
    if _s3:
        response = await _s3.get_object(Bucket=settings.s3_bucket, Key=file_key)
        try:
            yield response["Body"]
        finally:
            response["Body"].close()
        return

    async with get_s3_client() as client:
        response = await client.get_object(Bucket=settings.s3_bucket, Key=file_key)
        yield response["Body"]


generate_presigned_get_url = generate_presigned_get
generate_presigned_put_url = generate_presigned_put
