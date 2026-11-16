# Application layer. The runtime image contains the locked Node/pnpm/DSH
# toolchain; this image adds the current checkout and builds its lib/ output.
ARG RUNTIME_IMAGE=superagent-sec-runtime:stable
FROM ${RUNTIME_IMAGE}

WORKDIR /opt/superagent-sec
# Preserve the dependency image's lock before COPY replaces it.
RUN cp pnpm-lock.yaml /tmp/superagent-runtime-lock.yaml
COPY . .
RUN cmp -s pnpm-lock.yaml /tmp/superagent-runtime-lock.yaml \
  || { echo 'Dependency lock changed: build or import a runtime image for this checkout before building the app.' >&2; exit 1; }
RUN pnpm build

# Keep the dependency/runtime image reusable while allowing deployment fixes in
# this checkout to take effect on the next application-layer rebuild.
COPY deploy/entrypoint.sh /usr/local/bin/superagent-entrypoint
RUN chmod 755 /usr/local/bin/superagent-entrypoint

# A 401 from the token gateway only proves that the proxy is listening. Read
# the token file and check the management API, including the loaded plugin.
# Docker reports unhealthy containers; the entrypoint supervises process exits.
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
  CMD node /opt/superagent-sec/scripts/container-health.mjs

