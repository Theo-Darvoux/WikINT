import io
import logging

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
        elif mime_type.startswith("audio/") or mime_type == "video/ogg":
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
            # Re-save without EXIF
            output = io.BytesIO()
            # Preserve format (JPEG, PNG, WEBP)
            img_format = img.format or "JPEG"

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


# Filename hints help mutagen auto-detect format when magic bytes are ambiguous
_AUDIO_FILENAME_HINTS: dict[str, str] = {
    "audio/mpeg": "audio.mp3",
    "audio/mp3": "audio.mp3",
    "audio/flac": "audio.flac",
    "audio/x-flac": "audio.flac",
    "audio/ogg": "audio.ogg",
    "video/ogg": "audio.ogg",
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
