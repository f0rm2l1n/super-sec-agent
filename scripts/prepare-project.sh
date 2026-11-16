#!/bin/sh
# Compatibility entrypoint; Compose resolves env values and mount paths.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "${1:-}" = --env-file ]; then
  [ "$#" -ge 2 ] || exit 2
  deploy_env=$2
  shift 2
  exec python3 "$ROOT/scripts/deploy" --env-file "$deploy_env" prepare "$@"
fi
exec python3 "$ROOT/scripts/deploy" prepare "$@"
