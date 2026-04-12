#!/bin/sh

set -e

# Wait for postgres to be ready
echo "Waiting for database..."
uv run python wait_for_db.py

echo "Running migrations..."
uv run alembic upgrade head

echo "Starting application..."
exec "$@"
