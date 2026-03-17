#!/bin/sh

set -e

# Wait for postgres to be ready (optional, since docker-compose has healthchecks, but good practice)
echo "Running migrations..."
uv run alembic upgrade head

echo "Starting application..."
exec "$@"
