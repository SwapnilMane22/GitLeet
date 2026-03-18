// MCP is required by plan. In GitLeet v0.1 this "MCP client" loads a schema
// mapping (JSON) from either a bundled file or a configured MCP endpoint.
//
// This is intentionally simple: the MCP server/tool can serve a JSON mapping at
// GET /schema/leetcode/submission

const DEFAULTS = {
  mode: "bundled", // "bundled" | "remote"
  endpoint: "" // e.g. http://127.0.0.1:8787/schema/leetcode/submission
};

export async function getMcpConfig() {
  const res = await chrome.storage.local.get(["settings"]);
  const settings = res.settings || {};
  return { ...DEFAULTS, ...(settings.mcp || {}) };
}

export async function fetchSchemaMapping() {
  // Content scripts cannot fetch extension-packaged JSON (CORS / web-accessible rules).
  // Always load schema via the service worker.
  const res = await chrome.runtime.sendMessage({ action: "FETCH_SCHEMA_MAPPING" });
  if (!res?.ok) {
    throw new Error(res?.error || "Schema fetch failed");
  }
  return res.data;
}

