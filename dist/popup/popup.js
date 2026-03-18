const statusEl = document.getElementById("status");
const linkedPillEl = document.getElementById("linkedPill");
const openOptionsBtn = document.getElementById("openOptionsBtn");
const errEl = document.getElementById("err");
const recentListEl = document.getElementById("recentList");
const recentEmptyEl = document.getElementById("recentEmpty");
const captureProblemEl = document.getElementById("captureProblem");
const captureStatusTextEl = document.getElementById("captureStatusText");
const captureMessageEl = document.getElementById("captureMessage");
const syncNowBtn = document.getElementById("syncNowBtn");
const autoPushToggle = document.getElementById("autoPushToggle");
const syncHintEl = document.getElementById("syncHint");

function setError(message) {
  if (!message) {
    errEl.style.display = "none";
    errEl.textContent = "";
    return;
  }
  errEl.style.display = "block";
  errEl.textContent = message;
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

    const status = document.createElement("span");
    status.className =
      "status-pill " +
      (item.status === "failed"
        ? "status-pill-failed"
        : item.status === "synced"
        ? "status-pill-synced"
        : "status-pill-pending");
    status.textContent =
      item.status === "failed"
        ? "Failed"
        : item.status === "synced"
        ? "Synced"
        : "Pending";

    li.appendChild(left);
    li.appendChild(right);
    li.appendChild(status);
    recentListEl.appendChild(li);
  }
}

function updateCaptureStatus(captureStatus) {
  const problem =
    captureStatus?.problemTitle ||
    captureStatus?.problemSlug ||
    (captureStatus?.phase === "idle" ? "Not on a problem page" : "(no problem yet)");
  const message = captureStatus?.message || "";
  captureProblemEl.textContent = problem;

  captureStatusTextEl.className = "status-pill ";
  if (captureStatus?.phase === "captured") {
    captureStatusTextEl.classList.add("status-pill-synced");
    captureStatusTextEl.textContent = "Captured";
  } else if (captureStatus?.phase === "ready") {
    captureStatusTextEl.classList.add("status-pill-pending");
    captureStatusTextEl.textContent = "Ready";
  } else if (captureStatus?.phase === "enriching") {
    captureStatusTextEl.classList.add("status-pill-pending");
    captureStatusTextEl.textContent = "Fetching details…";
  } else if (captureStatus?.phase === "enrich_failed") {
    captureStatusTextEl.classList.add("status-pill-failed");
    captureStatusTextEl.textContent = "Details fetch failed";
  } else if (captureStatus?.phase === "not_accepted") {
    captureStatusTextEl.classList.add("status-pill-failed");
    captureStatusTextEl.textContent = "Not accepted";
  } else if (captureStatus?.phase === "capture_failed") {
    captureStatusTextEl.classList.add("status-pill-failed");
    captureStatusTextEl.textContent = "Submission capturing failed";
  } else if (captureStatus?.phase === "waiting_submission") {
    captureStatusTextEl.classList.add("status-pill-pending");
    captureStatusTextEl.textContent = "Waiting for result…";
  } else {
    captureStatusTextEl.classList.add("status-pill-pending");
    captureStatusTextEl.textContent = "Waiting for capture…";
  }
  captureMessageEl.textContent = message;
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
    updateCaptureStatus({ phase: "capture_failed", message: "Could not load status." });
    renderRecent([]);
    return;
  }

  const linked = Boolean(res.data?.linked);
  linkedPillEl.style.display = linked ? "inline-block" : "none";
  if (!linked) {
    statusEl.textContent = "Not linked. Open Options to configure.";
  } else if (res.data?.hasLastSubmission) {
    statusEl.textContent = `Linked to ${res.data.repo} • last submission captured`;
  } else {
    statusEl.textContent = `Linked to ${res.data.repo} • submit on LeetCode to capture`;
  }
  updateCaptureStatus(res.data?.captureStatus || null);
  const autoPush = Boolean(res.data?.autoPush);
  if (autoPushToggle) autoPushToggle.checked = autoPush;
  const canManualSync =
    linked && Boolean(res.data?.hasLastSubmission) && !autoPush;
  if (syncNowBtn) {
    syncNowBtn.disabled = !canManualSync;
    syncNowBtn.title = autoPush
      ? "Auto-push is on — submissions sync after Accepted capture."
      : !linked
      ? "Configure repo and token in Options."
      : !res.data?.hasLastSubmission
      ? "Submit an Accepted solution on LeetCode first."
      : "";
  }
  if (syncHintEl) {
    if (linked && autoPush) {
      syncHintEl.style.display = "block";
      syncHintEl.textContent =
        "Auto-push is on: Accepted submissions sync to GitHub automatically. Turn it off to use Sync now.";
    } else if (linked && !autoPush && res.data?.hasLastSubmission) {
      syncHintEl.style.display = "block";
      syncHintEl.textContent =
        "Sync now pushes the last captured Accepted submission.";
    } else {
      syncHintEl.style.display = "none";
      syncHintEl.textContent = "";
    }
  }
  renderRecent(res.data?.recentSyncs || []);
}

openOptionsBtn.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
});

if (autoPushToggle) {
  autoPushToggle.addEventListener("change", async () => {
    const on = Boolean(autoPushToggle.checked);
    await send("SET_AUTO_PUSH", { autoPush: on });
    await refresh();
  });
}

if (syncNowBtn) {
  syncNowBtn.addEventListener("click", async () => {
    setError("");
    syncNowBtn.disabled = true;
    try {
      const res = await send("PUSH_LAST");
      if (!res?.ok) setError(res?.error || "Sync failed.");
    } finally {
      await refresh();
    }
  });
}

refresh().catch((e) => {
  statusEl.textContent = "Error";
  setError(String(e?.message || e));
});

// Refresh status every minute while popup is open
setInterval(() => refresh().catch(() => {}), 60 * 1000);
