#!/bin/sh
set -eu

profile=${SUPERAGENT_PROFILE:-superagent-sec}
app_dir=${SUPERAGENT_APP_DIR:-/opt/superagent-sec}
dsh_home=${DSH_HOME:-/var/lib/superagent/dsh-home}
workspace=${SUPERAGENT_WORKSPACE:-/var/lib/superagent/workspace}
projects_dir=${SUPERAGENT_PROJECTS_DIR:-/var/lib/superagent/projects}
state_dir=${SUPERAGENT_STATE_DIR:-/var/lib/superagent/state}
backend_port=${DSH_SUPERAGENT_BACKEND_PORT:-3182}
token_file=${DSH_SUPERAGENT_ACCESS_TOKEN_FILE:-/var/lib/superagent/secrets/web-token}
external_patch=${SUPERAGENT_DSH_PATCH_FILE:-}

mkdir -p "$dsh_home" "$workspace" "$projects_dir" "$state_dir" "$(dirname "$token_file")"
chmod 700 "$dsh_home" "$(dirname "$token_file")" 2>/dev/null || true
if [ ! -f "$app_dir/package.json" ]; then
  echo "Superagent application image is missing package.json: $app_dir" >&2
  exit 1
fi
if [ ! -d "$app_dir/node_modules" ]; then
  echo "Superagent application image is missing node_modules: $app_dir/node_modules" >&2
  exit 1
fi
if [ ! -f "$app_dir/node_modules/.modules.yaml" ]; then
  echo "Superagent application image has no pnpm dependency metadata; rebuild the image" >&2
  exit 1
fi
if [ ! -f "$app_dir/lib/index.js" ]; then
  echo "Superagent application image is missing lib/index.js; build the app image before starting" >&2
  exit 1
fi
if [ "${SUPERAGENT_BUILD_ON_START:-false}" = true ]; then
  pnpm --dir "$app_dir" build >/dev/null
fi

ssh_secret_dir=${SUPERAGENT_SSH_SECRET_DIR:-/var/lib/superagent/secrets/ssh}
mkdir -p "$ssh_secret_dir"
chmod 700 "$ssh_secret_dir"
if [ -n "${SUPERAGENT_SSH_KEY_FILE:-}" ]; then
  ssh_source=$SUPERAGENT_SSH_KEY_FILE
else
  ssh_source="$ssh_secret_dir/id_ed25519"
  if [ ! -f "$ssh_source" ]; then
    ssh-keygen -q -t ed25519 -N '' -C "superagent-sec@$(hostname)" -f "$ssh_source"
    chmod 600 "$ssh_source"
    echo "Generated the persistent Superagent SSH key at $ssh_source"
  fi
fi
ssh_dir=/root/.ssh
mkdir -p "$ssh_dir"
chmod 700 "$ssh_dir"
if [ -f "$ssh_source" ]; then
  cp "$ssh_source" "$ssh_dir/id_ed25519"
  chmod 600 "$ssh_dir/id_ed25519"
  if [ -f "${ssh_source}.pub" ]; then
    cp "${ssh_source}.pub" "$ssh_dir/id_ed25519.pub"
    chmod 644 "$ssh_dir/id_ed25519.pub"
  else
    ssh-keygen -y -f "$ssh_dir/id_ed25519" > "$ssh_dir/id_ed25519.pub"
    chmod 644 "$ssh_dir/id_ed25519.pub"
  fi
  known_hosts_file=${SUPERAGENT_SSH_KNOWN_HOSTS_FILE:-/var/lib/superagent/secrets/ssh/known_hosts}
  mkdir -p "$(dirname "$known_hosts_file")"
  touch "$known_hosts_file"
  chmod 600 "$known_hosts_file"
  cat > "$ssh_dir/config" <<EOF
Host *
  IdentityFile $ssh_dir/id_ed25519
  IdentitiesOnly yes
  UserKnownHostsFile $known_hosts_file
  StrictHostKeyChecking ${SUPERAGENT_SSH_STRICT_HOST_KEY_CHECKING:-accept-new}
EOF
  chmod 600 "$ssh_dir/config"
  echo "Superagent SSH public-key fingerprint: $(ssh-keygen -lf "$ssh_dir/id_ed25519.pub" | awk '{print $2}')"
else
  echo "Configured Superagent SSH key does not exist: $ssh_source" >&2
  exit 1
fi
export DSH_HOME="$dsh_home" DSH_AGENTS_HOME="$dsh_home/agents"
export DSH_SUPERAGENT_HOME="$dsh_home"
export DSH_SUPERAGENT_BACKEND_PORT="$backend_port"
export DSH_SUPERAGENT_WEB_HOST="${DSH_SUPERAGENT_WEB_HOST:-0.0.0.0}"
export DSH_SUPERAGENT_WEB_PORT="${DSH_SUPERAGENT_WEB_PORT:-3184}"
export DSH_SUPERAGENT_ACCESS_TOKEN_FILE="$token_file"

profile_dir="$dsh_home/profiles/$profile"
if [ ! -d "$profile_dir" ]; then
  dsh "$profile" --from-default-profile web --dump-config >/dev/null
fi
if [ ! -f "$profile_dir/.superagent-sec-installed" ]; then
  dsh plugin --profile "$profile" add "link:$app_dir"
  touch "$profile_dir/.superagent-sec-installed"
fi
if [ -n "$external_patch" ]; then
  if [ ! -f "$external_patch" ]; then
    echo "Configured DSH patch does not exist: $external_patch" >&2
    exit 1
  fi
  cp "$external_patch" "$profile_dir/cordis.patch.yml"
elif [ ! -f "$profile_dir/cordis.patch.yml" ] || grep -q '# superagent-sec managed runtime patch v1' "$profile_dir/cordis.patch.yml"; then
  cat > "$profile_dir/cordis.patch.yml" <<EOF
# superagent-sec managed runtime patch v1
- id: webserver
  config:
    host: 127.0.0.1
    port: ${backend_port}
- id: dsh-superagent
  config:
    stateDir: ${state_dir}
    workspace: ${workspace}
- id: dsh-superagent-github
  disabled: true
EOF
  chmod 600 "$profile_dir/cordis.patch.yml"
fi

cleanup() {
  kill "$dsh_pid" 2>/dev/null || true
  wait "$dsh_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

dsh "$profile" --no-open &
dsh_pid=$!

ready=0
for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:${backend_port}/').then(() => process.exit(0)).catch(() => process.exit(1))"; then
    ready=1
    break
  fi
  if ! kill -0 "$dsh_pid" 2>/dev/null; then
    echo 'DSH exited before the backend became reachable' >&2
    exit 1
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo 'Timed out waiting for the DSH backend' >&2
  exit 1
fi

exec node "$app_dir/scripts/dsh-superagent-web-auth.mjs"
