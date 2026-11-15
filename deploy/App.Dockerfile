# Application layer. The runtime image contains the locked Node/pnpm/DSH
# toolchain; this image adds the current checkout and builds its lib/ output.
ARG RUNTIME_IMAGE=superagent-sec-runtime:stable
FROM ${RUNTIME_IMAGE}

WORKDIR /opt/superagent-sec
COPY . .
RUN pnpm build

