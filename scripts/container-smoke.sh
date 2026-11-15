#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME_IMAGE=${SUPERAGENT_RUNTIME_IMAGE:-superagent-sec-runtime:smoke}
APP_IMAGE=${SUPERAGENT_APP_IMAGE:-superagent-sec-app:smoke}
PLATFORM=${SUPERAGENT_CONTAINER_PLATFORM:-linux/amd64}

docker image inspect "$RUNTIME_IMAGE" >/dev/null 2>&1 || {
  echo "Runtime image is not available: $RUNTIME_IMAGE" >&2
  echo "Build or load the dependency-only runtime image before running this smoke check." >&2
  exit 1
}

docker build --platform "$PLATFORM" \
  --build-arg "RUNTIME_IMAGE=$RUNTIME_IMAGE" \
  --tag "$APP_IMAGE" \
  --file "$ROOT/deploy/App.Dockerfile" \
  "$ROOT"

docker run --rm --platform "$PLATFORM" --entrypoint sh "$APP_IMAGE" -eu -c '
  test -f /opt/superagent-sec/package.json
  test -d /opt/superagent-sec/node_modules
  test -f /opt/superagent-sec/lib/index.js
  test ! -e /workspace/superagent-source
  test ! -e /workspace/super-sec-agent
'
printf '%s\n' "Container smoke passed: runtime dependencies were reused and the checkout built into $APP_IMAGE."
