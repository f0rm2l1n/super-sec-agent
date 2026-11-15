#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=${1:-v$(node -p "require('./package.json').version")}
VERSION=${VERSION#v}
TAG="v${VERSION}"
IMAGE_REPOSITORY=${SUPERAGENT_IMAGE_REPOSITORY:-superagent-sec}
RELEASE_DIR=${SUPERAGENT_RELEASE_DIR:-"$ROOT/.artifacts/releases/$TAG"}
PLATFORMS=${SUPERAGENT_RELEASE_PLATFORMS:-linux/amd64,linux/arm64}
DSH_VERSION=${DSH_VERSION:-0.2.1-rc.3}

mkdir -p "$RELEASE_DIR"
printf '%s\n' "Building ${IMAGE_REPOSITORY}:${TAG} for ${PLATFORMS}"

old_ifs=$IFS
IFS=,
set -- $PLATFORMS
IFS=$old_ifs

for platform in "$@"; do
  safe_platform=$(printf '%s' "$platform" | tr '/:' '--')
  image="${IMAGE_REPOSITORY}:${TAG}-${safe_platform}"
  archive="$RELEASE_DIR/${IMAGE_REPOSITORY}-${TAG}-${safe_platform}.tar.gz"
  metadata="$RELEASE_DIR/${IMAGE_REPOSITORY}-${TAG}-${safe_platform}.json"
  docker buildx build \
    --platform "$platform" \
    --build-arg "DSH_VERSION=$DSH_VERSION" \
    --tag "$image" \
    --load \
    --file "$ROOT/deploy/Dockerfile" \
    "$ROOT"
  docker save "$image" | gzip -1 > "$archive"
  sha256sum "$archive" > "$archive.sha256"
  docker image inspect "$image" --format '{"image":"{{.RepoTags}}","id":"{{.Id}}","os":"{{.Os}}","architecture":"{{.Architecture}}"}' > "$metadata"
  printf '%s\n' "Wrote $archive"
done

printf '%s\n' "Release assets are in $RELEASE_DIR"
