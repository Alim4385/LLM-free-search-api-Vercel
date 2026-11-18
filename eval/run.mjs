// eval/run.mjs — canlı API-də sual dəstini işə salır, cavabları insan oxuması üçün yazır
// İstifadə: node eval/run.mjs <fayl.json> [max_results]
import fs from "fs";

const file = process.argv[2] || "eval/round1.json";
const n = Number(process.argv[3] || 3);
const args = Object.fromEntries(process.argv.slice(4).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "1"]));
const BASE = process.env.API_BASE || "https://searchapi-eta.vercel.app/api/search";

const qs = JSON.parse(fs.readFileSync(file, "utf8"));
const out = [];

// v97: golden.json girişləri OBYEKTDİR ({q, expect, sources}) — əvvəl bütün obyekt
// query kimi göndərilirdi və nəticə mənasız olurdu.
let pass = 0, fail = 0, known = 0;
// Bilinən boşluqlar: eval/known-gaps.json (səbəbi ilə). Onlar buraxılışı bloklamır.
let KNOWN = {};
try { KNOWN = JSON.parse(fs.readFileSync("eval/known-gaps.json", "utf8")); } catch {}
const norm = (e) => (typeof e === "string" ? { q: e } : (e && typeof e === "object" ? e : { q: String(e) }));

// v98: golden.json sxeminin TAM yoxlanması (num/tol/year/all/any/must_not/codeTokens/page/unit)
// v111: TANINMAYAN test şərti SƏSSİZCƏ ötürülməməlidir — əvvəl `contains` yazılmışdı,
// skript onu oxumurdu və metro testi "keçdi" görünə bilərdi.
const KNOWN_EXPECT_KEYS = new Set([
  "num", "tol", "unit", "requiresDigits", "year", "all", "any", "must_not", "codeTokens", "page",
  "contains", "answerContains", "answerNum", "answerYear", "answerUnit"
]);

function checkExpect(entry, d) {
  const ex = entry.expect;
  if (!ex) return { ok: true, why: "" };
  const results = d?.results || [];
  // SEÇİLMİŞ CAVAB (rəqəm) mənbələrdən AYRICA yoxlanılır:
  // cavab = mətndən çıxarılıb önə çəkilmiş element (yoxdursa ilk nəticə).
  const answerItem = results.find(r => r && (r.extracted === true || /\(mətndən çıxarıldı\)/.test(String(r.title || "")))) || results[0] || null;
  const answerText = answerItem ? `${answerItem.title || ""} ${answerItem.content || ""} ${answerItem.snippet || ""}`.toLowerCase() : "";
  const answerNums = [...answerText.matchAll(/\d{1,3}(?:[ \u00a0\u202f.]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g)]
    .map(m => Number(m[0].replace(/[ \u00a0\u202f]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")));
  const text = results.map(r => `${r.title || ""} ${r.snippet || ""} ${r.content || ""}`).join(" ").toLowerCase();
  const urls = results.map(r => String(r.url || "").toLowerCase());
  // v98.1: minlik ayırıcıları ("386 400", "1.234.567") TƏK rəqəm kimi oxunur
  const nums = [...text.matchAll(/\d{1,3}(?:[ \u00a0\u202f.]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g)]
    .map(m => Number(m[0].replace(/[ \u00a0\u202f]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")));
  const years = [...text.matchAll(/\b(1[5-9]\d{2}|20\d{2})\b/g)].map(m => Number(m[0]));
  const fails = [];

  for (const k of Object.keys(ex)) {
    if (!KNOWN_EXPECT_KEYS.has(k)) fails.push(`naməlum test şərti: ${k}`);
  }
  if (ex.requiresDigits && !nums.length) fails.push("rəqəm yoxdur");
  if (ex.unit) {
    let okUnit = false;
    try { okUnit = new RegExp(ex.unit, "i").test(text); } catch { okUnit = text.includes(String(ex.unit).toLowerCase()); }
    if (!okUnit) fails.push(`vahid yoxdur: ${ex.unit}`);
  }
  if (Number.isFinite(ex.num)) {
    const tol = Number.isFinite(ex.tol) ? ex.tol : 0;
    if (!nums.some(n => Math.abs(n - ex.num) <= tol)) fails.push(`rəqəm gözlənilirdi: ${ex.num}±${tol}`);
  }
  if (Number.isFinite(ex.year) && !years.includes(ex.year)) fails.push(`il gözlənilirdi: ${ex.year}`);
  const flat = (x) => String(x).toLowerCase();
  if (Array.isArray(ex.all) && ex.all.length && !ex.all.every(w => text.includes(flat(w)))) {
    fails.push(`hamısı olmalıdır: ${ex.all.join("/")}`);
  }
  if (Array.isArray(ex.any) && ex.any.length && !ex.any.some(w => text.includes(flat(w)))) {
    fails.push(`heç biri yoxdur: ${ex.any.join("/")}`);
  }
  if (Array.isArray(ex.codeTokens) && ex.codeTokens.length && !ex.codeTokens.some(w => text.includes(flat(w)))) {
    fails.push(`kod tokeni yoxdur: ${ex.codeTokens.join("/")}`);
  }
  if (Array.isArray(ex.must_not) && ex.must_not.length) {
    const bad = ex.must_not.filter(w => (typeof w === "number"
      ? results.some(r => new RegExp(`(?<!\\d)${w}(?!\\d)`).test(`${r.title || ""} ${r.content || ""}`))
      : text.includes(flat(w))));
    if (bad.length) fails.push(`olMAMALIDIR: ${bad.join("/")}`);
  }
  if (Array.isArray(ex.page) && ex.page.length && !urls.some(u => ex.page.some(h => u.includes(String(h).toLowerCase())))) {
    fails.push(`səhifə gözlənilirdi: ${ex.page.join("/")}`);
  }
  // v111: mənbədə olması kifayət deyil — `contains` mənbə mətnində axtarılır
  if (Array.isArray(ex.contains) && ex.contains.length && !ex.contains.every(w => text.includes(flat(w)))) {
    fails.push(`mənbədə yoxdur: ${ex.contains.join("/")}`);
  }
  // SEÇİLMİŞ CAVABIN özü düzgündürmü? (mənbədə ilin olması ≠ seçilmiş cavabın düzgünlüyü)
  if (Array.isArray(ex.answerContains) && ex.answerContains.length) {
    if (!answerItem) fails.push("cavab seçilməyib (structured cavab yoxdur)");
    else if (!ex.answerContains.every(w => answerText.includes(flat(w)))) {
      fails.push(`seçilmiş cavab səhvdir: "${String(answerItem.title || "").slice(0, 60)}"`);
    }
  }
  if (Number.isFinite(ex.answerNum)) {
    const at = Number.isFinite(ex.tol) ? ex.tol : 0;
    if (!answerNums.some(n => Math.abs(n - ex.answerNum) <= at)) {
      fails.push(`seçilmiş cavabda rəqəm səhvdir (${ex.answerNum}±${at} gözlənilirdi)`);
    }
  }
  if (Number.isFinite(ex.answerYear) && !new RegExp(`(?<!\\d)${ex.answerYear}(?!\\d)`).test(answerText)) {
    fails.push(`seçilmiş cavabda il səhvdir: ${ex.answerYear}`);
  }
  return { ok: fails.length === 0, why: fails.join("; ") };
}

for (const raw of qs) {
  const entry = norm(raw);
  const q = String(entry.q || "").trim();
  if (!q) continue;
  const t0 = Date.now();
  let d = null;
  try {
    const r = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, max_results: n })
    });
    d = await r.json();
  } catch (e) {
    d = { error: String(e.message) };
  }
  const rec = {
    q,
    ms: d?.meta?.took_ms ?? Date.now() - t0,
    intent: d?.intent,
    lang: d?.meta?.query_lang,
    rewritten: d?.meta?.rewritten_query,
    conf: d?.meta?.confidence,
    fallback: d?.meta?.fallback,
    providers: d?.meta?.providers_used,
    errs: d?.meta?.errors,
    results: (d?.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      source: r.source,
      score: r.score,
      content: (r.content || "").slice(0, 700)
    }))
  };
  let verdict = checkExpect(entry, d);
  // v98: provayder flake-i (429/timeout) golden qapısını yalançı sındırmasın — 1 təkrar
  const RETRY = Number(args.retry ?? 1);
  for (let attempt = 0; attempt < RETRY && !verdict.ok; attempt++) {
    await new Promise(res => setTimeout(res, 1200));
    try {
      const r2 = await fetch(BASE + "?q=" + encodeURIComponent(q) + "&no_cache=1&count=" + n);
      const d2 = await r2.json();
      const v2 = checkExpect(entry, d2);
      if (v2.ok) { verdict = v2; d = d2; rec.retried = true; }
    } catch {}
  }
  rec.expect_ok = verdict.ok;
  rec.expect_why = verdict.why;
  const isKnown = !verdict.ok && (KNOWN[q] || (Array.isArray(KNOWN.queries) && KNOWN.queries.includes(q)));
  if (entry.expect) { verdict.ok ? pass++ : (isKnown ? known++ : fail++); }
  rec.known_gap = isKnown ? (KNOWN[q] || "known") : undefined;
  out.push(rec);
  console.log(`\n${"=".repeat(80)}\n[${q}]  ${rec.ms}ms | intent=${rec.intent} | lang=${rec.lang} | conf=${rec.conf} | fb=${rec.fallback} | n=${rec.results.length}${entry.expect ? ` | ${verdict.ok ? "PASS" : (isKnown ? "KNOWN: " + verdict.why : "FAIL: " + verdict.why)}` : ""}`);
  if (rec.rewritten) console.log(`  rewritten: ${rec.rewritten}`);
  rec.results.forEach((r, i) => {
    console.log(`  ${i + 1}. [${r.source} ${r.score}] ${(r.title || "").slice(0, 75)}`);
    console.log(`     ${r.url}`);
    console.log(`     ${(r.content || "").replace(/\s+/g, " ").slice(0, 330)}`);
  });
  await new Promise((s) => setTimeout(s, 1700));
}

const outFile = file.replace(/\.json$/, ".out.json");
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`\n→ raw nəticələr: ${outFile}`);
if (pass + fail + known) {
  console.log(`\nGOLDEN: ${pass} keçdi, ${known} bilinən boşluq, ${fail} UĞURSUZ (${pass + known + fail} yoxlama)`);
  if (fail) process.exitCode = 1;
}
