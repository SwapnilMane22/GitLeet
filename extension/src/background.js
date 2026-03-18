import {
  addRecentSync,
  clearLastSubmission,
  getCaptureStatus,
  getLastSubmission,
  getRecentSyncs,
  getSettings,
  setSettings
} from "./storage.js";
import { githubGetRepo, githubGetUser, githubUpsertFiles } from "./github.js";

function maskToken(token) {
  if (!token) return "";
  return token.slice(0, 4) + "…" + token.slice(-4);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const { action, payload } = msg || {};
      if (action === "FETCH_SCHEMA_MAPPING") {
        const settings = await getSettings();
        const mcp = settings.mcp || {};
        if (mcp.mode === "remote" && mcp.endpoint) {
          const r = await fetch(String(mcp.endpoint).trim(), { cache: "no-store" });
          if (!r.ok) {
            sendResponse({
              ok: false,
              error: `MCP schema fetch failed: ${r.status}. For http://127.0.0.1 enable site access for the extension or use bundled mapping.`
            });
            return;
          }
          sendResponse({ ok: true, data: await r.json() });
          return;
        }
        const url = chrome.runtime.getURL("src/schemaMapping.json");
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) {
          sendResponse({ ok: false, error: "Bundled schema mapping missing" });
          return;
        }
        sendResponse({ ok: true, data: await r.json() });
        return;
      }

      if (action === "GET_STATUS") {
        const settings = await getSettings();
        const last = await getLastSubmission();
        const captureStatus = await getCaptureStatus();
        const recent = await getRecentSyncs();
        sendResponse({
          ok: true,
          data: {
            linked: Boolean(settings.repo && settings.token),
            repo: settings.repo || "",
            autoPush: Boolean(settings.autoPush),
            uiTheme: settings.uiTheme === "dark" ? "dark" : "light",
            tokenMasked: Boolean(settings.token),
            mcpEndpoint: settings.mcp?.endpoint || "",
            hasLastSubmission: Boolean(last),
            captureStatus,
            recentSyncs: recent
          }
        });
        return;
      }

      if (action === "SAVE_SETTINGS") {
        const settings = await getSettings();
        const repo = String(payload?.repo || "").trim();
        const token = String(payload?.token || "").trim();
        const autoPush = Boolean(payload?.autoPush);
        const mcpEndpoint = String(payload?.mcpEndpoint || "").trim();
        const uiTheme = payload?.uiTheme === "dark" ? "dark" : "light";
        const next = {
          ...settings,
          repo,
          autoPush,
          uiTheme: payload?.uiTheme !== undefined ? uiTheme : settings.uiTheme || "light",
          token: token || settings.token, // allow save without retyping
          mcp: {
            ...(settings.mcp || {}),
            mode: mcpEndpoint ? "remote" : "bundled",
            endpoint: mcpEndpoint
          }
        };
        await setSettings(next);
        sendResponse({ ok: true, data: { repo, autoPush, tokenMasked: maskToken(next.token) } });
        return;
      }

      if (action === "SET_AUTO_PUSH") {
        const settings = await getSettings();
        await setSettings({
          ...settings,
          autoPush: Boolean(payload?.autoPush)
        });
        sendResponse({ ok: true });
        return;
      }

      if (action === "SET_UI_THEME") {
        const settings = await getSettings();
        const uiTheme = payload?.theme === "dark" ? "dark" : "light";
        await setSettings({ ...settings, uiTheme });
        sendResponse({ ok: true });
        return;
      }

      if (action === "CLEAR_TOKEN") {
        const settings = await getSettings();
        await setSettings({ ...settings, token: "" });
        sendResponse({ ok: true });
        return;
      }

      if (action === "TEST_GITHUB") {
        const repoInput = String(payload?.repo || "").trim();
        const tokenInput = String(payload?.token || "").trim();
        const settings = await getSettings();
        const repo = repoInput || settings.repo;
        const token = tokenInput || settings.token;
        if (!repo || !token) throw new Error("Repo and token are required.");
        const user = await githubGetUser({ token });
        const repoInfo = await githubGetRepo({ token, repo });
        sendResponse({ ok: true, data: { login: user.login, full_name: repoInfo.full_name } });
        return;
      }

      if (action === "PUSH_LAST") {
        const settings = await getSettings();
        if (!settings.repo || !settings.token) throw new Error("Configure repo and token in Options.");
        const last = await getLastSubmission();
        if (!last) throw new Error("No captured submission to push yet. Submit on LeetCode first.");

        try {
          const result = await githubUpsertFiles({
            token: settings.token,
            repo: settings.repo,
            submission: last
          });

          // Clear local solution after successful upload (keep only recent sync metadata)
          await clearLastSubmission();
          const recent = await addRecentSync({
            slug: last.problem?.slug || "",
            title: last.problem?.title || last.problem?.slug || "",
            timestamp: Date.now(),
            status: "synced",
            error: "",
            commitUrl: result.commitUrl || "",
            folderUrl: result.folderUrl || ""
          });

          sendResponse({ ok: true, data: { recent } });
          return;
        } catch (e) {
          const msg = String(e?.message || e);
          await addRecentSync({
            slug: last.problem?.slug || "",
            title: last.problem?.title || last.problem?.slug || "",
            timestamp: Date.now(),
            status: "failed",
            error: msg,
            commitUrl: "",
            folderUrl: ""
          });
          sendResponse({ ok: false, error: msg });
          return;
        }
      }

      sendResponse({ ok: false, error: `Unknown action: ${action}` });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

