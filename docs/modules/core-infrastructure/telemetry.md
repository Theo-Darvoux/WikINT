# Telemetry & Observability

## OpenTelemetry (`api/app/core/telemetry.py`)

### Setup

`setup_telemetry(app)` initializes distributed tracing when `otel_endpoint` is configured:
- Creates a `TracerProvider` with a `BatchSpanProcessor` connected to an OTLP gRPC exporter
- Instruments FastAPI with `FastAPIInstrumentor` for automatic request span creation
- All upload pipeline stages create child spans (`upload.scan`, `upload.strip_metadata`, `upload.compress`, `upload.finalize`)

### Trace Context Propagation

Background workers (ARQ jobs) receive trace context from the request that enqueued them:
- `inject_trace_context()` - Serializes the current OpenTelemetry context into a dict (called in the request handler)
- `extract_trace_context(dict)` - Deserializes and restores the context in the worker (called at the start of `process_upload`)

This means a single upload shows as a connected trace from the HTTP request through the background processing pipeline.

### `get_tracer()`

Returns a no-op tracer when OpenTelemetry is not configured, so span creation code doesn't need conditional guards.

## Prometheus Metrics (`api/app/core/metrics.py`)

A custom `CollectorRegistry` (not the global default) is used to avoid conflicts with other libraries. Metrics are exposed at `GET /metrics` with optional bearer token protection.

### Counters
- `upload_pipeline_total` (labels: `status`, `mime_category`) - Total upload pipeline completions by outcome (clean, failed, malicious, cas_hit)

### Histograms
- `upload_pipeline_duration` (labels: `status`, `mime_category`) - Pipeline wall-clock time in seconds
- `upload_scan_duration` (labels: `mime_category`) - Malware scan stage duration
- `upload_file_size` (labels: `mime_category`) - Original file size distribution
- `upload_compression_ratio` (labels: `mime_category`) - Ratio of original to compressed size

### Helper

`mime_category(mime_type)` maps full MIME types to broad categories for metric labels:
- `image/png` → `image`
- `application/pdf` → `document`
- `video/mp4` → `video`
- etc.

## Metrics Endpoint

`GET /metrics` in `main.py` serves Prometheus text format. Protection:
- If `METRICS_TOKEN` is set: requires `Authorization: Bearer <token>` header or `?token=<token>` query parameter
- If unset: unauthenticated (appropriate for private networks)
