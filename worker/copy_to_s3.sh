#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

#
# Upload a local directory to the MinIO aerial-data bucket.
#
# Usage:
#   ./worker/copy_to_s3.sh <source_dir> [s3_prefix]
#
# Examples:
#   ./worker/copy_to_s3.sh ~/my_assets test_data
#   ./worker/copy_to_s3.sh ~/maps test_data/maps
#
# The MinIO stack must be running (./worker/up.sh) before copying.
#
# Environment variables:
#   MINIO_ENDPOINT      — MinIO S3 endpoint (default: http://localhost:9000)
#                         Set to the worker host when running remotely, e.g.:
#                         MINIO_ENDPOINT=http://worker-host:9000 ./worker/copy_to_s3.sh ...
#   MINIO_ROOT_USER     — MinIO access key   (default: minioadmin)
#   MINIO_ROOT_PASSWORD — MinIO secret key   (default: minioadmin)

set -e

SOURCE_DIR="${1:?Usage: $0 <source_dir> [s3_prefix]}"
S3_PREFIX="${2:-test_data}"
BUCKET="aerial-data"

MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"

SOURCE_DIR="$(realpath "${SOURCE_DIR}")"

if [ ! -d "${SOURCE_DIR}" ]; then
    echo "Error: source directory does not exist: ${SOURCE_DIR}"
    exit 1
fi

echo "Copying to MinIO:"
echo "  Source : ${SOURCE_DIR}"
echo "  Target : ${MINIO_ENDPOINT}/${BUCKET}/${S3_PREFIX}"
echo ""

# Write mc config to a temp directory so credentials are never passed as
# command-line arguments (visible in ps/audit logs) or injected into the
# container environment.  The directory is removed on exit via trap.
MC_CONFIG_DIR="$(mktemp -d)"
trap 'rm -rf "$MC_CONFIG_DIR"' EXIT
chmod 700 "$MC_CONFIG_DIR"
cat > "$MC_CONFIG_DIR/config.json" <<EOF
{
    "version": "10",
    "aliases": {
        "local": {
            "url": "${MINIO_ENDPOINT}",
            "accessKey": "${MINIO_ROOT_USER}",
            "secretKey": "${MINIO_ROOT_PASSWORD}",
            "api": "S3v4",
            "path": "auto"
        }
    }
}
EOF
chmod 600 "$MC_CONFIG_DIR/config.json"

# Use mc via Docker to avoid requiring a local mc install.
# The minio/mc image entrypoint is "mc", so override it to run a shell.
# MC_CONFIG_DIR keeps credentials in a host temp dir removed on exit.
DOCKER_NETWORK=()
if [[ "${MINIO_ENDPOINT}" =~ localhost|127\.0\.0\.1 ]]; then
    DOCKER_NETWORK=(--network host)
fi

docker run --rm \
    "${DOCKER_NETWORK[@]}" \
    --user "$(id -u):$(id -g)" \
    -e MC_CONFIG_DIR=/mc \
    -e "BUCKET=${BUCKET}" \
    -e "S3_PREFIX=${S3_PREFIX}" \
    -v "${MC_CONFIG_DIR}:/mc" \
    -v "${SOURCE_DIR}:/data:ro" \
    --entrypoint /bin/sh \
    minio/mc:RELEASE.2024-11-17T19-35-25Z \
    -c 'mc mb --ignore-existing "local/$BUCKET" && mc mirror --overwrite /data "local/$BUCKET/$S3_PREFIX" && echo Done.'
