#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

#
# Starts the worker stack. Automatically detects whether it is running on an
# EC2 instance and selects the appropriate compose file:
#
#   AWS  → docker-compose.aws.yml  (real S3, no MinIO)
#   Local → docker-compose.yml      (MinIO)
#
# Environment variables:
#   AWS_S3_BUCKET         — (AWS only, required) S3 bucket
#   AWS_REGION            — (AWS only) AWS region (default: us-east-1)
#   SIM_IMAGE             — worker image to run
#   SERVER_IP             — public IP of this machine, used in MinIO presigned URLs
#                           and the Nessie S3 endpoint returned to clients.
#                           Detected automatically; override if needed.
#   MINIO_API_PORT        — host port for MinIO S3 API (default: 9000). Change if port conflicts.
#   MINIO_CONSOLE_PORT    — host port for MinIO web console (default: 9001).
#   NESSIE_PORT           — host port for Nessie Iceberg REST catalog (default: 19120).
#   AODT_UCX_PORT         — UCX CM listener port (default: 13337)
#   AODT_UCX_HOST         — hostname/IP the worker advertises for UCX connections
#   AODT_UCX_WORKER_PORTS — port range for UCX worker data-path sockets (default: 13338-13350)
#   LOG_LEVEL             — log level for the worker (default: INFO)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Auto-detect AWS by probing the IMDSv2 endpoint (1 s timeout)
# ---------------------------------------------------------------------------
TOKEN=$(curl -s -m 1 -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 10" 2>/dev/null || true)

if [ -n "$TOKEN" ]; then
  IS_AWS=true
else
  IS_AWS=false
fi

# ---------------------------------------------------------------------------
# Select compose file and set environment variables
# ---------------------------------------------------------------------------
if [ "$IS_AWS" = true ]; then
  : "${AWS_S3_BUCKET:?On AWS, AWS_S3_BUCKET is required. Example: AWS_S3_BUCKET=my-bucket ./up.sh}"
  export AWS_REGION="${AWS_REGION:-us-east-1}"
  COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.aws.yml"
  PUBLIC_IP=$(curl -s -m 1 \
    -H "X-aws-ec2-metadata-token: ${TOKEN}" \
    "http://169.254.169.254/latest/meta-data/public-ipv4" 2>/dev/null || true)
  export SERVER_IP="${SERVER_IP:-${PUBLIC_IP}}"
  echo "AWS detected — using S3 (bucket=${AWS_S3_BUCKET}, region=${AWS_REGION})"
else
  COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
  export SERVER_IP="${SERVER_IP:-$(ip route get 8.8.8.8 | awk '$1=="8.8.8.8" {for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')}"
  echo "Local environment detected — using MinIO"
fi

if [[ -z "${SERVER_IP}" ]]; then
  echo "ERROR: Could not determine SERVER_IP. Please set it explicitly:"
  echo "  SERVER_IP=<your-ip> ./worker/up.sh"
  exit 1
fi

export MINIO_API_PORT="${MINIO_API_PORT:-9000}"
export MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9001}"
export NESSIE_PORT="${NESSIE_PORT:-19120}"
export AODT_UCX_HOST="${AODT_UCX_HOST:-${SERVER_IP}}"
export MINIO_SERVER_URL="http://${SERVER_IP}:${MINIO_API_PORT}"
export NESSIE_S3_ENDPOINT="http://${SERVER_IP}:${MINIO_API_PORT}"
echo "Server IP: ${SERVER_IP} (MinIO: ${MINIO_API_PORT}, Nessie: ${NESSIE_PORT})"

# Pre-create HDF5 output directory so the bind mount inherits the caller's
# uid/gid instead of being created as root by Docker.
mkdir -p "${SCRIPT_DIR}/data"

# ---------------------------------------------------------------------------
# Start the full stack — Docker Compose handles dependency ordering
# ---------------------------------------------------------------------------
echo "Starting stack..."
docker compose -f "$COMPOSE_FILE" up -d worker gis-worker
