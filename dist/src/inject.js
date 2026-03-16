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
          (url.includes("/submit") || url.includes("/interpret_solution") || url.includes("/graphql"))
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
              }

              post("SUBMISSION_CAPTURED", {
                submit,
                graphql: url.includes("/graphql")
                  ? { url, requestBody: bodyText || "" }
                  : null,
                response: json
              });
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

