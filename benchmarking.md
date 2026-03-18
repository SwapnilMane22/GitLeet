# Benchmarking: GitLeet vs common LeetCode→GitHub sync tools

This document compares GitLeet against widely used alternatives to identify:

- **Common features** users expect
- **Differentiators** that affect reliability, performance, UX, and security
- **Gaps / risks** and what GitLeet does to reduce them

Benchmarked tools (public references):

- **LeetSync**: `https://github.com/LeetSync/LeetSync`
- **LeetHub-3.0**: `https://github.com/raphaelheinz/LeetHub-3.0`
- **leetcode-sync (GitHub Action)**: `https://github.com/joshcai/leetcode-sync`

> Note: GitLeet is implemented as a MV3 browser extension with a minimal UI, focusing on JSON correctness, low API overhead, and safe sync rules.

## Feature matrix (high-signal)

Legend: ✅ supported • ⚠️ partial/depends • ❌ not supported


| Category            | Feature                                              | GitLeet                                    | LeetSync                       | LeetHub-3.0                                           | leetcode-sync (Action)                |
| ------------------- | ---------------------------------------------------- | ------------------------------------------ | ------------------------------ | ----------------------------------------------------- | ------------------------------------- |
| **Correctness**     | Captures exact submitted code (preserves formatting) | ✅ (uses `typed_code` from submit JSON)     | ⚠️ (depends on implementation) | ⚠️ (implementation dependent; UI timing issues noted) | ✅ (server-side fetch of submissions)  |
| **Correctness**     | Commit only when all test cases pass                 | ✅ **Accepted-only**                        | ⚠️                             | ✅ (states “pass all tests”)                           | ✅ (syncs accepted submissions)        |
| **Reliability**     | JSON-first (not DOM scraping)                        | ✅                                          | ⚠️                             | ⚠️ (notes UI issues / timing sensitivities)           | ✅                                     |
| **Reliability**     | Handles LeetCode schema changes without code changes | ✅ via **MCP schema mapping**               | ❌                              | ❌                                                     | ❌ (code updates needed)               |
| **Completeness**    | Full problem statement included                      | ✅ (GraphQL `question.content`)             | ⚠️                             | ⚠️                                                    | ⚠️ (depends on implementation/config) |
| **Completeness**    | Images included offline in repo                      | ✅ (extract + commit assets)                | ⚠️                             | ❌/⚠️                                                  | ❌/⚠️                                  |
| **Telemetry**       | Runtime/memory + percentiles                         | ✅ (GraphQL `submissionDetails`)            | ⚠️                             | ✅/⚠️                                                  | ✅/⚠️                                  |
| **GitHub overhead** | Single commit per sync                               | ✅ (Git Data API: blobs/tree/commit/ref)    | ⚠️                             | ⚠️                                                    | ✅ (one commit per run)                |
| **UX**              | “No-developer setup” (store install)                 | ⚠️ (works from `dist/`, store-ready later) | ✅                              | ✅                                                     | ❌ (requires Actions + secrets)        |
| **Security**        | Least privilege token                                | ✅ (repo-scoped PAT)                        | ⚠️                             | ⚠️                                                    | ✅ (GitHub token + secrets)            |
| **Security**        | Doesn’t keep solution locally after push             | ✅                                          | ⚠️                             | ⚠️                                                    | ✅ (server-side run)                   |
| **Platforms**       | Works without CI                                     | ✅                                          | ✅                              | ✅                                                     | ❌ (CI only)                           |


## What GitLeet’s final architecture optimizes for

### 1) Robust capture without DOM fragility

GitLeet captures submission data by injecting a small script that wraps `fetch`/XHR and forwards the relevant **JSON payloads** to the content script. DOM scraping is intentionally avoided as a primary strategy because UI selectors/layouts change more frequently than API response shapes.

### 2) Schema resilience with MCP mapping

LeetCode payload shapes can move fields. GitLeet uses an MCP-style **schema mapping** to extract fields via multiple candidate paths. Updating the mapping usually restores capture without code changes.

### 3) Higher completeness via official GraphQL enrichment

After initial capture, GitLeet calls `https://leetcode.com/graphql` (using the existing logged-in session) to fetch:

- `question.content` (full statement HTML)
- `submissionDetails` (runtime, memory, percentiles)

### 4) Safety rules to prevent unwanted commits

GitLeet enforces:

- **Submit intent gating** (requires actual Submit click and/or observed `/submit` request)
- **Accepted-only commit** (no commit and no overwrite when not accepted)

### 5) Lower GitHub API overhead and cleaner history

GitLeet writes **one commit** per sync using the Git Data API, which avoids multiple per-file commits/requests.

## Known risk areas (and how GitLeet mitigates them)

- **LeetCode auth/CSRF changes**: GraphQL calls require cookies + CSRF. GitLeet uses `credentials: "include"` and reads `csrftoken`. If LeetCode changes auth, enrichment may fail gracefully (capture still works if submission JSON includes enough).
- **Rate limits**: GitLeet minimizes GitHub calls by creating a single commit; still subject to GitHub API rate limits if submissions are extremely frequent.
- **Multi-submission noise**: Intent gating and Accepted-only commit reduce redundant commits.

## Gap checklist (product polish)

These are the main remaining items to “beat the market” in user experience:

- **Store distribution**: ship signed builds for Chrome/Edge/Firefox
- **OAuth vs PAT**: OAuth app flow can reduce friction (PAT remains simplest for power users)
- **First-run onboarding**: guided setup + validation + clearer status messaging
- **Optional backfill**: sync older accepted submissions from history

