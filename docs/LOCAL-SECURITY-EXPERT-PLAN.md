# Local Security Expert Implementation Plan

This branch implements a local-network-first security expert while keeping `main` aligned with the DeepSeek prototype.

## Design principles

- `main` remains an upstream mirror; all security work stays on a dedicated branch until the extension boundary is smaller and stable.
- The agent never needs to upload project source, tasks, reports or research artifacts to GitHub.
- A project security workspace is the durable source of truth for source revisions, evidence, knowledge, reports, questions and corrections.
- User requests and corrections have priority over autonomous research.
- Autonomous work is bounded into resumable rounds with checkpoints, evidence references and a clear next frontier.
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

## Local operation

The local profile uses a dedicated `stateDir` and workspace. The management panel and loopback API provide interactive control. A later folder adapter may consume `inbox/requests/` and `inbox/corrections/` through stable IDs and atomic claim/complete transitions; files placed elsewhere are never treated as tasks automatically.

When the service is exposed beyond localhost, it must sit behind company authentication or an authenticated reverse proxy. The local API header is an origin guard, not a complete network identity boundary.

## Future extraction

The current implementation is intentionally isolated on this branch. After the milestones pass, extract workspace, local intake and continuous research into a companion package and upstream the smallest generic host APIs needed by external plugins.
