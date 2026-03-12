import { fetchSchemaMapping } from "./mcpClient.js";

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function firstMatch(obj, candidates) {
  for (const p of candidates || []) {
    const v = getByPath(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function toNumberMaybe(v) {
  if (v == null) return undefined;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export async function normalizeCaptured(payload) {
  const mapping = await fetchSchemaMapping();
  const paths = mapping?.paths || {};

  // Flatten a combined view so mapping paths can target either response or submit.
  const combined = {
    ...payload,
    submit: payload?.submit || {},
    response: payload?.response || payload?.graphql?.response || payload?.response || {}
  };

  const response = payload?.response || {};

  const title = firstMatch(response, paths.title);
  const slug = firstMatch(response, paths.slug);
  const difficulty = firstMatch(response, paths.difficulty);

  const status = firstMatch(response, paths.status);
  const runtimeMs = toNumberMaybe(firstMatch(response, paths.runtimeMs));
  const memoryMb = toNumberMaybe(firstMatch(response, paths.memoryMb));
  const runtimeBeats = toNumberMaybe(firstMatch(response, paths.runtimeBeats));
  const memoryBeats = toNumberMaybe(firstMatch(response, paths.memoryBeats));

  const language =
    firstMatch(payload, paths.language) ||
    firstMatch(payload?.submit || {}, paths.language);
  const code =
    firstMatch(payload, paths.code) || firstMatch(payload?.submit || {}, paths.code);

  return {
    problem: { title, slug, difficulty, url: "" },
    language: language || "",
    code: code || "",
    status: status || "",
    performance: {
      status: status || "",
      runtimeMs,
      runtimeBeats,
      memoryMb,
      memoryBeats
    },
    raw: {
      // keep raw in-memory only; background clears this storage after upload
      captured: combined
    }
  };
}

