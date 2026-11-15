# superagent-sec v0.1.0-sec.5

Deployment candidate for the isolated Superagent-sec runtime.

- One project instance can contain multiple Git repositories and ordinary source directories.
- Research schedules support independent model routes, time zones, and 1–256 research lanes.
- 502/429 and network failures use durable exponential backoff.
- Research lanes keep concurrent artifacts isolated under `research/rounds/<round-id>/`.
- Docker assets include only the runtime, pnpm, DSH, OpenSSH client, and locked dependencies. Compose builds a separate application image from the current checkout; the release asset never contains application source or generated `lib/`.

Before importing an asset, verify its `.sha256` file and select the archive matching the target host architecture. Keep `DEEPSEEK_API_KEY` and `deploy/.env` outside the Release assets.

- Workspace sources explicitly distinguish Git, directory, binary, and pseudocode/decompilation evidence with content baselines.

- Provider, model name, API endpoint, and credentials are intentionally external to the image and Compose defaults; an operator may mount a complete DSH patch when needed.

- The application image is built with `deploy/App.Dockerfile` using the runtime image as its base. Fresh, read-only, and updated checkouts therefore follow the same build path without host `node_modules` or `lib/` volumes.
