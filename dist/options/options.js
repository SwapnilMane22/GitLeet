const repoEl = document.getElementById("repo");
const tokenEl = document.getElementById("token");
const autoPushEl = document.getElementById("autoPush");
const mcpEndpointEl = document.getElementById("mcpEndpoint");
const saveBtn = document.getElementById("saveBtn");
const testBtn = document.getElementById("testBtn");
const clearBtn = document.getElementById("clearBtn");
const msgEl = document.getElementById("msg");
const errEl = document.getElementById("err");
const themeLightBtn = document.getElementById("themeLight");
const themeDarkBtn = document.getElementById("themeDark");

let currentTheme = "light";

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", currentTheme);
  if (themeLightBtn && themeDarkBtn) {
    themeLightBtn.classList.toggle("active", currentTheme === "light");
    themeDarkBtn.classList.toggle("active", currentTheme === "dark");
  }
}

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

async function send(action, payload = {}) {
  return await chrome.runtime.sendMessage({ action, payload });
}

async function load() {
  const res = await send("GET_STATUS");
  if (!res?.ok) throw new Error(res?.error || "Failed to load settings");
  repoEl.value = res.data?.repo || "";
  tokenEl.value = "";
  autoPushEl.checked = Boolean(res.data?.autoPush);
  mcpEndpointEl.value = res.data?.mcpEndpoint || "";
  applyTheme(res.data?.uiTheme || "light");
}

async function persistTheme(theme) {
  applyTheme(theme);
  await send("SET_UI_THEME", { theme });
}

themeLightBtn?.addEventListener("click", () => persistTheme("light"));
themeDarkBtn?.addEventListener("click", () => persistTheme("dark"));

saveBtn.addEventListener("click", async () => {
  setError("");
  setMsg("Saving…");
  const repo = repoEl.value.trim();
  const token = tokenEl.value.trim();
  const autoPush = Boolean(autoPushEl.checked);
  const mcpEndpoint = mcpEndpointEl.value.trim();
  const res = await send("SAVE_SETTINGS", {
    repo,
    token,
    autoPush,
    mcpEndpoint,
    uiTheme: currentTheme
  });
  if (!res?.ok) {
    setMsg("");
    setError(res?.error || "Failed to save");
    return;
  }
  setMsg("Saved.");
});

testBtn.addEventListener("click", async () => {
  setError("");
  setMsg("Testing…");
  const repo = repoEl.value.trim();
  const token = tokenEl.value.trim();
  const res = await send("TEST_GITHUB", { repo, token });
  if (!res?.ok) {
    setMsg("");
    setError(res?.error || "Test failed");
    return;
  }
  setMsg(`OK. Authenticated as ${res.data.login}. Repo: ${res.data.full_name}`);
});

clearBtn.addEventListener("click", async () => {
  setError("");
  setMsg("Clearing…");
  const res = await send("CLEAR_TOKEN");
  if (!res?.ok) {
    setMsg("");
    setError(res?.error || "Failed to clear");
    return;
  }
  tokenEl.value = "";
  setMsg("Token cleared.");
});

load().catch((e) => {
  setError(String(e?.message || e));
});
