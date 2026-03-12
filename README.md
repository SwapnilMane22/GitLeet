# GitLeet

GitLeet is a serverless browser extension that syncs your **accepted** LeetCode submissions (question metadata + solution + performance) to your own GitHub repository.

## For users (no npm required)

1. **Install GitLeet**
   - **Best**: Install from the browser store (Chrome Web Store / Firefox Add-ons / Edge Add-ons) once published, or
   - **Today (open source)**: Download the latest release zip from GitHub Releases, unzip it, then load it as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked).
2. **Create a GitHub PAT**
   - Fine-grained PAT recommended, scope it to the single repo and grant **Contents: read/write**.
3. **Configure GitLeet**
   - Open GitLeet **Options**
   - Enter `owner/repo` and paste PAT
   - (Optional) set MCP schema endpoint (see below)
   - (Optional) enable auto-push on Accepted
4. **Use LeetCode**
   - Solve + submit; GitLeet will capture and push.

GitLeet stores the **latest captured submission only until it is pushed**. After a successful push, it clears the local solution and keeps only the last 2–3 sync entries (metadata) for the popup.

## Repo layout

GitLeet writes to:

- `solutions/<problem-slug>/solution.<ext>`
- `solutions/<problem-slug>/README.md`

Submitting the same problem again updates the same files (so Git history shows your changes).

## Maintainers

### Build extension

```bash
npm run build
```

Output is in `dist/` (load unpacked).

### Zip a release

```bash
npm run zip
```

Zip is written to `releases/`.

### MCP (required)

This repo includes a required MCP schema tool that serves the expected LeetCode response mapping:

```bash
npm run dev:mcp
```

Default endpoint: `http://127.0.0.1:8787/schema/leetcode/submission`

The extension can use the bundled mapping (`extension/src/schemaMapping.json`) and can also be configured to read from the MCP endpoint (Options → MCP schema endpoint).

