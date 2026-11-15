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
  const s = String(text || "");
  if (s.includes("\u0259") || s.includes("\u018f")) return "az";
  if (/[\u0400-\u04ff]{3,}/.test(s)) return "ru";
  if (/[şğüöçİı]/u.test(s)) {
    if (/\b(bak[ıi]|haqq[ıi]nda|üçün|hans[ıi]|manat|azərbaycan)/iu.test(s)) return "az";
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
  const first = Array.isArray(j) ? j[0] : null;
  const out = Array.isArray(first) ? String(first[0] || "").trim() : (typeof first === "string" ? first.trim() : "");
  return out || null;
}

export async function translateText(text, targetLang, sourceLang = "auto", timeoutMs = 1500) {
  const raw = String(text || "").trim();
  if (!raw || !targetLang) return null;
  const key = `${sourceLang}->${targetLang}:${raw.slice(0, 240)}:${raw.length}`;
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

export async function translateAzToEn(text, timeoutMs = 1200) {
  if (timeoutMs <= 0) return null;
  const out = await translateText(text, "en", "auto", timeoutMs);
  if (!out || out.toLowerCase() === String(text || "").trim().toLowerCase()) return null;
  return out.slice(0, 300);
}

// v15 (Alim qaydası): sual hansı dildə verilibsə, xarici dildə olan sayt məzmununu
// həmin dilə çevirib qaytarır. Artıq həmin dildə olan nəticələrə toxunulmur (0ms).
const SEP = "\n[[[QSEP]]]\n";
export async function translateResultsToQueryLang(results, targetLang, budgetMs = 1800, maxPerSourceChars = 1500) {
  if (!Array.isArray(results) || !results.length || !targetLang || budgetMs <= 200) return false;
  let anyTranslated = false;
  await Promise.allSettled(results.map(async (r) => {
    if (!r || /open-meteo|cbar\.az|asia-baku/.test(String(r.source || "")) && targetLang === "az") return;
    const sample = `${r.title || ""} ${(r.content || r.snippet || "").slice(0, 400)}`;
    const srcLang = detectContentLanguage(sample);
    if (srcLang === targetLang) return;

    const titleOrig = String(r.title || "");
    const snipOrig = String(r.snippet || "");
    const contOrig = String(r.content || "");
    const combined = [titleOrig, snipOrig, contOrig].join(SEP);
    const tr = await translateText(combined, targetLang, srcLang, budgetMs);
    if (!tr) return;

    const parts = tr.split(/\s*\[\[\[QSEP\]\]\]\s*/);
    if (parts.length === 3) {
      if (parts[0].trim()) r.title = parts[0].trim().slice(0, 200);
      if (parts[2].trim()) r.content = parts[2].trim().slice(0, maxPerSourceChars);
      if (snipOrig && parts[1].trim()) {
        const sn = cutWord(parts[1].trim(), 200);
        r.snippet = sn === r.content ? undefined : sn;
      }
      anyTranslated = true;
    } else if (contOrig) {
      // Separator pozularsa yalnız content-i çevir (təhlükəsiz yol)
      const tc = await translateText(contOrig, targetLang, srcLang, Math.max(400, budgetMs - 400));
      if (tc) {
        r.content = tc.slice(0, maxPerSourceChars);
        if (r.snippet === r.content) r.snippet = undefined;
        anyTranslated = true;
      }
    }
  }));
  return anyTranslated;
}
