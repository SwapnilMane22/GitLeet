const KEYS = {
  SETTINGS: "settings",
  LAST_SUBMISSION: "lastSubmission",
  RECENT_SYNCS: "recentSyncs"
};

export async function getSettings() {
  const res = await chrome.storage.local.get([KEYS.SETTINGS]);
  return (
    res[KEYS.SETTINGS] || {
      repo: "",
      token: "",
      autoPush: false,
      mcp: { mode: "bundled" }
    }
  );
}

export async function setSettings(settings) {
  await chrome.storage.local.set({ [KEYS.SETTINGS]: settings });
}

export async function getLastSubmission() {
  const res = await chrome.storage.local.get([KEYS.LAST_SUBMISSION]);
  return res[KEYS.LAST_SUBMISSION] || null;
}

export async function setLastSubmission(sub) {
  await chrome.storage.local.set({ [KEYS.LAST_SUBMISSION]: sub });
}

export async function clearLastSubmission() {
  await chrome.storage.local.remove([KEYS.LAST_SUBMISSION]);
}

export async function getRecentSyncs() {
  const res = await chrome.storage.local.get([KEYS.RECENT_SYNCS]);
  return res[KEYS.RECENT_SYNCS] || [];
}

export async function addRecentSync(entry) {
  const recent = await getRecentSyncs();
  const next = [entry, ...recent].slice(0, 3);
  await chrome.storage.local.set({ [KEYS.RECENT_SYNCS]: next });
  return next;
}

