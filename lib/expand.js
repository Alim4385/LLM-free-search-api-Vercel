// Query expansion: uzun AZ sorğusunu açar sözlərə + EN-ə çevir
// v10 🟠6: (a) keywords STMMED tokenlardan Yox - xam (real) sözlərdən
// (stemed "sorg" kimi tokenlər provider sorğusu olub nəticəni pisləyirdi);
// (b) EN copy yalnız AZ xarakterli sorğuda - EN sorğunun lowercase surəti
// yeni sorğu deyil, boş provider çağırışı idi; (c) dictionary həqiqətən
// çevirmədən (>=2 mapped term) "english" sayılmır.
import { tokenize, normalizeAz, AZ_STOPWORDS } from "./rank.js";
import { isLongAzQuery, translateAzToEn } from "./translate.js";

const AZ_EN = {
  "axtaris": "search", "axtarish": "search", "motoru": "engine", "motorunda": "engine",
  "neticelerin": "results", "neticeler": "results", "netice": "result",
  "formati": "format", "format": "format", "nece": "how", "olmalidir": "should",
  "ucin": "for", "ucun": "for", "ve": "and", "ile": "with",
  "suni": "artificial", "intellekt": "intelligence",
  "dilinde": "language", "dili": "language", "azerbaycan": "Azerbaijan", "azerbaycanda": "Azerbaijan",
  "baki": "Baku", "bakida": "Baku", "gun": "today", "bugun": "today", "sabah": "tomorrow",
  "hava": "weather", "necedir": "how", "olacaq": "will be", "qiymeti": "price",
  "mezennesi": "exchange rate", "dollar": "dollar", "avro": "euro",
  "xeberler": "news", "xeber": "news", "dunya": "world",
  "neftin": "oil", "neft": "oil", "qazin": "gas", "qaz": "gas",
  "ehali": "population", "ehaliisi": "population",
  "sual": "question", "cavab": "answer", "melumat": "information",
  "sistem": "system", "sistemleri": "systems", "xusussiyetleri": "features",
  "istifadeci": "user", "sorgusu": "query",
  "en": "most", "az": "least", "cox": "many",
  "yeni": "new", "son": "latest",
  "basliq": "title", "basligi": "title", "ehtiva": "contain",
  "etmelidir": "must", "biri": "each", "her": "each",
  "azi": "least", "qurulur": "built",
  "isleyir": "works", "nedir": "what is",
  "sorgu": "query", "sorgular": "queries", "cavablar": "answers",
  "melumatlar": "information", "sahifeler": "pages", "saytlar": "sites",
  "veb": "web", "internet": "internet", "sistemi": "system", "motor": "engine"
};
// Qeyd: v10 🟡 - `_`-li ("suni_intellekt", "her_biri"), `ğ`-li ("sorğusu") və
// `2`-li ("olmalidir2", "az2") açarlar ÖLÜ idi: raw token regex [a-z0-9]+ heç
// vaxt "_" vermir və normalizeAz əvvəlcə "ğ"->"g" çevirir - hamısı silindi.

export function expandQuery(query) {
  const raw = (normalizeAz(query).match(/[a-z0-9]+/g) || []);
  const content = raw.filter(w => w.length > 1 && !AZ_STOPWORDS.has(w));
  if (!content.length) return { original: query, expanded: null, english: null };

  // Açar söz versiyası: ilk 5 XAM (stem olunmamış) token
  const keywords = content.slice(0, 5).join(" ");
  const fullNorm = raw.join(" ");
  const expanded = keywords && keywords !== fullNorm && keywords.length < fullNorm.length ? keywords : null;

  // EN versiyası: YALNIZ sorğuda AZ xarakter varsa (əğışöüç) -
  // EN sorğunun ("Map in Java") lowercase surəti yeni provider sorğusu deyil
  const hasAzChars = /[əğışöüç]/.test(query.toLowerCase());
  let english = null;
  if (hasAzChars) {
    const enTerms = [];
    let mappedCount = 0;
    for (const w of raw) {
      if (AZ_EN[w]) { enTerms.push(AZ_EN[w]); mappedCount++; }
      else if (w.length > 1 && !["ve","ile","ucun","bu","o","ne","nece"].includes(w)) enTerms.push(w);
    }
    // Dictionary heç nə çevirməyibsə "english" YOX - orijinal AZ tokenlərin
    // surəti provider-ə gedib nəticəni pisləyirdi (v10: >=1 threshold idi)
    if (mappedCount >= 2) {
      const e = [...new Set(enTerms)].slice(0, 6).join(" ");
      if (e && e !== fullNorm) english = e;
    }
  }

  return {
    original: query,
    expanded,
    english: english && english !== keywords ? english : null
  };
}

// Async expansion: uzun AZ sorğular üçün pulsuz tərcümə (MyMemory)
// Qısa sorğularda dictionary kifayətdir - tərcümə çağırılmır (latency qənaəti)
// Uzun AZ-da dictionary zəifdir ("llm for search engine results format how should")
// MyMemory isə təbii EN verir ("What should the JSON format...") - anchor üçün idealdır
// v10.1 🔴4: translateTimeoutMs — searchAll-un ümumi 5s büdcəsinə görə çağırılır;
// büdcə bitibdirsə (<=0) tərcümə CƏHD OLUNMUR (MyMemory 1.2s boş yeyirdi)
export async function expandQueryAsync(query, translateTimeoutMs = 1200) {
  const base = expandQuery(query);
  if (!isLongAzQuery(query) || translateTimeoutMs <= 0) return { ...base, translated: false };
  const translated = await translateAzToEn(query, Math.round(translateTimeoutMs));
  if (translated && translated.toLowerCase() !== query.toLowerCase()) {
    return { ...base, english: translated, translated: true };
  }
  return { ...base, translated: false };
}

// Meta-sorğu detektoru (DeepSeek P0-2)
// v13 P2 (audit fix): tək topic marker ("ən azı N" / "hər biri") légitim sorğularda
// da olur ("sərhəddi olan ən azı 5 ölkə", "hər biri neçə qapıya") — əvvəlki tək-marker
// qaydası onları meta sayıb, stripMetaInstructions rəqəmi/mövzunu silirdi (canlı probe).
// İndi: imperativ marker (qaytarmalıdır/göstərməlidir/ehtiva etməlidir/olmalıdır)
// tək başına kifayətdir; topic markerlər isə ikisi birdən tələb olunur.
const IMPERATIVE_MARKERS = ["qaytarmalidir", "gostermelidir", "ehtiva", "olmalidir"];
const TOPIC_MARKERS = ["en azi", "her biri"];

export function isMetaQuery(query) {
  const q = normalizeAz(query).toLowerCase();
  const imper = IMPERATIVE_MARKERS.filter(m => q.includes(m)).length;
  const topic = TOPIC_MARKERS.filter(m => q.includes(m)).length;
  return imper >= 1 || topic >= 2;
}

export function stripMetaInstructions(query) {
  // DeepSeek: markerləri çıxar, mövzu sözlərini saxla (regex ilə)
  // v10 🟡: `və hər biri` regex-i ÖLÜ idi - "hər biri" əvvəlki replace-lərdə
  // artıq silinmişdi, birleşik pattern heç vaxt match etməzdi → silindi
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
    .replace(/\s+/g, ' ')
    .trim();
  // Əgər təmizlənmiş sorğu >=2 sözdürsə, onu istifadə et
  if (tokenize(cleaned).length >= 2) return cleaned;
  return null;
}
