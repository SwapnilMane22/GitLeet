import { setLastSubmission, getSettings } from "./storage.js";

function inject() {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("src/inject.js");
  s.type = "text/javascript";
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();
}

function isLeetCodeProblemPage() {
  return /^\/problems\/[^/]+\/?/.test(location.pathname);
}

function getProblemSlugFromUrl() {
  const m = location.pathname.match(/^\/problems\/([^/]+)\/?/);
  return m ? m[1] : "";
}

function getProblemUrl() {
  return `https://leetcode.com${location.pathname.replace(/\/+$/, "")}`;
}

async function shouldAutoPush() {
  const settings = await getSettings();
  return Boolean(settings.autoPush);
}

window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.__gitleet__ !== true) return;

  // We accept payloads from injected script; normalize with schemaAdapter.
  if (data.type === "SUBMISSION_CAPTURED") {
    try {
      const { normalizeCaptured } = await import(chrome.runtime.getURL("src/schemaAdapter.js"));
      const normalized = await normalizeCaptured(data.payload);

      // Enrich with problem URL/slug if missing.
      if (isLeetCodeProblemPage()) {
        normalized.problem = normalized.problem || {};
        normalized.problem.slug = normalized.problem.slug || getProblemSlugFromUrl();
        normalized.problem.url = normalized.problem.url || getProblemUrl();
      }

      // Only store if we have code and at least a slug.
      if (normalized?.code && normalized?.problem?.slug) {
        normalized.capturedAt = Date.now();
        await setLastSubmission(normalized);

        const auto = await shouldAutoPush();
        const accepted =
          String(normalized?.status || normalized?.performance?.status || "")
            .toLowerCase()
            .includes("accepted");
        if (auto && accepted) {
          chrome.runtime.sendMessage({ action: "PUSH_LAST", payload: {} });
        }
      }
    } catch {
      // ignore
    }
  }
});

inject();

