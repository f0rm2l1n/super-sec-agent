# superagent-sec v0.1.0-sec.1

Deployment candidate for the isolated Superagent-sec runtime.

- One project instance can contain multiple Git repositories and ordinary source directories.
- Research schedules support independent model routes, time zones, and 1–256 research lanes.
- 502/429 and network failures use durable exponential backoff.
- Research lanes keep concurrent artifacts isolated under `research/rounds/<round-id>/`.
- Docker assets include the runtime, pnpm, DSH, OpenSSH client, and locked dependencies; host source and runtime state remain mounted.

Before importing an asset, verify its `.sha256` file and select the archive matching the target host architecture. Keep `DEEPSEEK_API_KEY` and `deploy/.env` outside the Release assets.
