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
  const cfg = await getMcpConfig();
  if (cfg.mode === "remote" && cfg.endpoint) {
    const r = await fetch(cfg.endpoint, { cache: "no-store" });
    if (!r.ok) throw new Error(`MCP schema fetch failed: ${r.status}`);
    return await r.json();
  }
  const url = chrome.runtime.getURL("src/schemaMapping.json");
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("Bundled schema mapping missing");
  return await r.json();
}

