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

# A 401 from the token gateway only proves that the proxy is listening. Read
# the token file and make an authenticated request so Docker also restarts the
# container when the DSH backend later dies or becomes unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const fs = require('node:fs'); const token = fs.readFileSync(process.env.DSH_SUPERAGENT_ACCESS_TOKEN_FILE || '/var/lib/superagent/secrets/web-token', 'utf8').trim(); fetch('http://127.0.0.1:' + (process.env.DSH_SUPERAGENT_WEB_PORT || '3184') + '/', { headers: { authorization: 'Bearer ' + token } }).then((response) => process.exit(response.status < 500 ? 0 : 1)).catch(() => process.exit(1))"

