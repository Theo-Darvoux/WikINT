from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from urllib.parse import urlparse, urlunparse

import aioboto3
from botocore.config import Config as BotocoreConfig

from app.config import settings

_session = aioboto3.Session()

# MinIO ≥ RELEASE.2022 dropped SigV2; force SigV4 for all requests.
_s3_config = BotocoreConfig(signature_version="s3v4")


def _rewrite_host(url: str) -> str:
    """Swap the internal MinIO host with the public endpoint, touching only the netloc and enforcing https in production."""
    if not settings.minio_public_endpoint:
        return url
    parsed = urlparse(url)
    
    # If the public endpoint is not localhost, enforce https to avoid CSP errors.
    scheme = "https" if "localhost" not in settings.minio_public_endpoint else "http"
    
    return urlunparse(parsed._replace(netloc=settings.minio_public_endpoint, scheme=scheme))


@asynccontextmanager
async def get_s3_client() -> AsyncGenerator:
    async with _session.client(
        "s3",
        endpoint_url=f"{'https' if settings.minio_use_ssl else 'http'}://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
        region_name="us-east-1",
        config=_s3_config,
    ) as client:
        yield client


async def generate_presigned_put(
    file_key: str,
    content_type: str,
    ttl: int = 3600,
    content_length: int | None = None,
) -> str:
    params: dict = {
        "Bucket": settings.minio_bucket,
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
        return _rewrite_host(url)


async def generate_presigned_get(file_key: str, ttl: int = 900) -> str:
    async with get_s3_client() as client:
        url: str = await client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": settings.minio_bucket,
                "Key": file_key,
            },
            ExpiresIn=ttl,
        )
        return _rewrite_host(url)


async def object_exists(file_key: str) -> bool:
    async with get_s3_client() as client:
        try:
            await client.head_object(Bucket=settings.minio_bucket, Key=file_key)
            return True
        except client.exceptions.ClientError:
            return False


async def get_object_info(file_key: str) -> dict:
    async with get_s3_client() as client:
        response = await client.head_object(Bucket=settings.minio_bucket, Key=file_key)
        return {
            "size": response["ContentLength"],
            "content_type": response["ContentType"],
        }


async def move_object(source_key: str, dest_key: str) -> None:
    async with get_s3_client() as client:
        await client.copy_object(
            Bucket=settings.minio_bucket,
            CopySource={"Bucket": settings.minio_bucket, "Key": source_key},
            Key=dest_key,
        )
        await client.delete_object(Bucket=settings.minio_bucket, Key=source_key)


async def copy_object(source_key: str, dest_key: str) -> None:
    async with get_s3_client() as client:
        await client.copy_object(
            Bucket=settings.minio_bucket,
            CopySource={"Bucket": settings.minio_bucket, "Key": source_key},
            Key=dest_key,
        )


async def delete_object(file_key: str) -> None:
    async with get_s3_client() as client:
        await client.delete_object(Bucket=settings.minio_bucket, Key=file_key)


async def read_full_object(file_key: str) -> bytes:
    """Read the entire object from storage into memory."""
    async with get_s3_client() as client:
        response = await client.get_object(Bucket=settings.minio_bucket, Key=file_key)
        return await response["Body"].read()


async def read_object_bytes(file_key: str, byte_count: int = 2048) -> bytes:
    async with get_s3_client() as client:
        try:
            response = await client.get_object(
                Bucket=settings.minio_bucket, Key=file_key, Range=f"bytes=0-{byte_count - 1}"
            )
            return await response["Body"].read()
        except client.exceptions.ClientError:
            return b""


async def update_object_content_type(file_key: str, content_type: str) -> None:
    async with get_s3_client() as client:
        await client.copy_object(
            Bucket=settings.minio_bucket,
            CopySource={"Bucket": settings.minio_bucket, "Key": file_key},
            Key=file_key,
            MetadataDirective="REPLACE",
            ContentType=content_type,
        )


@asynccontextmanager
async def stream_object(file_key: str) -> AsyncGenerator:
    """Yield S3 response body for chunked reading via ``await body.read(size)``."""
    async with get_s3_client() as client:
        response = await client.get_object(Bucket=settings.minio_bucket, Key=file_key)
        yield response["Body"]


generate_presigned_get_url = generate_presigned_get
generate_presigned_put_url = generate_presigned_put
