// eval/run.mjs — canlı API-də sual dəstini işə salır, cavabları insan oxuması üçün yazır
// İstifadə: node eval/run.mjs <fayl.json> [max_results]
import fs from "fs";

const file = process.argv[2] || "eval/round1.json";
const n = Number(process.argv[3] || 3);
const BASE = process.env.API_BASE || "https://searchapi-eta.vercel.app/api/search";

const qs = JSON.parse(fs.readFileSync(file, "utf8"));
const out = [];

// v97: golden.json girişləri OBYEKTDİR ({q, expect, sources}) — əvvəl bütün obyekt
// query kimi göndərilirdi və nəticə mənasız olurdu.
let pass = 0, fail = 0;
const norm = (e) => (typeof e === "string" ? { q: e } : (e && typeof e === "object" ? e : { q: String(e) }));

function checkExpect(entry, d) {
  const ex = entry.expect;
  if (!ex) return { ok: true, why: "" };
  const results = d?.results || [];
  const blob = JSON.stringify(results);
  if (ex.requiresDigits && !/\d/.test(blob)) return { ok: false, why: "rəqəm gözlənilirdi" };
  if (ex.unit && !results.some(r => `${r.title || ""} ${r.content || ""} ${r.snippet || ""}`.toLowerCase().includes(String(ex.unit).toLowerCase()))) {
    return { ok: false, why: `vahid gözlənilirdi: ${ex.unit}` };
  }
  if (ex.page && ex.page.length && !results.some(r => ex.page.some(h => String(r.url || "").includes(h)))) {
    return { ok: false, why: `səhifə gözlənilirdi: ${ex.page.join("/")}` };
  }
  if (Number.isFinite(ex.num) && !blob.includes(String(ex.num))) return { ok: false, why: `rəqəm gözlənilirdi: ${ex.num}` };
  return { ok: true, why: "" };
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
  const verdict = checkExpect(entry, d);
  rec.expect_ok = verdict.ok;
  rec.expect_why = verdict.why;
  if (entry.expect) { verdict.ok ? pass++ : fail++; }
  out.push(rec);
  console.log(`\n${"=".repeat(80)}\n[${q}]  ${rec.ms}ms | intent=${rec.intent} | lang=${rec.lang} | conf=${rec.conf} | fb=${rec.fallback} | n=${rec.results.length}${entry.expect ? ` | ${verdict.ok ? "PASS" : "FAIL: " + verdict.why}` : ""}`);
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
if (pass + fail) {
  console.log(`\nGOLDEN: ${pass} keçdi, ${fail} uğursuz (${pass + fail} yoxlama)`);
  if (fail) process.exitCode = 1;
}
