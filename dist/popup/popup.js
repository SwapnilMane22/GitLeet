const statusEl = document.getElementById("status");
const linkedPillEl = document.getElementById("linkedPill");
const pushBtn = document.getElementById("pushBtn");
const openOptionsBtn = document.getElementById("openOptionsBtn");
const msgEl = document.getElementById("msg");
const errEl = document.getElementById("err");
const recentListEl = document.getElementById("recentList");
const recentEmptyEl = document.getElementById("recentEmpty");

function setError(message) {
  if (!message) {
    errEl.style.display = "none";
    errEl.textContent = "";
    return;
  }
  errEl.style.display = "block";
  errEl.textContent = message;
}

function setMsg(message) {
  msgEl.textContent = message || "";
}

function fmtTs(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function renderRecent(recent) {
  recentListEl.innerHTML = "";
  if (!recent || recent.length === 0) {
    recentEmptyEl.style.display = "block";
    return;
  }
  recentEmptyEl.style.display = "none";
  for (const item of recent.slice(0, 3)) {
    const li = document.createElement("li");
    const left = document.createElement("div");
    const title = document.createElement("div");
    title.style.fontSize = "12px";
    title.style.fontWeight = "600";
    title.textContent = item.title || item.slug || "(unknown)";
    const sub = document.createElement("div");
    sub.className = "muted";
    sub.textContent = fmtTs(item.timestamp);
    left.appendChild(title);
    left.appendChild(sub);

    const right = document.createElement("div");
    if (item.commitUrl) {
      const a = document.createElement("a");
      a.href = item.commitUrl;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = "Commit";
      right.appendChild(a);
    } else if (item.folderUrl) {
      const a = document.createElement("a");
      a.href = item.folderUrl;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = "Folder";
      right.appendChild(a);
    } else {
      right.className = "muted";
      right.textContent = item.slug ? item.slug : "";
    }

    li.appendChild(left);
    li.appendChild(right);
    recentListEl.appendChild(li);
  }
}

async function send(action, payload = {}) {
  return await chrome.runtime.sendMessage({ action, payload });
}

async function refresh() {
  setError("");
  const res = await send("GET_STATUS");
  if (!res?.ok) {
    statusEl.textContent = "Error";
    setError(res?.error || "Failed to load status.");
    linkedPillEl.style.display = "none";
    pushBtn.disabled = true;
    renderRecent([]);
    return;
  }

  const linked = Boolean(res.data?.linked);
  linkedPillEl.style.display = linked ? "inline-block" : "none";
  statusEl.textContent = linked
    ? `Linked to ${res.data.repo}`
    : "Not linked. Open Options to configure.";
  pushBtn.disabled = !linked;
  renderRecent(res.data?.recentSyncs || []);
}

openOptionsBtn.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
});

pushBtn.addEventListener("click", async () => {
  setMsg("Pushing…");
  setError("");
  pushBtn.disabled = true;
  try {
    const res = await send("PUSH_LAST");
    if (!res?.ok) {
      setMsg("");
      setError(res?.error || "Push failed.");
    } else {
      setMsg("Pushed successfully.");
    }
  } finally {
    await refresh();
  }
});

refresh().catch((e) => {
  statusEl.textContent = "Error";
  setError(String(e?.message || e));
});

