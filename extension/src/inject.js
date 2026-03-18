(function () {
  const TAG = "__gitleet__";

  function safeJsonParse(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  function post(type, payload) {
    window.postMessage({ [TAG]: true, __gitleet__: true, type, payload }, "*");
  }

  function captureFromSubmitPayload(url, bodyText) {
    // LeetCode REST submit (legacy / some flows)
    const json = safeJsonParse(bodyText);
    if (!json) return null;
    const typedCode = json.typed_code || json.typedCode || json.code || null;
    const lang = json.lang || json.language || null;
    if (!typedCode) return null;
    return {
      source: "submit",
      url,
      request: json,
      code: typedCode,
      language: lang
    };
  }

  /** LeetCode Submit uses GraphQL (e.g. submissionCreate), not POST /submit. */
  function captureFromGraphQLSubmit(bodyText) {
    const json = safeJsonParse(bodyText);
    if (!json?.variables || typeof json.variables.typed_code !== "string")
      return null;
    const op = String(json.operationName || "").toLowerCase();
    const q = String(json.query || "").replace(/\s+/g, " ");
    // Run / test — same typed_code; do not treat as final Submit
    if (
      op === "runcode" ||
      op === "interpret" ||
      op.includes("interpret") ||
      /runcode\s*\(/i.test(q) ||
      /interpretSolution/i.test(json.query || "")
    )
      return null;
    const qNorm = q.replace(/\s+/g, " ");
    const submitish =
      op.includes("submit") ||
      op.includes("submission") ||
      /submissioncreate|submitcode|createsubmission|submission\s*\(/i.test(
        qNorm
      );
    const likelyRunOnly =
      /runcode|interpret|executeexample|testcase/i.test(op + qNorm.toLowerCase());
    if (likelyRunOnly || !submitish) return null;
    const v = json.variables;
    return {
      source: "graphql_submit",
      url: "/graphql",
      request: json,
      code: v.typed_code,
      language:
        v.lang != null
          ? String(v.lang)
          : v.langSlug || v.lang_slug || v.language || ""
    };
  }

  function wrapFetch() {
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = (init?.method || "GET").toUpperCase();

      let reqBodyText = null;
      try {
        if (init?.body && typeof init.body === "string") reqBodyText = init.body;
      } catch {
        // ignore
      }

      let capturedSubmit = null;
      if (method === "POST" && reqBodyText) {
        if (url.includes("/submit") || url.includes("/interpret_solution")) {
          capturedSubmit = captureFromSubmitPayload(url, reqBodyText);
          post("SUBMIT_INTENT", { ts: Date.now(), url });
        } else if (url.includes("/graphql")) {
          capturedSubmit = captureFromGraphQLSubmit(reqBodyText);
          if (capturedSubmit) post("SUBMIT_INTENT", { ts: Date.now(), url });
        }
      }

      const res = await originalFetch.apply(this, arguments);

      try {
        const clone = res.clone();
        const contentType = clone.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await clone.json();
          if (capturedSubmit) {
            post("SUBMISSION_CAPTURED", { submit: capturedSubmit, response: json });
          }
        }
      } catch {
        // ignore
      }

      return res;
    };
  }

  function wrapXhr() {
    const OriginalXHR = window.XMLHttpRequest;
    function XHR() {
      const xhr = new OriginalXHR();
      let url = "";
      let method = "GET";
      let bodyText = null;

      const origOpen = xhr.open;
      xhr.open = function (m, u) {
        method = (m || "GET").toUpperCase();
        url = String(u || "");
        return origOpen.apply(xhr, arguments);
      };

      const origSend = xhr.send;
      xhr.send = function (body) {
        if (typeof body === "string") {
          bodyText = body;
        }

        if (
          method === "POST" &&
          (url.includes("/submit") ||
            url.includes("/interpret_solution") ||
            url.includes("/graphql"))
        ) {
          xhr.addEventListener("load", function () {
            try {
              const ct = xhr.getResponseHeader("content-type") || "";
              if (!ct.includes("application/json")) return;
              const json = safeJsonParse(xhr.responseText);
              if (!json) return;

              let submit = null;
              if (url.includes("/submit") || url.includes("/interpret_solution")) {
                submit = captureFromSubmitPayload(url, bodyText || "");
                post("SUBMIT_INTENT", { ts: Date.now(), url });
              } else if (url.includes("/graphql")) {
                submit = captureFromGraphQLSubmit(bodyText || "");
                if (submit) post("SUBMIT_INTENT", { ts: Date.now(), url });
              }

              if (submit) {
                post("SUBMISSION_CAPTURED", { submit, response: json });
              }
            } catch {
              // ignore
            }
          });
        }

        return origSend.apply(xhr, arguments);
      };

      return xhr;
    }

    window.XMLHttpRequest = XHR;
  }

  wrapFetch();
  wrapXhr();
  post("HOOK_INSTALLED", { ts: Date.now() });
})();

