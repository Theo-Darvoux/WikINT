from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import aioboto3

from app.config import settings

_session = aioboto3.Session()


@asynccontextmanager
async def get_s3_client() -> AsyncGenerator:
    async with _session.client(
        "s3",
        endpoint_url=f"{'https' if settings.minio_use_ssl else 'http'}://{settings.minio_endpoint}",
        aws_access_key_id=settings.minio_root_user,
        aws_secret_access_key=settings.minio_root_password,
    ) as client:
        yield client


async def generate_presigned_put(file_key: str, content_type: str, ttl: int = 3600) -> str:
    async with get_s3_client() as client:
        url: str = await client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.minio_bucket,
                "Key": file_key,
                "ContentType": content_type,
            },
            ExpiresIn=ttl,
        )
        if settings.minio_public_endpoint:
            url = url.replace(settings.minio_endpoint, settings.minio_public_endpoint)
        return url


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
        if settings.minio_public_endpoint:
            url = url.replace(settings.minio_endpoint, settings.minio_public_endpoint)
        return url


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


async def delete_object(file_key: str) -> None:
    async with get_s3_client() as client:
        await client.delete_object(Bucket=settings.minio_bucket, Key=file_key)


async def read_object_bytes(file_key: str, byte_count: int = 2048) -> bytes:
    async with get_s3_client() as client:
        try:
            response = await client.get_object(
                Bucket=settings.minio_bucket,
                Key=file_key,
                Range=f"bytes=0-{byte_count - 1}"
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


generate_presigned_get_url = generate_presigned_get
generate_presigned_put_url = generate_presigned_put
