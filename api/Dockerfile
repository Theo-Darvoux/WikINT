# Stage 1: Build environment
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libyara-dev \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /venv
COPY pyproject.toml uv.lock ./
ENV UV_PROJECT_ENVIRONMENT=/venv
RUN uv sync --frozen --no-dev

# Stage 2: Runtime environment
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# ghostscript (PDF), ffmpeg (video), bubblewrap (sandbox), exiftool (metadata)
# libreoffice-nogui: headless soffice for Office→PDF thumbnail generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    libyara10 \
    ghostscript \
    ffmpeg \
    bubblewrap \
    libimage-exiftool-perl \
    libreoffice-nogui \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appuser && useradd -r -g appuser -m appuser && \
    chown appuser:appuser /app && \
    mkdir -p /var/lib/wikint && chown appuser:appuser /var/lib/wikint

COPY --from=builder --chown=appuser:appuser /venv /venv
ENV UV_PROJECT_ENVIRONMENT=/venv

USER appuser

COPY --chown=appuser:appuser . .
RUN chmod +x start.sh worker-start.sh

EXPOSE 8000

ENTRYPOINT ["./start.sh"]
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
