#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# No cloud deploy. Use this project's isolated local Docker Compose only.
args=(-f infra/local-compose/compose.yaml)
if [[ -n "${CODEX_PROXY_CERT:-}" ]]; then
  args+=(-f infra/local-compose/compose.cloud.yaml)
  export BUILDX_CONFIG="${BUILDX_CONFIG:-/tmp/investment-os-p0-buildx}"
  exec env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    docker --host=unix:///var/run/docker.sock compose "${args[@]}" "$@"
fi
exec docker compose "${args[@]}" "$@"
