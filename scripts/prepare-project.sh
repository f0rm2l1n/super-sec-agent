#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE="$ROOT/deploy/.env"
PROJECT_ID=
SOURCE_DIR=
SOURCE_ID=main
SOURCE_KIND=directory
TOPIC=
DISPLAY_NAME=
NO_BUILD=false

usage() {
  cat >&2 <<'EOF'
Usage: scripts/prepare-project.sh --project-id ID --source-dir PATH --topic TEXT [options]

Options:
  --env-file PATH       Compose env file (default: deploy/.env)
  --source-id ID        Registered source id (default: main)
  --kind KIND           directory, binary, or pseudocode (default: directory)
  --name TEXT           Workspace display name (default: project id)
  --no-build            Reuse the already-built application image
EOF
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) [ "$#" -ge 2 ] || usage; ENV_FILE=$2; shift 2 ;;
    --project-id) [ "$#" -ge 2 ] || usage; PROJECT_ID=$2; shift 2 ;;
    --source-dir) [ "$#" -ge 2 ] || usage; SOURCE_DIR=$2; shift 2 ;;
    --source-id) [ "$#" -ge 2 ] || usage; SOURCE_ID=$2; shift 2 ;;
    --kind) [ "$#" -ge 2 ] || usage; SOURCE_KIND=$2; shift 2 ;;
    --topic) [ "$#" -ge 2 ] || usage; TOPIC=$2; shift 2 ;;
    --name) [ "$#" -ge 2 ] || usage; DISPLAY_NAME=$2; shift 2 ;;
    --no-build) NO_BUILD=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

[ -n "$PROJECT_ID" ] && [ -n "$SOURCE_DIR" ] && [ -n "$TOPIC" ] || usage
case "$PROJECT_ID" in *[!a-z0-9_-]*|'') echo 'project id must use lowercase letters, digits, _ or -' >&2; exit 1 ;; esac
case "$SOURCE_ID" in *[!a-z0-9_-]*|'') echo 'source id must use lowercase letters, digits, _ or -' >&2; exit 1 ;; esac
case "$SOURCE_KIND" in directory|binary|pseudocode) ;; *) echo 'kind must be directory, binary, or pseudocode' >&2; exit 1 ;; esac

case "$ENV_FILE" in
  /*) ;;
  *) ENV_FILE="$ROOT/$ENV_FILE" ;;
esac
[ -f "$ENV_FILE" ] || { echo "Compose env file does not exist: $ENV_FILE" >&2; exit 1; }
SOURCE_DIR=$(CDPATH= cd -- "$SOURCE_DIR" && pwd -P)

# This file contains deployment settings, not model credentials. API secrets
# belong in SUPERAGENT_EXTERNAL_ENV_FILE, which is not sourced here.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

PROJECTS_DIR=${SUPERAGENT_PROJECTS_DIR:-$ROOT/.container-data/projects}
DATA_DIR=${SUPERAGENT_DATA_DIR:-$ROOT/.container-data/$PROJECT_ID}
case "$PROJECTS_DIR" in /*) ;; *) PROJECTS_DIR="$ROOT/$PROJECTS_DIR" ;; esac
case "$DATA_DIR" in /*) ;; *) DATA_DIR="$ROOT/$DATA_DIR" ;; esac

HOST_PROJECT="$PROJECTS_DIR/$PROJECT_ID"
HOST_WORKSPACE="$HOST_PROJECT/workspace"
HOST_SOURCE="$HOST_WORKSPACE/sources/$SOURCE_ID"
CONTAINER_WORKSPACE="/var/lib/superagent/projects/$PROJECT_ID/workspace"
RUN_USER="$(id -u):$(id -g)"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$ROOT/deploy/compose.yaml" "$@"
}

mkdir -p "$HOST_PROJECT" "$DATA_DIR"
[ -d "$SOURCE_DIR" ] || { echo "Source directory does not exist: $SOURCE_DIR" >&2; exit 1; }

if [ "$NO_BUILD" = false ]; then
  compose build
fi

if [ -e "$HOST_WORKSPACE/project.json" ]; then
  echo "Reusing existing workspace: $HOST_WORKSPACE"
elif [ -e "$HOST_WORKSPACE" ] && [ "$(find "$HOST_WORKSPACE" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "Workspace exists but is not initialized or empty: $HOST_WORKSPACE" >&2
  echo "Move it aside or finish it manually; the script will not overwrite it." >&2
  exit 1
else
  mkdir -p "$HOST_WORKSPACE"
  if [ -n "$DISPLAY_NAME" ]; then
    compose run --rm --no-deps --user "$RUN_USER" --entrypoint pnpm superagent-sec expert init       --workspace "$CONTAINER_WORKSPACE" --id "$PROJECT_ID" --name "$DISPLAY_NAME" --topic "$TOPIC"
  else
    compose run --rm --no-deps --user "$RUN_USER" --entrypoint pnpm superagent-sec expert init       --workspace "$CONTAINER_WORKSPACE" --id "$PROJECT_ID" --topic "$TOPIC"
  fi
fi

mkdir -p "$HOST_SOURCE"
if [ "$SOURCE_DIR" != "$HOST_SOURCE" ]; then
  cp -a "$SOURCE_DIR"/. "$HOST_SOURCE"/
fi

export PREPARE_WORKSPACE="$CONTAINER_WORKSPACE"
export PREPARE_PROJECT_ID="$PROJECT_ID"
export PREPARE_SOURCE_ID="$SOURCE_ID"
export PREPARE_SOURCE_KIND="$SOURCE_KIND"
export PREPARE_SOURCE_PATH="sources/$SOURCE_ID"
export PREPARE_TOPIC="$TOPIC"
export PREPARE_NAME="${DISPLAY_NAME:-$PROJECT_ID}"

python_script=$(cat <<'PY'
import json
import os
from pathlib import Path

workspace = Path(os.environ["PREPARE_WORKSPACE"])
path = workspace / "project.json"
data = json.loads(path.read_text())
project_id = os.environ["PREPARE_PROJECT_ID"]
if data.get("id") != project_id:
    raise SystemExit("project.json id does not match the requested project")
source = {
    "id": os.environ["PREPARE_SOURCE_ID"],
    "path": os.environ["PREPARE_SOURCE_PATH"],
    "kind": os.environ["PREPARE_SOURCE_KIND"],
    "role": "subject",
    "purpose": "Primary project material for security research",
}
sources = [item for item in data.get("sources", []) if item.get("id") != source["id"]]
sources.append(source)
data["sources"] = sources
data["primarySource"] = source["id"]
data["name"] = os.environ["PREPARE_NAME"]
data["topic"] = os.environ["PREPARE_TOPIC"]
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
PY
)

compose run --rm --no-deps --user "$RUN_USER" \
  -e "PREPARE_WORKSPACE=$PREPARE_WORKSPACE" \
  -e "PREPARE_PROJECT_ID=$PREPARE_PROJECT_ID" \
  -e "PREPARE_SOURCE_ID=$PREPARE_SOURCE_ID" \
  -e "PREPARE_SOURCE_KIND=$PREPARE_SOURCE_KIND" \
  -e "PREPARE_SOURCE_PATH=$PREPARE_SOURCE_PATH" \
  -e "PREPARE_TOPIC=$PREPARE_TOPIC" \
  -e "PREPARE_NAME=$PREPARE_NAME" \
  --entrypoint python3 superagent-sec -c "$python_script"

for action in lock check prepare; do
  echo "Preparing workspace: $action"
  compose run --rm --no-deps --user "$RUN_USER" --entrypoint pnpm superagent-sec expert "$action"     --workspace "$CONTAINER_WORKSPACE"
done

echo
echo "Workspace ready: $HOST_WORKSPACE"
echo "Source registered as: $SOURCE_ID ($SOURCE_KIND)"
echo "Start the service with:"
echo "  docker compose --env-file $ENV_FILE -f $ROOT/deploy/compose.yaml up -d"

