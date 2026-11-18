// Çoxdilli axtarış eksperimenti: AZ (mövcud: AZ+EN) vs +TR +RU.
// Məqsəd: TR/RU variantları NƏ QƏDƏR YENİ və FAYDALI nəticə gətirir + latency nə qədər artır.
// Cavablar keşlənir (eval/mlcache) — provayder dəyişkənliyi A/B-ni korlamasın.
import { searchAll } from "../lib/search.js";
import { translateText } from "../lib/translate.js";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const FILE = "eval/multilang-cache.json";
const cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const save = () => writeFileSync(FILE, JSON.stringify(cache, null, 1));
const key = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);

const CASES = [
  { q: "Azərbaycanda pambıq istehsalı nə qədərdir", kw: ["min ton", "ton"], note: "rəqəm" },
  { q: "ən uzun çay hansıdır", kw: ["nil", "amazon"], note: "superlativ" },
  { q: "Azərbaycanda neçə universitet var", kw: ["51", "universitet"], note: "say" },
  { q: "Bakı metrosunda neçə stansiya var", kw: ["27", "stansiya"], note: "say" },
  { q: "Xocalı soyqırımı nə vaxt olub", kw: ["26 fevral", "1992"], note: "tarix" },
  { q: "minimum əmək haqqı nə qədərdir Azərbaycan", kw: ["manat"], note: "rəqəm" },
  { q: "Şəki hansı bölgədə yerləşir", kw: ["şəki", "rayon", "bölgə"], note: "coğrafiya" },
  { q: "Azərbaycanda milli parkların sayı", kw: ["12", "park"], note: "say" },
  { q: "süni intellekt nədir", kw: ["süni intellekt", "intellekt"], note: "anlayış" },
  { q: "Azərbaycan himni nə vaxt qəbul edilib", kw: ["1918", "1920", "1992", "himn"], note: "tarix" },
];

async function run(q, lang) {
  const k = `${lang}:${key(q)}`;
  if (cache[k]) return cache[k];
  const t0 = Date.now();
  let out = { results: [], ms: 0, err: null };
  try {
    const r = await searchAll(q, 8, {});
    out = { results: (r.results || []).map(x => ({ title: x.title, url: x.url, snippet: x.snippet })), ms: Date.now() - t0, err: null };
  } catch (e) { out = { results: [], ms: Date.now() - t0, err: String(e.message || e) }; }
  cache[k] = out; save();
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const hasKw = (x, kws) => kws.some(k => `${x.title || ""} ${x.snippet || ""}`.toLowerCase().includes(k));

const rows = [];
for (const c of CASES) {
  const [tr, ru] = await Promise.all([
    translateText(c.q, "tr", "az", 1500).catch(() => null),
    translateText(c.q, "ru", "az", 1500).catch(() => null),
  ]);
  const az = await run(c.q, "az");
  const trR = tr ? await run(tr, "tr") : { results: [] };
  const ruR = ru ? await run(ru, "ru") : { results: [] };
  const azUrls = new Set(az.results.map(r => r.url));
  const newOnes = [...trR.results, ...ruR.results].filter(r => !azUrls.has(r.url));
  const newHosts = [...new Set(newOnes.map(r => hostOf(r.url)))].filter(Boolean);
  const azHosts = new Set(az.results.map(r => hostOf(r.url)));
  const freshHosts = newHosts.filter(h => !azHosts.has(h));
  const usefulNew = newOnes.filter(x => hasKw(x, c.kw));
  const azUseful = az.results.filter(x => hasKw(x, c.kw));
  rows.push({
    q: c.q, note: c.note, tr: !!tr, ru: !!ru,
    az_n: az.results.length, az_useful: azUseful.length,
    new_n: newOnes.length, new_hosts: freshHosts.length, new_useful: usefulNew.length,
    ms_az: az.ms, ms_tr: trR.ms || 0, ms_ru: ruR.ms || 0,
  });
}

console.log("\n| sorğu | AZ n/faydalı | yeni n | yeni host | yeni faydalı | ms AZ / TR / RU |");
console.log("|---|---|---|---|---|---|");
let tNew = 0, tUseful = 0, tHosts = 0, tAzUseful = 0;
for (const r of rows) {
  tNew += r.new_n; tUseful += r.new_useful; tHosts += r.new_hosts; tAzUseful += r.az_useful;
  console.log(`| ${r.q.slice(0, 38)} | ${r.az_n}/${r.az_useful} | ${r.new_n} | ${r.new_hosts} | ${r.new_useful} | ${r.ms_az}/${r.ms_tr}/${r.ms_ru} |`);
}
const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
console.log(`\nCƏMİ: yeni nəticə ${tNew}, yeni host ${tHosts}, yeni FAYDALI ${tUseful} (AZ-da faydalı: ${tAzUseful})`);
console.log(`orta ms: AZ ${avg(rows.map(r => r.ms_az))}, TR ${avg(rows.map(r => r.ms_tr))}, RU ${avg(rows.map(r => r.ms_ru))}`);
save();
