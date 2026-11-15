// Pulsuz tərcümə sistemi (MyMemory) - keyless, qeydiyyatsız
// İstifadə: yalnız UZUN AZ sorğular üçün (hər axtarışda deyil - latency qənaəti)
// MyMemory: https://mymemory.translated.net - gündə 5000 simvol pulsuz, API key yoxdur
import { tokenize, normalizeAz } from "./rank.js";

const cache = new Map(); // key -> {val, exp}
const CACHE_TTL = 60 * 60 * 1000; // 1 saat

function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.exp) { cache.delete(key); return null; }
  return v.val;
}
function cacheSet(key, val) {
  cache.set(key, { val, exp: Date.now() + CACHE_TTL });
  if (cache.size > 500) cache.clear(); // yaddaş qorunması
}

// Uzun AZ sorğu detektoru: tərcümə yalnız bunlarda istifadə olunur
// Qısa sorğular ("LLM", "Bakı hava") üçün lüzumsuzdur - dictionary kifayətdir
const AZ_MARKERS = ["ucun", "nece", "olmalidir", "axtaris", "motorunda", "neticelerin", "qurulur", "ehtiva", "her", "en", "ne", "harada", "neden", "hansi"];

export function isLongAzQuery(query) {
  // Əvvəlcə sorğunun AZ olub-olmadığını yoxla - EN sorğular tərcümə olunmur
  // (Test4 "retrieval augmented generation..." EN-dir, tərcümə lazımsız latency-dir)
  const hasAzChars = /[əğışöüç]/.test(query.toLowerCase());
  const norm = normalizeAz(query);
  // Whole-word marker check (substring yox - "en" EN sözlərində də var: "generation")
  const words = norm.match(/[a-z0-9]+/g) || [];
  const hasAzMarker = AZ_MARKERS.some(m => words.includes(m));
  if (!hasAzChars && !hasAzMarker) return false;
  const terms = tokenize(query);
  if (terms.length >= 4) return true;
  if (terms.length >= 3 && hasAzMarker) return true;
  if (query.length > 50 && hasAzMarker) return true;
  return false;
}

// v10.1 🟠6: kvora bitəndə MyMemory responseStatus ≠ 200 və ya
// "MYMEMORY WARNING: Your quota..." mətnini translatedText-də qaytara bilər —
// onu "tərcümə" saymaq olmaz (bütün provayderlərə EN anchor kimi gedərdi)
function myMemoryResult(j, clean) {
  if (Number(j?.responseStatus) !== 200) return null;
  if (!clean || clean.length < 3) return null;
  if (/MYMEMORY WARNING/i.test(clean)) return null;
  return clean;
}

export async function translateAzToEn(text, timeoutMs = 1200) {
  const key = "az-en:" + text.toLowerCase().trim();
  const cached = cacheGet(key);
  if (cached) return cached;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=az|en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = await res.json();
    const translated = j?.responseData?.translatedText;
    if (!translated || translated === text) return null;
    // MyMemory bəzən boş və ya eyni qaytarır - yoxla
    const clean = String(translated).trim().slice(0, 300);
    const ok = myMemoryResult(j, clean);
    if (!ok) return null;
    cacheSet(key, ok);
    return ok;
  } catch {
    return null;
  }
}

export async function translateEnToAz(text, timeoutMs = 1200) {
  const key = "en-az:" + text.toLowerCase().trim();
  const cached = cacheGet(key);
  if (cached) return cached;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|az`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = await res.json();
    const translated = j?.responseData?.translatedText;
    if (!translated || translated === text) return null;
    const clean = String(translated).trim().slice(0, 500);
    const ok = myMemoryResult(j, clean);
    if (!ok) return null;
    cacheSet(key, ok);
    return ok;
  } catch {
    return null;
  }
}
