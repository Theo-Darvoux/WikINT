import asyncio
import hashlib
import os
import shutil
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from fastapi import UploadFile

from app.core.exceptions import BadRequestError

CHUNK_SIZE = 1024 * 1024  # 1 MiB chunks for fast buffered writes without thread overhead


class ProcessingFile:
    """A temporary file moving through the upload pipeline.

    Owns a single temp file on disk. Each pipeline stage reads it,
    processes, and writes the result back (or to a new temp file which
    then replaces the current one). This prevents large files from being
    held in process memory simultaneously.
    """

    def __init__(self, path: Path, size: int, hash: str | None = None) -> None:
        self.path = path
        self.size = size
        self.hash = hash

    @classmethod
    async def from_upload(cls, upload: UploadFile, max_bytes: int) -> "ProcessingFile":
        """Spool UploadFile to a named temp file with size enforcement and hashing.

        If the file is already on disk (Starlette spooled it), we use
        shutil.copyfile for a faster copy. Otherwise, we read in chunks.
        """
        temp = NamedTemporaryFile(delete=False)
        temp_path = Path(temp.name)
        hasher = hashlib.sha256()

        try:
            # 1. Fast path: if file is already on disk, check size and copy
            # We use getattr and check for existence safely to avoid crashes with mocks or spooled files.
            file_obj = getattr(upload, "file", None)
            inner_name = getattr(file_obj, "name", None) if file_obj else None

            if (
                inner_name
                and isinstance(inner_name, (str, bytes, os.PathLike))
                and os.path.exists(inner_name)
            ):
                file_size = os.path.getsize(inner_name)
                if file_size > max_bytes:
                    temp.close()
                    temp_path.unlink()
                    raise BadRequestError(
                        f"File size exceeds maximum of {max_bytes // (1024 * 1024)} MiB"
                    )

                temp.close()  # close our temp to let copyfile overwrite
                await asyncio.to_thread(shutil.copyfile, inner_name, temp_path)
                return cls(temp_path, file_size)

            # 2. Slow path: streamed read (file is likely in memory < 1MB)
            total_size = 0
            while True:
                chunk = await upload.read(CHUNK_SIZE)
                if not chunk:
                    break

                total_size += len(chunk)
                if total_size > max_bytes:
                    temp.close()
                    temp_path.unlink()
                    raise BadRequestError(
                        f"File size exceeds maximum of {max_bytes // (1024 * 1024)} MiB"
                    )
                # Delegate disk write to threadpool to avoid event loop blocking
                hasher.update(chunk)
                await asyncio.to_thread(temp.write, chunk)

            temp.close()
            return cls(temp_path, total_size, hash=hasher.hexdigest())
        except Exception:
            temp.close()
            temp_path.unlink(missing_ok=True)
            raise

    def replace_with(self, new_path: Path) -> None:
        """Atomic swap: delete old file, point to new_path."""
        if self.path != new_path:
            self.path.unlink(missing_ok=True)
            self.path = new_path
            self.size = new_path.stat().st_size

    async def sha256(self) -> str:
        """Compute SHA-256 by chunked reading in a separate thread.

        If the hash was already computed during upload, return the cached value.
        """
        if self.hash:
            return self.hash

        def _hash_file() -> str:
            hasher = hashlib.sha256()
            buffer = bytearray(CHUNK_SIZE)
            with open(self.path, "rb") as f:
                while True:
                    n = f.readinto(buffer)
                    if n == 0:
                        break
                    hasher.update(buffer[:n])
            return hasher.hexdigest()

        return await asyncio.to_thread(_hash_file)

    def read_bytes(self) -> bytes:
        """Read full file - use ONLY for types known to be small (SVG, text)."""
        return self.path.read_bytes()

    def open(self, mode: str = "rb") -> Any:
        """Context manager returning a file handle."""
        return open(self.path, mode)

    def cleanup(self) -> None:
        """Remove the temp file. Called in finally block."""
        self.path.unlink(missing_ok=True)
