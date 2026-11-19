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
    re: /^(.{2,60}?)\s+(?:paytaxti|capital|столица)\s*(?:hansidir|nedir|what)?$/u,
    title: (e) => `${e} — paytaxtı (Wikidata)` },
  // count_in (P150 sayı) QEYDİYYATDAN ÇIXARILIB: Azərbaycan üçün 59 verir, düzgünü 66 rayon.
  // Yanlış rəqəm verməkdənsə axtarışa buraxmaq düzgündür.
  { kind: "currency_of", prop: "P38",
    re: /^(.{2,60}?)\s+(?:valyutasi|valyutası|pulu|currency|валюта)\s*(?:nedir|nədir|hansidir|what|of)?$/u,
    title: (e) => `${e} — valyutası (Wikidata)` },
  { kind: "author", prop: "P50",
    re: /^(.{2,60}?)\s+(?:eseri|əsəri|kitabi|kitabı|müəllifi|muellifi|author)\s*(?:kimindir|kimdir|kim|who|of)?$/u,
    title: (e) => `${e} — müəllifi (Wikidata)` },
  // v56.3: "Yerusəlim hansı ölkədədir" → Mormon Kitabı səhifələri gəlirdi; cavab P17-dədir
  { kind: "country", prop: "P17",
    re: /^(.{2,60}?)\s+(?:hansi\s+olkede|hansi\s+olkededir|hansi\s+olke|which\s+country|v\s+kakoy\s+strane)\s*(?:yerlesir|yerleşir|dir|dadir|deyer|is)?$/u,
    title: (e) => `${e} — hansı ölkədə (Wikidata)` },
  // v72: "Azərbaycanın neçə qonşusu var" → P47 (shares border with) sayı
  { kind: "borders", prop: "P47",
    re: /^(.{2,60}?)\s+(?:nece\s+(?:serhed\s+|sərhəd\s+)?qonsusu|ne[cç][eə]\s+(?:serhed\s+|sərhəd\s+)?qonsusu|qonsu\s+olke\s+sayi|nece\s+olke\s+ile\s+hemserheddir|bordering\s+countries)\s*(?:var|vardir|nedir)?$/u,
    title: (e) => `${e} — qonşu ölkələr (Wikidata)` },
  // v67: "Azərbaycanın sahəsi nə qədərdir" / "Xəzər dənizinin sahəsi" → P2046 (km²)
  { kind: "area", prop: "P2046",
    re: /^(.{2,60}?)\s+(?:sahesi|sahəsi|erazisi|ərazisi|area|площадь)\s*(?:ne qederdir|ne qeder|necedir|nedir|how big|what)?$/u,
    title: (e) => `${e} — sahəsi (Wikidata)` },
  { kind: "population", prop: "P1082",
    re: /^(.{2,60}?)\s+(?:ehalisi|population|население)\s*(?:ne qederdir|necedir|how many|what)?$/u,
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

// Rus dili halları Wikidata axtarışını pozur ("Казахстана", "Москве") → sadə variantlar
const RU_ENDINGS = ["ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими", "ая", "яя", "ое", "ее", "ые", "ие", "ах", "ях", "ам", "ям", "ом", "ем", "ой", "ей", "ов", "ев", "а", "я", "е", "у", "ю", "ы", "и", "о"];
function ruVariants(word) {
  const w = String(word || "").trim();
  const out = [w];
  for (const end of RU_ENDINGS) {
    if (w.length - end.length >= 4 && w.toLowerCase().endsWith(end)) {
      const stem = w.slice(0, -end.length);
      out.push(stem, stem + "а", stem + "я", stem + "ь");
      break;
    }
  }
  return [...new Set(out)].filter(x => x.length >= 3).slice(0, 5);
}

export function matchFact(query = "") {
  const n = normalizeAz(query).replace(/[?!.]+$/g, "").replace(/\s+/g, " ").trim();
  // RU: "какой город столица Казахстана" / "население Москвы" — söz sırası tərsdir
  const ruRaw = String(query || "");
  const ruPat = [
    [/(?:столица|столицей|столицу)\s+(?:города\s+)?([А-Яа-яЁёA-Za-z\-\s]{2,40})/i, "capital"],
    [/(?:население|населения|населению)\s+(?:в\s+|города\s+)?([А-Яа-яЁёA-Za-z\-\s]{2,40})/i, "population"],
    [/(?:валюта|валюте|валютасы)\s+([А-Яа-яЁёA-Za-z\-\s]{2,40})/i, "currency_of"]
  ];
  for (const [re, kind] of ruPat) {
    const m = ruRaw.match(re);
    if (!m) continue;
    const ent = m[1].replace(/[?!.,]+$/g, "").trim();
    if (ent.length < 2) continue;
    const cands = ruVariants(ent);
    return { hit: true, exact: true, kind, entity: cands[0], entities: cands, entityWords: ent.split(/\s+/).length };
  }
  // EN: "what is the currency of Japan" → "japan valyutasi"
  const enCur = n.match(/what\s+is\s+the\s+(?:currency|capital)\s+of\s+(.{2,40})$/);
  if (enCur) {
    const kind = /currency/.test(n) ? "currency_of" : "capital";
    const raw = String(query).replace(/^.*\bof\s+/i, "").replace(/[?!.]+$/g, "").trim();
    const cands = entityCandidates(normalizeAz(raw));
    return { hit: true, exact: true, kind, entity: cands[0], entities: [raw, ...cands].slice(0, 4), probe: normalizeAz(raw).slice(0, 5), entityWords: raw.split(/\s+/).length };
  }
  for (const r of RULES) {
    const m = n.match(r.re);
    if (!m) continue;
    const raw = m[1].trim();
    const asciiCands = entityCandidates(raw);
    if (!asciiCands.length) continue;
    // diakritikalı variantlar əvvəl (daha dəqiq), sonra ASCII
    const cands = [...new Set([...origVariants(query, raw.split(/\s+/).length), ...asciiCands])].slice(0, 4);
    const nounMatch = String(query).toLowerCase().match(/(rayon|şəhər|seher|vilayət|vilayet|oblast|region|district|cities)/);
    // səhv obyekt qoruması: "Fransanın" → "Fransa ödənişləri" kimi nəticələr
    const probe = normalizeAz(cands[0] || raw).replace(/[^a-z]/g, "").slice(0, 5);
    return { hit: true, exact: true, kind: r.kind, entity: cands[0], entities: cands, probe, entityWords: raw.split(/\s+/).length, noun: nounMatch ? nounMatch[1] : undefined };
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
  for (const lang of ["az", "en", "ru"]) {
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
  // Wikidata bir çağırışda ~50 ID qəbul edir → hissə-hissə
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (!chunk.length) continue;
    try {
      const j = await getJson(`${WB}?action=wbgetentities&ids=${chunk.join("|")}&props=labels&languages=az|en&format=json`, ms);
      for (const [id, ent] of Object.entries(j?.entities || {})) {
        const l = ent?.labels?.az?.value || ent?.labels?.en?.value;
        if (l) out.set(id, l);
      }
    } catch {}
  }
  return out;
}

const qidOf = (claim) => claim?.mainsnak?.datavalue?.value?.id || null;

export async function fetchFact(fact, ms = 2500) {
  if (!fact || !fact.hit) return null;
  const rule = RULES.find(r => r.kind === fact.kind);
  if (!rule) return null;
  // Namizəd entity-ləri sıra ilə yoxla: xassə BİRİNDƏ yoxdursa, digərinə keç
  const DBG = !!process.env.FACT_DEBUG;
  for (const cand of (fact.entities || [fact.entity]).slice(0, 3)) {
    const found = await searchEntity(cand, ms);
    if (DBG) console.log("cand", cand, "→", JSON.stringify(found));
    if (!found) continue;
    // səhv obyekt qoruması: "Fransanın" → "Fransa ödənişləri" (ad daha UZUNDUR) keçməməlidir
    if (fact.probe) {
      const lab = normalizeAz(String(found.label || ""));
      const wantWords = fact.entityWords || 1;
      const gotWords = lab.split(/\s+/).filter(Boolean).length;
      if (gotWords > wantWords) continue;
    }
    const claims = await claimsOf(found.id, ms).catch(() => null);
    if (DBG) console.log("claims?", !!claims, "prop", rule.prop, "n", claims?.[rule.prop]?.length);
    if (!claims) continue;
    const rawList = claims[rule.prop] || [];
    if (!rawList.length) continue;
    const rankVal = (c) => (c?.rank === "preferred" ? 0 : c?.rank === "deprecated" ? 2 : 1);
    const list = rawList.filter(c => c?.rank !== "deprecated").sort((a, b) => rankVal(a) - rankVal(b));

    if (fact.kind === "count_in") {
      const list2 = claims[rule.prop] || [];
      const ids2 = [...new Set(list2.map(qidOf).filter(Boolean))];
      if (!ids2.length) continue;
      const labels2 = await labelsOf(ids2, ms).catch(() => new Map());
      const vals = [...labels2.values()];
      const noun = (fact.noun || "rayon").toLowerCase();
      const filtered = vals.filter(v => normalizeAz(v).includes(normalizeAz(noun).replace(/^(seher|şeher)$/, "seher")));
      // adi halda "rayonu" ilə bitənləri say; çox az uyğunluq varsa ümumi sayı götür
      const count = filtered.length >= 5 ? filtered.length : vals.length;
      return { kind: "count_in", entity: found.label, qid: found.id, noun, count, source: "wikidata.org", fetched_at: new Date().toISOString() };
    }
    if (fact.kind === "borders") {
      const ids3 = [...new Set(list.map(qidOf).filter(Boolean))];
      if (!ids3.length) continue;
      const labs = await labelsOf(ids3, ms).catch(() => new Map());
      const names = [...labs.values()];
      return { kind: "borders", entity: found.label, qid: found.id, count: ids3.length, items: names, source: "wikidata.org", fetched_at: new Date().toISOString() };
    }
    if (fact.kind === "area") {
      let best = null;
      for (const c of list) {
        const v = c?.mainsnak?.datavalue?.value;
        const raw = v?.amount ?? v?.text ?? v;
        const num = Number(String(raw).replace("+", ""));
        if (!Number.isFinite(num) || num <= 0) continue;
        const unit = String(v?.unit || "");
        best = { num, unit };
        break;
      }
      if (!best) continue;
      return { kind: "area", entity: found.label, qid: found.id, value: best.num,
        // Q712226 = kvadrat kilometr (Wikidata-da P2046 üçün standart vahid), Q25343 ehtiyat
        unit: /Q712226|Q25343/.test(best.unit) ? "km²" : (/Q35852/.test(best.unit) ? "ha" : ""),
        source: "wikidata.org", fetched_at: new Date().toISOString() };
    }
    if (fact.kind === "population") {
      let best = null;
      let bestYear = -1e9;
      for (const c of list) {
        const v = c?.mainsnak?.datavalue?.value?.amount;
        if (!v) continue;
        const time = c?.qualifiers?.P585?.[0]?.datavalue?.value?.time || "";
        const num = Number(String(v).replace("+", ""));
        // time format "+00000002026-..." / "-00000004000-..." — numeric year with sign
        let y = 0;
        if (time) { const m = String(time).match(/^([+-])(\d+)/); if (m) y = (m[1]==="-"?-1:1)*Number(m[2].replace(/^0+/,"0")||0); }
        if (y > 8000) continue; // future year filter (wikidata erroneous 4000 future etc)
        if (!best || y > bestYear) { best = { num, time }; bestYear = y; }
      }
      if (!best) continue;
      return { kind: "population", entity: found.label, qid: found.id, value: best.num, as_of: best.time ? best.time.slice(1, 5) : null, source: "wikidata.org", fetched_at: new Date().toISOString() };
    }

    let claimsList = list;
    if (fact.kind === "works" && Array.isArray(claims.P527) && claims.P527.length) claimsList = [...list, ...claims.P527];
    // paytaxt: tarixi paytaxtlar (Bonn, Edo, Fujiwara-kyō) cavab DEYİL → 1 (preferred) götür
    let ids = [...new Set(claimsList.map(qidOf).filter(Boolean))].slice(0, 12);
    if (fact.kind === "capital") ids = ids.slice(0, 1);
    if (fact.kind === "country") ids = ids.slice(0, 2); // tarixi dövlətlər siyahısı cavab deyil
    if (!ids.length) continue;
    const labels = await labelsOf(ids, ms).catch(() => new Map());
    if (DBG) console.log("ids", ids.slice(0,4), "labels", labels.size);
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
  if (f.kind === "currency_of") return `${f.entity} — valyutası: ${f.items.join(", ")}.`;
  if (f.kind === "count_in") return `${f.entity} — ${f.noun} sayı: ${f.count} (Wikidata).`;
  if (f.kind === "country") return `${f.entity} — yerləşdiyi ölkə: ${f.items.join(", ")} (Wikidata).`;
  if (f.kind === "borders") return `${f.entity} — qonşu ölkələrin sayı: ${f.count} (${(f.items || []).join(", ")}) (Wikidata).`;
  if (f.kind === "area") return `${f.entity} sahəsi: ${fmtNum(f.value)}${f.unit ? " " + f.unit : ""} (Wikidata).`;
  if (f.kind === "population") return `${f.entity} əhalisi: ${fmtNum(f.value)} nəfər${f.as_of ? ` (${f.as_of})` : ""} (Wikidata).`;
  return "";
}

export { fmtNum };
