import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);
const SCHEMA_PATH =
  process.env.SCHEMA_PATH ||
  path.resolve(__dirname, "../extension/src/schemaMapping.json");

async function readSchema() {
  const raw = await fs.readFile(SCHEMA_PATH, "utf8");
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === "/schema/leetcode/submission") {
      const schema = await readSchema();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(schema));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`GitLeet MCP server listening on http://127.0.0.1:${PORT}`);
  // eslint-disable-next-line no-console
  console.log("Schema endpoint: /schema/leetcode/submission");
});

