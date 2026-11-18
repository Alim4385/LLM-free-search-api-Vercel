// v100 — Giriş parametrlərinin normallaşdırılması (input layer).
// Blueprint-in `lib/pipeline/input.js` addımının test oluna bilən hissəsi.
// Məqsəd: route.js-dəki "sərhəd yoxlamaları" tək yerdə, unit testlə qorunur.

export const FORMATS = ["json", "jsonl", "simple"];
export const FRESHNESS = ["day", "week", "month", "year"];
export const LANGS = ["az", "tr", "en", "ru"];

export function parseMaxResults(body = {}) {
  const raw = body.max_results ?? body.maxResults ?? body.count ?? body.limit ?? "5";
  const n = parseInt(raw, 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 5, 1), 8);
}

export function parseMaxChars(body = {}) {
  const raw = body.max_chars ?? body.maxChars ?? "4000";
  const n = parseInt(raw, 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 4000, 500), 8000);
}

export function parseFormat(body = {}) {
  const f = typeof body.format === "string" ? body.format.toLowerCase() : "json";
  return FORMATS.includes(f) ? f : "json";
}

// freshness: açıq dəyər; yoxdursa "bu gün/live" kimi ifadələr üçün avtomatik "day"
export function parseFreshness(body = {}, query = "", sameDayCue = () => false) {
  const fr = typeof body.freshness === "string" ? body.freshness.toLowerCase() : "";
  if (FRESHNESS.includes(fr)) return fr;
  return sameDayCue(query) ? "day" : null;
}

export function parseExcludeDomains(body = {}) {
  if (!Array.isArray(body.exclude_domains)) return [];
  return body.exclude_domains
    .filter(d => typeof d === "string")
    .map(d => d.toLowerCase().replace(/^www\./, ""))
    .slice(0, 20);
}

export function parseBool(v) {
  return /^(1|true|on)$/i.test(String(v ?? ""));
}

export function parseTranslateResults(v) {
  return v !== false && v !== "0" && v !== 0;
}

export function parseLang(body = {}, fallback = "az") {
  const l = typeof body.lang === "string" ? body.lang.toLowerCase() : "";
  return LANGS.includes(l) ? l : fallback;
}
