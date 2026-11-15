// Query expansion: uzun AZ sorğusunu açar sözlərə + EN-ə çevir
import { tokenize, normalizeAz } from "./rank.js";
import { isLongAzQuery, translateAzToEn } from "./translate.js";

const AZ_EN = {
  "axtaris": "search", "axtarish": "search", "motoru": "engine", "motorunda": "engine",
  "neticelerin": "results", "neticeler": "results", "netice": "result",
  "formati": "format", "format": "format", "nece": "how", "olmalidir": "should",
  "ucin": "for", "ucun": "for", "ve": "and", "ile": "with",
  "suni": "artificial", "intellekt": "intelligence", "suni_intellekt": "artificial intelligence",
  "dilinde": "language", "dili": "language", "azerbaycan": "Azerbaijan", "azerbaycanda": "Azerbaijan",
  "baki": "Baku", "bakida": "Baku", "gun": "today", "bugun": "today", "sabah": "tomorrow",
  "hava": "weather", "necedir": "how", "olacaq": "will be", "qiymeti": "price",
  "mezennesi": "exchange rate", "dollar": "dollar", "avro": "euro",
  "xeberler": "news", "xeber": "news", "dunya": "world",
  "neftin": "oil", "neft": "oil", "qazin": "gas", "qaz": "gas",
  "ehali": "population", "ehaliisi": "population",
  "sual": "question", "cavab": "answer", "melumat": "information",
  "sistem": "system", "sistemleri": "systems", "xusussiyetleri": "features",
  "istifadeci": "user", "sorğusu": "query", "sorgusu": "query",
  "en": "most", "az": "least", "cox": "many", "az2": "few",
  "yeni": "new", "son": "latest", "en_son": "latest",
  "basliq": "title", "basligi": "title", "ehtiva": "contain", "ehtiva_etmelidir": "must contain",
  "etmelidir": "must", "biri": "each", "her": "each", "her_biri": "each",
  "azi": "least", "olmalidir2": "should be", "qurulur": "built", "qurulur": "built",
  "nece_qurulur": "how built", "isleyir": "works", "nedir": "what is",
  "sorgu": "query", "sorgular": "queries", "cavablar": "answers",
  "melumatlar": "information", "sahifeler": "pages", "saytlar": "sites",
  "veb": "web", "internet": "internet", "sistemi": "system", "motor": "engine"
};

export function expandQuery(query) {
  const terms = tokenize(query); // stopword-lar atılır, stemming olunur
  if (!terms.length) return { original: query, expanded: null, english: null };

  // Açar söz versiyası: ilk 5 mənzərəli token
  const keywords = terms.slice(0, 5).join(" ");

  // EN versiyası: AZ sözləri EN-ə çevir (xam token-lardan)
  const raw = (normalizeAz(query).match(/[a-z0-9]+/g) || []);
  const enTerms = [];
  for (const w of raw) {
    if (AZ_EN[w]) enTerms.push(AZ_EN[w]);
    else if (w.length > 1 && !["ve","ile","ucun","bu","o","ne","nece"].includes(w)) enTerms.push(w);
  }
  // >=1: qısa sorğularda ("LLM axtarış") tək termin kifayətdir - akronimlər saxlanılır
  const english = enTerms.length >= 1 ? [...new Set(enTerms)].slice(0, 6).join(" ") : null;

  return {
    original: query,
    expanded: keywords !== query ? keywords : null,
    english: english && english !== keywords ? english : null
  };
}

// Async expansion: uzun AZ sorğular üçün pulsuz tərcümə (MyMemory)
// Qısa sorğularda dictionary kifayətdir - tərcümə çağırılmır (latency qənaəti)
// Uzun AZ-da dictionary zəifdir ("llm for search engine results format how should")
// MyMemory isə təbii EN verir ("What should the JSON format...") - anchor üçün idealdır
export async function expandQueryAsync(query) {
  const base = expandQuery(query);
  if (!isLongAzQuery(query)) return { ...base, translated: false };
  const translated = await translateAzToEn(query, 1200);
  if (translated && translated.toLowerCase() !== query.toLowerCase()) {
    return { ...base, english: translated, translated: true };
  }
  return { ...base, translated: false };
}

// Meta-sorğu detektoru (DeepSeek P0-2)
const META_MARKERS = [
  "en azi", "her biri", "ehtiva", "qaytarmalidir", "gostermelidir"
];

export function isMetaQuery(query) {
  const q = normalizeAz(query).toLowerCase();
  const hits = META_MARKERS.filter(m => q.includes(normalizeAz(m))).length;
  return hits >= 1; // güclü təlimat markerləri: ən azı / hər biri / ehtiva
}

export function stripMetaInstructions(query) {
  // DeepSeek: markerləri çıxar, mövzu sözlərini saxla (regex ilə)
  let cleaned = query
    .replace(/ən azı\s*\d+/gi, '')
    .replace(/en azi\s*\d+/gi, '')
    .replace(/hər biri/gi, '')
    .replace(/her biri/gi, '')
    .replace(/ehtiva etməlidir/gi, '')
    .replace(/ehtiva etmelidir/gi, '')
    .replace(/olmalıdır/gi, '')
    .replace(/olmalidir/gi, '')
    .replace(/qaytarmalıdır/gi, '')
    .replace(/qaytarmalidir/gi, '')
    .replace(/göstərməlidir/gi, '')
    .replace(/gostermelidir/gi, '')
    .replace(/və hər biri[^,]*,?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Əgər təmizlənmiş sorğu >=2 sözdürsə, onu istifadə et
  if (tokenize(cleaned).length >= 2) return cleaned;
  return null;
}
