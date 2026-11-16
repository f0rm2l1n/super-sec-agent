# Stable dependency/runtime layer. Application source is copied into a separate
# image by deploy/App.Dockerfile so this layer can be reused across code updates.
FROM node:22-bookworm-slim

ARG DSH_VERSION=0.2.1-rc.3
ARG DEBIAN_FRONTEND=noninteractive
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash binutils ca-certificates curl elfutils file git jq less ltrace openssh-client procps \
    python3 python3-venv ripgrep sqlite3 strace unzip wget xxd zip xz-utils zstd \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global pnpm@10.15.1 @deepseek-ai/dsh@${DSH_VERSION}

WORKDIR /opt/superagent-sec
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=superagent-pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --prefer-offline --prod=false

# The app image runs with production semantics, but keeps the locked build
# toolchain in this reusable layer so Compose can compile the current checkout.
ENV NODE_ENV=production

RUN mkdir -p /var/lib/superagent/workspace /var/lib/superagent/state \
  /var/lib/superagent/dsh-home /var/lib/superagent/secrets/ssh \
  && chmod 700 /var/lib/superagent/secrets
COPY deploy/entrypoint.sh /usr/local/bin/superagent-entrypoint
RUN chmod 755 /usr/local/bin/superagent-entrypoint

EXPOSE 3184
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
  CMD node -e "const port = process.env.DSH_SUPERAGENT_WEB_PORT || '3184'; fetch('http://127.0.0.1:' + port + '/').then((response) => process.exit(response.status === 401 ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/superagent-entrypoint"]
