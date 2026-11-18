// eval/length100.mjs — "uzun sorğu" testi: 20 mövzu × 5 uzunluq səviyyəsi (100 sorğu)
// Məqsəd: S1 (1-2 söz) → S5 (13+ söz) getdikcə keyfiyyət düşürmü? Hansı sinif sınır?
// İstifadə: node eval/length100.mjs [fayl] [--conc=3] [--fresh=1]
import fs from "fs";

const file = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "/home/user/uploads/test_sorgulari_100.txt";
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith("--")).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "1"]));
const BASE = process.env.API_BASE || "https://searchapi-eta.vercel.app/api/search";
const CONC = Number(args.conc || 3);
const FRESH = args.fresh !== "0";

// ---- faylı parse et ----
const lines = fs.readFileSync(file, "utf8").split("\n");
const items = [];
let topic = null, lang = null, topicIdx = 0;
for (const raw of lines) {
  const line = raw.trim();
  const head = line.match(/^---\s*([A-Z]{2})-(\d+):\s*(.+?)\s*---$/);
  if (head) { lang = head[1]; topicIdx = Number(head[2]); topic = head[3]; continue; }
  const m = line.match(/^(\d+)\.\s+(.+)$/);
  if (m && topic) items.push({ id: Number(m[1]), q: m[2], lang, topic, topicIdx });
}
console.error(`# ${items.length} sorğu oxundu`);

// ---- hədəf anlayışları: mövzunun S1 sorğusundan (ən qısa) götürülür ----
const byTopic = new Map();
for (const it of items) {
  const k = `${it.lang}-${it.topicIdx}`;
  if (!byTopic.has(k)) byTopic.set(k, []);
  byTopic.get(k).push(it);
}
const STOP = new Set(["necə", "nə", "və", "üçün", "bir", "hansı", "what", "which", "how", "the", "for", "and", "with", "ist", "und", "için", "nedir", "nasıl", "ne", "bir"]);
const anchors = new Map();
for (const [k, list] of byTopic) {
  const s1 = list.sort((a, b) => a.id - b.id)[0];
  const toks = s1.q.toLowerCase().split(/[^\p{L}\p{N}+#.-]+/u).filter(t => t.length >= 2 && !STOP.has(t));
  anchors.set(k, toks.slice(0, 4));
}

// ---- çağırış ----
async function call(q) {
  const url = `${BASE}?q=${encodeURIComponent(q)}&count=5${FRESH ? "&no_cache=1" : ""}`;
  const t0 = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (r.status === 429) { await new Promise(s => setTimeout(s, 1500 * (attempt + 1))); continue; }
      const j = await r.json();
      return { ok: r.ok, status: r.status, j, ms: Date.now() - t0 };
    } catch (e) {
      await new Promise(s => setTimeout(s, 800));
    }
  }
  return { ok: false, status: 0, j: null, ms: Date.now() - t0 };
}

function relevance(it, j) {
  const a = anchors.get(`${it.lang}-${it.topicIdx}`) || [];
  const res = (j?.results || []).slice(0, 3);
  if (!res.length) return { level: "none", hits: 0, need: a.length };
  const blob = res.map(r => `${r.title || ""} ${r.snippet || ""} ${r.content || ""}`).join(" ").toLowerCase();
  const hits = a.filter(t => blob.includes(t)).length;
  if (a.length && hits === a.length) return { level: "strong", hits, need: a.length };
  if (hits >= Math.ceil(a.length / 2) && hits > 0) return { level: "weak", hits, need: a.length };
  return { level: "off", hits, need: a.length };
}

const out = [];
let idx = 0;
async function worker() {
  while (idx < items.length) {
    const it = items[idx++];
    const r = await call(it.q);
    const j = r.j || {};
    const rel = relevance(it, j);
    const meta = j.meta || {};
    out.push({
      id: it.id, lang: it.lang, topic: it.topic, topicIdx: it.topicIdx,
      s: ((it.id - 1) % 5) + 1,
      q: it.q,
      words: it.q.trim().split(/\s+/).length,
      status: r.status, ms: r.ms, n: (j.results || []).length,
      answer: (j.answer || "").slice(0, 200) || null,
      conf: meta.confidence || null, fb: !!meta.fallback,
      stages: meta.degraded_stages || [],
      hosts: (j.results || []).slice(0, 3).map(x => { try { return new URL(x.url).hostname.replace(/^www\./, ""); } catch { return "?"; } }),
      rel: rel.level, relHits: rel.hits, relNeed: rel.need
    });
    process.stderr.write(`.`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
out.sort((a, b) => a.id - b.id);
fs.writeFileSync("eval/length100.out.json", JSON.stringify(out, null, 1));

// ---- hesabat ----
const rank = { strong: 3, weak: 2, off: 1, none: 0 };
const pct = (x, n) => (n ? Math.round((x / n) * 100) : 0);
console.log("\n## Səviyyə üzrə (S1 = 1-2 söz … S5 = 13+ söz)");
console.log("S | n | strong% | weak% | off% | boş | orta ms | fallback% | cavab%");
for (let s = 1; s <= 5; s++) {
  const g = out.filter(x => x.s === s);
  const strong = g.filter(x => x.rel === "strong").length;
  const weak = g.filter(x => x.rel === "weak").length;
  const off = g.filter(x => x.rel === "off").length;
  const none = g.filter(x => x.rel === "none").length;
  const ms = Math.round(g.reduce((a, b) => a + b.ms, 0) / (g.length || 1));
  const fb = pct(g.filter(x => x.fb).length, g.length);
  const ans = pct(g.filter(x => x.answer).length, g.length);
  console.log(`S${s} | ${g.length} | ${pct(strong, g.length)} | ${pct(weak, g.length)} | ${pct(off, g.length)} | ${none} | ${ms} | ${fb} | ${ans}`);
}
console.log("\n## Dil üzrə");
console.log("dil | n | strong% | off/boş | orta ms | fallback% | cavab%");
for (const lang of ["EN", "AZ", "TR"]) {
  const g = out.filter(x => x.lang === lang);
  const strong = g.filter(x => x.rel === "strong").length;
  const bad = g.filter(x => x.rel === "off" || x.rel === "none").length;
  const ms = Math.round(g.reduce((a, b) => a + b.ms, 0) / (g.length || 1));
  console.log(`${lang} | ${g.length} | ${pct(strong, g.length)} | ${pct(bad, g.length)} | ${ms} | ${pct(g.filter(x => x.fb).length, g.length)} | ${pct(g.filter(x => x.answer).length, g.length)}`);
}
const bad = out.filter(x => x.rel === "off" || x.rel === "none");
console.log(`\n## Uğursuz (off/boş): ${bad.length}/100`);
for (const b of bad) console.log(`- [${b.lang} S${b.s}] ${b.q.slice(0, 70)} → ${b.hosts.join(", ") || "NƏTİCƏ YOX"} (n=${b.n}, ${b.ms}ms)`);
const slow = out.filter(x => x.ms > 6000).sort((a, b) => b.ms - a.ms);
console.log(`\n## Yavaş (>6s): ${slow.length}`);
for (const s of slow.slice(0, 10)) console.log(`- ${s.ms}ms [${s.lang} S${s.s}] ${s.q.slice(0, 60)}`);
