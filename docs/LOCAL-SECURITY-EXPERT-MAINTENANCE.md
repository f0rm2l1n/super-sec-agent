# Maintaining the local security expert

The repository has two intentional lines of development:

- `main` is the clean upstream mirror.
- `security/local-expert` contains the local-network security adaptation.

The local adaptation does not require GitHub access for project work. Source checkouts, requests, reports, checkpoints and corrections stay under the configured security workspace. GitHub is used only to obtain upstream source changes when the company network permits it; no company project data is pushed there.

## Adaptation boundary

Keep local behavior concentrated in these areas:

| Area | Local responsibility | Upgrade rule |
| --- | --- | --- |
| `src/security/` | Workspace validation, local messages, folder inbox, continuous research, security profile | Preserve unless upstream adds an equivalent extension point |
| `src/deployment.ts` | Local profile selection and external-account bypass | Recheck when deployment discovery changes |
| `src/app/http.ts` | Loopback research/status routes | Keep route contracts compatible with the panel |
| `src/app/runtime.ts` | Registers local source and polls the explicit inbox | Keep the hook small; rebase manually if lifecycle changes |
| `docs/` and tests | Operating procedure and regression evidence | Update with every behavior or boundary change |

Do not copy local workspace contents, state databases, model credentials or generated agent sessions into the repository. Do not turn arbitrary Markdown files into tasks: only UUID-named files in the two documented inbox directories are consumed.

## Bringing in upstream changes

Run the following from a clean working tree:

```sh
cd /Users/malin/Desktop/investigate/super-agents/super-sec-agent
git fetch upstream
git switch main
git pull --ff-only upstream main
git switch security/local-expert
git rebase main
NPM_CONFIG_CACHE=/tmp/super-sec-agent-npm-cache npx --yes pnpm@10.15.1 install --frozen-lockfile
NPM_CONFIG_CACHE=/tmp/super-sec-agent-npm-cache npx --yes pnpm@10.15.1 typecheck
NPM_CONFIG_CACHE=/tmp/super-sec-agent-npm-cache npx --yes pnpm@10.15.1 test:security
NPM_CONFIG_CACHE=/tmp/super-sec-agent-npm-cache npx --yes pnpm@10.15.1 build
```

If a shared file conflicts, retain upstream semantics first and reapply only the local behavior described in the boundary table. Conflicts in runtime lifecycle, HTTP route registration or shared API types require a focused test before the rebase is considered complete. Keep the upstream mirror clean:

```sh
git diff --exit-code upstream/main main
git diff --stat main...security/local-expert
```

Run the full upstream suite when the change touches shared code. On macOS, use a serial run to distinguish real regressions from resource contention:

```sh
NPM_CONFIG_CACHE=/tmp/super-sec-agent-npm-cache npx --yes pnpm@10.15.1 exec vitest run --maxWorkers=1
```

## Local task flow

The panel calls `POST /orchestrator/api/research/messages`. A folder task uses this layout:

```text
<workspace>/interactions/inbox/requests/<uuid>.md
<workspace>/interactions/inbox/corrections/<uuid>.md
```

The runtime polls those directories every two seconds. A valid file is recorded as a durable local trigger, then moved to `interactions/inbox/processed/`. Invalid names or empty/oversized content move to `interactions/inbox/errors/` with a JSON reason. A crash during intake is recoverable because files in `processing/` are returned to the inbox on restart. Status and replies remain visible through `GET /orchestrator/api/research`, the panel, and the durable `interactions/` records.

## Release checklist

Before using a rebased branch in the internal network, verify:

1. `main` matches `upstream/main`.
2. The local workspace has a pinned clean source revision and a reviewed `SCOPE.md`.
3. GitHub and Feishu are disabled in the local deployment; the service listens only on the intended loopback or authenticated company endpoint.
4. `typecheck`, `test:security`, and `build` pass.
5. Folder intake, idempotent HTTP messages, restart recovery, source drift blocking, human corrections and continuous checkpoints have regression evidence.
6. Any full-suite failure is classified as a code regression or a test-environment limitation before release.
