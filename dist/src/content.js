function inject() {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("src/inject.js");
  s.type = "text/javascript";
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();
}

function isLeetCodeProblemPage() {
  return /^\/problems\/[^/]+/.test(location.pathname);
}

function getProblemSlugFromUrl() {
  const m =
    location.pathname.match(/^\/problems\/([^/]+)\//) ||
    location.pathname.match(/^\/problems\/([^/]+)$/);
  return m ? m[1] : "";
}

function getProblemUrl() {
  return `https://leetcode.com${location.pathname.replace(/\/+$/, "")}`;
}

const STORAGE_KEYS = {
  SETTINGS: "settings",
  LAST_SUBMISSION: "lastSubmission",
  CAPTURE_STATUS: "captureStatus"
};

async function getSettingsLocal() {
  const res = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS]);
  return (
    res[STORAGE_KEYS.SETTINGS] || {
      repo: "",
      token: "",
      autoPush: false,
      mcp: { mode: "bundled" }
    }
  );
}

async function setLastSubmissionLocal(sub) {
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SUBMISSION]: sub });
}

async function setCaptureStatus(status) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.CAPTURE_STATUS]: {
      ...(status || {}),
      updatedAt: Date.now()
    }
  });
}

async function shouldAutoPush() {
  const settings = await getSettingsLocal();
  return Boolean(settings.autoPush);
}

// ---- DOM-based capture (works when inject.js network hooks are blocked) ----
function getText(el) {
  if (!el) return "";
  return (el.textContent || "").trim();
}

function findCodeFromDOM() {
  // Monaco editor lines (submission detail view)
  const viewLines = document.querySelectorAll('[class*="view-line"]');
  if (viewLines.length > 5) {
    const code = Array.from(viewLines)
      .map((line) => getText(line))
      .join("\n");
    if (code.length > 20) return code;
  }
  // Pre/code blocks
  const pres = document.querySelectorAll("pre");
  for (const pre of pres) {
    const code = getText(pre);
    if (code.length > 20 && (code.includes("def ") || code.includes("function ") || code.includes("class ") || code.includes("public "))) return code;
  }
  const codeEls = document.querySelectorAll("code");
  for (const codeEl of codeEls) {
    const code = getText(codeEl);
    if (code.length > 50) return code;
  }
  // Generic code container
  const codeContainers = document.querySelectorAll('[class*="code"], [class*="Code"]');
  for (const el of codeContainers) {
    const code = getText(el);
    if (code.length > 30) return code;
  }
  return "";
}

function findStatusAndStats() {
  const body = getText(document.body);
  const accepted = /Accepted/i.test(body);
  let runtimeMs = null;
  let memoryMb = null;
  const runtimeMatch = body.match(/Runtime[:\s]*(\d+)\s*ms/i) || body.match(/(\d+)\s*ms/i);
  if (runtimeMatch) runtimeMs = parseInt(runtimeMatch[1], 10);
  const memoryMatch = body.match(/Memory[:\s]*([\d.]+)\s*MB/i) || body.match(/([\d.]+)\s*MB/i);
  if (memoryMatch) memoryMb = parseFloat(memoryMatch[1]);
  return { accepted, runtimeMs, memoryMb };
}

function findLanguageFromDOM() {
  const body = getText(document.body);
  if (/Python\s*3?/i.test(body)) return "python3";
  if (/JavaScript|Node\.js/i.test(body)) return "javascript";
  if (/TypeScript/i.test(body)) return "typescript";
  if (/Java\s*\d*/i.test(body)) return "java";
  if (/C\+\+/i.test(body)) return "cpp";
  if (/C\s*#/i.test(body)) return "csharp";
  if (/Go\s*lang/i.test(body)) return "go";
  if (/Rust/i.test(body)) return "rust";
  return "unknown";
}

function findProblemTitle() {
  const sel = document.querySelector('[data-cy="question-title"]') ||
    document.querySelector("h4.text-title-large") ||
    document.querySelector(".question-title");
  return sel ? getText(sel) : "";
}

let lastDomCaptureHash = "";

function tryDomCapture() {
  if (!isLeetCodeProblemPage()) return;
  const slug = getProblemSlugFromUrl();
  if (!slug) return;

  const code = findCodeFromDOM();
  const { accepted, runtimeMs, memoryMb } = findStatusAndStats();
  if (!accepted || !code || code.length < 10) return;

  const hash = slug + "|" + code.slice(0, 200);
  if (hash === lastDomCaptureHash) return;
  lastDomCaptureHash = hash;

  const title = findProblemTitle() || slug;
  const language = findLanguageFromDOM();

  const normalized = {
    problem: {
      slug,
      title,
      url: getProblemUrl()
    },
    code,
    language,
    status: "Accepted",
    performance: {
      status: "Accepted",
      runtimeMs: runtimeMs ?? undefined,
      memoryMb: memoryMb ?? undefined
    },
    capturedAt: Date.now()
  };

  setLastSubmissionLocal(normalized);
  setCaptureStatus({
    phase: "captured",
    problemSlug: slug,
    problemTitle: title,
    message: "Submission captured from page."
  });

  shouldAutoPush().then((auto) => {
    if (auto) chrome.runtime.sendMessage({ action: "PUSH_LAST", payload: {} });
  });
}

function startDomObserver() {
  if (!isLeetCodeProblemPage()) return;
  const run = () => {
    try {
      tryDomCapture();
    } catch (e) {
      // ignore
    }
  };
  run();
  setInterval(run, 2000);
  const observer = new MutationObserver(() => run());
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
}

// ---- Message handling (network capture from inject.js) ----
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.__gitleet__ !== true) return;

  if (data.type === "HOOK_INSTALLED") {
    await setCaptureStatus({
      phase: "hook_installed",
      message: "GitLeet capture hooks installed."
    });
    return;
  }

  if (data.type === "SUBMISSION_CAPTURED") {
    try {
      const { normalizeCaptured } = await import(
        chrome.runtime.getURL("src/schemaAdapter.js")
      );
      const normalized = await normalizeCaptured(data.payload);

      if (isLeetCodeProblemPage()) {
        normalized.problem = normalized.problem || {};
        normalized.problem.slug =
          normalized.problem.slug || getProblemSlugFromUrl();
        normalized.problem.url = normalized.problem.url || getProblemUrl();
      }

      if (normalized?.code && normalized?.problem?.slug) {
        normalized.capturedAt = Date.now();
        await setLastSubmissionLocal(normalized);
        await setCaptureStatus({
          phase: "captured",
          problemSlug: normalized.problem.slug,
          problemTitle: normalized.problem.title || normalized.problem.slug,
          message: "Submission captured successfully."
        });

        const auto = await shouldAutoPush();
        const accepted =
          String(normalized?.status || normalized?.performance?.status || "")
            .toLowerCase()
            .includes("accepted");
        if (auto && accepted) {
          chrome.runtime.sendMessage({ action: "PUSH_LAST", payload: {} });
        }
      } else {
        await setCaptureStatus({
          phase: "capture_failed",
          problemSlug: normalized?.problem?.slug || "",
          problemTitle: normalized?.problem?.title || "",
          message: "Submission normalization did not yield code + slug."
        });
      }
    } catch (e) {
      await setCaptureStatus({
        phase: "capture_failed",
        message: `Submission capture failed: ${String(e?.message || e)}`
      });
    }
  }
});

inject();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startDomObserver);
} else {
  startDomObserver();
}
