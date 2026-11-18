// v106 — Dil körpüsü: məqalə səviyyəsində tərcümə.
// AZ-da məlumat azdır; eyni mövzunun TR (və RU) vikipediya versiyası çox vaxt daha zəngindir.
// Axtarışı başqa dildə TƏKRARLAMAQ əvəzinə, tapılmış məqalənin `langlinks`-i ilə qarşılığı
// götürülür — bu, deterministdir (axtarış keyfiyyətindən asılı deyil) və 1-2 API çağırışıdır.

const UA = "LLM-free-search-api/1.0 (keyless; contact: alim@example.com)";
const TTL = 10 * 60 * 1000;
const CACHE = globalThis.__qaqaWikiLinkCache || (globalThis.__qaqaWikiLinkCache = new Map());

function cached(key, fn) {
  const now = Date.now();
  const hit = CACHE.get(key);
  if (hit && now - hit.t < TTL) return Promise.resolve(hit.v);
  return fn().then(v => {
    if (CACHE.size > 300) CACHE.clear();
    CACHE.set(key, { t: now, v });
    return v;
  }).catch(() => null);
}

async function api(lang, params, timeoutMs = 1400) {
  const url = `https://${lang}.wikipedia.org/w/api.php?${params}&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error("wiki " + res.status);
  return res.json();
}

// "https://az.wikipedia.org/wiki/Bak%C4%B1_metrosu" → { lang:"az", title:"Bakı metrosu" }
export function wikiTitleFromUrl(url = "") {
  const m = String(url || "").match(/^https?:\/\/([a-z-]{2,12})\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i);
  if (!m) return null;
  let title = m[2];
  try { title = decodeURIComponent(title); } catch {}
  return { lang: m[1].toLowerCase(), title: title.replace(/_/g, " ") };
}

export async function fetchLanglink(lang, title, target) {
  if (!lang || !title || !target || lang === target) return null;
  return cached(`ll:${lang}:${target}:${title}`, async () => {
    const j = await api(lang, `action=query&prop=langlinks&lllang=${encodeURIComponent(target)}&titles=${encodeURIComponent(title)}&redirects=1`);
    const page = Object.values(j.query?.pages || {})[0];
    const t = page?.langlinks?.[0]?.["*"];
    return t || null;
  });
}

export async function fetchWikiExtract(lang, title, maxChars = 6000) {
  return cached(`ex:${lang}:${title}:${maxChars}`, async () => {
    const j = await api(lang, `action=query&prop=extracts&explaintext=1&exchars=${maxChars}&titles=${encodeURIComponent(title)}&redirects=1`, 1800);
    const page = Object.values(j.query?.pages || {})[0];
    return page?.extract || null;
  });
}

// Nəticələr içində vikipediya məqaləsi varsa, onun TR/RU qarşılığının MƏTNİNİ qaytarır.
// Qaytarır: { lang, title, url, text, from } və ya null.
export async function bridgeTextForResults(results = [], opts = {}) {
  const targets = opts.targets || ["tr", "ru"];
  const maxChars = opts.maxChars || 6000;
  const budgetMs = opts.budgetMs || 1600;
  const startedAt = Date.now();
  for (const r of results || []) {
    const w = wikiTitleFromUrl(r.url);
    if (!w) continue;
    for (const target of targets) {
      if (Date.now() - startedAt > budgetMs) return null;
      const title = w.lang === target ? w.title : await fetchLanglink(w.lang, w.title, target);
      if (!title || title === w.title) continue;
      const text = await fetchWikiExtract(target, title, maxChars);
      if (text && text.length >= 200) {
        return { lang: target, title, url: `https://${target}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`, text, from: w };
      }
    }
  }
  return null;
}

// Sorğuya görə məqalə tapıb digər dilə keçit: EN axtarışı → langlink → mətn.
// Say/rəqəm suallarında istifadə olunur: "universities in Azerbaijan" → "List of
// universities in Azerbaijan" → tr qarşılığı → mətn (içində 51).
export async function bridgeByQuery(query, opts = {}) {
  const q = String(query || "").trim();
  if (!q) return null;
  const targets = opts.targets || ["tr"];
  const maxChars = opts.maxChars || 5000;
  return cached(`bq:${q}:${targets.join(",")}:${maxChars}`, async () => {
    const j = await api("en", `action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${opts.limit || 3}`);
    const hits = j.query?.search || [];
    for (const h of hits.slice(0, opts.limit || 3)) {
      const title = String(h.title || "");
      if (!title) continue;
      for (const target of targets) {
        const t2 = await fetchLanglink("en", title, target);
        if (!t2) continue;
        const text = await fetchWikiExtract(target, t2, maxChars);
        if (text && text.length >= 200) {
          return { lang: target, title: t2, url: `https://${target}.wikipedia.org/wiki/${encodeURIComponent(t2.replace(/ /g, "_"))}`, text, from: { lang: "en", title } };
        }
      }
    }
    return null;
  });
}

// Sual formasından wiki axtarışı üçün təmiz sorğu: "How many universities are there in
// Azerbaijan?" → "universities azerbaijan" (axtarış API-si sual cümləsini sevmir).
export function cleanWikiQuery(q = "") {
  return String(q || "")
    .replace(/[?!.]+$/g, "")
    .replace(/^\s*(how\s+many|how\s+much|what\s+is|what\s+are|when\s+(did|was|is)|where\s+is|who\s+is|which\s+is)\s+/i, "")
    // "Number of universities in Azerbaijan" → "universities in Azerbaijan" (wiki axtarışı
    // "number of" ilə statistika səhifələrinə düşür, sadə ad isə düzgün məqaləni verir)
    .replace(/^\s*(the\s+)?(total\s+)?(number\s+of|count\s+of|say[ıi]\s+of)\s+/i, "")
    .replace(/\b(are\s+there|is\s+there|there\s+are|oldu|var)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// SAY sualı üçün körpü: məqalə mətninin GİRİŞİNDƏ (ilk 900 simvol) "N + isim" cütü axtarılır.
// Yalnız girişə baxmaq vacibdir: mətnin ortasında "30 hektar" kimi rəqəmlər say cavabı deyil.
export async function bridgeCount(azQuery, enQuery, noun, opts = {}) {
  const clean = cleanWikiQuery(enQuery);
  if (!clean || !noun) return null;
  const page = await bridgeByQuery(clean, { targets: opts.targets || ["tr", "ru"], maxChars: 4000 });
  if (!page) return null;
  const { extractCount } = await import("./countextract.js");
  const intro = String(page.text || "").slice(0, 900);
  const got = extractCount(intro, noun, { query: azQuery });
  if (!got || !(got.score >= 1.5 || got.fromWord)) return null;
  return { ...got, url: page.url, sources: [page.url], bridge_lang: page.lang, bridge_title: page.title };
}

// TARİX sualı üçün körpü: çıxarış məqalənin öz dilindəki başlıqla aparılır
// ("Hocalı Katliamı" → 26 fevral 1992), çünki AZ sorğu terminləri TR mətnində yoxdur.
export async function bridgeDate(azQuery, enQuery, opts = {}) {
  const clean = cleanWikiQuery(enQuery);
  if (!clean) return null;
  const page = await bridgeByQuery(clean, { targets: opts.targets || ["tr", "ru"], maxChars: 5000 });
  if (!page) return null;
  const { extractDateAnswer } = await import("./measure.js");
  const hit = extractDateAnswer(page.text, page.title) || extractDateAnswer(page.text, clean);
  if (!hit) return null;
  return { ...hit, url: page.url, sources: [page.url], bridge_lang: page.lang, bridge_title: page.title };
}

// Eyni MƏQALƏNİN digər dillərdəki versiyaları (langlinks) — "mövzunu təqib et" prinsipi:
// AZ məqaləsində rəqəm yoxdursa, həmin mövzunun TR/RU/EN versiyasında ola bilər.
// Qaytarır: [{ lang, title, url }]
export async function langlinkVariants(url, langs = ["tr", "ru", "en"]) {
  const w = wikiTitleFromUrl(url);
  if (!w) return [];
  const out = [];
  for (const target of langs) {
    if (target === w.lang) continue;
    const title = await fetchLanglink(w.lang, w.title, target);
    if (!title) continue;
    out.push({ lang: target, title, url: `https://${target}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` });
  }
  return out;
}
