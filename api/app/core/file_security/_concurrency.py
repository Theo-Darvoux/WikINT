"""Distributed + local concurrency guards for heavy file operations.

Provides a dual-layer semaphore: a Redis distributed semaphore for cluster-wide
rate limiting, with a local asyncio.Semaphore fallback when Redis is unavailable.
"""

import asyncio
import logging
import os
import subprocess
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from app.config import settings
from app.core.redis import redis_client, redis_semaphore

logger = logging.getLogger("wikint")

# Fallback local semaphores for environments without Redis or as a secondary guard.
# We prefer distributed semaphores for clustered workers.
_SUBPROCESS_LIMIT = settings.global_max_subprocesses or (os.cpu_count() or 4)
_IMAGE_MEMORY_LIMIT = settings.max_concurrent_image_ops or max(1, (os.cpu_count() or 2) // 2)

_local_subprocess_sem = asyncio.Semaphore(_SUBPROCESS_LIMIT)
_local_image_sem = asyncio.Semaphore(_IMAGE_MEMORY_LIMIT)


@asynccontextmanager
async def _get_concurrency_guard(guard_type: str) -> AsyncIterator[None]:
    """Acquire a distributed semaphore with a local fallback."""
    limit = _SUBPROCESS_LIMIT if guard_type == "subprocess" else _IMAGE_MEMORY_LIMIT
    local_sem = _local_subprocess_sem if guard_type == "subprocess" else _local_image_sem

    try:
        async with redis_semaphore(redis_client, f"heavy_ops:{guard_type}", limit=limit):
            async with local_sem:
                yield
    except (TimeoutError, Exception) as e:
        # If Redis is down or slow, rely strictly on the local semaphore
        # to prevent complete processing stall.
        if isinstance(e, (asyncio.TimeoutError, TimeoutError)):
            logger.warning(
                "Timeout acquiring distributed semaphore for %s, falling back to local only",
                guard_type,
            )
        async with local_sem:
            yield


async def run_managed_subprocess(
    cmd: list[str],
    timeout: int = 60,
    check: bool = True,
    **kwargs: Any,
) -> "subprocess.CompletedProcess[Any]":
    """Run a subprocess while respecting the global concurrency limit."""
    async with _get_concurrency_guard("subprocess"):
        return await asyncio.to_thread(
            lambda: subprocess.run(
                cmd,
                timeout=timeout,
                check=check,
                capture_output=True,
                **kwargs,
            )
        )
