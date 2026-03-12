function b64EncodeUtf8(str) {
  // MV3 service worker environment supports btoa; ensure UTF-8.
  const utf8 = new TextEncoder().encode(str);
  let binary = "";
  for (const b of utf8) binary += String.fromCharCode(b);
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

async function getContentIfExists({ token, repo, path, branch }) {
  const { owner, repo: name } = parseRepo(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(
    path
  )}?ref=${encodeURIComponent(branch)}`;
  try {
    return await ghFetch(url, { token });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("Not Found")) return null;
    throw e;
  }
}

async function putFile({ token, repo, path, branch, message, content, sha }) {
  const { owner, repo: name } = parseRepo(repo);
  const url = `https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(
    path
  )}`;
  return await ghFetch(url, {
    token,
    method: "PUT",
    body: {
      message,
      content,
      branch,
      ...(sha ? { sha } : {})
    }
  });
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

function makeReadme(submission) {
  const p = submission.problem || {};
  const perf = submission.performance || {};
  const lines = [];
  lines.push(`# ${p.title || p.slug || "LeetCode Problem"}`);
  if (p.url) lines.push(`\n- Link: ${p.url}`);
  if (p.difficulty) lines.push(`- Difficulty: ${p.difficulty}`);
  if (p.slug) lines.push(`- Slug: ${p.slug}`);
  if (submission.language) lines.push(`- Language: ${submission.language}`);
  lines.push("\n## Performance");
  lines.push(`- Status: ${perf.status || submission.status || "unknown"}`);
  if (perf.runtimeMs != null) lines.push(`- Runtime: ${perf.runtimeMs} ms`);
  if (perf.runtimeBeats != null) lines.push(`- Runtime beats: ${perf.runtimeBeats}%`);
  if (perf.memoryMb != null) lines.push(`- Memory: ${perf.memoryMb} MB`);
  if (perf.memoryBeats != null) lines.push(`- Memory beats: ${perf.memoryBeats}%`);
  lines.push(`\n## Last synced\n- ${new Date().toISOString()}`);
  return lines.join("\n");
}

export async function githubUpsertFiles({ token, repo, submission }) {
  const branch = await getDefaultBranch({ token, repo });
  const slug = submission.problem?.slug;
  if (!slug) throw new Error("Missing problem slug; cannot determine folder path.");
  const folder = `solutions/${slug}`;
  const ext = extFromLang(submission.language);

  const files = [
    {
      path: `${folder}/solution.${ext}`,
      content: submission.code || "",
      message: `GitLeet: ${slug} (solution)`
    },
    {
      path: `${folder}/README.md`,
      content: makeReadme(submission),
      message: `GitLeet: ${slug} (metadata)`
    }
  ];

  let lastCommitUrl = "";
  for (const f of files) {
    const existing = await getContentIfExists({ token, repo, path: f.path, branch });
    const sha = existing?.sha;
    const resp = await putFile({
      token,
      repo,
      path: f.path,
      branch,
      message: f.message,
      content: b64EncodeUtf8(f.content),
      sha
    });
    lastCommitUrl = resp?.commit?.html_url || lastCommitUrl;
  }

  const { owner, repo: name } = parseRepo(repo);
  const folderUrl = `https://github.com/${owner}/${name}/tree/${encodeURIComponent(
    branch
  )}/${folder}`;

  return { commitUrl: lastCommitUrl, folderUrl };
}

