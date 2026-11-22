// Pulsuz, açarsız (keyless) tərcümə sistemi — v15:
// 1) Sorğu tərcüməsi (AZ/TR -> EN anchor, axtarış keyfiyyəti üçün)
// 2) Cavab tərcüməsi (sual hansı dildə verilibsə, xarici dildəki sayt cavablarını
//    həmin dilə çevirib qaytarır — Alim qaydası)
// Prioritet zənciri: Google client=at (POST, sürətli, kvotasız) -> clients5 -> MyMemory (qısa mətn ehtiyatı)
import { tokenize, normalizeAz, AZ_STOPWORDS } from "./rank.js";
import { detectQueryLanguage, cutWord } from "./clean.js";

const cache = new Map(); // key -> {val, exp}
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 saat

function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.exp) { cache.delete(key); return null; }
  return v.val;
}
function cacheSet(key, val) {
  if (cache.size >= 800) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { val, exp: Date.now() + CACHE_TTL });
}

const AZ_MARKERS = ["ucun", "nece", "olmalidir", "axtaris", "motorunda", "neticelerin", "qurulur", "ehtiva", "her", "en", "ne", "harada", "neden", "hansi", "limiti", "yeni", "var"];

export function isLongAzQuery(query) {
  const hasAzChars = /[əğışöüç]/i.test(query);
  const norm = normalizeAz(query);
  const words = norm.match(/[a-z0-9]+/g) || [];
  const hasAzMarker = AZ_MARKERS.some(m => words.includes(m));
  if (!hasAzChars && !hasAzMarker) return false;
  const lang = detectQueryLanguage(query);
  const content = words.filter(w => w.length > 1 && !AZ_STOPWORDS.has(w));
  const terms = tokenize(query);
  if (words.length >= 4 || content.length >= 4 || terms.length >= 4) return true;
  if ((content.length >= 3 || terms.length >= 3) && (hasAzMarker || lang !== "en")) return true;
  if (query.length > 50 && hasAzMarker) return true;
  return false;
}

export function detectContentLanguage(text = "") {
  // Mötərizə içindəki tərcümə/transkripsiya qeydlərini ("(Azerbaijani: ...)") çıxar ki, dili çaşdırmasın
  const s = String(text || "").replace(/\([^)]{0,140}(?:Azerbaijani|azərbaycanca|Turkish|türkcə)[^)]{0,140}\)/giu, " ");
  const words = s.match(/[\p{L}]{2,}/gu) || [];
  const enStops = (s.match(/\b(the|is|are|was|were|with|from|that|this|which|for|and|in|of|to|on|as|by|at|can|may|will)\b/gi) || []).length;
  const azSchwa = (s.match(/[\u0259\u018f]/g) || []).length;
  const letterTotal = Math.max(1, words.join("").length);
  // İngilis mətnində EN bağlayıcıları çoxdur və 'ə' payı aşağıdır
  if ((enStops >= 3 && (azSchwa / letterTotal) < 0.045) || (enStops >= 2 && (azSchwa / letterTotal) < 0.03)) return "en";
  if (azSchwa >= 1) return "az";
  if (/[\u0400-\u04ff]{3,}/.test(s)) return "ru";
  if (/[şğüöçİı]/u.test(s)) {
    if (enStops >= 2) return "en";
    if (/\b(haqq[ıi]nda|üçün|hans[ıi]|manat|azərbaycan)/iu.test(s)) return "az";
    return "tr";
  }
  return "en";
}

function myMemoryResult(j, clean) {
  if (Number(j?.responseStatus) !== 200) return null;
  if (!clean || clean.length < 2) return null;
  if (/MYMEMORY WARNING/i.test(clean)) return null;
  return clean;
}

async function googleAtTranslate(text, tl, sl = "auto", timeoutMs = 1500) {
  const params = new URLSearchParams({ client: "at", dt: "t", sl, tl, q: text });
  const r = await fetch("https://translate.google.com/translate_a/single", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      "User-Agent": "Mozilla/5.0"
    },
    body: params.toString(),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!r.ok) return null;
  const j = await r.json();
  const out = (j?.[0] || []).map(seg => (seg && seg[0]) ? seg[0] : "").join("").trim();
  return out || null;
}

async function googleClients5Translate(text, tl, sl = "auto", timeoutMs = 1500) {
  const params = new URLSearchParams({ client: "dict-chrome-ex", sl, tl, q: text });
  const r = await fetch("https://clients5.google.com/translate_a/t", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      "User-Agent": "Mozilla/5.0"
    },
    body: params.toString(),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!r.ok) return null;
  const j = await r.json();
  // v30: dict-chrome-ex seqmentlər massivi qaytarır — HAMISINI birləşdir (əvvəl yalnız j[0][0] götürülürdü)
  let out = "";
  if (Array.isArray(j)) {
    out = j.map((seg) => Array.isArray(seg) ? String(seg[0] || "") : String(seg || "")).join(" ").trim();
  } else if (typeof j === "string") out = j.trim();
  return out || null;
}

// v30 (P1): kod/texniki tokenlər tərcümədən ƏVVƏL çıxarılır, sonra bərpa olunur.
// "React state management" → "Reakt vəziyyət idarəetməsi" kimi təhrifin qarşısını alır.
const PROTECT_RE = /(`[^`]{1,60}`|\b[a-z]+[A-Z][A-Za-z0-9]*\b|\b[A-Z]{2,6}\b|\b[A-Za-z]+\.[A-Za-z0-9]{2,6}\b|\b[A-Za-z_]+\.[A-Za-z_]+\b|\b\d+(?:[.,]\d+)?\s?(?:km²|km2|GB|MB|ms|s|%|milyon|milyard|min|ton)\b)/g;
// v33: SİYAHISIZ qoruma — sualda keçən latın tokenlər tərcümədə OLDUĞU KİMİ saxlanılır.
// "Rust ownership nədir" → Rust/ownership qorunur; siyahı sonsuz olmaqdan çıxır.
export function protectWithTerms(raw, terms = []) {
  const base = protectTokens(raw);
  let txt = base.txt;
  const keep = [...base.keep];
  const list = [...new Set((terms || []).filter((t) => /[A-Za-z]/.test(t) && t.length >= 3))]
    .sort((a, b) => b.length - a.length);
  for (const t of list) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
    txt = txt.replace(re, (m) => { keep.push(m); return `ZXQ${keep.length - 1}ZXQ`; });
  }
  return { txt, keep };
}

export function protectTokens(raw) {
  const keep = [];
  const txt = String(raw).replace(PROTECT_RE, (m) => {
    keep.push(m);
    return `ZXQ${keep.length - 1}ZXQ`;
  });
  return { txt, keep };
}
export function restoreTokens(out, keep) {
  if (!out || !keep.length) return out;
  const restored = String(out).replace(/ZXQ(\d+)ZXQ/g, (m, i) => (keep[Number(i)] !== undefined ? keep[Number(i)] : m));
  // v31: bütövlük yoxlaması — hər hansı token bərpa olunmadısa, tərcüməni QABUL ETMƏ
  // (səssiz itki "React state" → "Reaksiya vəziyyəti" kimi təhrifdən betərdir)
  if (!keep.every((k) => restored.includes(k))) return null;
  return restored;
}

export async function translateText(text, targetLang, sourceLang = "auto", timeoutMs = 1500, terms = []) {
  const raw = String(text || "").trim();
  if (!raw || !targetLang) return null;
  const __prot = terms && terms.length ? protectWithTerms(raw, terms) : protectTokens(raw);
  const __origRaw = raw;
  const __t = await translateTextInner(__prot.txt, targetLang, sourceLang, timeoutMs);
  return __t ? restoreTokens(__t, __prot.keep) : __t;
}

async function translateTextInner(text, targetLang, sourceLang = "auto", timeoutMs = 1500) {
  const raw = String(text || "").trim();
  if (!raw || !targetLang) return null;
  const key = `${sourceLang}->${targetLang}:${raw}`; // v30: tam mətn — slice toqquşması bitdi
  const hit = cacheGet(key);
  if (hit) return hit;

  const t1 = Math.max(300, Math.min(timeoutMs, 1400));
  try {
    const g1 = await googleAtTranslate(raw, targetLang, sourceLang, t1);
    if (g1) { cacheSet(key, g1); return g1; }
  } catch {}

  if (timeoutMs >= 700) {
    try {
      const g2 = await googleClients5Translate(raw, targetLang, sourceLang, Math.max(400, timeoutMs - 300));
      if (g2) { cacheSet(key, g2); return g2; }
    } catch {}
  }

  // Qısa sorğular üçün MyMemory son ehtiyat
  if (raw.length <= 450 && timeoutMs >= 600) {
    try {
      const sl = sourceLang === "auto" ? "az" : sourceLang;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(raw)}&langpair=${sl}|${targetLang}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.min(1000, timeoutMs)) });
      if (res.ok) {
        const j = await res.json();
        const tr = String(j?.responseData?.translatedText || "").trim();
        const ok = myMemoryResult(j, tr);
        if (ok && ok.toLowerCase() !== raw.toLowerCase()) {
          cacheSet(key, ok);
          return ok;
        }
      }
    } catch {}
  }
  return null;
}

// v117: AZ hal şəkilçisini təmizləyərək tərcümə — "Çinin paytaxtı" → "Çin paytaxt" → "China capital" (əvvəl "cinin capital hansi city" idi)
// v121: şəkilçi kəsmə yalnız XÜSUSİ ADLAR üçündür; "ün/ın/in/un/ya/yə/da/də…" ilə bitən adi sözləri korlayırdı:
// "bugün" → "bug" (xəbər sorğusu texniki sayılır), "dünya" → "dün", "Rusiya" → "Rusi", "Türkiyə" → "Türki".
// Ən çox işlənən belə sözlər qorunur (siyahı tam deyil — əsas həll prepareTranslateInput-dakı dil yoxlamasıdır).
const AZ_PROTECTED_WORDS = new Set([
  "bugün", "bugun", "dünya", "dunya", "rusiya", "türkiyə", "turkiye", "türkiye", "qadın", "qadin", "dünən", "dunen"
]);
function stripAzCaseForTranslate(w) {
  const low = String(w || "").toLowerCase();
  const orig = String(w || "");
  if (low.length < 4) return w;
  if (AZ_PROTECTED_WORDS.has(low)) return w;
  // cəhd 1: 3 hərfli şəkilçi (nın/nin/nun/nün) — Azərbay//canın → Azərbaycan
  if (/(nın|nin|nun|nün)$/u.test(low)) {
    const cand3 = orig.slice(0, -3);
    const cand2 = orig.slice(0, -2);
    // hansı daha mənalıdır? Əgər 3-lük kəsim 3+ hərf saxlayırsa, onu götür, yoxsa 2-lik
    if (cand3.length >= 3) return cand3;
    if (cand2.length >= 3) return cand2;
    return cand3;
  }
  // v122: 2 hərfli şəkilçilər ÇOX qeyri-müəyyəndir (bugün/dünya/qadın/Rusiya…) → yalnız BÖYÜK hərflə başlayan
  // (xüsusi ad ola bilən) sözlərə tətbiq olunur. Kiçik hərfli "bakıda", "dünya" toxunulmaz qalır — MT onları özü düzgün tərcümə edir.
  if (/^\p{Lu}/u.test(orig) && /(ın|in|un|ün|da|də|dan|dən|ya|yə|na|nə)$/u.test(low)) return orig.slice(0, -2);
  return w;
}
function cleanForTranslate(text) {
  let s = String(text || "");
  s = s.split(/([^\p{L}\p{N}-]+)/u).map(tok => {
    if (/^[\p{L}]{4,}$/u.test(tok)) {
      // uzun sözlər (Azərbaycanın, paytaxtı) Google tərəfindən onsuz da düzgün tərcümə olunur — toxunma
      // problem yalnız QISA xüsusi adlarda (Çinin, Misirin) olur: "cinin capital" kimi zibil
      if (tok.length > 8) return tok;
      const stripped = stripAzCaseForTranslate(tok);
      if (stripped.length >= 3 && stripped.toLowerCase() !== tok.toLowerCase()) return stripped;
    }
    return tok;
  }).join("");
  return s;
}
// v121: cleanForTranslate AZ-spesifik heuristikadır → yalnız mənbə dili "az" olanda tətbiq olunur.
// Əvvəl tr/ru/auto sorğulara da tətbiq olunurdu: türkcə "bugün" → "bug" → anchor "Istanbul bug breaking news".
export function prepareTranslateInput(text, sourceLang = "auto") {
  if (sourceLang !== "az") return String(text || "");
  return cleanForTranslate(text);
}
export async function translateAzToEn(text, timeoutMs = 1200, sourceLang = "auto") {
  if (timeoutMs <= 0) return null;
  const sl = (sourceLang === "az" || sourceLang === "tr" || sourceLang === "ru") ? sourceLang : "auto";
  const cleaned = prepareTranslateInput(text, sl);
  const out = await translateText(cleaned, "en", sl, timeoutMs);
  if (!out || out.toLowerCase() === String(text || "").trim().toLowerCase()) return null;
  return out.slice(0, 300);
}

// v15/v17 (Alim qaydası): sual hansı dildə verilibsə, xarici dildə olan sayt məzmununu
// həmin dilə çevirib qaytarır. Artıq həmin dildə olan nəticələrə toxunulmur (0ms).
const SEP = "\n§§909§§\n";
export async function translateResultsToQueryLang(results, targetLang, budgetMs = 2400, maxPerSourceChars = 1600, terms = []) {
  if (!Array.isArray(results) || !results.length || !targetLang || budgetMs <= 200) return false;
  let anyTranslated = false;
  await Promise.allSettled(results.map(async (r) => {
    // v48.5: ÖZ yaratdığımız structured cavablar (hava/valyuta/saat/Wikidata/idman/hesablama)
    // TƏRCÜMƏ OLUNMUR — tərcümə qatı "Fransa paytaxtı"nı "Fransa ödənişləri" edirdi.
    if (!r || /^(open-meteo|cbar\.az|asia-baku|wikidata|thesportsdb|hesablama|usda)$/.test(String(r.source || ""))) return;
    let srcLang = null;
    try {
      const h = new URL(r.url).hostname.toLowerCase();
      if (h === "en.wikipedia.org") srcLang = "en";
      else if (h === "az.wikipedia.org") srcLang = "az";
      else if (h === "tr.wikipedia.org") srcLang = "tr";
    } catch {}
    if (!srcLang) {
      // Yalnız title + content əsasında dil müəyyən et (snippet-də yerli tarix ola bilər)
      const sample = `${r.title || ""} ${(r.content || "").slice(0, 500)}`;
      srcLang = detectContentLanguage(sample);
    }
    if (srcLang === targetLang) return;

    const titleOrig = String(r.title || "");
    const snipOrig = String(r.snippet || "");
    const contOrig = String(r.content || "");
    const combined = [titleOrig, snipOrig, contOrig].join(SEP);
    const tr = await translateText(combined, targetLang, srcLang, budgetMs, terms);
    const parts = tr ? tr.split(/\s*§+\s*909\s*§+\s*/) : [];
    if (parts.length === 3) {
      if (parts[0].trim()) r.title = parts[0].trim().slice(0, 200);
      if (parts[2].trim()) r.content = parts[2].trim().slice(0, maxPerSourceChars);
      if (snipOrig && parts[1].trim()) {
        const sn = cutWord(parts[1].trim(), 200);
        r.snippet = sn === r.content ? undefined : sn;
      }
      anyTranslated = true;
    } else if (contOrig || titleOrig) {
      // Separator pozularsa həm title, həm content paralel çevrilir ki, ingiliscə başlıq qalmasın!
      const [tt, tc] = await Promise.all([
        titleOrig ? translateText(titleOrig, targetLang, srcLang, Math.max(450, budgetMs - 300), terms) : Promise.resolve(null),
        contOrig ? translateText(contOrig, targetLang, srcLang, Math.max(500, budgetMs - 200), terms) : Promise.resolve(null)
      ]);
      if (tt) r.title = tt.trim().slice(0, 200);
      if (tc) {
        r.content = tc.slice(0, maxPerSourceChars);
        if (r.snippet === r.content) r.snippet = undefined;
      }
      if (tt || tc) anyTranslated = true;
    }
  }));
  return anyTranslated;
}
