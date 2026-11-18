// v94.1 — FİLTR KALİBRASYON ÖLÇÜ ALƏTİ (measurement-first, v2)
// Etalon: Vikipediya. Etiketləmə 3 siqnala söykənir:
//   1) CAVAB SİQNALI  — sualın gözlədiyi cavab (rəqəm/tarix) etalon mətndə varsa,
//      həmin cavabı daşıyan istənilən nəticə = relevant (dil fərqindən asılı deyil)
//   2) LEKSİK ÖRTÜŞMƏ — nəticə ilə etalon mətni arasında termin/trigram oxşarlığı
//   3) HOW-TO QAYDASI  — "necə hazırlanır" sualında baş söz + hazırlanma siqnalı
// İşlədilməsi:  node eval/filter-calib.mjs [--limit=12] [--json] [--thr=1.5]
import { searchAll } from "../lib/search.js";
import { scoreResult, isJunkDomain, isSpamDomain } from "../lib/score.js";
import { tokenize, normalizeAz } from "../lib/rank.js";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "1"]));
const LIMIT = Number(args.limit || 12);
const THRESHOLD = Number(args.thr || 1.5);
const POS = Number(args.pos || 0.20);
const NEG = Number(args.neg || 0.06);

// Hər sual üçün TƏSDİQLƏNMİŞ Vikipediya məqaləsi (etalon səhifə əl ilə bəllidir —
// avtomatik seçim yanlış məqalə götürürdü: "İran himni", "Capital punishment in Azerbaijan")
const QUERIES = [
  { q: "Azərbaycanda neçə rayon var", lang: "az", wiki: "Azərbaycanın inzibati bölgüsü" },
  { q: "Azərbaycanın paytaxtı hansıdır", lang: "az", wiki: "Azərbaycan" },
  { q: "Xəzər dənizinin sahəsi nə qədərdir", lang: "az", wiki: "Xəzər dənizi" },
  { q: "Azərbaycanda neçə muzey var", lang: "az", wiki: "Azərbaycan muzeyləri" },
  { q: "Azərbaycan himni nə vaxt təsdiq olunub", lang: "az", wiki: "Azərbaycan himni" },
  { q: "Azərbaycanın dövlət borcu nə qədərdir", lang: "az", wiki: "Azərbaycan iqtisadiyyatı" },
  { q: "Azərbaycanda neçə universitet var", lang: "az", wiki: "Azərbaycanda təhsil" },
  { q: "Azərbaycanda neçə kənd var", lang: "az", wiki: "Azərbaycanın yaşayış məntəqələri" },
  { q: "qutab necə hazırlanır", lang: "az", wiki: "Qutab" },
  { q: "React state idarəetməsi nədir", lang: "az", wiki: "React (JavaScript kitabxanası)" },
  { q: "what is the capital of Azerbaijan", lang: "en", wiki: "Azerbaijan" },
  { q: "how many regions does Azerbaijan have", lang: "en", wiki: "Administrative divisions of Azerbaijan" },
  { q: "python list comprehension", lang: "en", wiki: "Python (programming language)" },
  { q: "Azərbaycanda neçə milli park var", lang: "az", wiki: "Azərbaycan milli parkları" }
];

const HOWTO_RE = /(necə|nece|hazırlan|hazirlan|resept|resep|how\s+to|recipe)/iu;
const NUMERIC_Q = /(neçə|nece\s+neçə|nə\s+qədər|ne\s+qeder|how\s+many|how\s+much|hansı\s+il|nə\s+vaxt|when)/iu;

// Vikipediya axtarışı sual cümləsi ilə işləmir — sual sözlərini atıb açar sözlərlə axtarırıq
const QWORDS = /(?<![\p{L}])(hansıdır|hansı|nə\s+vaxt|ne\s+vaxt|necə|neçə|nə\s+qədərdir|nədir|var|haqqında|what|is|the|does|do|have|has|how|many|much|of|in)(?![\p{L}])/giu;
function keyQuery(q) {
  const stripped = String(q).replace(QWORDS, " ").replace(/\s+/g, " ").trim();
  return stripped.length >= 3 ? stripped : String(q);
}

// Vikipediya cavabları keşlənir: API dəqiqədə az sorğu qəbul edir (429).
const CACHE_PATH = "eval/wiki-cache.json";
let WIKI_CACHE = {};
try { WIKI_CACHE = JSON.parse((await import("node:fs")).readFileSync(CACHE_PATH, "utf8")); } catch {}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function saveCache() {
  try { (await import("node:fs")).writeFileSync(CACHE_PATH, JSON.stringify(WIKI_CACHE)); } catch {}
}

async function wikiPages(q, lang, title) {
  const host = lang === "az" ? "az.wikipedia.org" : "en.wikipedia.org";
  const url = title
    ? `https://${host}/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts&explaintext&exchars=2500&format=json&origin=*`
    : `https://${host}/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(keyQuery(q))}` +
      `&gsrlimit=3&prop=extracts&exintro&explaintext&format=json&origin=*`;
  const cacheKey = `${host}|${title || keyQuery(q)}`;
  if (WIKI_CACHE[cacheKey]) return WIKI_CACHE[cacheKey];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await sleep(attempt === 0 ? 300 : 1500 * attempt);   // 429 → geri çəkilmə
      const res = await fetch(url, { headers: { "User-Agent": "search-api-filter-calib/2.1 (educational eval; contact: local)" } });
      if (res.status === 429) continue;
      if (!res.ok) return [];
      const j = await res.json();
      const pages = Object.values(j?.query?.pages || {})
        .filter(p => !p.missing)
        .map(p => ({ title: p.title || "", text: `${p.title}. ${p.extract || ""}` }));
      if (pages.length) { WIKI_CACHE[cacheKey] = pages; await saveCache(); }
      return pages;
    } catch { await sleep(800); }
  }
  return [];
}

// Etalon məqaləni sualla üst-üstə düşməsinə görə seç (yanlış məqalə = yanlış etiket)
function pickTruth(pages, q) {
  const qt = new Set(tokenize(q));
  let best = null;
  for (const p of pages) {
    const pt = new Set(tokenize(`${p.title} ${p.text.slice(0, 400)}`));
    let hit = 0;
    for (const t of qt) if (pt.has(t)) hit++;
    const sim = hit / Math.max(1, qt.size);
    // başlıq da tokenləşdirilir (tokenize diakritikləri ASCII-yə salır: "Azərbaycan"→"azerbaycan")
    const titleToks = new Set(tokenize(p.title));
    const titleHit = [...qt].some(t => t.length >= 4 && titleToks.has(t));
    const cand = { ...p, sim, titleHit };
    if (!best || (sim + (titleHit ? 0.34 : 0)) > (best.sim + (best.titleHit ? 0.34 : 0))) best = cand;
  }
  return best && best.sim >= 0.5 && best.titleHit ? best : null;   // zəif etalon → etiket yoxdur
}

// Etalondan gözlənilən cavab siqnalı: rəqəm, faiz, tarix
function answerHints(truthText, q) {
  const out = new Set();
  if (!NUMERIC_Q.test(q)) return out;
  const counts = new Map();
  for (const m of truthText.matchAll(/(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)\s*(rayon|muzey|universitet|faiz|%)?/giu)) {
    const v = m[1].replace(/[\s.]/g, "").replace(",", ".");
    if (v && Number(v) > 0) counts.set(v, (counts.get(v) || 0) + 1);
  }
  for (const [v, c] of counts) if (c <= 2) out.add(v);
  return out;
}

function textOf(r) { return `${r.title || ""} ${r.snippet || r.content || ""}`; }

function overlap(result, truthText) {
  const rt = new Set(tokenize(textOf(result)));
  const tt = new Set(tokenize(truthText));
  if (!rt.size || !tt.size) return 0;
  let hit = 0;
  for (const t of rt) if (tt.has(t)) hit++;
  // yalnız termin örtüşməsi: trigram başlıq prefiksi ("Milli park ...") yalançı uyğunluq verirdi
  return hit / Math.min(rt.size, 30);
}

// XAM NƏTİCƏ KEŞİ: iki filtr variantını EYNİ girişlərlə müqayisə etmək üçün.
// Canlı axtarış hər run-da fərqli nəticə verir → keşsiz A/B müqayisəsi etibarsızdır.
const RAW_CACHE_PATH = "eval/raw-cache.json";
let RAW_CACHE = {};
try { RAW_CACHE = JSON.parse((await import("node:fs")).readFileSync(RAW_CACHE_PATH, "utf8")); } catch {}
async function rawResults(q, refresh) {
  if (!refresh && RAW_CACHE[q]) return RAW_CACHE[q];
  const out = await searchAll(q, 8, {}).catch(() => []);
  const arr = Array.isArray(out) ? out : (out?.results || []);
  RAW_CACHE[q] = arr;
  await saveCacheRaw();
  return arr;
}
async function saveCacheRaw() {
  try { (await import("node:fs")).writeFileSync(RAW_CACHE_PATH, JSON.stringify(RAW_CACHE)); } catch {}
}
const REFRESH = !!args.refresh;

const report = { threshold: THRESHOLD, queries: [], domains: {}, totals: { tp: 0, fn: 0, fp: 0, tn: 0, skip: 0 } };
for (const { q, lang, wiki } of QUERIES.slice(0, LIMIT)) {
  const [pages, raw] = await Promise.all([wikiPages(q, lang, wiki), rawResults(q, REFRESH)]);
  const truth = wiki && pages.length ? { ...pages[0], sim: 1 } : pickTruth(pages, q);
  const hints = truth ? answerHints(truth.text, q) : new Set();
  const results = Array.isArray(raw) ? raw : (raw?.results || []);
  const qTerms = [...new Set(tokenize(q))];
  // "entity" = sualın ən uzun sözünün 5 hərflik gövdəsi (Azərbaycan/Azerbaijan → "azerb").
  // Beləliklə dil və yazılış fərqi (y/i, ə/e) mane olmur.
  const entityStem = (() => {
    const words = String(q).split(/[^\p{L}]+/u).filter(w => w.length >= 5);
    if (!words.length) return "";
    const longest = words.sort((a, b) => b.length - a.length)[0];
    return normalizeAz(longest).slice(0, 5);
  })();
  const isHowto = HOWTO_RE.test(q);
  const baseNoun = tokenize(q).sort((a, b) => b.length - a.length)[0] || "";
  const row = { q, lang, truth: truth?.title || null, truthSim: truth ? Math.round(truth.sim * 100) / 100 : 0, hints: [...hints].slice(0, 6), raw: results.length, pos: 0, fn: 0, fp: 0, fnList: [], fpList: [] };

  for (const r of results) {
    let host = "";
    try { host = new URL(r.url).hostname.replace(/^www\./, ""); } catch {}
    const junk = isJunkDomain(r.url) || isSpamDomain(r.url);
    const score = scoreResult(r, qTerms, lang === "az" ? "az" : "en", q);
    const emptySnippet = String(r.snippet || r.content || "").trim().length < 10;
    // route.js-dəki saxlanma qaydası ilə EYNİ olmalıdır (v95: boş snippet + güclü bal → saxlanır)
    const kept = !junk && score >= THRESHOLD && (!emptySnippet || score >= 3);
    const drop = junk ? "junk_domain" : score < THRESHOLD ? "score" : emptySnippet ? "empty_snippet" : "";
    const txt = textOf(r);
    const ov = truth ? overlap(r, truth.text) : 0;
    // cavab siqnalı yalnız sualın ADI ilə bitişik olanda sayılır ("64 rayon"), tək rəqəm yox
    const nouns = qTerms.filter(t => t.length >= 4).join("|");
    const entityOk = !entityStem || normalizeAz(txt).includes(entityStem);
    const hintHit = (nouns && entityOk) ? [...hints].some(h => {
      if (h.length < 2) return false;
      try { return new RegExp(`${h}\s*[\p{L}]{0,8}(?:${nouns})|(?:${nouns})\s*[^\d]{0,12}${h}`, "iu").test(txt); } catch { return false; }
    }) : false;
    const howtoHit = isHowto && baseNoun && txt.toLowerCase().includes(baseNoun) && HOWTO_RE.test(txt);

    let label = "skip";
    if (hintHit || howtoHit || (truth && ov >= POS)) label = "pos";
    else if (truth && ov <= NEG) label = "neg";

    const bucket = (report.domains[host] ||= { pos: 0, neg: 0, kept: 0, dropped: 0 });
    if (label === "pos") bucket.pos++; else if (label === "neg") bucket.neg++;
    if (kept) bucket.kept++; else bucket.dropped++;

    row.items ||= [];
    row.items.push({ r, score, label, kept });
    if (label === "pos") {
      row.pos++;
      if (kept) report.totals.tp++;
      else {
        report.totals.fn++; row.fn++;
        row.fnList.push({ host, score: Math.round(score * 10) / 10, ov: Math.round(ov * 100) / 100, drop, why: hintHit ? "cavab" : howtoHit ? "howto" : "leksik", title: (r.title || "").slice(0, 68) });
      }
    } else if (label === "neg") {
      if (kept) { report.totals.fp++; row.fp++; row.fpList.push({ host, score: Math.round(score * 10) / 10, ov: Math.round(ov * 100) / 100, title: (r.title || "").slice(0, 68) }); }
      else report.totals.tn++;
    } else report.totals.skip++;
  }
  // === SIRALAMA ÖLÇÜSÜ (P@1 / P@3) — filtr metriki bunu görmür ===
  // Üç variant eyni xam nəticələr üzərində müqayisə olunur:
  //   A: bonus yoxdur | B: URL/provayder konsensusu (koddakı) | C: SAYT (host) konsensusu
  const provOf = (r) => new Set(Array.isArray(r.providers) && r.providers.length ? r.providers : [r.source || "?"]);
  const hostProv = {};
  for (const r of results) {
    let h = ""; try { h = new URL(r.url).hostname.replace(/^www\./, ""); } catch {}
    hostProv[h] ||= new Set();
    for (const p of provOf(r)) hostProv[h].add(p);
  }
  const scoredList = row.items || [];
  const SCALE = Number(args.scale || 1);   // bonus gücü (A/B/C testi üçün)
  const bonusB = (r) => SCALE * Math.min(0.9, 0.3 * (provOf(r).size - 1));
  const bonusC = (r) => { let h = ""; try { h = new URL(r.url).hostname.replace(/^www\./, ""); } catch {} const n = hostProv[h] ? hostProv[h].size : 1; return SCALE * Math.min(0.9, 0.3 * (n - 1)); };
  const rank = (bonusFn) => {
    const arr = scoredList.filter(x => x.kept).map(x => ({ ...x, s2: x.score + bonusFn(x.r) })).sort((a, b) => b.s2 - a.s2).slice(0, 3);
    return arr.map(x => x.label);
  };
  row.pAt3 = { A: rank(() => 0), B: rank(bonusB), C: rank(bonusC) };
  row.rankD = (table) => {
    const arr = scoredList.filter(x => x.kept).map(x => {
      let h = ""; try { h = new URL(x.r.url).hostname.replace(/^www\./, ""); } catch {}
      return { ...x, s2: x.score + 0.5 * (table[h] || 0) };
    }).sort((a, b) => b.s2 - a.s2).slice(0, 3);
    return arr.map(x => x.label);
  };
  report.queries.push(row);
  console.log(`\n## ${q}  (etalon: ${row.truth || "YOXDUR"} uyğunluq=${row.truthSim}, cavab siqnalları: ${row.hints.join(",") || "—"}, xam ${row.raw})`);
  console.log(`   relevant ${row.pos} | FN ${row.fn} | FP ${row.fp}`);
  for (const x of row.fnList) console.log(`   ✗ FN ${String(x.score).padStart(4)} bal [${x.drop}/${x.why}] ${x.host} — ${x.title}`);
  for (const x of row.fpList) console.log(`   ✗ FP ${String(x.score).padStart(4)} bal ov=${x.ov} ${x.host} — ${x.title}`);
}

const t = report.totals;
const precision = t.tp + t.fp ? (t.tp / (t.tp + t.fp)) * 100 : 0;
const recall = t.tp + t.fn ? (t.tp / (t.tp + t.fn)) * 100 : 0;
console.log(`\n=== CƏMİ  TP ${t.tp} | FN ${t.fn} | FP ${t.fp} | TN ${t.tn} | skip ${t.skip}`);
console.log(`=== Precision ${precision.toFixed(1)}%   Recall ${recall.toFixed(1)}%`);
// sıralama nəticələri: top-3-də neçə relevant nəticə (maksimum 3)
let sumA = 0, sumB = 0, sumC = 0, cntQ = 0;
for (const row of report.queries) {
  if (!row.pAt3) continue;
  const sc = (l) => l.filter(x => x === "pos").length;
  sumA += sc(row.pAt3.A); sumB += sc(row.pAt3.B); sumC += sc(row.pAt3.C);
  cntQ++;
}
console.log(`\n=== SIRALAMA (top-3-də relevant sayı, ${cntQ} sual)`);
console.log(`   A bonus yoxdur          : ${sumA}`);
console.log(`   B URL/provayder konsensus: ${sumB}`);
console.log(`   C SAYT (host) konsensus  : ${sumC}`);
// D: domen etibarlılıq cədvəli (kalibrasiya datasından) — SAYTIN keçmiş nəticələrinə görə çəki
const domTable = {};
for (const [h, v] of Object.entries(report.domains)) {
  if (v.pos + v.neg < 3) continue;
  domTable[h] = (v.pos - v.neg) / (v.pos + v.neg);
}
const sumD = report.queries.reduce((acc, row) => acc + (row.rankD ? row.rankD(domTable).filter(x => x === "pos").length : 0), 0);
console.log(`   D SAYT etibarlılıq çəki (${Object.keys(domTable).length} domen): ${sumD}  [in-sample]`);

const dom = Object.entries(report.domains).filter(([, v]) => v.pos + v.neg >= 2)
  .sort((a, b) => (b[1].pos - b[1].neg) - (a[1].pos - a[1].neg)).slice(0, 16);
console.log("\n=== DOMEN BALANSI (pos−neg)");
for (const [h, v] of dom) console.log(`   ${String(v.pos - v.neg).padStart(3)}   ${h.padEnd(32)} pos ${v.pos} neg ${v.neg} saxlanan ${v.kept}/${v.kept + v.dropped}`);

if (args.json) {
  for (const row of report.queries) delete row.items;
  const fs = await import("node:fs");
  fs.writeFileSync("eval/calib-report.json", JSON.stringify(report, null, 2));
  console.log("\nyazıldı: eval/calib-report.json");
}
