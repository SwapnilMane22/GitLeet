## GitLeet

GitLeet is a **Manifest V3 browser extension** that syncs your **Accepted** LeetCode submissions to a GitHub repo — automatically (auto-push) or on demand (Sync now).

### What gets committed

For each problem (updated in-place on re-submits):

- **Code**: `solutions/<problem-slug>/<problem-slug>.<ext>`
- **Write-up**: `solutions/<problem-slug>/README.md` (statement, metadata, performance)
- **Assets**: `solutions/<problem-slug>/assets/*` (images referenced by the statement)

### Key guarantees

- **Accepted-only**: GitLeet writes to GitHub only when LeetCode returns **Accepted**.
- **Intent-gated**: it only processes captures inside a short window after **Submit** (prevents background/stale payloads from syncing).
- **Single commit per sync**: solution + README + assets are written in **one** Git commit.
- **No local server**: schema mapping is **bundled** with the extension by default.

---

## Install (no dev tools required)

- **Recommended**: install from a browser store once published.
- **From source**: download the latest release zip (or clone), then load the `dist/` folder as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked).

## Setup

1. Create a GitHub **fine‑grained PAT** scoped to your repo with **Contents: read/write**.
2. Open **GitLeet Options**.
3. Set:
   - **Repo**: `owner/repo`
   - **Token**: your PAT
   - **Auto-push**: on/off (you can also toggle this in the popup)
   - **Theme**: Light/Dark (Options)

## Usage

- Solve a problem on LeetCode and click **Submit**.
- If the result is **Accepted**:
  - with **Auto-push ON**: it syncs automatically after capture
  - with **Auto-push OFF**: the popup enables **Sync now** to push the last captured Accepted submission

---

## How it works (high level)

GitLeet is **JSON-first** and avoids brittle DOM scraping:

- An injected page script observes LeetCode’s network traffic (primarily `POST /graphql`) and captures the submit payload (includes `typed_code`).
- A content script normalizes the capture using a **bundled schema mapping** and enriches it via LeetCode GraphQL:
  - `question.content` (full statement HTML)
  - `submissionDetails` (runtime, memory, percentiles; **polled** until judging completes)
- If the final status is **Accepted**, the background service worker writes a **single commit** to GitHub using the Git Data API.

### Architecture (files)

- **Injected page script**: `extension/src/inject.js`
- **Content script**: `extension/src/content.js`
- **Background worker**: `extension/src/background.js`
- **Schema adapter**: `extension/src/schemaAdapter.js` + `extension/src/schemaMapping.json`
- **GitHub writer**: `extension/src/github.js`
- **UI**: `extension/popup/*`, `extension/options/*`

---

## Tech stack

- **Browser extension**: Manifest V3 (service worker background, content scripts, extension pages)
- **Language**: JavaScript (ES modules)
- **Storage**: `chrome.storage.local`
- **LeetCode integration**:
  - Capture: in-page `fetch`/`XMLHttpRequest` instrumentation
  - Enrichment: authenticated `https://leetcode.com/graphql` calls (cookies + CSRF)
- **GitHub integration**: GitHub **Git Data API** (create blobs/tree/commit, update ref)
- **Schema normalization**: bundled JSON field mapping (`schemaMapping.json`) + adapter functions
- **Build**: simple file copy into `dist/` (`scripts/build.sh`), zip packaging (`scripts/zip.sh`)

---

## System design & architecture

### Components

- **Popup UI** (`extension/popup/*`)
  - Shows capture state + recent syncs
  - Lets you toggle **Auto-push** and trigger **Sync now** (manual mode only)
- **Options UI** (`extension/options/*`)
  - Repo + PAT config
  - Theme (Light/Dark)
  - Advanced: optional custom schema URL
- **Background service worker** (`extension/src/background.js`)
  - Single-writer to GitHub (all GitHub API calls happen here)
  - Owns settings + recent sync history
  - Serves schema mapping to other scripts (bundled or remote)
- **Content script** (`extension/src/content.js`)
  - Orchestrates capture → normalize → enrich → validate → persist → push trigger
  - Enforces **intent-gating** and **Accepted-only** rules
- **Injected page script** (`extension/src/inject.js`)
  - Runs in the page context (main world)
  - Observes LeetCode network calls and forwards only **submit-related** JSON to the content script

### Key design decisions

- **JSON-first capture**: uses the same network payloads LeetCode uses (more stable than DOM scraping).
- **Intent gating**: GitLeet only accepts capture events inside a short window after a real **Submit** intent, reducing false positives from background traffic.
- **Accepted-only persistence**: the last submission is stored only if it’s Accepted; failures don’t overwrite a good capture.
- **Polling for final status**: `submissionDetails` is polled briefly because submit flows can return a pending state initially.
- **Single-commit GitHub write**: all updated files are written in one commit to keep history clean and reduce API calls.
- **Bundled schema mapping**: end users don’t run any local servers; the optional schema URL is for maintainers only.

### Data model (what GitLeet stores)

GitLeet stores a small set of objects in `chrome.storage.local`:

- **`settings`**
  - `repo`: `owner/repo`
  - `token`: GitHub PAT
  - `autoPush`: boolean
  - `uiTheme`: `"light"` | `"dark"`
  - `mcp`: `{ mode: "bundled" | "remote", endpoint?: string }`
- **`lastSubmission`** (cleared after successful push)
  - `problem`: `{ slug, title, difficulty, url, descriptionHtml?, assets? }`
  - `language`, `code`, `submissionId`, `status`
  - `performance`: `{ runtimeMs?, runtimeBeats?, memoryMb?, memoryBeats? }`
- **`recentSyncs`** (last ~3)
  - `{ slug, title, timestamp, status, error?, commitUrl?, folderUrl? }`
- **`captureStatus`** (for popup)
  - `{ phase, message, problemSlug?, problemTitle?, updatedAt }`

### GitHub write strategy (single commit)

GitLeet uses the GitHub **Git Data API** to write one commit per sync:

- create blobs for solution, README, and any assets
- create a tree based on current `HEAD`
- create a commit with the new tree
- update the branch ref

This avoids multiple commits per submission and keeps your repo history clean.

---

## Security & privacy

- GitLeet stores your PAT in `chrome.storage.local` and uses it only to write to `api.github.com`.
- LeetCode enrichment requests use your existing logged-in session cookies (CSRF token is read from cookies on `leetcode.com`).
- GitLeet keeps **only the last captured submission** until it is successfully pushed, then clears it and retains only the last ~3 sync metadata entries for the popup.
- There is **no analytics SDK** and no third‑party telemetry in the default build.

---

## Extension icons

- **Folder**: `extension/assets/icons/`
- **Files**: `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`
- Docs: `extension/assets/icons/README.md`

---

### Release checklist

- Build and package:

```bash
npm run build
npm run zip
```

- Ensure icons (including `128×128`) and screenshots are ready.
- Prepare a short **privacy policy** stating:
  - PAT is stored locally
  - requests go to `leetcode.com`, `assets.leetcode.com`, `api.github.com`
  - optional custom schema URL (Advanced) if configured by the user

Note: Safari uses a different workflow (Xcode + Apple Developer Program).

---

## Development

### Prerequisites

- **Node.js**: v18+ recommended
- **zip**: required for `npm run zip`

### Install and build

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension.

### Schema mapping (bundled by default)

GitLeet normalizes payloads using `extension/src/schemaMapping.json` bundled in the extension.

- **Default**: bundled mapping (recommended).
- **Advanced (Options)**: optional custom schema URL (for maintainers who host mapping JSON elsewhere).

### Optional MCP server (maintainers only)

```bash
npm run dev:mcp
```

Example endpoint: `http://127.0.0.1:8787/schema/leetcode/submission`

---

## Troubleshooting

- **“Not accepted / Unknown” right after submit**: LeetCode sometimes returns a pending state first. GitLeet polls `submissionDetails` briefly until a final status is available.
- **Sync now disabled**:
  - Auto-push ON → Sync now stays disabled by design (sync happens automatically).
  - No captured submission yet → submit an Accepted solution first.
- **Remote schema URL issues**: leave Advanced schema URL empty to use the bundled mapping.
