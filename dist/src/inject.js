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
    // LeetCode submission endpoints often include typed_code / lang / question_id in body
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
        }
      }

      const res = await originalFetch.apply(this, arguments);

      // Capture response (clone).
      try {
        const clone = res.clone();
        const contentType = clone.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const json = await clone.json();
          if (capturedSubmit) {
            post("SUBMISSION_CAPTURED", { submit: capturedSubmit, response: json });
          } else if (method === "POST" && url.includes("/graphql")) {
            post("SUBMISSION_CAPTURED", { graphql: { url, requestBody: reqBodyText }, response: json });
          }
        }
      } catch {
        // ignore
      }

      return res;
    };
  }

  wrapFetch();
})();

