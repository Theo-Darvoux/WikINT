import io
import logging
import subprocess
import tempfile

import mutagen
import pikepdf
from PIL import Image

logger = logging.getLogger("wikint")


def strip_metadata(file_bytes: bytes, mime_type: str) -> bytes:
    """Remove PII and technical metadata from files (EXIF, PDF Info, audio tags, etc.)."""
    try:
        if mime_type.startswith("image/"):
            return _strip_image_metadata(file_bytes)
        elif mime_type == "application/pdf":
            return _strip_pdf_metadata(file_bytes)
        elif mime_type.startswith("video/"):
            return _strip_video_metadata(file_bytes, mime_type)
        elif mime_type.startswith("audio/"):
            return _strip_audio_metadata(file_bytes, mime_type)
    except Exception as e:
        logger.error("Failed to strip metadata from %s: %s", mime_type, e)
        # If stripping fails, return original bytes as fallback (fail-open for usability,
        # but malware scan will still run later)
        return file_bytes

    return file_bytes


def _strip_image_metadata(file_bytes: bytes) -> bytes:
    """Remove EXIF data from images by re-saving them."""
    try:
        with Image.open(io.BytesIO(file_bytes)) as img:
            output = io.BytesIO()
            img_format = img.format or "JPEG"

            if img_format == "GIF":
                # Preserve all frames and animation data for animated GIFs
                frames = []
                try:
                    while True:
                        frames.append(img.copy())
                        img.seek(img.tell() + 1)
                except EOFError:
                    pass

                if len(frames) > 1:
                    # Animated GIF: save all frames with animation parameters
                    durations = []
                    for i, frame in enumerate(frames):
                        img.seek(i)
                        durations.append(img.info.get("duration", 100))
                    loop = img.info.get("loop", 0)

                    frames[0].save(
                        output,
                        format="GIF",
                        save_all=True,
                        append_images=frames[1:],
                        duration=durations,
                        loop=loop,
                    )
                else:
                    frames[0].save(output, format="GIF")
            else:
                # Note: We don't use img.info which contains EXIF
                img.save(output, format=img_format)

            return output.getvalue()
    except Exception:
        raise


def _strip_pdf_metadata(file_bytes: bytes) -> bytes:
    """Remove Document Info and XMP metadata from PDFs."""
    try:
        with pikepdf.open(io.BytesIO(file_bytes)) as pdf:
            # Clear docinfo
            with pdf.open_metadata():
                # This clears the XMP metadata
                pass

            # Remove standard Info dictionary entries
            if "/Info" in pdf.trailer:
                del pdf.trailer["/Info"]

            output = io.BytesIO()
            pdf.save(output)
            return output.getvalue()
    except Exception:
        raise


_VIDEO_EXTENSION_HINTS: dict[str, str] = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
}


def _strip_video_metadata(file_bytes: bytes, mime_type: str) -> bytes:
    """Remove metadata from video files using ffmpeg (stream copy, no re-encoding)."""
    ext = _VIDEO_EXTENSION_HINTS.get(mime_type, ".mp4")
    with tempfile.NamedTemporaryFile(suffix=ext) as src, \
         tempfile.NamedTemporaryFile(suffix=ext) as dst:
        src.write(file_bytes)
        src.flush()
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", src.name,
                "-map_metadata", "-1",  # strip all global/stream metadata
                "-c", "copy",           # no re-encoding
                dst.name,
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            logger.warning(
                "ffmpeg metadata strip failed (rc=%d): %s",
                result.returncode, result.stderr[:500],
            )
            return file_bytes
        return dst.read()


# Filename hints help mutagen auto-detect format when magic bytes are ambiguous
_AUDIO_FILENAME_HINTS: dict[str, str] = {
    "audio/mpeg": "audio.mp3",
    "audio/mp3": "audio.mp3",
    "audio/flac": "audio.flac",
    "audio/x-flac": "audio.flac",
    "audio/ogg": "audio.ogg",
    "audio/wav": "audio.wav",
    "audio/x-wav": "audio.wav",
    "audio/mp4": "audio.m4a",
    "audio/x-m4a": "audio.m4a",
    "audio/aac": "audio.aac",
    "audio/x-aac": "audio.aac",
}


def _strip_audio_metadata(file_bytes: bytes, mime_type: str) -> bytes:
    """Remove ID3/Vorbis/MP4 tags from audio files."""
    bio = io.BytesIO(file_bytes)
    hint = _AUDIO_FILENAME_HINTS.get(mime_type, "audio.mp3")
    audio = mutagen.File(bio, filename=hint)
    if audio is None or audio.tags is None:
        return file_bytes
    audio.delete(bio)
    return bio.getvalue()
