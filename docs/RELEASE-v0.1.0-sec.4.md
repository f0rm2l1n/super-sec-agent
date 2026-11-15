# superagent-sec v0.1.0-sec.4

Deployment candidate for the isolated Superagent-sec runtime.

- One project instance can contain multiple Git repositories and ordinary source directories.
- Research schedules support independent model routes, time zones, and 1–256 research lanes.
- 502/429 and network failures use durable exponential backoff.
- Research lanes keep concurrent artifacts isolated under `research/rounds/<round-id>/`.
- Docker assets include only the runtime, pnpm, DSH, OpenSSH client, and locked dependencies; application source and generated `lib/` are mounted/generated at runtime from the host checkout.

Before importing an asset, verify its `.sha256` file and select the archive matching the target host architecture. Keep `DEEPSEEK_API_KEY` and `deploy/.env` outside the Release assets.

- Workspace sources explicitly distinguish Git, directory, binary, and pseudocode/decompilation evidence with content baselines.

- Provider, model name, API endpoint, and credentials are intentionally external to the image and Compose defaults; an operator may mount a complete DSH patch when needed.

- The dependency image pre-creates the writable `lib/` mountpoint required when the host checkout is mounted read-only.
