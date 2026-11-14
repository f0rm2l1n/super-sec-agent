# Local Security Expert Implementation Plan

This branch implements a local-network-first security expert while keeping `main` aligned with the DeepSeek prototype.

## Design principles

- `main` remains an upstream mirror; all security work stays on a dedicated branch until the extension boundary is smaller and stable.
- The agent never needs to upload project source, tasks, reports or research artifacts to GitHub.
- A project security workspace is the durable source of truth for source revisions, evidence, knowledge, reports, questions and corrections.
- User requests and corrections have priority over autonomous research.
- Autonomous work is bounded into resumable rounds with checkpoints, evidence references and a clear next frontier.
- The host supplies a research charter; the expert chooses concrete questions and maintains a structured frontier.
- Human questions pause only the blocked round; independent work may continue.
- Parallel workers use separate round directories and a coordinator merges shared knowledge.
- Local API and folder intake are explicit task channels; arbitrary project files are research data, not instructions.

## Milestones

1. Initialize and validate a standard security workspace for a real project.
2. Start a local DSH profile with GitHub and Feishu disabled.
3. Submit a local security request and persist it with an idempotent ID.
4. Deliver the request to a durable worker session and expose status/replies.
5. Enable bounded continuous research and persist checkpoints across restarts.
6. Accept human corrections and resume the same project session.
7. Ask concrete questions and preserve useful independent work while waiting.
8. Track source revision drift and refuse unsafe continuation.
9. Run independent research work in parallel without shared-file corruption.
10. Verify recovery, status visibility, evidence quality and local-network boundaries.

## Verification contract

Each milestone must have a focused automated test or a reproducible local command. A passing test proves the execution path and persistence behavior; it does not prove the correctness of a security conclusion. Real-model acceptance remains a separate evaluation with human review.

## Implementation status and step report

The first implementation pass is complete on `security/local-expert` (2026-11-14). The upstream mirror remains unchanged.

| Milestone | Implemented behavior | Verification |
| --- | --- | --- |
| 1 | Portable workspace initialization, source pinning, scope and drift checks | `tests/security-workspace.spec.ts` |
| 2 | Local deployment profile with account probing bypassed and external Sources disabled | `tests/local-research.spec.ts` local startup case |
| 3 | HTTP and folder intake with UUID idempotency and durable JSON records | `tests/local-research.spec.ts` request and inbox cases |
| 4 | Durable local worker session, status view and local replies | `tests/local-research.spec.ts` local worker case; `tests/panel-research.spec.tsx` |
| 5 | Bounded autonomous rounds, structured proposals, evidence checkpoints and restart recovery | continuous-research cases in `tests/local-research.spec.ts` |
| 6 | Corrections routed into the same project session | correction branch of the local worker case |
| 7 | Worker questions, human-priority scheduling and independent checkpoint preservation | human-input and recovery cases in `tests/local-research.spec.ts` |
| 8 | Source revision and scope drift block further research | drift case in `tests/local-research.spec.ts` and workspace tests |
| 9 | Existing Executor `maxWorkers` supports parallel independent Tickets; local research serializes one project workspace to protect shared evidence | `tests/runtime-concurrency.spec.ts`; separate workspace/inbox directories |
| 10 | Recovery, status, evidence and loopback/local-network boundaries are covered and documented | security suite, build, and this maintenance guide |

Verification completed during this pass: `typecheck` passed; the security suite passed 20 tests; the production build passed; the serial upstream suite passed 1217 tests, with its only failure being the documentation module index, which was fixed by adding `src/security/local-inbox.ts` to `docs/007-architecture.md`. The suite should be rerun after that documentation-only fix before release.

## Local operation

The local profile uses a dedicated `stateDir` and workspace. The management panel and loopback API provide interactive control. The runtime also polls `interactions/inbox/requests/` and `interactions/inbox/corrections/` during its normal pass. Each task is a UTF-8 Markdown file named `<uuid>.md`; it is atomically moved through `processing/` and `processed/`, while malformed files are quarantined under `errors/`. Files placed elsewhere are never treated as tasks automatically.

## Upstream adaptation and upgrade procedure

Keep `main` as a clean mirror of `upstream/main`. Develop the local security layer on `security/local-expert`; do not put local deployment settings, workspace data or credentials in either branch. The current branch deliberately keeps the local code in `src/security/`, the local profile path in `src/deployment.ts`, the local routes in `src/app/http.ts`, and the smallest lifecycle hook in `src/app/runtime.ts`. This makes upstream adoption a reviewable rebase instead of a permanent fork.

Before adopting an upstream release:

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

Resolve conflicts by preserving upstream behavior in `src/core/`, generic source handling and the panel first. Re-apply local behavior only where the local branch owns it: workspace validation, local intake, continuous research, security prompts and the local deployment branch. A conflict in `src/app/runtime.ts`, `src/app/http.ts` or shared client types is an adaptation boundary: resolve it manually, add a focused regression test, and run the complete upstream suite serially when parallel macOS workers make failures ambiguous. Never resolve by blindly choosing one side.

After a rebase, review `git diff --stat main...security/local-expert`, inspect every changed shared file, and verify that `main` is still identical to `upstream/main`. If an upstream feature makes a local hook unnecessary, remove the hook and its tests rather than adding another compatibility layer. The long-term extraction path is a companion package containing `src/security/` plus a small upstream host interface; this branch remains the integration staging area until that boundary is stable.

When the service is exposed beyond localhost, it must sit behind company authentication or an authenticated reverse proxy. The local API header is an origin guard, not a complete network identity boundary.

## Future work

The current single-agent loop is the first implementation of the research protocol, not the final multi-agent design. The next increments should be implemented in this order:

1. **Research quality evaluation** — run repeated real-project rounds and have a human review novelty, evidence quality, useful negative results, repeated questions and cost.
2. **Frontier maintenance** — add deterministic duplicate detection, stale-item expiry, dependency links and explicit status transitions when evidence confirms or weakens a hypothesis.
3. **Independent review** — add a second model or reviewer pass that checks the proposal and checkpoint against source evidence before a frontier item becomes the next default.
4. **Planner/worker separation** — let a stronger model select and rank research directions while cheaper workers perform bounded evidence collection; keep the existing checkpoint contract between them.
5. **Event-driven refresh** — re-open affected frontier items after source revision changes, new user corrections or new runtime evidence instead of relying only on periodic rounds.
6. **Multi-project and parallel safety** — introduce separate project queues and merge rules only after one-project evidence quality is stable.

Do not introduce multi-agent roles merely for naming or parallelism. Each additional role must improve a measured property such as evidence accuracy, novelty, coverage or cost.

## Future extraction

The current implementation is intentionally isolated on this branch. After the milestones pass, extract workspace, local intake and continuous research into a companion package and upstream the smallest generic host APIs needed by external plugins.
