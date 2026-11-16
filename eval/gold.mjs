#!/usr/bin/env node
// Qızıl cavab harness-i (v30): hər sual N dəfə canlı API-yə vurulur,
// expected sətirlərdən biri top-K nəticədədirsə və ya mənbə domeni uyğundursa PASS.
// Nəticə: pass@1, pass-all, UNSTABLE sayı, orta latency.
//
// İstifadə: node eval/gold.mjs [golden.json] [repeats] [topK]
//   env API_URL, CONCURRENCY

import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] || "eval/golden.json";
const repeats = Math.max(1, Number(process.argv[3] || process.env.REPEATS || 3));
const topK = Math.max(1, Number(process.argv[4] || 3));
const API = process.env.API_URL || "https://searchapi-eta.vercel.app/api/search";
const CONC = Math.max(1, Number(process.env.CONCURRENCY || 2));

const fold = (x) =>
  String(x || "").toLowerCase().normalize("NFC")
    .replace(/ə/g, "e").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
    .replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u")
    .replace(/(\d)\s*[.,]\s*(?=\d)/g, "$1.")   // 362,9 / 362 . 9 → 362.9
    .replace(/\s+/g, " ").trim();

const items = JSON.parse(readFileSync(file, "utf8"));

async function runOne(item) {
  const url = `${API}?q=${encodeURIComponent(item.q)}&limit=${topK}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    const results = (j.results || []).slice(0, topK);
    const hay = results.map((x) =>
      fold(`${x.title || ""} ${x.snippet || ""} ${x.content || ""}`)
    ).join(" || ");
    const domains = results.map((x) => {
      try { return new URL(x.url).hostname.replace(/^www\./, ""); } catch { return ""; }
    });
    const srcOk = (item.sources || []).some((d) => domains.some((h) => h === d || h.endsWith("." + d)));
    const exp = (item.expected || []).map(fold);
    const expOk = exp.some((e) => e.length >= 3 && hay.includes(e));
    return {
      pass: expOk || srcOk,
      why: expOk ? "expected" : srcOk ? "source" : "miss",
      ms: Date.now() - t0,
      top: (results[0] && results[0].title || "").slice(0, 42),
      degraded: (j.meta && j.meta.degraded_stages) || [],
      cached: !!(j.meta && j.meta.cached),
      providers: (j.meta && j.meta.providers_used) || [],
    };
  } catch (e) {
    return { pass: false, why: "error:" + e.message.slice(0, 20), ms: Date.now() - t0, top: "", degraded: [] };
  }
}

async function withConc(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < list.length) {
      const idx = i++;
      out[idx] = await fn(list[idx], idx);
    }
  }));
  return out;
}

const runs = [];
for (let rep = 0; rep < repeats; rep++) {
  const res = await withConc(items, CONC, (item) => runOne(item));
  runs.push(res);
  process.stderr.write(`repeat ${rep + 1}/${repeats} bitdi\n`);
}

const rows = items.map((item, i) => {
  const marks = runs.map((r) => r[i]);
  const passes = marks.filter((m) => m.pass).length;
  const status = passes === repeats ? "PASS" : passes === 0 ? "FAIL" : "UNSTABLE";
  return {
    q: item.q,
    type: item.type || "",
    status,
    passes: `${passes}/${repeats}`,
    why: marks.map((m) => m.why).join(","),
    cached: marks.filter((m) => m.cached).length,
    degraded: [...new Set(marks.flatMap((m) => m.degraded || []))].join("|"),
    providers: [...new Set(marks.flatMap((m) => m.providers || []))].join(","),
    top: marks[0]?.top || "",
    ms: Math.round(marks.reduce((s, m) => s + (m.ms || 0), 0) / marks.length),
  };
});

const cnt = (s) => rows.filter((r) => r.status === s).length;
const avgMs = Math.round(rows.reduce((s, r) => s + r.ms, 0) / Math.max(1, rows.length));
const passRate = Math.round((rows.reduce((s, r) => s + Number(r.passes.split("/")[0]) / repeats, 0) / rows.length) * 100);

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(pad("STATUS", 9) + pad("PASS", 7) + pad("TYPE", 11) + pad("ms", 6) + "SUAL → TOP-1");
for (const r of rows) {
  console.log(pad(r.status, 9) + pad(r.passes, 7) + pad(r.type, 11) + pad(r.ms, 6) + r.q.slice(0, 46) + " → " + r.top);
}
const cachedCalls = rows.reduce((s2, r) => s2 + r.cached, 0);
console.log(`\ncached ${cachedCalls}/${items.length * repeats} çağırış`);
console.log(`PASS ${cnt("PASS")} | UNSTABLE ${cnt("UNSTABLE")} | FAIL ${cnt("FAIL")} | ${items.length} sual`);
console.log(`pass@1 ${passRate}% | orta latency ${avgMs} ms | repeats ${repeats}`);

const outFile = file.replace(/\.json$/, "") + `.gold.out.json`;
writeFileSync(outFile, JSON.stringify({ file, repeats, topK, passRate, avgMs, rows, runs }, null, 1));
console.log(`→ ${outFile}`);
