// Structured fakt lookup — Wikidata (açıq, keysiz, pulsuz).
// Səbəb: "Nizami Gəncəvinin əsərləri hansılardır" kimi suallarda axtarış motoru
// abidə/medal səhifələrini gətirir; cavab isə Wikidata-da P800 (notable work) kimi DURUR.
// Dəstəklənən: works (P800), capital (P36), population (P1082).
import { normalizeAz } from "./rank.js";

const WB = "https://www.wikidata.org/w/api.php";
const UA = "Mozilla/5.0 (compatible; LLMSearchAPI/1.0; +https://github.com/Alim4385/LLM-free-search-api-Vercel)";

const RULES = [
  { kind: "works", prop: "P800",
    re: /^(.{2,60}?)\s+(?:eserleri|eserler|works?)\s*(?:hansilardir|hansilardi|nelerdir|what are|list)?$/u,
    title: (e) => `${e} — əsərləri (Wikidata)` },
  { kind: "capital", prop: "P36",
    re: /^(.{2,60}?)\s+(?:paytaxti|capital)\s*(?:hansidir|nedir|what)?$/u,
    title: (e) => `${e} — paytaxtı (Wikidata)` },
  { kind: "author", prop: "P50",
    re: /^(.{2,60}?)\s+(?:eseri|əsəri|kitabi|kitabı|müəllifi|muellifi|author)\s*(?:kimindir|kimdir|kim|who|of)?$/u,
    title: (e) => `${e} — müəllifi (Wikidata)` },
  { kind: "population", prop: "P1082",
    re: /^(.{2,60}?)\s+(?:ehalisi|population)\s*(?:ne qederdir|necedir|how many|what)?$/u,
    title: (e) => `${e} — əhalisi (Wikidata)` }
];

// AZ hal şəkilçilərini UZUNDAN QISAYA sıra ilə at ("azerbaycanin" → azerbaycan)
const CASE_SUFFIXES = ["larinin", "lerinin", "nun", "nin", "nın", "nün", "ının", "inin", "unun", "ünün", "da", "de", "də", "ta", "te", "dan", "den", "dən", "nin", "in", "un", "ın", "ün", "nı", "ni", "nu", "nü", "ya", "yə", "ye"];
function stripCase(w) {
  let x = w;
  for (const sfx of CASE_SUFFIXES) {
    if (x.length - sfx.length >= 3 && x.endsWith(sfx)) { x = x.slice(0, -sfx.length); break; }
  }
  return x;
}
// "azerbaycanin" → ["azerbayca","azerbaycan"]; "gencevinin" → ["gencevi","gencevin"]
// AZ-da kök "n" ilə bitə bilər, ona görə iki namizəd sınanır.
function entityCandidates(w) {
  const out = [];
  const push = (x) => { if (x && x.length >= 2 && !out.includes(x)) out.push(x); };
  push(stripCase(w));
  if (/(?:in|un|ın|ün)$/.test(w)) push(w.slice(0, -2));   // azerbaycanin → azerbaycan
  if (/(?:nın|nin|nun|nün|da|de|ta|te)$/.test(w)) push(w.slice(0, -3));
  push(w);
  return out.slice(0, 3);
}

// "nizami gencevinin eserleri hansilardir" → { kind: "works", entity: "nizami gencevinin" }
// Orijinal (diakritikalı) yazılış Wikidata axtarışında daha dəqiqdir:
// "azerbaycan" → Azərbaycan (mahnı), "Azərbaycan" → Q227 dövlət.
function origVariants(rawQuery, wordCount) {
  const words = String(rawQuery || "").trim().replace(/[?!.,]+$/g, "").split(/\s+/).slice(0, Math.max(1, wordCount));
  const text = words.join(" ");
  const out = [text];
  if (/(?:ın|in|un|ün|nı|ni)$/i.test(text)) out.push(text.slice(0, -2));
  if (/(?:nın|nin|nun|nün|də|da|dən|dan|də|dır|dir)$/i.test(text)) out.push(text.slice(0, -3));
  return out.filter(x => x && x.length >= 2);
}

export function matchFact(query = "") {
  const n = normalizeAz(query).replace(/[?!.]+$/g, "").replace(/\s+/g, " ").trim();
  for (const r of RULES) {
    const m = n.match(r.re);
    if (!m) continue;
    const raw = m[1].trim();
    const asciiCands = entityCandidates(raw);
    if (!asciiCands.length) continue;
    // diakritikalı variantlar əvvəl (daha dəqiq), sonra ASCII
    const cands = [...new Set([...origVariants(query, raw.split(/\s+/).length), ...asciiCands])].slice(0, 4);
    return { hit: true, exact: true, kind: r.kind, entity: cands[0], entities: cands };
  }
  return { hit: false, exact: false };
}

const withTimeout = (ms) => AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;

async function getJson(url, ms = 2500) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: withTimeout(ms) });
  if (!res.ok) throw new Error("wikidata " + res.status);
  return res.json();
}

async function searchEntity(name, ms = 2500) {
  for (const lang of ["az", "en"]) {
    try {
      const j = await getJson(`${WB}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&uselang=${lang}&format=json&limit=3&type=item`, ms);
      const hit = (j.search || [])[0];
      if (hit && hit.id) return { id: hit.id, label: hit.label || hit.display?.label?.value || name };
    } catch {}
  }
  return null;
}

async function claimsOf(id, ms = 2500) {
  const j = await getJson(`${WB}?action=wbgetentities&ids=${id}&props=claims&format=json`, ms);
  return j?.entities?.[id]?.claims || {};
}

async function labelsOf(ids, ms = 2500) {
  const out = new Map();
  const chunk = ids.slice(0, 40);
  if (!chunk.length) return out;
  const j = await getJson(`${WB}?action=wbgetentities&ids=${chunk.join("|")}&props=labels&languages=az|en&format=json`, ms);
  for (const [id, ent] of Object.entries(j?.entities || {})) {
    const l = ent?.labels?.az?.value || ent?.labels?.en?.value;
    if (l) out.set(id, l);
  }
  return out;
}

const qidOf = (claim) => claim?.mainsnak?.datavalue?.value?.id || null;

export async function fetchFact(fact, ms = 2500) {
  if (!fact || !fact.hit) return null;
  const rule = RULES.find(r => r.kind === fact.kind);
  if (!rule) return null;
  // Namizəd entity-ləri sıra ilə yoxla: xassə BİRİNDƏ yoxdursa, digərinə keç
  for (const cand of (fact.entities || [fact.entity]).slice(0, 3)) {
    const found = await searchEntity(cand, ms);
    if (!found) continue;
    const claims = await claimsOf(found.id, ms).catch(() => null);
    if (!claims) continue;
    const rawList = claims[rule.prop] || [];
    if (!rawList.length) continue;
    const rankVal = (c) => (c?.rank === "preferred" ? 0 : c?.rank === "deprecated" ? 2 : 1);
    const list = rawList.filter(c => c?.rank !== "deprecated").sort((a, b) => rankVal(a) - rankVal(b));

    if (fact.kind === "population") {
      let best = null;
      for (const c of list) {
        const v = c?.mainsnak?.datavalue?.value?.amount;
        if (!v) continue;
        const time = c?.qualifiers?.P585?.[0]?.datavalue?.value?.time || "";
        const num = Number(String(v).replace("+", ""));
        if (!best || time > best.time) best = { num, time };
      }
      if (!best) continue;
      return { kind: "population", entity: found.label, qid: found.id, value: best.num, as_of: best.time ? best.time.slice(1, 5) : null, source: "wikidata.org", fetched_at: new Date().toISOString() };
    }

    let claimsList = list;
    if (fact.kind === "works" && Array.isArray(claims.P527) && claims.P527.length) claimsList = [...list, ...claims.P527];
    // paytaxt: tarixi paytaxtlar (Bonn, Edo, Fujiwara-kyō) cavab DEYİL → 1 (preferred) götür
    let ids = [...new Set(claimsList.map(qidOf).filter(Boolean))].slice(0, 12);
    if (fact.kind === "capital") ids = ids.slice(0, 1);
    if (!ids.length) continue;
    const labels = await labelsOf(ids, ms).catch(() => new Map());
    let items = [...new Set(ids.map(id => labels.get(id)).filter(Boolean))];
    // "Xəmsə" kimi tək qeyd əslində BEŞ poemadır → bir səviyyə aç (P527)
    if (fact.kind === "works" && items.length === 1 && ids[0]) {
      try {
        const inner = await claimsOf(ids[0], ms);
        const innerIds = [...new Set((inner?.P527 || []).map(qidOf).filter(Boolean))].slice(0, 12);
        if (innerIds.length >= 2) {
          const innerLabels = await labelsOf(innerIds, ms);
          const expanded = [...new Set(innerIds.map(id => innerLabels.get(id)).filter(Boolean))];
          if (expanded.length >= 2) items = expanded;
        }
      } catch {}
    }
    if (!items.length) continue;
    return { kind: fact.kind, entity: found.label, qid: found.id, items, source: "wikidata.org", fetched_at: new Date().toISOString() };
  }
  return null;
}

const fmtNum = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function factToText(f) {
  if (!f) return "";
  if (f.kind === "works") return `${f.entity} əsərləri (Wikidata, ${f.items.length} qeyd): ${f.items.join(", ")}.`;
  if (f.kind === "capital") return `${f.entity} paytaxtı: ${f.items.join(", ")}.`;
  if (f.kind === "author") return `${f.entity} — müəllifi: ${f.items.join(", ")}.`;
  if (f.kind === "population") return `${f.entity} əhalisi: ${fmtNum(f.value)}${f.as_of ? ` (${f.as_of})` : ""} (Wikidata).`;
  return "";
}

export { fmtNum };
