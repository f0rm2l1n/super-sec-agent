#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE_REPOSITORY=${SUPERAGENT_IMAGE_REPOSITORY:-superagent-sec}
IMAGE_TAG=${1:-stable}
PLATFORM=${SUPERAGENT_CONTAINER_PLATFORM:-linux/amd64}
IMAGE="${IMAGE_REPOSITORY}:${IMAGE_TAG}"
suffix=$$
node_volume="superagent-sec-smoke-node-${suffix}"
lib_volume="superagent-sec-smoke-lib-${suffix}"

cleanup() {
  docker volume rm "$node_volume" "$lib_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker volume create "$node_volume" >/dev/null
docker volume create "$lib_volume" >/dev/null
docker run --rm --platform "$PLATFORM" \
  -v "$ROOT:/workspace/superagent-source:ro" \
  -v "$node_volume:/workspace/super-sec-agent/node_modules" \
  -v "$lib_volume:/workspace/super-sec-agent/lib" \
  -e SUPERAGENT_SOURCE_MOUNT=/workspace/superagent-source \
  -e SUPERAGENT_APP_DIR=/workspace/super-sec-agent \
  -e SUPERAGENT_SMOKE_ONLY=1 \
  --entrypoint /usr/local/bin/superagent-entrypoint "$IMAGE"
printf '%s\n' "Container smoke passed: host checkout mounted read-only and lib built in its writable volume ($IMAGE)."
