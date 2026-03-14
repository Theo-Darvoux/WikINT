#!/bin/sh
set -e

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

mc mb --ignore-existing local/wikint
mc anonymous set download local/wikint

echo "MinIO bucket 'wikint' created successfully."
