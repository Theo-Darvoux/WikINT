import asyncio
import json
import logging
import time
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.config import settings
from app.core.cas import hmac_cas_key
from app.core.exceptions import BadRequestError
from app.core.file_security import (
    check_pdf_safety,
    compress_file_path,
    get_uncompressed_size,
    strip_metadata_file,
)
from app.core.metrics import (
    mime_category as _mime_cat,
)
from app.core.metrics import (
    upload_compression_ratio,
    upload_file_size,
    upload_pipeline_duration,
    upload_pipeline_total,
    upload_scan_duration,
)
from app.core.mimetypes import MimeRegistry, guess_mime_from_file_path
from app.core.processing import ProcessingFile
from app.core.scanner import MalwareScanner
from app.core.storage import (
    copy_object,
    delete_object,
    upload_file_multipart,
)
from app.core.telemetry import extract_trace_context, get_tracer
from app.schemas.material import UploadStatus

logger = logging.getLogger("wikint")

_STATUS_CACHE_PREFIX = "upload:status:"
_SCAN_CACHE_PREFIX = "upload:scanned:"
_SHA256_CACHE_PREFIX = "upload:sha256:"

_LUA_CAS_INCR = """
local raw = redis.call('GET', KEYS[1])
local data
if not raw then
  if ARGV[1] then
    data = cjson.decode(ARGV[1])
    data['ref_count'] = 1
  else
    return 0
  end
else
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok then return 0 end
  data = decoded
  data['ref_count'] = (data['ref_count'] or 1) + 1
  if ARGV[1] then
    local arg_data = cjson.decode(ARGV[1])
    if arg_data['scanned_at'] then
      data['scanned_at'] = arg_data['scanned_at']
    end
  end
end
redis.call('SET', KEYS[1], cjson.encode(data))
return data['ref_count']
"""

_LUA_CAS_DECR = """
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, data = pcall(cjson.decode, raw)
if not ok then return 0 end
local count = (data['ref_count'] or 1) - 1
if count <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
data['ref_count'] = count
redis.call('SET', KEYS[1], cjson.encode(data))
return count
"""

# ── Pipeline stage definitions ────────────────────────────────────────────────
#
# Each stage has a name, a human-readable label, and a weight (sum → 1.0).
# Clients receive ``overall_percent`` (0.0–1.0) for smooth progress rendering.
#
_STAGES = [
    ("scanning", "Scanning for malware", 0.40),
    ("stripping", "Removing private metadata", 0.25),
    ("compressing", "Optimising file size", 0.25),
    ("finalizing", "Finalising upload", 0.10),
]
_STAGE_TOTAL = len(_STAGES)
_STAGE_BASES = [sum(w for _, _, w in _STAGES[:i]) for i in range(_STAGE_TOTAL)]

# Per-MIME-category compression timeouts (seconds)
_COMPRESSION_TIMEOUTS: dict[str, float] = {
    "application/pdf": 120.0,
    "video/mp4": 1200.0,
    "video/webm": 1200.0,
    "audio/": 60.0,  # prefix match
    "image/": 30.0,
    "text/": 15.0,
    "default": 90.0,
}


def _compression_timeout(mime_type: str) -> float:
    """Return the compression deadline (seconds) for the given MIME type."""
    if mime_type in _COMPRESSION_TIMEOUTS:
        return _COMPRESSION_TIMEOUTS[mime_type]
    for prefix, timeout in _COMPRESSION_TIMEOUTS.items():
        if prefix.endswith("/") and mime_type.startswith(prefix):
            return timeout
    return _COMPRESSION_TIMEOUTS["default"]


def _overall(stage_index: int, stage_percent: float) -> float:
    """Compute overall progress [0.0, 1.0] from stage index + within-stage percent."""
    base = _STAGE_BASES[stage_index]
    weight = _STAGES[stage_index][2]
    return round(base + weight * stage_percent, 4)


def _get_fallback_scanner() -> MalwareScanner:
    """Create a one-shot scanner for contexts without a pooled instance (e.g. tests)."""
    s = MalwareScanner()
    s.initialize()
    return s


async def _update_db_status(
    ctx: dict,
    upload_id: str,
    status: str,
    *,
    sha256: str | None = None,
    content_sha256: str | None = None,
    final_key: str | None = None,
    error_detail: str | None = None,
    cas_key: str | None = None,
    cas_ref_count: int | None = None,
) -> None:
    """Best-effort DB status update with single retry for transient failures (audit fix #9)."""
    session_factory = ctx.get("db_sessionmaker")
    if session_factory is None:
        return
    for _attempt in range(2):
        try:
            from sqlalchemy import update

            from app.models.upload import Upload

            async with session_factory() as session:
                values: dict = {
                    "status": status,
                    "updated_at": datetime.now(UTC),
                }
                if sha256 is not None:
                    values["sha256"] = sha256
                if content_sha256 is not None:
                    values["content_sha256"] = content_sha256
                if final_key is not None:
                    values["final_key"] = final_key
                if error_detail is not None:
                    values["error_detail"] = error_detail
                if cas_key is not None:
                    values["cas_key"] = cas_key
                if cas_ref_count is not None:
                    values["cas_ref_count"] = cas_ref_count
                await session.execute(
                    update(Upload).where(Upload.upload_id == upload_id).values(**values)
                )
                await session.commit()
            return
        except Exception as exc:
            if _attempt == 0:
                logger.warning("DB status update retry for upload %s: %s", upload_id, exc)
                await asyncio.sleep(0.5)
            else:
                logger.error(
                    "DB status update failed for upload %s after retry: %s", upload_id, exc
                )


_CANCEL_KEY_PREFIX = "upload:cancel:"
_MAX_ARQ_RETRIES = 3


async def _checkpoint_stage(ctx: dict, upload_id: str, stage: int) -> None:
    """Persist the completed pipeline stage to the DB for resume-on-retry."""
    session_factory = ctx.get("db_sessionmaker")
    if session_factory is None:
        return
    try:
        from sqlalchemy import update

        from app.models.upload import Upload

        async with session_factory() as session:
            await session.execute(
                update(Upload)
                .where(Upload.upload_id == upload_id)
                .values(pipeline_stage=stage)
            )
            await session.commit()
    except Exception as exc:
        logger.warning("Checkpoint stage %d failed for upload %s: %s", stage, upload_id, exc)


async def _get_pipeline_stage(ctx: dict, upload_id: str) -> int:
    """Read the last completed pipeline stage from the DB."""
    session_factory = ctx.get("db_sessionmaker")
    if session_factory is None:
        return 0
    try:
        from sqlalchemy import select

        from app.models.upload import Upload

        async with session_factory() as session:
            row = await session.scalar(select(Upload).where(Upload.upload_id == upload_id))
            return row.pipeline_stage if row else 0
    except Exception as exc:
        logger.warning("Failed to read pipeline stage for upload %s: %s", upload_id, exc)
        return 0


async def _check_cancelled(redis, upload_id: str) -> bool:
    """Check whether this upload has been cancelled via the Redis flag."""
    key = f"{_CANCEL_KEY_PREFIX}{upload_id}"
    return await redis.exists(key) > 0


async def _insert_dead_letter(
    ctx: dict,
    upload_id: str,
    job_name: str,
    payload: dict,
    error: str,
    attempts: int,
) -> None:
    """Insert a failed job into the dead_letter_jobs table."""
    session_factory = ctx.get("db_sessionmaker")
    if session_factory is None:
        logger.error("No DB session factory — cannot insert dead letter for upload %s", upload_id)
        return
    try:
        from app.models.dead_letter import DeadLetterJob

        async with session_factory() as session:
            dlj = DeadLetterJob(
                job_name=job_name,
                upload_id=upload_id,
                payload=payload,
                error_detail=error[:4000] if error else None,
                attempts=attempts,
            )
            session.add(dlj)
            await session.commit()
        logger.info("Dead-lettered job %s for upload %s after %d attempts", job_name, upload_id, attempts)
    except Exception as exc:
        logger.error("Failed to insert dead letter for upload %s: %s", upload_id, exc)


async def _increment_cas_ref(redis, sha256: str, initial_data: dict | None = None) -> int:
    """Atomically increment the CAS ref count. Returns the new count, or 0 on error."""
    cas_key = hmac_cas_key(sha256)
    try:
        if initial_data:
            count = await redis.eval(_LUA_CAS_INCR, 1, cas_key, json.dumps(initial_data))
        else:
            count = await redis.eval(_LUA_CAS_INCR, 1, cas_key)
        return int(count) if count is not None else 1
    except Exception as exc:
        logger.warning("CAS ref increment failed for %s: %s", sha256, exc)
        return 0


async def _decrement_cas_ref(redis, sha256: str) -> None:
    cas_key = hmac_cas_key(sha256)
    try:
        await redis.eval(_LUA_CAS_DECR, 1, cas_key)
    except Exception as exc:
        logger.warning("CAS ref decrement failed for %s: %s", sha256, exc)


def _is_cas_entry_stale(cas_data: dict, ctx: dict) -> bool:
    """Return True if a CAS cache entry should be treated as expired.

    An entry is stale when:
    - It has no ``scanned_at`` timestamp (legacy entry before staleness tracking).
    - It is older than ``settings.cas_max_age_seconds``.
    - It was scanned before the last YARA rules compilation time (stored in ctx
      at worker startup).
    """
    max_age = settings.cas_max_age_seconds
    if max_age <= 0:
        return False  # staleness checks disabled

    scanned_at = cas_data.get("scanned_at")
    if scanned_at is None:
        return True  # legacy entry, force re-scan

    now = time.time()
    if now - scanned_at > max_age:
        return True

    # If YARA rules were re-compiled after this entry was scanned, re-scan.
    yara_compiled_at = ctx.get("yara_compiled_at", 0)
    if yara_compiled_at and scanned_at < yara_compiled_at:
        return True

    return False


async def process_upload(
    ctx: dict,
    user_id: str,
    upload_id: str,
    quarantine_key: str,
    original_filename: str,
    mime_type: str,
    expected_sha256: str | None = None,
    trace_context: dict | None = None,
) -> None:
    """Background task: download → scan → strip metadata → compress → stage.

    Emits structured SSE progress events so clients can render a smooth progress
    bar without parsing human-readable detail strings.

    Global CAS deduplication: if a known-clean SHA-256 exists in Redis, the full
    pipeline is skipped and the file is copied from the existing S3 object.
    """
    from opentelemetry import context as otel_context

    trace_ctx = extract_trace_context(trace_context or {})
    _otel_token = otel_context.attach(trace_ctx)

    redis = ctx["redis"]
    status_key = f"{_STATUS_CACHE_PREFIX}{quarantine_key}"
    event_channel = f"upload:events:{quarantine_key}"
    pipeline_start = time.monotonic()
    _cat = _mime_cat(mime_type)

    async def _check_deadline(stage_name: str) -> None:
        """Fail the job if the total pipeline deadline has been exceeded."""
        elapsed = time.monotonic() - pipeline_start
        if elapsed > settings.upload_pipeline_max_seconds:
            msg = f"Pipeline deadline exceeded at stage '{stage_name}' ({elapsed:.0f}s)"
            await update_status(UploadStatus.FAILED, detail=msg)
            raise RuntimeError(msg)

    async def update_status(
        status: UploadStatus,
        detail: str | None = None,
        result: dict | None = None,
        stage_index: int | None = None,
        stage_percent: float = 0.0,
    ) -> None:
        payload: dict = {
            "upload_id": upload_id,
            "file_key": quarantine_key,
            "status": status,
            "detail": detail,
            "result": result,
        }
        if stage_index is not None:
            payload["stage_index"] = stage_index
            payload["stage_total"] = _STAGE_TOTAL
            payload["stage_percent"] = round(stage_percent, 4)
            payload["overall_percent"] = _overall(stage_index, stage_percent)

        payload_json = json.dumps(payload)
        await redis.set(status_key, payload_json, ex=3600)
        await redis.publish(event_channel, payload_json)
        event_log_key = f"upload:eventlog:{quarantine_key}"
        idx = await redis.rpush(event_log_key, payload_json)
        if idx == 1:
            await redis.expire(event_log_key, 7200)
        elif idx > 200:
            # Cap event log to prevent unbounded Redis memory growth (M5)
            await redis.ltrim(event_log_key, -200, -1)

    # ── Resume support: skip completed stages on retry ────────────────────
    completed_stage = await _get_pipeline_stage(ctx, upload_id)
    if completed_stage > 0:
        logger.info(
            "Resuming upload %s from stage %d (stages 0–%d already done)",
            upload_id,
            completed_stage,
            completed_stage - 1,
        )

    # ── Early cancellation check (before downloading) ─────────────────────
    if await _check_cancelled(redis, upload_id):
        logger.info("Upload %s cancelled before processing started", upload_id)
        await _update_db_status(ctx, upload_id, "cancelled", error_detail="Cancelled by user")
        try:
            await delete_object(quarantine_key)
        except Exception:
            pass
        return

    # ── Stage 0: scanning start ──────────────────────────────────────────────
    stage_name, stage_label, _ = _STAGES[0]
    await update_status(
        UploadStatus.PROCESSING, detail=stage_label, stage_index=0, stage_percent=0.0
    )
    await _update_db_status(ctx, upload_id, "processing")

    tmp = NamedTemporaryFile(delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()

    pf = None
    try:
        await _check_deadline(stage_name)

        # 1. Download from quarantine + compute hash in one pass (Optimization 6.1)
        # ── DISK SPACE GUARD (Issue 5 / 3.2) ──
        # ZIP-based files (DOCX, EPUB) and PDFs can expand massively.
        # We must check free disk space against uncompressed size for ZIPs.
        import shutil

        from app.core.storage import download_file_with_hash, get_object_info
        info = await get_object_info(quarantine_key)
        initial_size = info["size"]

        # Cut-off for extremely suspicious expansion: 500 MB (matching ZIP_MAX_TOTAL_BYTES)
        expansion_hard_limit = 500 * 1024 * 1024

        # We first download to calculate the true hash and extension/mime.
        temp_dir = tmp_path.parent
        usage = shutil.disk_usage(temp_dir)
        required_free = int(initial_size * 2.0) # Increased buffer to 2.0x

        if usage.free < required_free:
            logger.error("Worker disk space critically low: %d bytes free, %d required.", usage.free, required_free)
            raise RuntimeError(f"Insufficient disk space for {upload_id}")

        original_sha256 = await download_file_with_hash(quarantine_key, tmp_path)

        # ── DECOMPRESSION BOMB CHECK (Issue 5) ──
        from app.core.mimetypes import ZIP_MIME_TYPES
        if mime_type in ZIP_MIME_TYPES or original_filename.lower().endswith(('.docx', '.xlsx', '.pptx', '.zip', '.epub')):
            uncompressed_size = await asyncio.to_thread(get_uncompressed_size, tmp_path)
            if uncompressed_size > expansion_hard_limit:

                 msg = f"Decompression bomb detected: total uncompressed size {uncompressed_size} bytes exceeds limit."
                 await update_status(UploadStatus.MALICIOUS, detail=msg)
                 await _update_db_status(ctx, upload_id, "malicious", error_detail=msg)
                 return

            # Re-verify disk space for actual extraction
            required_extraction_free = int(uncompressed_size * 1.2)
            if usage.free < required_extraction_free:
                msg = "Worker disk space low for uncompressed payload."
                logger.error(msg)
                raise RuntimeError(msg)

        if expected_sha256 and expected_sha256 != original_sha256:
            msg = "SHA-256 integrity check failed"
            logger.warning("Upload %s failed sha256 check. Expected: %s, got: %s", upload_id, expected_sha256, original_sha256)
            await update_status(UploadStatus.FAILED, detail=msg)
            await _update_db_status(ctx, upload_id, "failed", error_detail=msg)
            return

        # ── MIME Verification (Issue S3/S4) ──
        # Re-detect MIME from magic bytes to prevent bypass via client-declared type
        actual_mime = guess_mime_from_file_path(tmp_path)
        if actual_mime != "application/octet-stream" and actual_mime != mime_type:
            # If magic bytes give a specific type that differs from declared, use it
            logger.info(
                "MIME mismatch for %s: declared %s, detected %s", upload_id, mime_type, actual_mime
            )
            mime_type = actual_mime
            _cat = _mime_cat(mime_type)

        # ── Strict MIME Guard (S14) ──
        if not MimeRegistry.is_allowed_mime(mime_type):
            msg = f"File type {mime_type} is not allowed"
            await update_status(UploadStatus.FAILED, detail=msg)
            await _update_db_status(ctx, upload_id, "failed", error_detail=msg)
            return

        # ── Polyglot detection (Issue 1.11) ──────────────────────────────────
        from app.core.polyglot import check_polyglot

        try:
            await asyncio.to_thread(check_polyglot, tmp_path, mime_type)
        except ValueError as e:
            msg = str(e)
            await update_status(UploadStatus.MALICIOUS, detail=msg)
            await _update_db_status(ctx, upload_id, "malicious", error_detail=msg)
            return

        # ── SVG Safety Check (Issue S8) ──
        if mime_type == "image/svg+xml":
            from app.core.file_security import check_svg_safety
            try:
                check_svg_safety(tmp_path.read_bytes(), original_filename)
            except Exception as e:
                msg = str(e)
                await update_status(UploadStatus.MALICIOUS, detail=msg)
                await _update_db_status(ctx, upload_id, "malicious", error_detail=msg)
                return

        pf = ProcessingFile(tmp_path, size=initial_size)

        # ── Global CAS deduplication check ──────────────────────────────────
        cas_key = hmac_cas_key(original_sha256)
        cas_raw = await redis.get(cas_key)
        if cas_raw:
            try:
                cas_data = json.loads(cas_raw)

                if _is_cas_entry_stale(cas_data, ctx):
                    logger.info(
                        "CAS entry stale for %s — re-processing through full pipeline",
                        original_sha256[:12],
                    )
                    raise ValueError("stale")  # caught below, triggers full pipeline

                # ── MANDATORY SCAN-ON-HIT (Issue 1) ──
                # Even if we have a CAS hit, we MUST re-scan against the CURRENT
                # YARA rules and MalwareBazaar status to prevent cache poisoning.
                malware_scanner: MalwareScanner = ctx.get("scanner") or _get_fallback_scanner()
                await malware_scanner.scan_file_path(tmp_path, original_filename, bazaar_hash=original_sha256)

                cas_s3_key = cas_data["final_key"]

                # Ensure the CAS object actually exists in S3 (Issue 1.1)
                from app.core.storage import object_exists
                if await object_exists(cas_s3_key):
                    safe_name = original_filename
                    final_key = f"uploads/{user_id}/{upload_id}/{safe_name}"

                    # We still copy to a per-user uploads/ key for now to maintain
                    # compatibility with the PR system, but the source is now the
                    # stable cas/ prefix.
                    await asyncio.wait_for(
                        copy_object(cas_s3_key, final_key), timeout=60.0
                    )
                    await _increment_cas_ref(redis, original_sha256)

                    # Track in quota + scan caches
                    await redis.zadd(f"quota:uploads:{user_id}", {final_key: time.time()})
                    await redis.set(f"{_SCAN_CACHE_PREFIX}{final_key}", "CLEAN", ex=24 * 3600)
                    await redis.set(
                        f"{_SHA256_CACHE_PREFIX}{user_id}:{original_sha256}",
                        final_key,
                        ex=24 * 3600,
                    )

                    res_data = {
                        "file_key": final_key,
                        "size": cas_data.get("size", initial_size),
                        "original_size": initial_size,
                        "mime_type": cas_data.get("mime_type", mime_type),
                    }
                    await update_status(
                        UploadStatus.CLEAN, result=res_data, stage_index=3, stage_percent=1.0
                    )
                    await _update_db_status(
                        ctx, upload_id, "clean", sha256=original_sha256, final_key=final_key
                    )
                    await delete_object(quarantine_key)
                    logger.info("CAS hit for upload %s (sha256=%s)", upload_id, original_sha256[:12])
                    _elapsed = time.monotonic() - pipeline_start
                    upload_pipeline_total.labels(status="cas_hit", mime_category=_cat).inc()
                    upload_pipeline_duration.labels(status="cas_hit", mime_category=_cat).observe(
                        _elapsed
                    )
                    upload_file_size.labels(mime_category=_cat).observe(initial_size)
                    return
                else:
                    logger.warning("CAS entry exists but S3 object missing for %s — re-processing", original_sha256[:12])
            except Exception as exc:
                logger.warning(
                    "CAS copy failed for %s, falling through to full scan: %s",
                    original_sha256[:12],
                    exc,
                )

        # ── Persist SHA-256 to DB early (before scan, for audit) ────────────
        await _update_db_status(ctx, upload_id, "processing", sha256=original_sha256)

        # ── Stages 0+1: scan + strip in parallel (4.7) ──────────────────────
        # When neither stage has been completed yet, run ClamAV scan and metadata
        # stripping concurrently.  Scan is the security gate — if it reports
        # malicious content, the strip result is discarded regardless of outcome.
        # When resuming after a checkpoint, fall back to running remaining stages
        # sequentially as before.
        tracer = get_tracer()
        _, strip_label, _ = _STAGES[1]

        if completed_stage >= 2:
            # Both stages already completed on a prior attempt — skip both
            logger.info("Skipping scan+strip stages for upload %s (already completed)", upload_id)
            await update_status(
                UploadStatus.PROCESSING, detail=stage_label, stage_index=0, stage_percent=1.0
            )
            await update_status(
                UploadStatus.PROCESSING, detail=strip_label, stage_index=1, stage_percent=1.0
            )
        elif completed_stage == 1:
            # Scan done, strip not done — run strip only
            logger.info("Skipping scan stage for upload %s (already completed)", upload_id)
            await update_status(
                UploadStatus.PROCESSING, detail=stage_label, stage_index=0, stage_percent=1.0
            )
            await _check_deadline("stripping")
            await update_status(
                UploadStatus.PROCESSING, detail=strip_label, stage_index=1, stage_percent=0.0
            )
            with tracer.start_as_current_span("upload.strip_metadata"):
                try:
                    clean_path = await asyncio.wait_for(
                        strip_metadata_file(tmp_path, mime_type), timeout=60.0
                    )
                    if clean_path != tmp_path:
                        pf.replace_with(clean_path)
                except TimeoutError:
                    msg = "Metadata stripping timed out"
                    await update_status(UploadStatus.FAILED, detail=msg)
                    await _update_db_status(ctx, upload_id, "failed", error_detail=msg)
                    return
                except ValueError as e:
                    msg = str(e)
                    await update_status(UploadStatus.MALICIOUS, detail=msg)
                    await _update_db_status(ctx, upload_id, "malicious", error_detail=msg)
                    return
            await update_status(
                UploadStatus.PROCESSING, detail=strip_label, stage_index=1, stage_percent=1.0
            )
            await _checkpoint_stage(ctx, upload_id, 2)
        else:
            # Neither done — run scan and strip in parallel (4.7)
            await _check_deadline("scan+strip")
            await update_status(
                UploadStatus.PROCESSING, detail=stage_label, stage_index=0, stage_percent=0.0
            )

            scanner: MalwareScanner = ctx.get("scanner") or _get_fallback_scanner()
            _owns_scanner = ctx.get("scanner") is None
            _scan_start = time.monotonic()

            # Create an isolated copy for the scanner so strip operations on
            # tmp_path cannot mutate the bytes the scanner is reading (C2).
            import shutil as _shutil

            scan_copy = tmp_path.with_suffix(".scan")
            await asyncio.to_thread(_shutil.copyfile, tmp_path, scan_copy)

            async def _run_scan() -> None:
                try:
                    with tracer.start_as_current_span("upload.scan") as _span:
                        _span.set_attribute("upload.id", upload_id)
                        _span.set_attribute("upload.mime_category", _cat)
                        await asyncio.wait_for(
                            scanner.scan_file_path(
                                scan_copy, original_filename, bazaar_hash=original_sha256
                            ),
                            timeout=120.0,
                        )
                finally:
                    scan_copy.unlink(missing_ok=True)

            async def _run_strip() -> Path:
                with tracer.start_as_current_span("upload.strip_metadata"):
                    return await asyncio.wait_for(
                        strip_metadata_file(tmp_path, mime_type), timeout=60.0
                    )

            scan_exc: BaseException | None = None
            strip_exc: BaseException | None = None
            strip_clean_path: Path | None = None

            try:
                scan_res, strip_res = await asyncio.gather(
                    _run_scan(), _run_strip(), return_exceptions=True
                )
                if isinstance(scan_res, BaseException):
                    scan_exc = scan_res
                if isinstance(strip_res, BaseException):
                    strip_exc = strip_res
                elif isinstance(strip_res, Path):
                    strip_clean_path = strip_res
            finally:
                if _owns_scanner:
                    await scanner.close()

            upload_scan_duration.labels(mime_category=_cat).observe(
                time.monotonic() - _scan_start
            )

            # ── Evaluate scan result first (security gate) ───────────────────
            if isinstance(scan_exc, TimeoutError):
                msg = "Malware scan timed out"
                await update_status(UploadStatus.FAILED, detail=msg)
                await _update_db_status(ctx, upload_id, "failed", error_detail=msg)
                _elapsed = time.monotonic() - pipeline_start
                upload_pipeline_total.labels(status="failed", mime_category=_cat).inc()
                upload_pipeline_duration.labels(status="failed", mime_category=_cat).observe(_elapsed)
                return
            if isinstance(scan_exc, BadRequestError):
                detail = str(scan_exc.detail) if hasattr(scan_exc, "detail") else str(scan_exc)
                await update_status(UploadStatus.MALICIOUS, detail=detail)
                await _update_db_status(ctx, upload_id, "malicious", error_detail=detail)
                _elapsed = time.monotonic() - pipeline_start
                upload_pipeline_total.labels(status="malicious", mime_category=_cat).inc()
                upload_pipeline_duration.labels(status="malicious", mime_category=_cat).observe(_elapsed)
                return
            if isinstance(scan_exc, BaseException):
                raise scan_exc

            await update_status(
                UploadStatus.PROCESSING, detail=stage_label, stage_index=0, stage_percent=1.0
            )
            await _checkpoint_stage(ctx, upload_id, 1)

            # ── Evaluate strip result (scan passed) ──────────────────────────
            if isinstance(strip_exc, TimeoutError):
                msg = "Metadata stripping timed out"
                await update_status(UploadStatus.FAILED, detail=msg)
                await _update_db_status(ctx, upload_id, "failed", error_detail=msg)
                return
            if isinstance(strip_exc, ValueError):
                msg = str(strip_exc)
                await update_status(UploadStatus.MALICIOUS, detail=msg)
                await _update_db_status(ctx, upload_id, "malicious", error_detail=msg)
                return
            if isinstance(strip_exc, BaseException):
                logger.warning("Strip failed for %s (ignored): %s", upload_id, strip_exc)
            elif strip_clean_path is not None and strip_clean_path != tmp_path:
                pf.replace_with(strip_clean_path)

            await update_status(
                UploadStatus.PROCESSING, detail=strip_label, stage_index=1, stage_percent=1.0
            )
            await _checkpoint_stage(ctx, upload_id, 2)

        # ── Post-Sanitization Safety Check (PDF) ──
        # Run safety check on the sanitized file. If it still contains dangerous
        # constructs after stripping, it must be rejected as malicious.
        if mime_type == "application/pdf":
            try:
                await asyncio.to_thread(check_pdf_safety, pf.path)
            except ValueError as e:
                msg = str(e)
                await update_status(UploadStatus.MALICIOUS, detail=msg)
                await _update_db_status(ctx, upload_id, "malicious", error_detail=msg)
                return

        # ── Cancellation check after scan+strip ──────────────────────────────
        if await _check_cancelled(redis, upload_id):
            logger.info("Upload %s cancelled after scan+strip stage", upload_id)
            await update_status(UploadStatus.FAILED, detail="Upload cancelled by user")
            await _update_db_status(ctx, upload_id, "cancelled", error_detail="Cancelled by user")
            await delete_object(quarantine_key)
            return

        # ── Stage 2: compression ─────────────────────────────────────────────
        _, comp_label, _ = _STAGES[2]
        # Default values in case compression is skipped on resume
        final_mime = mime_type
        content_encoding = None
        if completed_stage >= 3:
            logger.info("Skipping compress stage for upload %s (already completed)", upload_id)
        else:
            await _check_deadline("compressing")
            await update_status(
                UploadStatus.PROCESSING, detail=comp_label, stage_index=2, stage_percent=0.0
            )
            with tracer.start_as_current_span("upload.compress"):
                comp_timeout = _compression_timeout(mime_type)
                try:
                    comp_res = await asyncio.wait_for(
                        compress_file_path(pf.path, mime_type, original_filename),
                        timeout=comp_timeout,
                    )
                    if comp_res.path != pf.path:
                        pf.replace_with(comp_res.path)
                    final_mime = comp_res.mime_type
                    content_encoding = comp_res.content_encoding
                except Exception as e:
                    logger.warning(
                        "Compression failed for %s: %s — proceeding uncompressed", original_filename, e
                    )

        await update_status(
            UploadStatus.PROCESSING, detail=comp_label, stage_index=2, stage_percent=1.0
        )

        # Checkpoint stage 2 (compress) complete
        await _checkpoint_stage(ctx, upload_id, 3)

        # ── Cancellation check after compress ────────────────────────────────
        if await _check_cancelled(redis, upload_id):
            logger.info("Upload %s cancelled after compress stage", upload_id)
            await update_status(UploadStatus.FAILED, detail="Upload cancelled by user")
            await _update_db_status(ctx, upload_id, "cancelled", error_detail="Cancelled by user")
            await delete_object(quarantine_key)
            return

        # ── Stage 3: finalise ────────────────────────────────────────────────
        await _check_deadline("finalizing")
        _, final_label, _ = _STAGES[3]
        await update_status(
            UploadStatus.PROCESSING, detail=final_label, stage_index=3, stage_percent=0.0
        )

        with tracer.start_as_current_span("upload.finalize") as _final_span:
            ext = MimeRegistry.get_canonical_extension(final_mime)
            safe_name = original_filename
            if ext and not original_filename.lower().endswith(ext.lower()):
                stem = Path(original_filename).stem
                safe_name = f"{stem}{ext}"

            final_key = f"uploads/{user_id}/{upload_id}/{safe_name}"
            _final_span.set_attribute("upload.final_key", final_key)

            # ── 1. Upload to per-user prefix (compatibility) ──
            await upload_file_multipart(
                pf.path,
                final_key,
                content_type=final_mime,
                content_encoding=content_encoding,
            )

            # ── 2. Promote to global CAS prefix (deduplication master) ──
            content_sha256 = await pf.sha256()
            cas_id = cas_key.split(":")[-1]
            cas_s3_key = f"cas/{cas_id}"

            # Use a distributed lock to prevent concurrent workers from racing
            # on the same CAS key (upload + ref count must be atomic together).
            from app.core.storage import object_exists

            cas_lock_key = f"lock:cas:{cas_id}"
            lock_acquired = await redis.set(cas_lock_key, "1", nx=True, ex=120)
            try:
                if lock_acquired:
                    if not await object_exists(cas_s3_key):
                        await asyncio.wait_for(
                            upload_file_multipart(
                                pf.path,
                                cas_s3_key,
                                content_type=final_mime,
                                content_encoding=content_encoding,
                            ),
                            timeout=60.0,
                        )
                else:
                    # Wait for the lock holder to finish the upload
                    cas_appeared = False
                    for _ in range(60):
                        if await object_exists(cas_s3_key):
                            cas_appeared = True
                            break
                        await asyncio.sleep(1)

                    # If the lock holder crashed, attempt upload ourselves (audit fix #7)
                    if not cas_appeared:
                        logger.warning(
                            "CAS lock holder taking too long for %s; bypassing global CAS promotion.", cas_id
                        )
                        # Skip uploading to global CAS to avoid S3 object corruption.
                        # The file is still successfully uploaded to the user's `final_key` prefix earlier.
            finally:
                if lock_acquired:
                    await redis.delete(cas_lock_key)

        final_size = pf.size

        res_data = {
            "file_key": final_key,
            "size": final_size,
            "original_size": initial_size,
            "mime_type": final_mime,
        }

        # Cache scan result for PR validation (24 h)
        await redis.set(f"{_SCAN_CACHE_PREFIX}{final_key}", "CLEAN", ex=24 * 3600)

        # Per-user SHA-256 cache for fast re-upload detection (24 h)
        sha256_key = f"{_SHA256_CACHE_PREFIX}{user_id}:{original_sha256}"
        await redis.set(sha256_key, final_key, ex=24 * 3600)

        # Write global CAS entry for future cross-user deduplication
        # Point to the stable cas/ key, not the per-user uploads/ key.
        # We use _increment_cas_ref (Lua) to handle the first-time race:
        # if another user promoted this SAME file in the last few seconds,
        # we increment their count rather than overwriting it with 1.
        cas_data = {
            "final_key": cas_s3_key,
            "mime_type": final_mime,
            "size": final_size,
            "scanned_at": time.time(),
        }
        new_cas_ref = await _increment_cas_ref(redis, original_sha256, initial_data=cas_data)
        _db_cas_key = hmac_cas_key(original_sha256)

        # Track the final key in the quota sorted set.
        await redis.zadd(f"quota:uploads:{user_id}", {final_key: time.time()})

        await update_status(
            UploadStatus.CLEAN,
            result=res_data,
            stage_index=3,
            stage_percent=1.0,
        )

        await _update_db_status(
            ctx,
            upload_id,
            "clean",
            sha256=original_sha256,
            content_sha256=content_sha256,
            final_key=final_key,
            cas_key=_db_cas_key,
            cas_ref_count=new_cas_ref if new_cas_ref > 0 else None,
        )

        # Remove quarantine object (also triggers ZREM of quarantine_key via storage helper)
        await delete_object(quarantine_key)

        # ── Metrics: clean outcome ───────────────────────────────────────────
        _elapsed = time.monotonic() - pipeline_start
        upload_pipeline_total.labels(status="clean", mime_category=_cat).inc()
        upload_pipeline_duration.labels(status="clean", mime_category=_cat).observe(_elapsed)
        upload_file_size.labels(mime_category=_cat).observe(initial_size)
        if initial_size > 0 and final_size > 0:
            upload_compression_ratio.labels(mime_category=_cat).observe(initial_size / final_size)

        # Enqueue webhook dispatch if a webhook_url is registered for this upload
        await _maybe_dispatch_webhook(ctx, upload_id)

    except RuntimeError:
        # Pipeline deadline exceeded — status already emitted inside _check_deadline
        _elapsed = time.monotonic() - pipeline_start
        upload_pipeline_total.labels(status="failed", mime_category=_cat).inc()
        upload_pipeline_duration.labels(status="failed", mime_category=_cat).observe(_elapsed)
        job_try = ctx.get("job_try", 1)
        if job_try >= _MAX_ARQ_RETRIES:
            await _insert_dead_letter(
                ctx,
                upload_id=upload_id,
                job_name="process_upload",
                payload={"quarantine_key": quarantine_key, "mime": mime_type},
                error="RuntimeError: pipeline deadline exceeded.",
                attempts=job_try,
            )
    except BaseException as e:
        logger.exception("Error processing upload %s", quarantine_key)
        msg = "Internal processing error occurred. Please try again or contact support."
        await update_status(UploadStatus.FAILED, detail=msg)
        await _update_db_status(ctx, upload_id, "failed", error_detail=str(e))
        _elapsed = time.monotonic() - pipeline_start
        upload_pipeline_total.labels(status="failed", mime_category=_cat).inc()
        upload_pipeline_duration.labels(status="failed", mime_category=_cat).observe(_elapsed)

        # ── Dead letter queue: insert if this is the last ARQ retry ──────────
        job_try = ctx.get("job_try", 1)
        if job_try >= _MAX_ARQ_RETRIES:
            await _insert_dead_letter(
                ctx,
                upload_id=upload_id,
                job_name="process_upload",
                payload={
                    "user_id": user_id,
                    "upload_id": upload_id,
                    "quarantine_key": quarantine_key,
                    "original_filename": original_filename,
                    "mime_type": mime_type,
                },
                error=str(e),
                attempts=job_try,
            )

            # Delete the orphaned S3 file to prevent permanent storage leakage
            try:
                await delete_object(quarantine_key)
            except Exception as del_exc:
                logger.warning("Failed to clean up quarantine object %s: %s", quarantine_key, del_exc)
    finally:
        if pf is not None:
            pf.cleanup()
        else:
            tmp_path.unlink(missing_ok=True)
        otel_context.detach(_otel_token)


async def _maybe_dispatch_webhook(ctx: dict, upload_id: str) -> None:
    """Enqueue a webhook dispatch job if the Upload row has a webhook_url.

    Best-effort: never raises so it cannot interrupt the main pipeline.
    """
    session_factory = ctx.get("db_sessionmaker")
    if session_factory is None:
        return
    try:
        from sqlalchemy import select

        from app.models.upload import Upload

        async with session_factory() as session:
            row = await session.scalar(select(Upload).where(Upload.upload_id == upload_id))
            if row is None or not row.webhook_url:
                return

        import app.core.redis as redis_core

        if redis_core.arq_pool is None:
            logger.warning("arq_pool unavailable — webhook for upload %s skipped", upload_id)
            return

        await redis_core.arq_pool.enqueue_job("dispatch_webhook", upload_id=upload_id)
    except Exception as exc:
        logger.warning("Failed to enqueue webhook for upload %s: %s", upload_id, exc)

