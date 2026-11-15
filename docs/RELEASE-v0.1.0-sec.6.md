# superagent-sec v0.1.0-sec.6

Runtime-tooling update for the isolated Superagent-sec deployment.

- Keeps the runtime/app image split from v0.1.0-sec.5.
- Adds Python 3, ripgrep, jq, curl, file, binutils, elfutils, xxd, sqlite3, compression tools, and process tracing tools (`strace`/`ltrace`) to the dependency-only runtime image.
- The runtime image still contains no Superagent-sec application source or generated `lib/`; Compose builds those into the app image.
- Provider, model name, API endpoint, credentials, target source, and research state remain external to the image.

Verify the `.sha256` file and import the archive matching the host architecture. Rebuild the app image with Compose after loading the runtime archive.
