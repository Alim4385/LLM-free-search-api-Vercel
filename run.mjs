// eval/run.mjs — canlı API-də sual dəstini işə salır, cavabları insan oxuması üçün yazır
// İstifadə: node eval/run.mjs <fayl.json> [max_results]
import fs from "fs";

const file = process.argv[2] || "eval/round1.json";
const n = Number(process.argv[3] || 3);
const BASE = process.env.API_BASE || "https://searchapi-eta.vercel.app/api/search";

const qs = JSON.parse(fs.readFileSync(file, "utf8"));
const out = [];

for (const q of qs) {
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
  out.push(rec);
  console.log(`\n${"=".repeat(80)}\n[${q}]  ${rec.ms}ms | intent=${rec.intent} | lang=${rec.lang} | conf=${rec.conf} | fb=${rec.fallback} | n=${rec.results.length}`);
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
