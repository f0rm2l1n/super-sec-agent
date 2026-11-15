# Application layer. The runtime image contains the locked Node/pnpm/DSH
# toolchain; this image adds the current checkout and builds its lib/ output.
ARG RUNTIME_IMAGE=superagent-sec-runtime:stable
FROM ${RUNTIME_IMAGE}

WORKDIR /opt/superagent-sec
COPY . .
RUN pnpm build

# Keep the dependency/runtime image reusable while allowing deployment fixes in
# this checkout to take effect on the next application-layer rebuild.
COPY deploy/entrypoint.sh /usr/local/bin/superagent-entrypoint
RUN chmod 755 /usr/local/bin/superagent-entrypoint

