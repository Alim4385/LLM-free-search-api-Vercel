import { intentAnchor } from "./query-quality.js";
// Query expansion: uzun AZ sorğusunu açar sözlərə + EN-ə çevir
// v10 🟠6: (a) keywords STMMED tokenlardan Yox - xam (real) sözlərdən
// (stemed "sorg" kimi tokenlər provider sorğusu olub nəticəni pisləyirdi);
// (b) EN copy yalnız AZ xarakterli sorğuda - EN sorğunun lowercase surəti
// yeni sorğu deyil, boş provider çağırışı idi; (c) dictionary həqiqətən
// çevirmədən (>=2 mapped term) "english" sayılmır.
import { tokenize, normalizeAz, AZ_STOPWORDS } from "./rank.js";
import { normalizeColloquialAz, detectQueryLanguage } from "./clean.js";
import { isLongAzQuery, translateAzToEn, translateText } from "./translate.js";

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
  // v112: AZ→EN lüğəti — rus/ingilis anchor tərcüməsində səhv söz seçilməsin
  "stansiya": "station", "stansiyalar": "stations", "stansiyalarin": "stations",
  "stansiyanin": "station", "metropoliten": "metro", "metropoliteni": "metro",
  "metrosu": "metro", "metrosunda": "metro", "universitet": "university",
  "universitetlerin": "universities", "sayi": "number", "sayisi": "number",
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
  "melumatlar": "information", "sahifeler": "pages",
  "saytlar": "websites", "saytlari": "websites", "sayt": "website",
  "paytaxti": "capital", "paytaxt": "capital", "seher": "city", "seherdir": "city",
  "tercume": "translate", "tercumeci": "translator", "luget": "dictionary",
  "film": "movies", "filmler": "movies", "kino": "movies",
  "oyun": "game", "oyunlar": "games", "yaxsi": "best", "iyi": "best",
  "haqqinda": "about", "ucundur": "used for",
  "veb": "web", "internet": "internet", "sistemi": "system", "motor": "engine"
};

/**
 * v16: Danışıq dilindəki sualı həm orfoqrafik, həm də niyyət baxımından normallaşdırır.
 * Məs: "Xəbərlər hakda məlumat Azərbaycanda" -> "Azərbaycanda son xəbərlər"
 *      "Azərbaycan paytaxtı hansı şəhərdi" -> "Azərbaycan paytaxtı hansı şəhərdir"
 */
export function rewriteSearchIntentAz(rawQuery = "") {
  let q = normalizeColloquialAz(rawQuery);
  if (/(?<![\p{L}])(xəbər|xəbərlər|xeber|xeberler)(?![\p{L}])/iu.test(q) && /(?<![\p{L}])(haqqında|barədə|barəsində)\s+məlumat(?![\p{L}])/iu.test(q)) {
    const cleaned = q
      .replace(/(?<![\p{L}])(haqqında|barədə|barəsində)\s+məlumat(?![\p{L}])/giu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (cleaned) {
      if (/(?<![\p{L}])son(?![\p{L}])/iu.test(cleaned)) {
        q = cleaned;
      } else {
        const strippedNews = cleaned.replace(/^(?:xəbərlər|xəbər|xeberler|xeber)\s+/iu, "").trim();
        q = strippedNews ? `${strippedNews} son xəbərlər` : `${cleaned} son xəbərlər`;
      }
    }
  }
  return q;
}

// İngiliscəyə tərcümədən əvvəl ikimənalı sözləri dəqiqləşdir ("saytları" -> UNESCO "sites" olmasın, "veb-saytları" olsun!)
// v112: `site:` və domen tokenları SORĞU MƏTNİ DEYİL — dil aşkarlanması və tərcümə
// onlarsız aparılmalıdır. Əks halda "site:metro.gov.az stansiyaların sayı" sorğusu
// TR kimi aşkarlanıb "instances" kimi səhv anchor tərcüməsi verirdi.
const SITE_TOKEN_RE = /(?<![^\s])site:\S+/gi;
const DOMAIN_TOKEN_RE = /(?<![^\s])(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:az|com|org|net|gov|edu|info|ru|tr|io|co|biz|me|uz|kz)(?:\/\S*)?/giu;
export function stripSiteAndDomains(q = "") {
  return String(q || "").replace(SITE_TOKEN_RE, " ").replace(DOMAIN_TOKEN_RE, " ")
    .replace(/\s{2,}/g, " ").trim();
}

function prepareForEnTranslation(azQuery = "") {
  return normalizeColloquialAz(azQuery)
    .replace(/(?<![\p{L}])([\p{L}0-9._-]+)\s+sayt[ıi]\s+nə\s+üçündür(?![\p{L}])/giu, "$1 nədir və nə üçündür")
    .replace(/(?<![\p{L}])istifadə\s+edil(miş|ən)\s+sayt(lar[\p{L}]*)?(?![\p{L}])/giu, "ziyarət edilən veb-sayt$2")
    .replace(/(?<![\p{L}-])sayt(lar[\p{L}]*|ın|da|dan|a)?(?![\p{L}])/giu, "veb-sayt$1");
}
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
    const minMapped = raw.length === 1 ? 1 : 2;
    if (mappedCount >= minMapped) {
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
  const normQ = rewriteSearchIntentAz(query);
  const base = expandQuery(normQ);
  const anchor = intentAnchor(normQ);
  if (anchor) return { ...base, rewritten: normQ, english: anchor, translated: true };
  if (translateTimeoutMs <= 0) return { ...base, rewritten: normQ, translated: false };
  const langProbe = stripSiteAndDomains(normQ) || normQ;   // v112: site:/domen olmadan dil aşkarlanması
  const qLang = detectQueryLanguage(langProbe);
  // v17: Həm uzun AZ sorğularda, həm də qısa (1-3 sözlük) AZ/TR/RU sorğularda ("Tərcümə", "En iyi filmler", "GitHub haqqında məlumat") tərcümə işləyir!
  const needsTranslate = isLongAzQuery(normQ) || (qLang !== "en" && (!base.english || normQ.trim().split(/\s+/).length >= 2));
  if (!needsTranslate) return { ...base, rewritten: normQ, translated: false };
  const prep = qLang === "az" ? prepareForEnTranslation(stripSiteAndDomains(normQ) || normQ) : normQ;
  // v105: ÇOXDİLLİ KÖRPÜ — AZ sorğu üçün eyni anda TR və RU tərcümələri də alınır.
  // Səbəb: tr.wikipedia / ru.wikipedia AZ mövzularında (Xocalı, Şəki, universitet sayı,
  // minimum əmək haqqı) az.wikipedia-dan daha zəngindir. Ölçmə: AZ→TR tərcümə ilə
  // tr.wiki 50 nəticədən 26 faydalı, tərcüməsiz isə 7 nəticədən 2 faydalı.
  // v105.4: körpü YALNIZ yerli/AZ mövzulu sorğularda. Səbəb: körpü əlavə Wikimedia API
  // çağırışları edir və prod-da wikipedia provayderi 429-a düşürdü ("wikipedia: error"),
  // bu da əvvəl işləyən GPT-5 kimi sualları sındırırdı. Brend/texniki token (GPT-5, Python)
  // olan sorğuda EN korpusu düzgün seçimdir — körpü lazım deyil.
  const hasAnchorToken = /(?<![\p{L}\d])[\p{L}]{2,}[-]?\d{1,4}(?![\p{L}\d])/u.test(normQ);
  // ÖLÇMƏ NƏTİCƏSİ: körpü cavab sayını dəyişmədi (7/10 → 7/10), latency də dəyişmədi,
  // amma əlavə Wikimedia çağırışları prod-da 429 yükünü artırdı. Ona görə DEFAULT SÖNÜK —
  // AZ_BRIDGE=1 ilə yandırılır. Kod saxlanılır: provayder hovuzu genişlənəndə yenidən ölçüləcək.
  const wantBridges = qLang === "az" && process.env.AZ_BRIDGE === "1" && !hasAnchorToken;
  const tBudget = Math.round(translateTimeoutMs);
  // Körpü tərcümələri ARXA PLANDA başladılır (bloklamır) — əvvəl Promise.all üç tərcüməni
  // birlikdə gözləyirdi və hər AZ sorğuya ~1000 ms əlavə edirdi (canlı golden: 22/30).
  const bridgesPromise = wantBridges
    // yalnız TR: ölçmədə tr.wiki 50 nəticədən 26 faydalı, ru.wiki 50-dən 10 →
    // RU əlavə Wikimedia yükü yaradır, qazanc azdır
    ? translateText(normQ, "tr", "az", tBudget)
        .then(tr => (tr && tr.toLowerCase() !== normQ.toLowerCase() ? { tr } : {}))
        .catch(() => ({}))
    : null;
  const translated = await translateAzToEn(prep, tBudget, qLang).catch(() => null);
  if (translated && translated.toLowerCase() !== normQ.toLowerCase()) {
    return { ...base, rewritten: normQ, english: translated, translated: true, bridgesPromise, translateInput: prep };
  }
  return { ...base, rewritten: normQ, translated: false, bridgesPromise, translateInput: prep };
}

// Meta-sorğu detektoru (DeepSeek P0-2)
// v13 P2 (audit fix): tək topic marker ("ən azı N" / "hər biri") légitim sorğularda
// da olur ("sərhəddi olan ən azı 5 ölkə", "hər biri neçə qapıya") — əvvəlki tək-marker
// qaydası onları meta sayıb, stripMetaInstructions rəqəmi/mövzunu silirdi (canlı probe).
// İndi: imperativ marker (qaytarmalıdır/göstərməlidir/ehtiva etməlidir/olmalıdır)
// tək başına kifayətdir; topic markerlər isə ikisi birdən tələb olunur.
// v45: "olmalidir" gündəlik suallarda işlənir ("hansı sənədlər olmalıdır") → marker deyil
const IMPERATIVE_MARKERS = ["qaytarmalidir", "gostermelidir", "ehtiva", "cavab\s+ver\s+yalniz"];
const TOPIC_MARKERS = ["en azi", "her biri"];
// v45: "olmalıdır" tək başına marker DEYİL, əgər cümlədə sual sözü varsa
// ("hansı sənədlər olmalıdır" = adi sual). Sual sözü yoxdursa köhnə davranış.
const QUESTION_WORDS = /(?<![\p{L}])(hansi|nece|nedir|harada|haraya|hansini|which|what|how)(?![\p{L}])/u;

export function isMetaQuery(query) {
  const q = normalizeAz(query).toLowerCase();
  let imper = IMPERATIVE_MARKERS.filter(m => q.includes(m)).length;
  if (q.includes("olmalidir") && !QUESTION_WORDS.test(q)) imper += 1;
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
