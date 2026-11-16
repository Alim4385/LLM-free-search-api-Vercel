#!/usr/bin/env node
// v32: QIZIL CAVAB harness-i — SƏRT rejim.
// pass = answer_ok (cavab mətndədir). retrieval_ok ayrı sütundur, PASS etmir.
// Tipləşdirilmiş yoxlama: count (rəqəm+vahid, tol, must_not), date (il + must_not),
// all/any (söz sərhədi ilə), codeTokens.
//
// node eval/gold.mjs [file] [repeats] [topK]
// env: API_URL, CONCURRENCY, NO_CACHE=1

import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] || "eval/golden.json";
const repeats = Math.max(1, Number(process.argv[3] || process.env.REPEATS || 3));
const topK = Math.max(1, Number(process.argv[4] || 3));
const API = process.env.API_URL || "https://searchapi-eta.vercel.app/api/search";
const CONC = Math.max(1, Number(process.env.CONCURRENCY || 2));

const AZ = [["ə","e"],["ı","i"],["ş","s"],["ç","c"],["ğ","g"],["ö","o"],["ü","u"]];
const fold = (x) => {
  let s = String(x || "").toLowerCase().normalize("NFC");
  for (const [a, b] of AZ) s = s.split(a).join(b);
  return s.replace(/\s+/g, " ").trim();
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// söz sərhədi (AZ hərfləri ilə də işləyir)
const wordRe = (w) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(fold(w))}(?![\\p{L}\\p{N}])`, "u");
const hasWord = (hay, w) => wordRe(w).test(hay);

function numsIn(text) {
  return [...text.matchAll(/(\d[\d\s.,]*)/g)]
    .map((m) => Number.parseFloat(m[1].replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n));
}
// rəqəm VAHİDİN yanında (±80 simvol). v35: fold(unit), BÜTÜN namizədlər qaytarılır.
function numbersWithUnit(hay, unitPattern) {
  const out = [];
  if (!unitPattern) return out;
  const re = new RegExp(`(\\d[\\d\\s.,]*)\\s*(?:min\\s+|milyon\\s+|milyard\\s+)?(?:${unitPattern})|(?:${unitPattern})[^.]{0,60}?(\\d[\\d\\s.,]*)`, "gu");
  let m;
  while ((m = re.exec(hay)) !== null) {
    const raw = (m[1] || m[2] || "").replace(/\s/g, "");
    const n = Number.parseFloat(raw.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
    if (out.length > 40) break;
  }
  return out;
}

function checkAnswer(hay, exp = {}) {
  // 1) dəqiq ədəd + vahid (bütün namizədlər; ±25% filtr yox — qərar aşağıda)
  if (exp.num != null) {
    const got = numbersWithUnit(hay, fold(exp.unit || ""));
    if (!got.length) return { ok: false, why: "no-number" };
    const tol = exp.tol ?? 0;
    const hit = got.find((n) => Math.abs(n - exp.num) <= tol + 0.001);
    if (hit != null) return { ok: true, why: `num=${hit}` };
    return { ok: false, why: `num≠(${got.slice(0, 3).join("|")})` };
  }
  // 2) il — must_not bu branch-da da işləyir
  if (exp.year != null) {
    const years = [...hay.matchAll(/\b(1[5-9]\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
    for (const bad of exp.must_not || []) if (years.includes(bad) && !years.includes(exp.year)) return { ok: false, why: `must_not:${bad}` };
    if (years.includes(exp.year)) return { ok: true, why: "year" };
    return { ok: false, why: "no-year" };
  }
  // 3) rəqəm tələb olunur, dəqiq dəyər yox (say sualları)
  if (exp.requiresDigits) {
    const near = numbersWithUnit(hay, fold(exp.unit || "\\d"));
    if (!near.length) return { ok: false, why: "no-num+unit" };
  }
  // 4) bütün sözlər / hər hansı söz
  if (exp.all) for (const w of exp.all) if (!hasWord(hay, w)) return { ok: false, why: `missing:${w}` };
  if (exp.codeTokens) for (const c of exp.codeTokens) if (!hay.includes(fold(c))) return { ok: false, why: `code:${c}` };
  if (exp.any) {
    const hit = exp.any.some((w) => hasWord(hay, w) || hay.includes(fold(w)));
    if (!hit) return { ok: false, why: "none-of-any" };
  }
  for (const bad of exp.must_not || []) if (hasWord(hay, bad)) return { ok: false, why: `must_not:${bad}` };
  return { ok: true, why: "ok" };
}

// throttle: 30/dəq limitinə sığmaq üçün çağırışlar arasında ≥2200ms
const MIN_GAP = Number(process.env.MIN_GAP_MS || 2200);
let lastCall = 0;
async function throttle() {
  const wait = lastCall + MIN_GAP - Date.now();
  lastCall = Math.max(Date.now(), lastCall + MIN_GAP);
  if (wait > 0) await new Promise((res) => setTimeout(res, wait));
}
// boş cavab sayğacları
const http = { http_429: 0, http_other: 0, empty_results: 0, api_error: 0 };

const items = JSON.parse(readFileSync(file, "utf8"));

// page_ok: gözlənilən səhifə (domen və ya başlıq/snippet açar sözü) gəldi?
// v37: page_ok — domen VƏ YA URL/title açar sözü (əvvəl sırf domen idi → retrieval_ok ilə eyni idi)
function pageOk(domains, hay, item, urls = []) {
  const pages = (item.expect && item.expect.page) || [];
  if (!pages.length) return false;
  const urlsFolded = urls.map(fold).join(" ");
  return pages.some((d) => {
    if (d.includes("/") || d.includes(" ")) return urlsFolded.includes(fold(d)) || hay.includes(fold(d));
    return domains.some((h) => h === d || h.endsWith("." + d));
  });
}

async function runOne(item) {
  const qs = new URLSearchParams({ q: item.q, max_results: String(topK) });
  if (process.env.NO_CACHE) qs.set("no_cache", "1");
  const t0 = Date.now();
  try {
    await throttle(); // v36: 30 sorğu/dəq limiti — throttle olmadan 429 "səhv cavab" kimi sayılırdı
    const r = await fetch(`${API}?${qs}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return { answer: false, retrieval: false, page: false, err: true, http: r.status, why: `http:${r.status}`, ms: Date.now() - t0, cached: false, degraded: [], providers: [], top: "" };
    const j = await r.json();
    if (j.error) return { answer: false, retrieval: false, page: false, err: true, http: r.status, why: `api:${j.error}`, ms: Date.now() - t0, cached: false, degraded: [], providers: [], top: "" };
    const results = (j.results || []).slice(0, topK);
    const hay = fold(results.map((x) => `${x.title || ""} ${x.snippet || ""} ${x.content || ""}`).join(" || "));
    const domains = results.map((x) => { try { return new URL(x.url).hostname.replace(/^www\./, ""); } catch { return ""; } });
    const retrieval = (item.sources || []).some((d) => domains.some((h) => h === d || h.endsWith("." + d)));
    const verdict = checkAnswer(hay, item.expect || {});
    if (!results.length) http.empty_results++;
    return { answer: verdict.ok, retrieval, page: pageOk(domains, hay, item, results.map((x) => x.url || "")), why: verdict.why, ms: Date.now() - t0,
      cached: !!(j.meta && j.meta.cached), degraded: (j.meta && j.meta.degraded_stages) || [],
      providers: (j.meta && j.meta.providers_used) || [], top: (results[0] && results[0].title || "").slice(0, 40) };
  } catch (e) {
    http.http_other++;
    return { answer: false, retrieval: false, page: false, err: true, why: "error:" + e.message.slice(0, 18), ms: Date.now() - t0, cached: false, degraded: [], providers: [], top: "" };
  }
}

async function withConc(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } }));
  return out;
}

const runs = [];
for (let rep = 0; rep < repeats; rep++) {
  runs.push(await withConc(items, CONC, runOne));
  process.stderr.write(`repeat ${rep + 1}/${repeats}\n`);
}

const rows = items.map((item, i) => {
  const marks = runs.map((r) => r[i]);
  const ap = marks.filter((m) => m.answer).length;
  const rp = marks.filter((m) => m.retrieval).length;
  const pp = marks.filter((m) => m.page).length;
  const errs = marks.filter((m) => m.err).length;
  return {
    q: item.q, type: item.type, answer: `${ap}/${repeats}`, retrieval: `${rp}/${repeats}`,
    status: errs > 0 ? "ERROR" : ap === repeats ? "PASS" : ap === 0 ? "FAIL" : "UNSTABLE",
    page: `${pp}/${repeats}`,
    why: marks.map((m) => m.why).join(","), top: marks[0]?.top || "",
    ms: Math.round(marks.reduce((s, m) => s + m.ms, 0) / marks.length),
    cached: marks.filter((m) => m.cached).length,
    degraded: [...new Set(marks.flatMap((m) => m.degraded))].join("|"),
    providers: [...new Set(marks.flatMap((m) => m.providers))].join(","),
  };
});

const val = (s) => Number(s.split("/")[0]) / repeats;
const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) : 0);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

console.log(pad("STATUS", 9) + pad("ANS", 6) + pad("PAGE", 6) + pad("RETR", 6) + pad("TYPE", 11) + pad("ms", 6) + "SUAL → TOP-1");
for (const r of rows) console.log(pad(r.status, 9) + pad(r.answer, 6) + pad(r.page, 6) + pad(r.retrieval, 6) + pad(r.type, 11) + pad(r.ms, 6) + r.q.slice(0, 44) + " → " + r.top);

const answerOk = avg(rows.map((r) => val(r.answer)));
const retrievalOk = avg(rows.map((r) => val(r.retrieval)));
const pageOkPct = avg(rows.map((r) => val(r.page || "0/1")));
const cnt = (s) => rows.filter((r) => r.status === s).length;
const cachedCalls = rows.reduce((s, r) => s + r.cached, 0);

console.log(`\nanswer_ok ${answerOk}%  |  page_ok ${pageOkPct}%  |  retrieval_ok ${retrievalOk}%  |  fərq ${retrievalOk - answerOk} xal ("səhifə tapıldı, cavab yoxdur")`);
console.log(`PASS ${cnt("PASS")} | UNSTABLE ${cnt("UNSTABLE")} | FAIL ${cnt("FAIL")} | ERROR ${cnt("ERROR")} | ${items.length} sual | cached ${cachedCalls}/${items.length * repeats}`);

const types = [...new Set(rows.map((r) => r.type))];
console.log("\nTIP ÜZRƏ:");
for (const t of types) {
  const sub = rows.filter((r) => r.type === t);
  console.log(`  ${pad(t, 12)} answer_ok ${pad(avg(sub.map((r) => val(r.answer))) + "%", 6)} page_ok ${pad(avg(sub.map((r) => val(r.page || "0/1"))) + "%", 6)} retrieval_ok ${avg(sub.map((r) => val(r.retrieval)))}%  (n=${sub.length})`);
}

const unstable = rows.filter((r) => r.status === "UNSTABLE");
if (unstable.length) {
  console.log("\nUNSTABLE atributları:");
  for (const r of unstable) console.log(`  ${pad(r.answer, 5)} ${pad(r.type, 11)} ${r.q.slice(0, 40)} | degraded=${r.degraded || "-"} | providers=${r.providers.slice(0, 70)}`);
}

writeFileSync(file.replace(/\.json$/, "") + ".gold.out.json", JSON.stringify({ repeats, topK, answerOk, retrievalOk, rows, runs }, null, 1));
console.log(`\n→ ${file.replace(/\.json$/, "")}.gold.out.json`);
