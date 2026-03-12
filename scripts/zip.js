import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const DIST = path.resolve(ROOT, "dist");
const OUT = path.resolve(ROOT, "releases");

await fs.mkdir(OUT, { recursive: true });

const zipName = `gitleet-chrome-v0.1.0.zip`;
const zipPath = path.join(OUT, zipName);

// macOS has /usr/bin/zip; use it.
await fs.rm(zipPath, { force: true });
await execFileAsync("zip", ["-r", zipPath, "."], { cwd: DIST });
console.log(`Wrote ${zipPath}`);

