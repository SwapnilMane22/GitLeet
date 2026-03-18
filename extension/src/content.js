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

// ---- JSON-based capture only ----
let lastSubmitIntentAt = 0;
const SUBMIT_INTENT_WINDOW_MS = 3 * 60 * 1000;

function withinSubmitIntentWindow() {
  return lastSubmitIntentAt && Date.now() - lastSubmitIntentAt < SUBMIT_INTENT_WINDOW_MS;
}

function setSubmitIntentNow() {
  lastSubmitIntentAt = Date.now();
}

function getCookie(name) {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function absolutizeUrl(url) {
  try {
    return new URL(url, location.origin).toString();
  } catch {
    return url || "";
  }
}

function slugifyAssetName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getExtensionFromUrl(url) {
  const u = String(url || "");
  const m = u.match(/\.([a-zA-Z0-9]{2,5})(?:\?|#|$)/);
  if (!m) return "png";
  const ext = m[1].toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext))
    return ext === "jpeg" ? "jpg" : ext;
  return "png";
}

function extractAssetsFromHtml({ slug, html }) {
  const assets = [];
  if (!html) return { html: "", assets };

  let out = String(html);
  const seen = new Set();
  let idx = 1;
  const imgRe = /<img\b([^>]*?)>/gi;
  out = out.replace(imgRe, (full, attrs) => {
    const srcMatch = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!srcMatch) return full;
    const srcAbs = absolutizeUrl(srcMatch[1]);
    if (!srcAbs) return full;

    const altMatch = attrs.match(/\balt\s*=\s*["']([^"']+)["']/i);
    const alt = altMatch ? altMatch[1] : `image-${idx}`;
    const ext = getExtensionFromUrl(srcAbs);
    let filename = `${slugifyAssetName(alt) || `image-${idx}`}.${ext}`;
    while (seen.has(filename)) filename = `${slug}-image-${idx++}.${ext}`;
    seen.add(filename);
    assets.push({ url: srcAbs, filename });
    idx += 1;

    const nextAttrs = attrs.replace(srcMatch[0], `src="./assets/${filename}"`);
    return `<img${nextAttrs}>`;
  });

  return { html: out, assets };
}

async function leetGraphQL({ query, variables, operationName }) {
  const csrf = getCookie("csrftoken");
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(csrf ? { "x-csrftoken": csrf } : {}),
      // LeetCode sometimes checks these:
      "x-requested-with": "XMLHttpRequest"
    },
    body: JSON.stringify({ query, variables, operationName })
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`LeetCode GraphQL failed: ${res.status}`);
  }
  if (json?.errors?.length) {
    throw new Error(`LeetCode GraphQL errors: ${json.errors[0]?.message || "unknown"}`);
  }
  return json;
}

function getSubmissionIdFromUrl() {
  const m = location.pathname.match(/\/submissions\/(\d+)/);
  return m ? m[1] : "";
}

const SUBMISSION_DETAILS_QUERY = `query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    statusDisplay
    runtime
    runtimePercentile
    memory
    memoryPercentile
  }
}`;

/** Submit API often returns PENDING with no status_msg; poll until judged. */
async function pollSubmissionDetailsGraphQL(submissionIdInt) {
  const pendingRe =
    /^(pending|judging|queued|started|waiting|processing|submitting)$/i;
  let lastResp = null;
  for (let i = 0; i < 70; i++) {
    const resp = await leetGraphQL({
      operationName: "submissionDetails",
      query: SUBMISSION_DETAILS_QUERY,
      variables: { submissionId: submissionIdInt }
    });
    lastResp = resp;
    const st = String(resp?.data?.submissionDetails?.statusDisplay || "").trim();
    if (st && !pendingRe.test(st)) return resp;
    await new Promise((r) => setTimeout(r, 450));
  }
  return lastResp;
}

function isLeetCodeAccepted(normalized) {
  const s = String(
    normalized?.status || normalized?.performance?.status || ""
  ).toLowerCase();
  if (s.includes("accepted")) return true;
  if (s === "ac" || s === "success") return true;
  const raw = normalized?.raw?.captured?.response;
  if (!raw || typeof raw !== "object") return false;
  const state = String(raw.state || raw.data?.state || "").toUpperCase();
  if (state === "ACCEPTED" || state === "SUCCESS") return true;
  const msg = String(raw.status_msg || raw.statusMsg || "").toLowerCase();
  if (msg.includes("accepted")) return true;
  return false;
}

async function enrichSubmissionViaGraphQL({ slug, submissionId }) {
  // 1) Question content (statement HTML)
  const questionResp = await leetGraphQL({
    operationName: "questionData",
    query: `query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        title
        content
        difficulty
        titleSlug
      }
    }`,
    variables: { titleSlug: slug }
  });

  // 2) Submission details — poll until LeetCode finishes judging (~30s max)
  let submissionDetailsResp = null;
  const sid = submissionId ? Number(submissionId) : NaN;
  if (Number.isFinite(sid)) {
    submissionDetailsResp = await pollSubmissionDetailsGraphQL(sid);
  }

  const { normalizeGraphQlEnrichment } = await import(
    chrome.runtime.getURL("src/schemaAdapter.js")
  );
  return await normalizeGraphQlEnrichment({
    questionResp,
    submissionDetailsResp
  });
}

function installSubmitIntentListener() {
  window.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const btn = t.closest('button,[role="button"]');
      if (!btn) return;
      const label = (btn.textContent || "").trim().toLowerCase();
      if (!label) return;
      // Only treat explicit Submit as intent (avoid Run).
      if (label === "submit" || label.includes("submit")) {
        setSubmitIntentNow();
        const slug = getProblemSlugFromUrl();
        setCaptureStatus({
          phase: "waiting_submission",
          problemSlug: slug,
          problemTitle: slug,
          message: "Waiting for Accepted result to appear…"
        });
      }
    },
    true
  );
}

function updateIdleStatusIfNeeded() {
  if (!isLeetCodeProblemPage()) {
    setCaptureStatus({
      phase: "idle",
      message: "Open a LeetCode problem page to start capture."
    });
    return;
  }
  const slug = getProblemSlugFromUrl();
  if (!slug) return;
  setCaptureStatus({
    phase: "ready",
    problemSlug: slug,
    problemTitle: slug,
    message: "Ready. Click Submit to capture the submission JSON."
  });
}

function installSpaNavigationListener() {
  const notify = () => updateIdleStatusIfNeeded();

  window.addEventListener("popstate", notify);

  const origPush = history.pushState;
  history.pushState = function () {
    const r = origPush.apply(this, arguments);
    notify();
    return r;
  };
  const origReplace = history.replaceState;
  history.replaceState = function () {
    const r = origReplace.apply(this, arguments);
    notify();
    return r;
  };
}

// ---- Message handling (network capture from inject.js) ----
window.addEventListener("message", async (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.__gitleet__ !== true) return;

  if (data.type === "SUBMIT_INTENT") {
    setSubmitIntentNow();
    const slug = getProblemSlugFromUrl();
    await setCaptureStatus({
      phase: "waiting_submission",
      problemSlug: slug,
      problemTitle: slug,
      message: "Submitting… waiting for results."
    });
    return;
  }

  if (data.type === "HOOK_INSTALLED") {
    await setCaptureStatus({
      phase: "hook_installed",
      problemSlug: isLeetCodeProblemPage() ? getProblemSlugFromUrl() : "",
      problemTitle: isLeetCodeProblemPage() ? getProblemSlugFromUrl() : "",
      message: isLeetCodeProblemPage()
        ? "GitLeet capture hooks installed."
        : "Open a LeetCode problem to start capture."
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
        // Avoid background/old payloads causing commits without explicit submission intent.
        // Intent is set by either:
        // - clicking the Submit button (UI listener), or
        // - observing a /submit request in the injected network hook (SUBMIT_INTENT)
        if (!withinSubmitIntentWindow()) return;
        normalized.capturedAt = Date.now();
        if (!normalized.submissionId) {
          const fromUrl = getSubmissionIdFromUrl();
          if (fromUrl) normalized.submissionId = fromUrl;
        }
        // Enrich via official LeetCode GraphQL (JSON-based, no DOM scraping)
        try {
          await setCaptureStatus({
            phase: "enriching",
            problemSlug: normalized.problem.slug,
            problemTitle: normalized.problem.title || normalized.problem.slug,
            message: "Fetching full problem + submission details…"
          });

          const enrichment = await enrichSubmissionViaGraphQL({
            slug: normalized.problem.slug,
            submissionId: normalized.submissionId
          });

          const descriptionRaw = enrichment?.problem?.descriptionHtml || "";
          const extracted = extractAssetsFromHtml({
            slug: normalized.problem.slug,
            html: descriptionRaw
          });

          normalized.problem.title =
            enrichment?.problem?.title || normalized.problem.title || normalized.problem.slug;
          normalized.problem.difficulty =
            enrichment?.problem?.difficulty || normalized.problem.difficulty || "";
          normalized.problem.descriptionHtml = extracted.html || "";
          normalized.problem.assets = extracted.assets || [];

          normalized.performance = {
            ...(normalized.performance || {}),
            ...(enrichment?.performance || {})
          };
          if (!normalized.status && enrichment?.performance?.status) {
            normalized.status = enrichment.performance.status;
          }
        } catch (e) {
          // Enrichment failure shouldn't block a successful JSON capture.
          await setCaptureStatus({
            phase: "enrich_failed",
            problemSlug: normalized.problem.slug,
            problemTitle: normalized.problem.title || normalized.problem.slug,
            message: `Enrichment failed: ${String(e?.message || e)}`
          });
        }

        const auto = await shouldAutoPush();
        const accepted = isLeetCodeAccepted(normalized);
        if (!accepted) {
          const reason =
            normalized?.performance?.status ||
            normalized?.status ||
            (normalized?.raw?.captured?.response?.state
              ? String(normalized.raw.captured.response.state)
              : "") ||
            "Still judging or status unavailable — try Sync now from submission page.";
          await setCaptureStatus({
            phase: "not_accepted",
            problemSlug: normalized.problem.slug,
            problemTitle: normalized.problem.title || normalized.problem.slug,
            message: `Not accepted: ${reason}`
          });
          return;
        }

        // Only persist & push for Accepted submissions.
        await setLastSubmissionLocal(normalized);
        await setCaptureStatus({
          phase: "captured",
          problemSlug: normalized.problem.slug,
          problemTitle: normalized.problem.title || normalized.problem.slug,
          message: "Accepted. Ready to push."
        });
        if (auto) chrome.runtime.sendMessage({ action: "PUSH_LAST", payload: {} });
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

installSubmitIntentListener();
installSpaNavigationListener();
updateIdleStatusIfNeeded();
inject();
