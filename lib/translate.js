// Pulsuz tərcümə sistemi (MyMemory) - keyless, qeydiyyatsız
// İstifadə: yalnız UZUN AZ sorğular üçün (hər axtarışda deyil - latency qənaəti)
// MyMemory: https://mymemory.translated.net - gündə 5000 simvol pulsuz, API key yoxdur
import { tokenize, normalizeAz, AZ_STOPWORDS } from "./rank.js";
import { detectQueryLanguage } from "./clean.js";

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
  // Əvvəlcə sorğunun AZ/TR olub-olmadığını yoxla - EN sorğular tərcümə olunmur
  // (Test4 "retrieval augmented generation..." EN-dir, tərcümə lazımsız latency-dir)
  const hasAzChars = /[əğışöüç]/.test(query.toLowerCase());
  const norm = normalizeAz(query);
  // Whole-word marker check (substring yox - "en" EN sözlərində də var: "generation")
  const words = norm.match(/[a-z0-9]+/g) || [];
  const hasAzMarker = AZ_MARKERS.some(m => words.includes(m));
  if (!hasAzChars && !hasAzMarker) return false;
  // v13 P10 (audit fix): tokenize() sual sözlərini atır ("ne", "zaman", "nasıl") →
  // adi 4-sözlük TR sualı ("Ankara ne zaman kuruldu") 2 term qalıb, heç vaxt
  // tərcüməyə/EN anchor-a çatmırdı (canlı probe: longAz=false). MyMemory mənbə
  // dilini avto-tanır (az|en vs tr|en probe-ləri 5/5 eyni keyfiyyət) — langpair
  // dəyişmə EHTİYAC YOXDUR; çatışmayan bu gate idi. Sual sözləri (ne/zaman)
  // stopword olub content sayından düşdüyündə gate XAM söz sayı ilə açılır —
  // yuxarıdakı AZ/TR filtri (hasAzChars/hasAzMarker) EN sorğuları artıq buraya salmır.
  const lang = detectQueryLanguage(query);
  const content = words.filter(w => w.length > 1 && !AZ_STOPWORDS.has(w));
  const terms = tokenize(query);
  if (words.length >= 4 || content.length >= 4 || terms.length >= 4) return true;
  if ((content.length >= 3 || terms.length >= 3) && (hasAzMarker || lang !== "en")) return true;
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

// v13 P12: translateEnToAz silindi (0 istifadə - dead code)
