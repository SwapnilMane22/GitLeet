function b64EncodeUtf8(str) {
  // MV3 service worker environment supports btoa; ensure UTF-8.
  const utf8 = new TextEncoder().encode(str);
  let binary = "";
  for (const b of utf8) binary += String.fromCharCode(b);
  return btoa(binary);
}

function b64EncodeBytes(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

function parseRepo(repo) {
  const [owner, name] = String(repo || "").split("/");
  if (!owner || !name) throw new Error("Repo must be in the form owner/repo");
  return { owner, repo: name };
}

async function ghFetch(url, { token, method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `token ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg =
      json?.message ||
      `GitHub API error ${res.status} ${res.statusText} for ${url}`;
    throw new Error(msg);
  }
  return json;
}

export async function githubGetUser({ token }) {
  return await ghFetch("https://api.github.com/user", { token });
}

export async function githubGetRepo({ token, repo }) {
  const { owner, repo: name } = parseRepo(repo);
  return await ghFetch(`https://api.github.com/repos/${owner}/${name}`, { token });
}

async function getDefaultBranch({ token, repo }) {
  const repoInfo = await githubGetRepo({ token, repo });
  return repoInfo.default_branch || "main";
}

async function getRefSha({ token, repo, branch }) {
  const { owner, repo: name } = parseRepo(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(
    branch
  )}`;
  const ref = await ghFetch(url, { token });
  const sha = ref?.object?.sha;
  if (!sha) throw new Error("Failed to resolve branch ref sha.");
  return sha;
}

async function getCommit({ token, repo, sha }) {
  const { owner, repo: name } = parseRepo(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/git/commits/${encodeURIComponent(
    sha
  )}`;
  return await ghFetch(url, { token });
}

async function createBlob({ token, repo, contentBase64 }) {
  const { owner, repo: name } = parseRepo(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/git/blobs`;
  const resp = await ghFetch(url, {
    token,
    method: "POST",
    body: { content: contentBase64, encoding: "base64" }
  });
  const sha = resp?.sha;
  if (!sha) throw new Error("Failed to create blob.");
  return sha;
}

async function createTree({ token, repo, baseTreeSha, entries }) {
  const { owner, repo: name } = parseRepo(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/git/trees`;
  const resp = await ghFetch(url, {
    token,
    method: "POST",
    body: { base_tree: baseTreeSha, tree: entries }
  });
  const sha = resp?.sha;
  if (!sha) throw new Error("Failed to create tree.");
  return sha;
}

async function createCommit({ token, repo, message, treeSha, parentSha }) {
  const { owner, repo: name } = parseRepo(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/git/commits`;
  const resp = await ghFetch(url, {
    token,
    method: "POST",
    body: { message, tree: treeSha, parents: [parentSha] }
  });
  const sha = resp?.sha;
  if (!sha) throw new Error("Failed to create commit.");
  return sha;
}

async function updateRef({ token, repo, branch, newSha }) {
  const { owner, repo: name } = parseRepo(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(
    branch
  )}`;
  await ghFetch(url, { token, method: "PATCH", body: { sha: newSha, force: false } });
}

function extFromLang(lang) {
  const l = String(lang || "").toLowerCase();
  if (l.includes("python")) return "py";
  if (l.includes("javascript")) return "js";
  if (l.includes("typescript")) return "ts";
  if (l.includes("java")) return "java";
  if (l.includes("c++") || l.includes("cpp")) return "cpp";
  if (l === "c") return "c";
  if (l.includes("c#")) return "cs";
  if (l.includes("go")) return "go";
  if (l.includes("rust")) return "rs";
  if (l.includes("kotlin")) return "kt";
  if (l.includes("swift")) return "swift";
  if (l.includes("ruby")) return "rb";
  if (l.includes("php")) return "php";
  return "txt";
}

/** LeetCode GraphQL often returns memory as bytes, not MB. */
function memoryValueToMb(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= 50_000) return n / (1024 * 1024);
  return n;
}

function fmtMemMb(mb) {
  if (mb == null || !Number.isFinite(mb)) return null;
  if (mb >= 100) return `${Math.round(mb)} MB`;
  if (mb >= 10) return `${mb.toFixed(1)} MB`;
  return `${mb.toFixed(2)} MB`;
}

function fmtPct(p) {
  if (p == null || !Number.isFinite(Number(p))) return null;
  const x = Number(p);
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? `${r}%` : `${r}%`;
}

function formatPerfForCommit(submission) {
  const perf = submission?.performance || {};
  const rtBeats = fmtPct(perf.runtimeBeats);
  const rt =
    perf.runtimeMs != null
      ? `Time: ${perf.runtimeMs} ms${rtBeats ? ` (${rtBeats})` : ""}`
      : "";
  const memMb = memoryValueToMb(perf.memoryMb ?? perf.memory);
  const memBeats = fmtPct(perf.memoryBeats);
  const memStr = fmtMemMb(memMb);
  const mem = memStr
    ? `Memory: ${memStr}${memBeats ? ` (${memBeats})` : ""}`
    : "";
  const parts = [rt, mem].filter(Boolean);
  return parts.length ? `${parts.join(" | ")} - GitLeet` : "";
}

function makeReadme(submission) {
  const p = submission.problem || {};
  const perf = submission.performance || {};
  const lines = [];
  lines.push(`# ${p.title || p.slug || "LeetCode Problem"}`);
  if (p.url) lines.push(`\n- Link: ${p.url}`);
  if (p.difficulty) lines.push(`- Difficulty: ${p.difficulty}`);
  if (p.slug) lines.push(`- Slug: ${p.slug}`);
  if (submission.language) lines.push(`- Language: ${submission.language}`);

  // Store an offline-ish copy of the statement (HTML is supported in GitHub Markdown).
  if (p.descriptionHtml) {
    lines.push(`\n## Problem`); // keep it simple; LeetCode HTML contains headings, lists, code, images.
    lines.push(p.descriptionHtml);
  }

  lines.push(`\n## Complexity`);
  lines.push(`- Time: ${p.timeComplexity || "Not captured"}`);
  lines.push(`- Space: ${p.spaceComplexity || "Not captured"}`);

  const memMbReadme = memoryValueToMb(perf.memoryMb ?? perf.memory);
  const memLabel = fmtMemMb(memMbReadme);
  lines.push("\n## Performance");
  lines.push(`- Status: ${perf.status || submission.status || "unknown"}`);
  if (perf.runtimeMs != null) lines.push(`- Runtime: ${perf.runtimeMs} ms`);
  if (perf.runtimeBeats != null)
    lines.push(`- Runtime beats: ${fmtPct(perf.runtimeBeats) || perf.runtimeBeats}`);
  if (memLabel) lines.push(`- Memory: ${memLabel}`);
  if (perf.memoryBeats != null)
    lines.push(`- Memory beats: ${fmtPct(perf.memoryBeats) || perf.memoryBeats}`);
  lines.push(`\n## Last synced\n- ${new Date().toISOString()}`);
  return lines.join("\n");
}

async function fetchAssetBytes(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch asset: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function sanitizeAssetFilename(name) {
  const base = String(name || "").trim();
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "image.png";
}

export async function githubUpsertFiles({ token, repo, submission }) {
  const branch = await getDefaultBranch({ token, repo });
  const slug = submission.problem?.slug;
  if (!slug) throw new Error("Missing problem slug; cannot determine folder path.");
  const folder = `solutions/${slug}`;
  const ext = extFromLang(submission.language);
  const perfMsg = formatPerfForCommit(submission);

  const files = [];

  // Problem images (download and store in repo for offline viewing)
  const assets = Array.isArray(submission.problem?.assets) ? submission.problem.assets : [];
  const usedNames = new Set();
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i] || {};
    const url = String(a.url || "").trim();
    if (!url) continue;
    let filename = sanitizeAssetFilename(a.filename || `image-${i + 1}.png`);
    if (usedNames.has(filename)) {
      const dot = filename.lastIndexOf(".");
      const stem = dot > 0 ? filename.slice(0, dot) : filename;
      const extPart = dot > 0 ? filename.slice(dot) : "";
      filename = `${stem}-${i + 1}${extPart}`;
    }
    usedNames.add(filename);
    const bytes = await fetchAssetBytes(url);
    files.push({
      path: `${folder}/assets/${filename}`,
      contentBase64: b64EncodeBytes(bytes),
      message: `GitLeet: ${slug}`
    });
  }

  files.push(
    {
      // Match LeetSync-style naming: <problem-slug>.<ext> (supports multiple languages side-by-side)
      path: `${folder}/${slug}.${ext}`,
      content: submission.code || "",
      message: `GitLeet: ${slug}`
    },
    {
      path: `${folder}/README.md`,
      content: makeReadme(submission),
      message: `GitLeet: ${slug}`
    }
  );

  // Single commit for all files using the Git Data API.
  const headSha = await getRefSha({ token, repo, branch });
  const headCommit = await getCommit({ token, repo, sha: headSha });
  const baseTreeSha = headCommit?.tree?.sha;
  if (!baseTreeSha) throw new Error("Failed to resolve base tree sha.");

  const treeEntries = [];
  for (const f of files) {
    const contentBase64 = f.contentBase64 ? f.contentBase64 : b64EncodeUtf8(f.content);
    const blobSha = await createBlob({ token, repo, contentBase64 });
    treeEntries.push({
      path: f.path,
      mode: "100644",
      type: "blob",
      sha: blobSha
    });
  }

  const treeSha = await createTree({ token, repo, baseTreeSha, entries: treeEntries });
  const commitMessage = perfMsg ? perfMsg : `GitLeet: ${slug}`;
  const newCommitSha = await createCommit({
    token,
    repo,
    message: commitMessage,
    treeSha,
    parentSha: headSha
  });
  await updateRef({ token, repo, branch, newSha: newCommitSha });

  const { owner, repo: name } = parseRepo(repo);
  const commitUrl = `https://github.com/${owner}/${name}/commit/${newCommitSha}`;
  const folderUrl = `https://github.com/${owner}/${name}/tree/${encodeURIComponent(
    branch
  )}/${folder}`;

  return { commitUrl, folderUrl };
}

