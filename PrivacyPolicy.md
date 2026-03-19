## GitLeet Privacy Policy

**Last updated:** March 19, 2026

GitLeet is a browser extension that syncs **Accepted** LeetCode submissions to a GitHub repository you configure.

### Data GitLeet stores
GitLeet stores the following data locally in your browser using extension storage:
- **GitHub repository** (`owner/repo`)
- **GitHub Personal Access Token (PAT)** (used only to write commits to your repo)
- **Settings** (e.g., auto-push, theme)
- The **last captured submission** (temporarily, until it is pushed)
- A short history of **recent syncs** (metadata only)

### Data GitLeet sends over the network
GitLeet communicates only with:
- `https://leetcode.com/` (to capture/enrich submission details using your logged-in session)
- `https://assets.leetcode.com/` (to download problem statement images if present)
- `https://api.github.com/` (to write commits to your configured repo)

GitLeet does **not** sell data, does **not** run ads, and does **not** include third‑party analytics.

### Authentication
- LeetCode requests use your existing logged-in session (cookies) inside your browser.
- GitHub access uses the PAT you provide. The token is stored locally and is never shared with anyone else.

### Data retention
- Submission code is stored only until a successful push, then removed.
- Recent sync entries are kept only as a short list for display in the popup.

### Your choices
You can remove stored data at any time by:
- Clearing the token in GitLeet Options
- Removing the extension (which removes extension storage)

### Contact
For questions or concerns, open an issue in the GitHub repository.
