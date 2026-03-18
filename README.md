# GitLeet

GitLeet is a serverless browser extension that syncs your **Accepted** LeetCode submissions to your GitHub repo.

What it commits per problem (updates in-place on re-submits):

- `solutions/<problem-slug>/<problem-slug>.<ext>`: your submitted code (supports multiple languages side-by-side)
- `solutions/<problem-slug>/README.md`: problem statement + performance + metadata
- `solutions/<problem-slug>/assets/*`: images referenced by the problem statement (downloaded and committed)

### What’s new (v0.2)

- **Popup**: **Auto-push** toggle next to **Sync now**; when auto-push is on, **Sync now** stays disabled with a short explanation (sync happens automatically after Accepted captures).
- **Commit messages / README**: Memory is shown in **megabytes** with sensible rounding (LeetCode’s API returns **bytes**; older builds wrongly labeled them as MB). Runtime/memory **beat percentages** use fewer decimal places.
- **Schema**: **Bundled mapping** is the default for all users — **no Node/MCP server required**. Custom schema URL lives under **Advanced (developers)** in Options.
- **Options**: **Light / Dark** theme toggle (saved with your settings).
- **Icons**: Toolbar and store icons live under `extension/assets/icons/` (replace PNGs with your branding; see `extension/assets/icons/README.md`).
- **Capture**: Submit is detected via LeetCode’s **GraphQL** flow (`typed_code`); `submissionDetails` is **polled** until judging finishes so status isn’t “Unknown” on Accepted solutions.

## How GitLeet works (latest implementation)

GitLeet is **JSON-first**:

- It injects a small script into LeetCode that listens to LeetCode’s own network calls.
- It captures the **JSON request/response** from submission-related endpoints.
- It runs the raw payload through an **MCP schema mapping** to normalize fields into GitLeet’s internal shape.
- It **enriches** the capture by calling LeetCode’s official **GraphQL** API to fetch the full problem statement and richer submission telemetry.
- If the submission is **Accepted** and auto-push is enabled, it writes a **single Git commit** to your repo containing all updated files.

### Commit rules (strict)

GitLeet follows this rule:

- Click **Submit**
- If result is **Accepted** → GitLeet commits
- If result is **not Accepted** → GitLeet does **not** commit (and does not overwrite the last stored solution)

Technically, GitLeet “arms” capture when it detects a real submission intent: **Submit** click, **`POST /submit`**, or a **GraphQL submit** (e.g. submission mutation with `typed_code`). This prevents stale/background payloads from creating commits.

### Manual sync (when auto-push is off)

If you keep auto-push disabled, GitLeet still captures **Accepted** submissions and shows a **Sync now** button in the popup to push the last captured Accepted submission on demand.

## High-level design (HLD)

### Goals

- **Correctness**: commit only what LeetCode accepted; preserve exact submitted code formatting for all languages.
- **Reliability**: depend on **JSON** sources (submission payloads + official GraphQL), avoid brittle DOM scraping.
- **Low overhead**: one GitHub commit per sync; minimal persistent local storage.
- **Security**: least-privilege GitHub access; no password collection; minimize retention of sensitive data.

### Architecture overview

GitLeet is a Manifest V3 browser extension composed of:

- **Content script** (`extension/src/content.js`)
  - Injects a page script for network capture
  - Normalizes and enriches submission data
  - Applies strict commit rules (Submit intent + Accepted-only)
  - Triggers a push via background messaging

- **Injected page script** (`extension/src/inject.js`)
  - Runs in the page’s main world
  - Wraps `fetch` and `XMLHttpRequest` to observe LeetCode’s submission-related JSON
  - Sends captured payloads to the content script via `window.postMessage`

- **Background service worker** (`extension/src/background.js`)
  - Owns GitHub writes and settings
  - Performs a single “upsert” push to GitHub
  - Clears local submission after successful push

- **MCP schema adapter** (`extension/src/schemaAdapter.js` + `extension/src/schemaMapping.json`)
  - Normalizes changing LeetCode payload shapes into a stable internal model
  - Mapping is **bundled by default** or can be fetched from a configured endpoint

- **UI**
  - Popup (`extension/popup/*`): capture status, recent syncs, **Auto-push** toggle, **Sync now** (manual only when auto-push is off)
  - Options (`extension/options/*`): repo, PAT, auto-push, **light/dark theme**, **Advanced** optional custom schema URL

### Data flow (end-to-end)

1. **User clicks Submit** → LeetCode calls **GraphQL** and/or REST; `inject.js` detects submit payloads
2. `inject.js` emits `SUBMIT_INTENT`, then `SUBMISSION_CAPTURED` with `{ submit, response }` (code from `typed_code`, ids from response)
3. `content.js`:
   - gates processing on the submit-intent window
   - normalizes captured payload using MCP mapping
   - enriches using LeetCode GraphQL (`question.content`, `submissionDetails`)
   - extracts problem statement images into `assets`
   - checks **Accepted-only**
   - persists `lastSubmission` only if Accepted
4. `content.js` triggers `PUSH_LAST` to `background.js` (auto-push) or user clicks “Sync now”
5. `background.js` calls `githubUpsertFiles()` which writes **one commit**
6. On success, `background.js` clears `lastSubmission` and appends `recentSyncs`

## Low-level design (LLD)

### Storage schema (`chrome.storage.local`)

- **`settings`**
  - `repo`: `owner/repo`
  - `token`: GitHub PAT
  - `autoPush`: boolean
  - `uiTheme`: `"light"` | `"dark"`
  - `mcp`: `{ mode: "bundled" | "remote", endpoint?: string }`

- **`lastSubmission`** (cleared after successful push)
  - `problem`: `{ slug, title?, difficulty?, url, descriptionHtml?, assets? }`
  - `language`: string
  - `code`: string (exact submitted code)
  - `submissionId`: string (when available)
  - `status`: string
  - `performance`: `{ runtimeMs?, runtimeBeats?, memoryMb?, memoryBeats? }`

- **`recentSyncs`** (last 3)
  - `{ slug, title, timestamp, status, error?, commitUrl?, folderUrl? }`

- **`captureStatus`** (for popup)
  - `{ phase, message, problemSlug?, problemTitle?, updatedAt }`

### Message contracts

- **Page → Content (window.postMessage)**
  - `HOOK_INSTALLED`
  - `SUBMIT_INTENT`
  - `SUBMISSION_CAPTURED` (`{ submit?, graphql?, response }`)

- **Popup/Options/Content → Background (chrome.runtime.sendMessage)**
  - `GET_STATUS`
  - `SAVE_SETTINGS`
  - `SET_AUTO_PUSH` (popup quick toggle)
  - `SET_UI_THEME`
  - `TEST_GITHUB`
  - `CLEAR_TOKEN`
  - `PUSH_LAST`
  - `FETCH_SCHEMA_MAPPING` (background; bundled JSON or remote URL)

### GitHub write strategy (single commit)

`githubUpsertFiles()` uses the **Git Data API** to reduce overhead:

- create blobs for each file
- create a tree based on the current HEAD tree
- create one commit
- update the branch ref

### Strict commit gating

Commits happen only when:

- there is recent **submit intent** (`SUBMIT_INTENT` and/or Submit click), and
- the final status is **Accepted**

If status is not accepted, GitLeet:

- updates the popup status
- does **not** store `lastSubmission`
- does **not** call `PUSH_LAST`

## Design patterns and principles

### Patterns used

- **Adapter**: MCP mapping + `normalizeCaptured()` / `normalizeGraphQlEnrichment()` adapt volatile payloads into a stable internal model.
- **Pipeline**: capture → normalize → enrich → validate → persist → push.
- **Facade**: `githubUpsertFiles()` hides GitHub API complexity behind one function.
- **Single-writer**: background service worker is the only component that writes to GitHub.

### Principles applied

- **SRP (Single Responsibility)**: each module has one job (capture vs normalize vs push vs UI).
- **Least privilege**: PAT scoped to one repo; only required permissions (`storage` + host permissions).
- **Fail-safe defaults**: no commit unless Accepted; no commit unless submit intent is observed.
- **Minimize persistence**: code stored only until successful push; then cleared.
- **Performance-aware**: one Git commit per sync; MCP mapping bundled by default to avoid network latency.

### How we get LeetCode JSON (no DOM scraping)

LeetCode’s UI submits solutions primarily via **`POST /graphql`** (mutation with `typed_code`, `lang`, etc.). Some flows still use `POST /submit` or `POST /interpret_solution`.

GitLeet’s injected script wraps `window.fetch` and `XMLHttpRequest` in the page’s main context, clones the JSON responses, and forwards them to the extension via `window.postMessage`.

### JSON enrichment (GraphQL)

The initial submission response sometimes doesn’t include everything we want to commit (full statement, consistent telemetry fields, etc.).

After a successful capture, GitLeet calls LeetCode’s GraphQL endpoint (`https://leetcode.com/graphql`) using your existing logged-in session (cookies + CSRF token) to fetch:

- **Problem statement HTML** (`question.content`)
- **Richer submission details** (`submissionDetails`) such as runtime, memory, and percentile metrics (when available)

This keeps capture **accurate** and avoids brittle UI scraping.

### Core data structures

GitLeet only keeps a small set of objects in `chrome.storage.local`:

- **`settings`**
  - `repo` (string): `owner/repo`
  - `token` (string): GitHub PAT (contents write access)
  - `autoPush` (boolean)
  - `mcp` (object): `{ mode: "bundled" | "remote", endpoint?: string }`

- **`lastSubmission`** (cleared after a successful push)
  - `problem`: `{ slug, title, difficulty, url, descriptionHtml?, assets? }`
  - `language`: string
  - `code`: string (exact `typed_code`, preserves formatting for all languages)
  - `submissionId`: string (when available)
  - `status`: string (e.g. `"Accepted"`)
  - `performance`: `{ runtimeMs?, runtimeBeats?, memoryMb?, memoryBeats? }`

- **`recentSyncs`** (last 3 only)
  - `{ slug, title, timestamp, status: "synced" | "failed" | "pending", error?, commitUrl?, folderUrl? }`

- **`captureStatus`** (for the popup)
  - `{ phase, message, problemSlug?, problemTitle?, updatedAt }`

### GitHub writes (single commit)

When pushing, GitLeet uses the GitHub **Git Data API** to create exactly **one commit** per sync:

- create blobs for all files (solution + README + any assets)
- create one tree
- create one commit
- update the branch ref

This reduces redundant commits and avoids multiple “solution/metadata” commits per submission.

## System design principles (why this is robust)

- **Source of truth is JSON**: code is captured from the submission payload (`typed_code`) which preserves formatting across all languages.
- **Normalization via MCP mapping**: when LeetCode moves/renames fields, updating the mapping is usually enough (no code changes).
- **Enrichment via official API**: full statement and telemetry are fetched from GraphQL rather than scraping UI.
- **Intent-gated capture**: GitLeet only persists a captured submission within a short window after you click **Submit**, preventing stale/background payloads from creating commits.
- **Single-commit writes**: one commit per sync reduces GitHub API calls and keeps history clean.
- **Least privilege**: GitLeet uses a GitHub PAT scoped to a single repo with Contents read/write. No GitHub passwords.
- **Minimized local retention**: solution code is only stored locally until successfully pushed, then cleared.

## For users (no npm required)

1. **Install GitLeet**
   - **Best**: Install from the browser store (Chrome Web Store / Firefox Add-ons / Edge Add-ons) once published, or
   - **Today (open source)**: Download the latest release zip from GitHub Releases, unzip it, then load it as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked).
2. **Create a GitHub PAT**
   - Fine-grained PAT recommended, scope it to the single repo and grant **Contents: read/write**.
3. **Configure GitLeet**
   - Open GitLeet **Options**
   - Enter `owner/repo` and paste PAT
   - Choose **Light** or **Dark** theme if you like
   - (Optional) enable **auto-push** on Accepted (or use **Sync now** in the popup when it’s off)
   - **No MCP server needed** — schema mapping ships inside the extension. Advanced users can set a custom schema URL.
4. **Use LeetCode**
   - Solve + submit; GitLeet will capture and push.

GitLeet stores the **latest captured submission only until it is pushed**. After a successful push, it clears the local solution and keeps only the last 2–3 sync entries (metadata) for the popup.

## Using GitLeet as a “portfolio” (what you get in your repo)

GitLeet effectively turns a GitHub repo into a **LeetCode solutions portfolio** by writing a stable, human-readable folder layout per problem:

- **Code**: `solutions/<problem-slug>/<problem-slug>.<ext>`
- **Write-up**: `solutions/<problem-slug>/README.md` (statement + metrics + metadata)
- **Assets**: `solutions/<problem-slug>/assets/*` (only when the statement includes images)

Because GitLeet **updates in-place on resubmits**, your Git history becomes a clean timeline of improvements for each problem without creating duplicate folders.

Where this “portfolio” comes from in the extension:

- **Capture**: exact submitted code from LeetCode’s submission JSON (`typed_code`)
- **Enrich**: statement + telemetry from LeetCode GraphQL (`question.content`, `submissionDetails`)
- **Commit**: a single Git commit per Accepted submission containing the files above

If you want to showcase it publicly, you can:

- Link the `solutions/` folder from your main README
- Pin the repo on GitHub
- Add a GitHub Pages site that indexes `solutions/` (optional; not required by GitLeet)

## Repo layout

GitLeet writes to:

- `solutions/<problem-slug>/<problem-slug>.<ext>`
- `solutions/<problem-slug>/README.md`
- `solutions/<problem-slug>/assets/*` (only if the problem statement contains images)

Submitting the same problem again updates the same files (so Git history shows your changes).

## Extension icons

- **Folder**: `extension/assets/icons/`
- **Files**: `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` (PNG, square)
- The build copies them into `dist/`; `manifest.json` references all four plus toolbar sizes.
- Replace with your artwork before publishing to stores (see `extension/assets/icons/README.md`).
- Regenerate green placeholders: `python3 scripts/gen_placeholder_icons.py`

## Publishing to browser stores (overview)

GitLeet is a **Manifest V3** extension. Store policies and fees change — verify current requirements on each portal.

| Store | Portal | Notes |
| ----- | ------ | ----- |
| **Chrome** | [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) | One-time developer registration fee. Package: zip **contents** of `dist/` (not the parent folder). You’ll need a short description, screenshots, and often a **privacy policy** URL (GitLeet uses GitHub + LeetCode APIs only; no third-party analytics in default build). |
| **Edge** | [Microsoft Partner Center](https://partner.microsoft.com/dashboard) | Often accepts the **same zip** as Chrome; select “Edge Add-ons”. |
| **Firefox** | [Firefox Developer Hub (AMO)](https://addons.mozilla.org/developers/) | May require `browser_specific_settings.gecko.id` in `manifest.json` and a quick review. Test with `about:debugging` → temporary add-on. |
| **Opera / Brave / Chromium forks** | Varies | Many allow installing from Chrome Web Store or sideloading the same `dist/` zip. |

**Practical steps**

1. Run `npm run build` then `npm run zip` (or zip `dist/` yourself).
2. Test a clean profile with the zip unpacked or submitted build.
3. Prepare **128×128** (and screenshot) assets; use your icons in `assets/icons/`.
4. Write privacy policy (e.g. GitHub Gist or repo doc) stating: local PAT storage, calls to `leetcode.com`, `api.github.com`, optional custom schema URL.
5. Submit and respond to review feedback.

Safari extensions use a different workflow (Xcode + Apple Developer Program); not covered in the default manifest here.

## Maintainers

## Development (macOS, Linux, Windows/WSL)

### Prerequisites

- **Node.js**: v18+ recommended (any modern Node that supports ESM)
- **npm**: comes with Node
- **zip**: required for `npm run zip`
  - macOS: available by default
  - Ubuntu/WSL: `sudo apt-get update && sudo apt-get install -y zip`
  - Windows (without WSL): install a zip utility that provides `zip` on PATH, or use WSL

> Note: this repo’s build scripts are **bash** scripts (`scripts/*.sh`). On Windows, the simplest path is **WSL2**.

### Windows options (recommended: WSL2)

- **WSL2 (recommended)**:
  - Open an Ubuntu terminal
  - `cd` into your repo (ideally stored inside the Linux filesystem for best performance, e.g. `~/projects/GitLeet`)
  - run the same commands as Linux below

- **Git Bash / MSYS2**:
  - Works as long as you have `bash`, `cp`, and `zip` available
  - If you hit permission/line-ending issues, prefer WSL2

### Install dependencies (one-time)

```bash
npm install
```

### Build extension

Build copies `extension/` into `dist/` (load unpacked from there).

```bash
npm run build
```

Output is in `dist/` (load unpacked).

### Zip a release

Run `npm run build` first to ensure `dist/` exists.

```bash
npm run zip
```

Zip is written to `releases/`.

### MCP / schema mapping (bundled by default)

GitLeet normalizes LeetCode payloads using a **JSON field map** (`extension/src/schemaMapping.json`), loaded from the extension package — **end users never run a server**.

- **Default**: bundled mapping (fast, offline-capable for this step).
- **Advanced (Options)**: optional **custom schema URL** if you host the same JSON shape elsewhere (e.g. to update mappings without shipping a new extension).

Maintainers can still run the repo’s small MCP server for experiments:

```bash
npm run dev:mcp
# Example: http://127.0.0.1:8787/schema/leetcode/submission
```

### Troubleshooting (common cross-platform fixes)

- **`zip: command not found`**:
  - Ubuntu/WSL: `sudo apt-get install -y zip`
  - macOS: should exist; if not, install Xcode Command Line Tools
- **`bash: .../scripts/build.sh: No such file or directory` on Windows**:
  - This is often a line endings issue. Use WSL2 and ensure scripts use LF line endings.
- **WSL can’t access your repo smoothly / very slow**:
  - Prefer cloning the repo inside WSL (Linux filesystem) instead of `/mnt/c/...`.

### Do I need to constantly run the MCP server?

No. If you don’t configure an MCP endpoint, GitLeet will keep using the bundled mapping.

### Can the extension auto-start the MCP server?

No. Browser extensions **cannot start local processes** (for security / sandbox reasons).

### Alternatives to a local MCP server

- **Bundled mapping (default)**: simplest, no extra service
- **Remote mapping endpoint**: host the schema mapping JSON somewhere stable (a small HTTPS endpoint) and put that URL in Options. That gives you “schema updates without shipping a new extension build”.

### Performance notes (fast/slow to load)

- **Bundled MCP mapping (default)**: fastest. Loading the mapping is just a local fetch from the extension package.
- **Remote MCP mapping**: adds a network request at capture time. It’s usually still quick, but if the endpoint is slow/down, capture normalization can fail until it recovers.


