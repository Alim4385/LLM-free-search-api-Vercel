// Relevance scoring + domain diversification (v15)
import { tokenize, normalizeAz, trigramSimilarity, trigrams, isGenericNewsTerm, NEWS_WORD_RE } from "./rank.js";

export const SPAM_DOMAINS = [
  "gitee.com", "twitpic.com", "imgur.com", "flickr.com", "i.imgur.com", "photobucket.com",
  "pinterest.com", "quora.com",
  "cataliahealth.com"
];

export const JUNK_DOMAINS = [
  // v55.1: sosial şəbəkə / UGC və Google News RSS başlıqları fakt sualına cavab vermir
  // ("Azərbaycanda ilk metro" → facebook.com video, news.google.com başlıq linki)
  "facebook.com", "tiktok.com", "instagram.com", "twitter.com", "x.com",
  "threads.net", "vk.com", "ok.ru", "news.google.com",
  // v56.2: reddit səhifələri ekstraksiyada "log in to your Reddit account" blokunu qaytarır
  "reddit.com",
  "rocketreach.com", "rocketreach.co", "linkedin.com", "glassdoor.com",
  "crunchbase.com", "zoominfo.com", "apollo.io", "owler.com",
  "contactout.com", "lusha.com", "theorg.com", "signalhire.com",
  "snov.io", "leadgenius.com", "rocketreach.ru", "zoominfo.co.uk"
];

export const TRUSTED_MULTI_DOMAINS = [
  "wikipedia.org", "vercel.com", "nextjs.org", "docs.python.org",
  "developer.mozilla.org", "learn.microsoft.com", "react.dev",
  "nodejs.org", "github.com", "stackoverflow.com"
];

export function isSpamDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return SPAM_DOMAINS.some(d => host === d || host.endsWith("." + d));
  } catch { return false; }
}

export function isJunkDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return JUNK_DOMAINS.some(d => host === d || host.endsWith("." + d));
  } catch { return false; }
}

// Auth/login səhifələri heç vaxt sual cavabı vermir (Bing "Login - Vercel" zibilini atır)
function isAuthOrBareSearchRoot(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const p = u.pathname.toLowerCase().replace(/\/$/, "");
    if ((host === "google.com" || host === "bing.com" || host === "yahoo.com") && p === "") return true;
    if (/^\/(login|signin|sign-in|signup|sign-up|auth|register)(\/|$)/.test(p)) return true;
    return false;
  } catch { return false; }
}

const DEFINITION_QUERY_RE = /(?<![\p{L}])(nə\s+demək[\p{L}]*|məna[\p{L}]*|lüğət|tərif[\p{L}]*|definition|meaning|what\s+does\s+.+\s+mean)(?![\p{L}])/iu;
const CURRENT_INTENT_RE = /(?<![\p{L}])(ən\s+çox|son|bu\s+gün|bugün|hazırda|indiki|yeni|top|best|most\s+visited|most\s+popular|latest|current)(?![\p{L}])/iu;
const OVERVIEW_QUERY_RE = /(?<![\p{L}])(nədir|nedir|nə\s+üçündür|nə\s+işə\s+yarayır|ne\s+işe\s+yarar|haqqında(\s+məlumat)?|what\s+is)(?![\p{L}])/iu;
const CASINO_SPAM_RE = /(?<![\p{L}])(kazino|kazinolar|casino|1xbet|mostbet|pin-?up|melbet|betwinner|slot\s+oyun|mərc\s+sayt)(?![\p{L}])/iu;
const FOREIGN_PATH_RE = /^\/(sv|de|fr|es|pt|it|nl|pl|cs|hu|ro|fi|da|no|ja|ko|zh|ar|he|vi|th|id)(\/|$)/i;
const WEBSITE_LIST_QUERY_RE = /(?<![\p{L}])(saytlar|saytları|saytlari|veb-?saytlar|veb-?saytları|websites)(?![\p{L}])/iu;
const WEBSITE_SIGNAL_RE = /(?<![\p{L}])(sayt[\p{L}]*|veb[\p{L}]*|web[\p{L}]*|site|sites|online|onlayn|izlə[\p{L}]*|izle[\p{L}]*|watch|stream[\p{L}]*|platform[\p{L}]*|portal[\p{L}]*|domain|trafik|traffic|ziyarət[\p{L}]*|visit[\p{L}]*|internet)(?![\p{L}])|\b[a-z0-9-]+\.(az|com|org|net|tv|io)\b/iu;
// v46.2: "seçki" NEWS sayılmır — "son seçkilər NƏ VAXT olub" fakt sualıdır,
// xəbər niyyəti wikipedia cəzası verib cavabı tamam boşaldırdı
const NEWS_RE = /(son\s+(xeber|xəbər|oyun|matç|nəticə|hesab)|udubmu|uduzubmu|oyunun\s+nəticəsi|matç\w*\s+nəticə|xəbər[\p{L}]*|xeber[\p{L}]*|gündəm|gundem|son\s+saat|breaking\s+news|latest\s+news|today'?s?\s+news|gündem\s+xəbər|indi\s+(ne|nə)|what\s+happened|(?<![\p{L}])(news|headlines?|top\s+stories|fact\s*check|live\s+updates|noticias|haberler|actualités|nachrichten|новости)(?![\p{L}]))/iu;

function isDictionaryPage(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    const p = u.pathname.toLowerCase();
    if (h === "merriam-webster.com" || h.endsWith(".wiktionary.org") || h === "dictionary.com" || h === "urbandictionary.com") return true;
    if (p.startsWith("/dictionary/")) return true;
    return false;
  } catch { return false; }
}
const TECH_RE = /\b(javascript|typescript|python|golang|nodejs|node\.?js|next\.?js|vercel|serverless|timeout|asyncio|taskgroup|react|vue\.?js|angular|svelte|tailwind|vite|prisma|api|json|framework|library|docker|kubernetes|sql|github|git|code|kod|bug|hata|error|program\w*|algoritm\w*|rag|llm|gpt|chatgpt|claude|machine\s+learning|yapay\s+zeka|server|software|linux|ubuntu|npm|cloudflare|mühəndis\w*)\b/i;

export function isNewsQuery(q = "") { return NEWS_RE.test(q); }
export function isTechQuery(q = "") { return TECH_RE.test(q); }

const DOMAIN_BONUS = {
  "wikipedia.org": 1, "stackoverflow.com": 1, "vercel.com": 1, "nextjs.org": 1,
  "docs.python.org": 1, "developer.mozilla.org": 1, "react.dev": 1.6, "nodejs.org": 0.9,
  "git-scm.com": 1.4, "postgresql.org": 1.4, "mysql.com": 1.3, "dev.mysql.com": 1.3,
  "javascript.info": 1.3, "typescriptlang.org": 1.3, "w3schools.com": 0.9, "aws.amazon.com": 0.8,
  "arxiv.org": 0.5, "github.com": 1, "microsoft.com": 1,
  "cloud.google.com": 1, "translate.google.com": 1.2, "translate.google.az": 1.5,
  "learn.microsoft.com": 1, "news.google.com": 0.3,
  "spring.io": 0.8, "britannica.com": 0.8, "geeksforgeeks.org": 0.5, "semrush.com": 0.8, "similarweb.com": 0.8,
  // v27: how-to texniki suallarda rəsmi sənəd saytları
  "kotlinlang.org": 1.4, "man7.org": 1.3, "wiki.archlinux.org": 1.2, "linux.die.net": 0.8,
  "stat.gov.az": 1.5, "cbar.az": 1.2, "e-qanun.az": 1.0, "sosial.gov.az": 1.2,
  "taxes.gov.az": 2.5, "vergiler.az": 1.8, "my.gov.az": 2.2, "e-gov.az": 1.6, "asan.gov.az": 1.5, "asan.az": 1.0, "president.az": 1.4, "edu.gov.az": 1.4
};
const BONUS_DOMAINS = Object.entries(DOMAIN_BONUS).sort((a, b) => b[0].length - a[0].length);
// v122: generic gov.az boost — hər hansı .gov.az rəsmi sayılır (free harden)
function govBoost(url="") { try { const h=new URL(String(url||"")).hostname.toLowerCase(); if (h.endsWith(".gov.az")||h=="gov.az") return 4.5; if (/\.gov\.[a-z]{2,3}$/.test(h) || h.endsWith(".gov.tr") || h.endsWith(".gov.ru") || h.endsWith(".gouv.fr") || h.endsWith(".gov.uk")) return 3.0; if (h.endsWith(".gov")||h.endsWith(".edu")||h.endsWith(".edu.az")||h.endsWith(".edu.tr")) return 2.0; } catch{} return 0; }
// v122: kimdir → bio məqaləsi bonusu (muzey/abidə cəzası)
function kimdirBoost(query="", title="", url="") {
  if (!/(kimdir|kimdi|kto\s+takoy|кто\s+такой|кто\s+такая|kim\s+oldu|who\s+is|who\s+was|qui\s+est|wer\s+ist)/i.test(String(query||""))) return 0;
  const tl=(String(title||"").toLowerCase());
  const ul=(String(url||"").toLowerCase());
  if (/(muzey|ev-muzeyi|abid[əe]|heyk[əe]l|filmi|kino|topik|channel|museum|музей|müze|abide)/i.test(tl) || /(ev-muzeyi|abide|heyke|museum)/i.test(ul)) return -1.4;
  // exact entity match bonus: title qısa və query entity-sinə yaxın
  if (tl.length <= 60 && !/(muzey|abide)/i.test(tl)) return 0.9;
  return 0;
}
// v122: tərcümə sorğusu üçün translate domen boostu
const TRANSLATE_DOMAINS=["translate.google","reverso.net","reverso.context","tureng.com","glosbe.com","azerdict.com","cevirsozluk.com","dictionary.cambridge","pons.com","wordreference.com","linguee.com","tatoeba.org"];
function translateBoost(query="", url="") {
  const ql=String(query||"").toLowerCase(); const ul=String(url||"").toLowerCase();
  if (/(tercume|tərcümə|translate|ceviri|çeviri|translat)/i.test(ql) && ul.includes("genius.com")) return -3.0;
  if (!/(t[əe]rc[üu]m[əe]|tercume|translate|çeviri|ceviri|translat)/i.test(String(query||""))) return 0;
  const h= (()=>{ try{return new URL(String(url||"")).hostname.toLowerCase()}catch{return ""}})();
  for (const d of TRANSLATE_DOMAINS) if (h.includes(d)) return 2.4;
  return 0;
}
function azFold(x) {
  return String(x || "").toLowerCase().normalize("NFC")
    .replace(/\u0307/g, "")
    .replace(/sh/g, "s").replace(/ch/g, "c")
    .replace(/[şs]/g, "s").replace(/[çc]/g, "c").replace(/[əea]/g, "e")
    .replace(/[ğg]/g, "g").replace(/[öo]/g, "o").replace(/[üu]/g, "u").replace(/[ıi]/g, "i")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

const AZ_STOPWORDS_LITE = new Set(["ve","ile","ucun","üçün","bu","o","bir","ne","nə","nedir","kimdir","haqqinda","haqqında","the","of","a","in","and","for"]);
const qSetLike = (arr, t) => arr.some(x => x === t);

const NON_ACADEMIC_TERMS = new Set(["json", "format", "snippet", "url", "api", "response", "vercel", "timeout", "nextjs", "sayt", "websites", "lake", "borders"]);

const QGRAMS_CACHE = new WeakMap();
function qGramsFor(queryTerms) {
  let m = QGRAMS_CACHE.get(queryTerms);
  if (!m) {
    m = new Map(queryTerms.map(qt => [qt, trigrams(qt)]));
    QGRAMS_CACHE.set(queryTerms, m);
  }
  return m;
}

// v51.3: mənasız/klaviatura zibili tokenlər ("asdfqwer", "zxcvbnm", "zzzz").
// Belə tokenlər əlaqə sayılmır: əks halda "asdfqwer zxcvbnm nonsense" sorğusuna
// YouTube kimi səhifələr düşürdü (orada həmin hərf silsiləsi təsadüfən var).
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
// v114: real texniki akronimlər "sait yoxdur" qaydasına düşüb TERM SİYAHISINDAN SİLİNİRDİ.
// Ölçmə: tokenize("HTTP ilə HTTPS arasındakı fərq nədir") → ["http","https","aras","ferq"],
// amma `looksLikeGibberish` http/https-i zibil sayırdı və skor yalnız "aras/ferq" üzərində
// qurulurdu → 14 yaxşı nəticədən 1-i qalırdı. Eyni problem GPT/SQL/CSS/HTML/NPM üçün də var idi.
const TECH_KEEP = new Set(["abs", "bmt", "dms", "who", "usa", "uk", "eu", "ai", "llm", "rag", "nasa", "opec", "http", "https", "http2", "http3", "html", "css", "js", "ts", "sql", "gpt", "npm", "png",
  "jpg", "svg", "pdf", "xml", "yml", "cli", "sdk", "cbd", "gpu", "cpu", "ram", "ssd", "hdd", "usb", "api", "json", "yaml",
  "httpd", "ssh", "tls", "ssl", "dns", "tcp", "udp", "ftp", "smtp", "cors", "csrf", "jwt", "orm", "cdn", "vpn", "nas",
  "dnt", "nba", "fifa", "uefa", "un", "unesco", "unicef", "css3", "html5"]);
export function looksLikeGibberish(tok) {
  const t = String(tok || "").toLowerCase();
  if (t.length < 3) return false;
  if (TECH_KEEP.has(t)) return false;                             // real akronim
  if (/\d/.test(t)) return false;                                 // rəqəmli token (gpt5, 4k) — zibil deyil
  if (/(.)\1{2,}/.test(t)) return true;                            // zzzz / qqq
  // klaviatura sırası: 5 simvolluq ARDICI alt sətir (qwert, asdfg, zxcvb)
  for (const row of KEYBOARD_ROWS) {
    for (let i = 0; i + 5 <= t.length; i++) if (row.includes(t.slice(i, i + 5))) return true;
  }
  // 4 simvolluq alt sətir YALNIZ sait payı çox aşağıdırsa zibildir ("metr"/"etro" kimi
  // real sözlər əvvəl səhvən zibil sayılırdı)
  const vowels = (t.match(/[aeiouyаеиоуыэюяəıöü]/g) || []).length;
  const ratio = vowels / t.length;
  if (ratio < 0.34) {
    for (const row of KEYBOARD_ROWS) {
      for (let i = 0; i + 4 <= t.length; i++) if (row.includes(t.slice(i, i + 4))) return true;
    }
  }
  // SAİTSİZ token: qısa akronimlər (HTTP → whitelist) istisnadır, qalanı zibildir.
  // ("strengths" kimi real söz 1 saitlə keçir — onu samit silsiləsi qaydası tutmur.)
  if (!vowels) return true;
  if (/[bcdfghjklmnpqrstvwxzşçğ]{6,}/.test(t)) return true;       // 6+ samit silsiləsi
  return false;
}

// v56: əsas ölkə adları (normallaşdırılmış: diakritika yox, kiçik hərf)
export const COUNTRIES = [
  "azerbaycan","turkiye","rusiya","gurcustan","ermenistan","iran","iraq","hindistan",
  "cin","yaponiya","koreya","almaniya","fransa","italiya","ispaniya","portugaliya",
  "ingiltere","britaniya","abs","kanada","meksika","braziliya","misir","qazaxistan",
  "ozbekistan","turkmenistan","qirgizistan","ukrayna","polsa","yunanistan","pakistan",
  "afganistan","suriy","israil","seudi","emirlik","malayziya","indoneziya","avstraliya"
];

const foldAz = (x) => String(x || "").toLowerCase()
  .replace(/ə/g, "a").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
  .replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u");
const skeleton = (w) => foldAz(w).replace(/[aeiou]/g, "");

const COUNTRY_SK = new Set(COUNTRIES.map(c => skeleton(c)).filter(k => k.length >= 2));

// mətndəki hansı ölkə adları var (sait-baqişsız kök üzrə)
function countrySkeletons(text) {
  const out = new Set();
  for (const w of String(text || "").split(/[^\p{L}]+/u)) {
    if (w.length < 3) continue;
    const sk = skeleton(w);
    if (sk.length >= 2 && COUNTRY_SK.has(sk)) out.add(sk);
  }
  return out;
}

export function scoreResult(result, queryTerms, lang = "en", queryRaw = "") {
  if (isJunkDomain(result.url) || isAuthOrBareSearchRoot(result.url)) return 0;
  if (isDictionaryPage(result.url) && !DEFINITION_QUERY_RE.test(queryRaw)) return 0;
  const hayRaw = `${result.title || ""} ${result.snippet || ""}`;
  const spamNorm = (x) => String(x || "").toLowerCase().normalize("NFC").replace(/\u0307/g, "").replace(/ı/g, "i");
  if (CASINO_SPAM_RE.test(spamNorm(hayRaw)) && !CASINO_SPAM_RE.test(spamNorm(queryRaw))) return 0;
  // v17.1: Sorğu konkret olaraq "saytlar / veb-saytlar / websites" siyahısı istəyirsə,
  // film mükafatları ("Filmfare Award") və ya siyasi partiya ("Sosial Demokrat Partiyası") kimi sayt olmayan mövzuları kəs
  if (queryRaw && WEBSITE_LIST_QUERY_RE.test(queryRaw) && !OVERVIEW_QUERY_RE.test(queryRaw)) {
    if (!WEBSITE_SIGNAL_RE.test(hayRaw)) return 0;
  }
  // v56: ölkə uyğunsuzluğu — "Azərbaycan iqtisadiyyatının əsas sektorları" sorğusuna
  // "Hindistan iqtisadiyyatının əsas sektorları" gəlirdi. Bir ölkə soruşulub, başlıqda
  // BAŞQA ölkədirsə nəticə cavab deyil.
  // v56.1: ölkə adları sait fərqinə həssas olmasın (Azərbaycan/azarbaycan, Türkiyə/turkiya)
  const qCountry = countrySkeletons(queryRaw);
  if (qCountry.size === 1) {
    const only = [...qCountry][0];
    const titleC = countrySkeletons(result.title || "");
    titleC.delete(only);
    if (titleC.size) return 0;
  }
  // v86: yazı sistemi uyğunsuzluğu — latın əlifbalı sorğuya kiril/ərəb/Çin/Koreya/Yaponiya
  // mətni cavab deyil (istifadəçi şikayəti: "qəribə dildən nəticə"). Cəza, tam atma deyil —
  // rusdilli mənbə bəzən yeganə mənbədir, dibdə qalsın.
  let scriptPenalty = 0;
  if (lang === "az" || lang === "tr" || lang === "en") {
    const letters = hayRaw.match(/\p{L}/gu) || [];
    if (letters.length >= 24) {
      const foreign = letters.filter(ch => /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0E00-\u0E7F]/.test(ch)).length;
      // v107: BLOK DEYİL — CƏZA. İstifadəçi qaydası: "hansı dildə axtarırıqsa o dil üstün olsun,
      // amma başqa dilləri BLOKLAMA". Kiril/ərəb/Çin mətni yalnız həqiqətən başqa heç nə
      // olmayanda dibdə görünə bilər.
      if (foreign / letters.length > 0.4) scriptPenalty = 2.0;
    }
  }
  const titleTerms = new Set(tokenize(result.title || ""));
  const snippetTerms = new Set(tokenize(result.snippet || ""));
  const qGrams = qGramsFor(queryTerms);
  let score = 0;
  if (scriptPenalty) score -= scriptPenalty;   // v107: blok deyil, cəza (aşağıya bax)
  // v23: say/neçə sualında xəbər mənbəyi cavab vermir — başlıqda rəqəm yoxdursa cəzalandır
  // (DİQQƏT: bu blok `let score` -dan SONRA olmalıdır, əvvəl qoysan TDZ xətası → 500)
  const isCountQ = /(?<![\p{L}])(neçə|nece|sayı|sayi|how\s+many|count|nə\s+qədər|ne\s+qeder|qədərdir|sahəsi|sahesi|hündürlüyü|uzunluğu|çəkisi)(?![\p{L}])/iu.test(String(queryRaw || ""));
  if (isCountQ && /news/i.test(String(result.source || ""))) {
    // xəbər saytı "neçə X var" sualına cavab vermir — başlıqda rəqəm olsa belə
    score -= 3.0;
  }
  let termHits = 0;
  let titleHits = 0;
  for (const qt of queryTerms) {
    let hit = false;
    if (titleTerms.has(qt)) { score += 2; hit = true; titleHits++; }
    else if (snippetTerms.has(qt)) { score += 1; hit = true; }
    else {
      // v19: 3 hərfli sözlərdə təxmini uyğunluq çox risklidir ("Dolar" ↔ "Do vs Does") —
      // yalnız 4+ hərfli sözlər üçün və namizəd də 4+ hərfli olsun
      let best = 0;
      const grams = qGrams.get(qt);
      const fuzzyOk = qt.length >= 4;
      if (fuzzyOk) {
        for (const t of titleTerms) { if (t.length < 4) continue; const s = trigramSimilarity(qt, t, grams); if (s > best) best = s; }
        if (best >= 0.7) { score += 1; hit = true; titleHits++; }
        else {
          // v24: prefiks uyğunluğu — "kitab" ↔ "kitaba", "fransa" ↔ "frans" (stem fərqi)
          // v45.3: 4 hərfli kök prefiksi təhlükəlidir ("gənclər"→genc ↔ "Gəncə"→gence)
          const pref = qt.length >= 5 && [...titleTerms, ...snippetTerms].some(t => t.length >= 5 && (t.startsWith(qt) || qt.startsWith(t)));
          if (pref) { score += 0.5; hit = true; }
        }
        if (!hit) {
          for (const t of snippetTerms) { if (t.length < 4) continue; const s = trigramSimilarity(qt, t, grams); if (s > best) best = s; }
          if (best >= 0.7) { score += 1; hit = true; }
        }
      }
    }
    if (hit) termHits++;
  }

  // v54.4: nə başlıqda, nə snippet-də BİR DƏNƏ də sorğu termini olmayan nəticə gərəksizdir.
  // ("C vitamini hansı qidalarda var" → Medera Hospital ana səhifəsi: "Biz pasiyent
  // mərkəzli qayğıya..." — sorğu ilə heç bir əlaqəsi yox, amma .az bonusu ilə #1 idi.)
  // v57.3: ümumi "son xəbərlər" sorğusunda mövzu termini olmur — bu halda təzəlik yarışı
  // (əks halda sitemap/RSS xəbərləri tam sıfırlanırdı)
  const specificTerms = queryTerms.filter(t => !isGenericNewsTerm(t) && t !== "bu");
  // yalnız "son xəbərlər / latest news" tipli sorğuda (xəbər sözü VAR, mövzu sözü YOX)
  const hasNewsWord = NEWS_WORD_RE.test(queryRaw || "");
  const genericOnlyQ = hasNewsWord && queryTerms.length > 0 && specificTerms.length === 0;
  if (genericOnlyQ) {
    // "son xəbərlər" tipli sorğuda başlıq uyğunluğu MƏNASIZDIR — hər xəbər saytının ana
    // səhifəsi "son xəbərlər" yazır. Skoru sıfırlayıb təzəlik/məzmunla sıralayırıq.
    score = 0;
    if (result.published_at) score += 0.8;
  } else if (queryTerms.length > 0 && termHits === 0) {
    return 0;
  }

  // v17: Dəqiq başlıq üst-üstə düşməsi bonusu (canonical entity qoruması):
  // Sorğu "Minecraft" olduqda "Minecraft" məqaləsi "A Minecraft Movie Squared"-dən,
  // "Translation" olduqda "Translation" məqaləsi "Machine translation"-dan önə çıxır.
  const questionIntent = OVERVIEW_QUERY_RE.test(String(queryRaw || ""));
  if (termHits > 0 && queryTerms.length >= 1 && queryTerms.length <= (questionIntent ? 4 : 3)) {
    const cleanTitleRaw = String(result.title || "")
      .replace(/\s*[-–—|]\s*(wikipedia|vikipediya|vikipedi|official\s+site).*$/i, "")
      .trim();
    const titleTokens = tokenize(cleanTitleRaw);
    const rawWords = cleanTitleRaw.split(/\s+/).filter(Boolean);
    if (
      titleTokens.length === queryTerms.length &&
      rawWords.length <= queryTerms.length + 1 &&
      titleTokens.join(" ") === queryTerms.join(" ")
    ) {
      score += 1.8;
    }
  }

  // v19.2: çoxsözlü sualda YALNIZ BİR sözün başlıqda uyğunluğu zəif siqnaldır
  // ("gözəl yeməklər" → "gözəl" adlı Wikipedia məqaləsi zibil kimi çıxırdı)
  // v95: istisna — tutulan söz sualın ƏSAS MÖVZUSUDURSA ("React" + "state idarəetməsi")
  const primaryTermHit = (() => {
    const primary = queryTerms[0];
    if (!primary || primary.length < 4) return false;
    // yalnız QISA, dəqiq başlıq ("React", "Xəzər dənizi") — uzun bloq başlığı istisna deyil
    if (tokenize(result.title || "").length > 2) return false;
    if (titleTerms.has(primary) || snippetTerms.has(primary)) return true;
    const grams = qGrams.get(primary);
    for (const t of titleTerms) if (t.length >= 4 && trigramSimilarity(primary, t, grams) >= 0.7) return true;
    return false;
  })();
  if (queryTerms.length >= 2 && termHits === 1 && titleHits === 1 && snippetTerms.size > 0 &&
      !primaryTermHit &&
      queryTerms.filter(t => snippetTerms.has(t)).length === 0) {
    score -= 1.6;
  }

  let host = "";
  let pathName = "";
  try {
    const parsedU = new URL(result.url);
    host = parsedU.hostname.replace(/^www\./, "").toLowerCase();
    pathName = parsedU.pathname || "/";
    if (host.endsWith(".az")) score += 1;
    // v109: rəsmi dövlət mənbəyi (.gov.az) — "metro.gov.az/about" kimi ilkin mənbələr
    // provayderlərdən gec gəlir və medianın arxasında qalırdı
    if (host.endsWith(".gov.az")) score += 0.9;
    for (const [dom, bonus] of BONUS_DOMAINS) {
      if (hostMatches(result.url, dom)) { score += bonus; break; }
    }
    score += govBoost(result.url);
    // sahibkar spesifik rəsmi boost — generic qayda (hər hansı gov)
    if (/sahibkar/i.test(queryRaw) && /\.gov\./i.test(String(result.url||""))) score += 3.5;
    score += kimdirBoost(queryRaw, result.title, result.url);
    score += translateBoost(queryRaw, result.url);
    if ((lang === "az" || lang === "tr" || lang === "en") && FOREIGN_PATH_RE.test(pathName)) {
      score -= 2.5;
    }
    // v19 (8c): tək sözlük sualda rəsmi sayt ("Python" → python.org, "Minecraft" → minecraft.net)
    const hostLabel = host.split(".")[0];
    if (queryTerms.length === 1 && hostLabel === queryTerms[0] && /^(com|org|net|az|io|dev|gov)$/.test(host.split(".")[1] || "")) {
      score += 1.6;
    }
    // v19 (8b): başlıqda sorğudan artıq mövzu sözü varsa ("Nizami Gəncəvi metro stansiyası") kiçik cərimə
    if (queryRaw && queryTerms.length <= 4 && titleHits > 0) {
      const qSet = new Set(queryTerms);
      const extra = tokenize(String(result.title || "")).filter(t => !qSet.has(t) && !AZ_STOPWORDS_LITE.has(t));
      if (extra.length >= 2 && extra.length > queryTerms.length) score -= 1.2;
    }
    // v19 (5c): yalnız tərcümədən gələn söz domen adına uyğun gəlirsə, məzmun uyğunluğu olmadan qəbul etmə
    // ("gözəl yeməklər" → "delicious" → delicious.com zibili)
    if (queryRaw && /^(az|tr)$/.test(String(lang)) && queryTerms.length <= 4) {
      const rawSet = new Set(tokenize(queryRaw));
      const hostTerms = tokenize(hostLabel.replace(/-/g, " "));
      const onlyTranslated = hostTerms.filter(t => qSetLike(queryTerms, t) && !rawSet.has(t));
      const rawHit = [...rawSet].some(t => titleTerms.has(t) || snippetTerms.has(t));
      if (onlyTranslated.length && !rawHit) score -= 4;
    }
  } catch {}

  const origSet = queryRaw ? new Set(tokenize(queryRaw)) : null;
  const conceptCount = origSet && origSet.size ? origSet.size : queryTerms.length;
  const newsQ = isNewsQuery(queryRaw);
  const techQ = isTechQuery(queryRaw);
  const overviewQ = OVERVIEW_QUERY_RE.test(queryRaw) && conceptCount <= 4;

  // v15/v17: dil uyğunluğu — sorğu hansı dildədirsə, həmin dildə cavab verən saytlar və ön-izləmələr önə çıxır!
  if (lang === "az" || lang === "tr") {
    const blob = ((result.title || "") + " " + (result.snippet || "")).toLowerCase();
    const local =
      lang === "az"
        ? (blob.includes("\u0259") || host.endsWith(".az"))
        : (/[şğüöç]/.test(blob) || host.endsWith(".com.tr") || host.endsWith(".tr") || /\b(en\s+iyi|filmler|nedir|türkiye)\b/i.test(blob));
    if (local) {
      score += 1.2;
    } else if (!techQ && !result.anchorBonus) {
      // v108: "2 termin uyğunlaşdı → cəza yoxdur" qaydası GERİ GÖTÜRÜLDÜ — ölçdük:
      // texniki olmayan sualda zibil səhifələr (perlmonks, köhnə bloq) MDN-i üstələyirdi.
      // Texniki suallar artıq techQ ilə azaddır; GitHub-da AZ dilli layihə də techQ-yə düşür.
      score -= 0.6;
    }
  } else if (lang === "en" && queryRaw) {
    if (/^(az|tr|ru)\.wikipedia\.org$/.test(host)) score -= 1.8;
  }

  // v107: KONSEPTUAL sualda kalkulyator/alət səhifəsi cavab deyil
  // ("HTTP ilə HTTPS arasındakı fərq nədir" → "faiz fərqi kalkulyatoru" ilk yerdə idi).
  // Sayt siyahısı deyil, ümumi kateqoriya qaydasıdır.
  const conceptualQ = /(?<![\p{L}])(n[əe]dir|n[əe]\s+f[əe]rq|f[əe]rq[\p{L}]*\s+n[əe]dir|what\s+is|difference\s+between|m[əe]nas[ıi])(?![\p{L}])/iu.test(String(queryRaw || ""));
  if (conceptualQ && /(calc|kalkulyator|calculator)/i.test(`${result.title || ""} ${host}`)) score -= 2.5;

  const isCodey = result.source === "github" || result.source === "hacker-news" || result.source === "arxiv" || result.source === "stackoverflow";
  if (isCodey && !techQ) {
    score -= newsQ ? 2 : 1.2;
  }
  if (overviewQ && (result.source === "stackoverflow" || result.source === "hacker-news")) {
    score -= 3.5;
  }
  if (overviewQ && (host.endsWith(".wikipedia.org") || pathName === "/")) {
    score += 1.2;
  }

  // v19: ".ai", ".az" kimi TLD məqalələri adi sorğuda (-"AI" → ".ai" 1-ci çıxırdı)
  if (/^\.[a-z]{2,4}$/i.test(String(result.title || "").trim()) && !/(domen|domain|tld|uzantı|uzanti)/i.test(String(queryRaw || ""))) {
    score -= 3;
  }
  // v19: disambiguation ("Nizami" → "müraciət edə bilər") səhifələri arxa sıraya
  const disambig = /(müraciət\s+edə\s+bilər|may\s+refer\s+to|bir\s+neçə\s+məna|adisini\s+daşıy|soyadı\s+olan)/i.test(String(result.content || result.snippet || "").slice(0, 400));
  if (disambig) score -= 2.2;

  // ===== v20: real test raundunda tapılan konkret səhvlər =====
  const hay = `${result.title || ""} ${result.snippet || ""} ${String(result.content || "").slice(0, 600)}`;
  // (A) "paytaxtı" → "capital punishment" tuzağı
  if (/(?<![\p{L}])(paytaxt[\p{L}]*|capital\s+of)(?![\p{L}])/iu.test(String(queryRaw || ""))) {
    if (/(capital\s+punishment|ölüm\s+cəzası|edam\s+cəzası|cəza\s+məcəlləsi)/iu.test(hay)) {
      score -= 3.5;
    } else if (/(paytaxtıdır|paytaxtı\s+olan|is\s+the\s+capital|capital\s+of\s+[\p{Lu}][\p{L}]+\s+is)/iu.test(hay)) {
      score += 2.5; // birbaşa cavab cümləsi ("Ankara Türkiyənin paytaxtıdır")
    }
  }
  // (B) "neçə X var" say sualı → rəqəmsiz səhifə cavab deyil
  if (/(?<![\p{L}])(neçə[\p{L}]*|nece[\p{L}]*|how\s+many|how\s+much)(?![\p{L}])/iu.test(String(queryRaw || "")) && !/\d/.test(hay)) {
    score -= 2.2;
  }
  // (C) siyahı sualı ("hansılardır") → "X–Y münasibətləri" kimi məqalələr cavab deyil
  if (/(?<![\p{L}])(hansılardır|hansilardir|hansılardı|list|members?|üzv)(?![\p{L}])/iu.test(String(queryRaw || "")) &&
      /(münasibətləri|munasibetleri|relations|tarixi|history\s+of)/iu.test(String(result.title || ""))) {
    score -= 2.4;
  }
  // (D) cari cədvəl/reytinq sualında köhnə mövsüm/il başlığı
  if (/(?<![\p{L}])(cədvəl[\p{L}]*|cedvel|standings|table|reytinq[\p{L}]*|ranking)(?![\p{L}])/iu.test(String(queryRaw || ""))) {
    const yr = String(result.title || "").match(/(?:19|20)\d{2}/);
    const curYear = new Date().getFullYear();
    if (yr && Math.abs(Number(yr[0]) - curYear) >= 3) score -= 2.5;
  }
  // (E) "necə/nasıl yapılır" təlimat sualı → təlimat səhifələri önə, brend məqalələri arxaya
  if (/(?<![\p{L}])(necə[\p{L}]*|nece[\p{L}]*|nasıl[\p{L}]*|nasil[\p{L}]*|how\s+to)(?![\p{L}])/iu.test(String(queryRaw || ""))) {
    const howtoish = /(necə|nece|nasıl|nasil|how\s+to|adım\s+adım|addım-addım|resimlerle|addım|təlimat|guide|tutorial)/iu.test(hay);
    if (howtoish) score += 1.6;
    else if (/(brend|brand|şirkət|sirket|company|market|product)/iu.test(hay)) score -= 1.4;
  }
  // (F) maşın tərcüməli brend adları ("React" → "Reaksiya")
  if (/\breact\b/i.test(String(queryRaw || ""))) {
    const ttl = String(result.title || "");
    if (/(?<![\p{L}])reaksiya(?![\p{L}])/iu.test(ttl) && !/\breact\b/i.test(ttl)) score -= 2.5;
  }
  // (G) "ən yaxşı X-lər" siyahı sualı → siyahı başlıqları önə
  if (/(?<![\p{L}])(ən\s+yaxşı|en\s+iyi|best|top)(?![\p{L}])/iu.test(String(queryRaw || ""))) {
    if (/(?<![\p{L}])(ən\s+yaxşı|en\s+iyi|best|top\s*\d)/iu.test(String(result.title || ""))) score += 1.2;
  }

  // ===== v21: 2-ci test raundu (15 yeni sual) tapıntıları =====
  const qRaw = String(queryRaw || "");
  const normHay = azFold(hay);
  const foldTok = (x) => azFold(String(x || ""));
  // (H) "xas" söz qaydası: sualın FƏRQLƏNDİRİCİ sözü başlıqda/girişdə olmalıdır
  // ("fransız inqilabı" → "Oktyabr inqilabı", "css grid vs flexbox" → "Page layout" bununla kəsilir)
  const GENERIC_TERMS = new Set(["let","const","var","run","use","new","get","set","vs","difference","ferqi","fərqi","say","sayi","sayı","nece","how","many","much","best","top","example","numune","nümunə","dəyər","deyer","hara","harada","harda","where","hansi","hansı","which","nere","nerede","vaxt","zaman","when","who","kim","what","nə","ne","nedir","nədir"]);
  const distinctive = queryTerms.filter(t => t.length >= 4 && !GENERIC_TERMS.has(t) && !AZ_STOPWORDS_LITE.has(t));
  if (distinctive.length >= 2) {
    const lead = foldTok(`${result.title || ""} ${result.snippet || ""} ${String(result.content || "").slice(0, 220)}`);
    let hit = 0;
    for (const t of distinctive) {
      const ft = foldTok(t);
      if (lead.includes(ft) || lead.includes(ft.slice(0, Math.max(4, ft.length - 2)))) hit++;
    }
    const ratio = hit / distinctive.length;
    if (hit === 0) score -= 4;
    else if (ratio < 0.34) score -= 2.6;
    else if (ratio < 0.5) score -= 1.2;
    // izah sualında ("X nədir") X başlıqda olmalıdır — "Git rebase nədir" → "Git" məqaləsi düşür
    if (questionIntent && distinctive.length >= 1) {
      const ttlF = azFold(String(result.title || ""));
      // v95: əsas mövzu = sualın ilk fərqləndirici sözü (söz sırası qaydası), ən uzunu deyil
      const mainTerm = distinctive[0];
      const ft = azFold(mainTerm);
      if (ft.length >= 4 && !ttlF.includes(ft.slice(0, Math.max(4, ft.length - 2)))) score -= 2.5;
    }
  } else if (distinctive.length === 1) {
    // tək fərqləndirici söz varsa və mətndə YOXDURSA — cavab deyil.
    // İSTİSNA: söz BAŞLIQDA varsa kifayətdir ("Fransa" səhifəsi: snippet "Paytaxtı Paris şəhəridir")
    const ft = foldTok(distinctive[0]);
    const ftKey = ft.slice(0, Math.max(4, ft.length - 2));
    const inTitle = azFold(String(result.title || "")).includes(ftKey);
    if (ft.length >= 4 && !inTitle && !normHay.includes(ftKey)) score -= 3.5;
  }
  // (I) "keçiriləcək / gələn / upcoming" → cari və gələcək il olmalıdır, köhnə il yox
  if (/(?<![\p{L}])(keçiriləcək|kecirilecek|olacaq|gələn|gelen|planlaşdır|planlasdir|növbəti|novbeti|upcoming|next)(?![\p{L}])/iu.test(qRaw)) {
    const m = String(result.title || "").match(/(?:19|20)\d{2}/);
    const curYear = new Date().getFullYear();
    if (m) {
      const y = Number(m[0]);
      if (y >= curYear) score += 2;
      else if (y <= curYear - 2) score -= 2.5;
    }
  }
  // (L) say sualı: rəqəm sayılan sözün YANINDA olmalıdır ("1 manat neçə dollar" tipli tələlər üçün)
  if (/(?<![\p{L}])(neçə|nece|how\s+many|how\s+much)(?![\p{L}])/iu.test(qRaw) && distinctive.length >= 1) {
    const noun = distinctive.reduce((a, b) => (b.length > a.length ? b : a), "");
    const fn = azFold(noun);
    const near = new RegExp(`${fn.slice(0, Math.max(4, fn.length - 2))}[^.]{0,80}\\d|\\d[^.]{0,80}${fn.slice(0, Math.max(4, fn.length - 2))}`, "i");
    if (near.test(normHay)) score += 1.5;
    else if (!normHay.includes(fn.slice(0, Math.max(4, fn.length - 2)))) score -= 2;
  }

  // (J) "nə vaxt" sualı → tarix (il) daşıyan mətn cavabdır
  if (/(?<![\p{L}])(nə\s+vaxt|ne\s+vaxt|when)(?![\p{L}])/iu.test(qRaw)) {
    if (/\b(1[5-9]\d{2}|20\d{2})\b/.test(hay)) score += 1.2;
  }
  // (K) "vs / fərqi / difference" müqayisə sualı → müqayisə səhifələri önə
  if (/(?<![\p{L}])(vs\.?|fərq\w*|ferq\w*|farki|difference|müqayisə\w*|muqayise\w*|comparison)(?![\p{L}])/iu.test(qRaw)) {
    if (/(difference|different|fərq|ferq|vs\.?|müqayisə|muqayise|comparison|compared)/i.test(hay)) score += 1.8;
    else score -= 1.2;
    // hər iki tərəf BŞALIQDA olmalıdır ("PostgreSQL vs MySQL" → "Null (SQL)" kəsilir)
    const cmpTerms = queryTerms
      .filter(t => GENERIC_TERMS.has(t) === false && t.length >= 3 && !/(daki|deki|ndaki|aras|ferq|fərq|difference|vs|nedir)$/.test(t))
      .slice(0, 3);
    const ttlFold = azFold(String(result.title || ""));
    const inTitle = cmpTerms.filter(t => ttlFold.includes(azFold(t).slice(0, Math.max(3, azFold(t).length - 2)))).length;
    if (cmpTerms.length >= 2 && inTitle < 2) score -= 2.5;
    // v25: hər iki tərəf BAŞLIQDA varsa ("HTTP vs HTTPS") — bu, məhz müqayisə səhifəsidir
    else if (cmpTerms.length >= 2 && inTitle >= 2) {
      // sərt yoxlama: hər iki termin başlıqda TAM görünməlidir ("http/2" ≠ "https")
      const strict = cmpTerms.every(t => ttlFold.includes(azFold(t)) && azFold(t).length >= 3);
      score += strict ? 2.5 : 0.5;
    }
  }
  // (V) howto ("necə işləyir") → izahat səhifəsi; esse/tənqid ("... qarşı arqument") cavab deyil
  if (/(?<![\p{L}])(necə|nece|işləyir|isleyir|nədir|nedir|nə\s+deməkdir)(?![\p{L}])/iu.test(qRaw)) {
    const tH = String(result.title || "").toLowerCase();
    if (/(nedir|nece|ne\s+ucun|izah|what\s+is|how\s+to|haqqinda|isleyir)/u.test(tH)) score += 1.5;
    if (/(arqument|argument|tenqid|criticism|critique|qarsi\s+arqument|against|controvers|sübut|proof)/u.test(tH)) score -= 1.5;
  }
  // (U) mövzu örtüyü (bütün növlər): "ali təhsil islahatları" sualına
  // "Azərbaycan Ali Dəniz Akademiyası" cavab deyil — başlıq 1 sözü əhatə edir.
  {
    const kT = tokenize(qRaw).filter(t => t.length >= 5 &&
      !/^(haqqinda|haqqında|dunyanin|dünyanın|azerbaycan|azərbaycan|2024|2025|2026|necə|nece|nədir|nedir|işləyir|isleyir)$/u.test(t)).slice(0, 4);
    if (kT.length >= 3) {
      const ttlOnly = String(result.title || "").toLowerCase();
      const snipL = String(result.snippet || "").toLowerCase();
      const snipOk = /[əöüğışç]/.test(String(result.snippet || "")) || !/[a-z]/i.test(String(result.snippet || ""));
      const hayU = ttlOnly + " " + (snipOk ? snipL : ttlOnly);
      const hit = kT.filter(t => hayU.includes(t.slice(0, Math.max(5, t.length - 3)))).length;
      if (hit / kT.length < 0.4) score -= 1.6;
    }
  }
  // (T) SİYAHI tipli sual ("ən yaxşı filmlər", "qalibləri", "növləri", "üsulları"):
  // tək-obyekt səhifəsi (bir film, bir universitet) cavab deyil — siyahı/skаталoк səhifəsi lazımdır
  const LIST_Q = /(?<![\p{L}])(ən\s+yaxşı|en\s+yaxsi|siyahı\w*|siyahi\w*|qaliblər\w*|qalibleri|növləri|novleri|üsulları\w*|usullari\w*|yolları|yollari|üstünlükləri\w*|ustunlukleri\w*|çatışmazlıqları\w*|top\s*\d+|best)(?![\p{L}])/iu.test(qRaw);
  if (LIST_Q) {
    const ttlL = String(result.title || "").toLowerCase();
    const listSignal = /(siyahi|siyahı|list|top\s*\d|top\s+100|qalib|champion|awards|nomin|növ|usul|yol|üstünlük|lək|müqayisə|comparison|rank|bütün|всех|all\s+time|ever)/iu.test(ttlL);
    // mövzu örtüyü: "Çempionlar Liqasının qalibləri" → ingilis səhifəsi yalnız "çempion" daşıyır,
    // AZ səhifəsi həm "çempion", həm "liqa" → nisbət < 0.5 cəzalanır
    const keyToks = tokenize(qRaw).filter(t => t.length >= 5 && !/^(haqqinda|siyahi|haqqında|dunyanin|dünyanın|azerbaycan|azərbaycan|2025|2026)$/u.test(t)).slice(0, 4);
    if (keyToks.length >= 2) {
      const hayL = String(result.title || "").toLowerCase() + " " + String(result.snippet || "").toLowerCase();
      const hit = keyToks.filter(t => hayL.includes(t.slice(0, Math.max(5, t.length - 3)))).length;
      const cov = hit / keyToks.length;
      if (cov >= 0.75) score += 1.2;
      else if (cov < 0.5 && !listSignal) score -= 1.8;
    }
    // iki-sözlü vahid: "Çempionlar Liqası" — ingilis liqa səhifəsi bu vahidi daşımırsa cavab deyil
    const toksL = tokenize(qRaw).filter(t => t.length >= 5);
    const bigrams = [];
    for (let i = 0; i + 1 < toksL.length; i++) bigrams.push([toksL[i], toksL[i + 1]]);
    if (bigrams.length) {
      const hayB = String(result.title || "").toLowerCase() + " " + String(result.snippet || "").toLowerCase();
      const pairHit = bigrams.some(([a, b]) => hayB.includes(a.slice(0, 6)) && hayB.includes(b.slice(0, 6)));
      if (pairHit) score += 0.8;
      else if (!listSignal) score -= 1.5;
    }
    // TƏK ƏSƏR: "Ən yaxşı şey (TV seriyası)" — adı belədir, siyahı deyil
    const ttlRawS = String(result.title || "");
    const singleWork = /(?:\(\s*(?:\d{4}\s*)?(film\w*|serial\w*|seriya\w*|mahn[ıi]\w*|albom\w*|dizi\w*|şark[ıi]\w*|сериал|фильм|song|album|novel|book|tv\s+series|video\s+game)\s*\))|(?<![\p{L}])(filmi|serialı|seriyası|mahnısı|albomu|dizisi|şarkısı|romanı)(?![\p{L}])/iu.test(ttlRawS);
    if (singleWork && !/(siyahi|siyahı|list\s+of|top\s*\d|rank|bütün|всех|all\s+time|disambiguation)/iu.test(ttlRawS)) score -= 4;
    const shortEntity = String(result.title || "").trim().split(/\s+/).length <= 4 && !/\d{4}/.test(ttlL);
    if (listSignal) score += 2;
    else if (shortEntity) score -= 2.2;
  }
  // (S) superlatif sualda ("ən böyük şəhər", "ən çox oxunan") xəbər mənbəyi cavab vermir
  if (/(?<![\p{L}])(ən\s+böyük|en\s+boyuk|ən\s+çox|en\s+cox|largest|biggest|most\s+popular|most\s+read)(?![\p{L}])/iu.test(qRaw)
      && /news/i.test(String(result.source || ""))) {
    score -= 2.2;
  }
  // (Q) "əhali nə qədərdir" → köhnə rəqəm (2012) cavabsız sayılır, təzə məlumat önə
  if (/(?<![\p{L}])(əhali|ehali|population|əhalisi|əmək\s+haqqı|emek\s+haqqi|minimum\s+maaş|qiyməti|qiymeti|tarif|manat|dollar|avro)(?![\p{L}])/iu.test(qRaw)) {
    const yrs = [...String(hay).matchAll(/(?:19|20)\d{2}/g)].map(m => Number(m[0]));
    const newest = yrs.length ? Math.max(...yrs) : 0;
    const curY = new Date().getFullYear();
    if (newest >= curY - 2 && /(milyon|nəfər|nefər|million|people)/iu.test(hay)) score += 2;
    else if (newest && newest < curY - 6) score -= 2;
  }
  // (R) "paytaxtı haradır" → siyahı/xronologiya səhifəsi deyil, birbaşa şəhər/ölkə səhifəsi
  if (/(?<![\p{L}])(paytaxtı|paytaxti|capital)(?![\p{L}])/iu.test(qRaw)) {
    const ttl = String(result.title || "");
    if (/(siyahı|siyahisi|list\s+of|xronologiya|chronolog)/iu.test(ttl)) score -= 2.5;
    if (ttl.split(/\s+/).length <= 3 && /(paytaxtı|paytaxti|capital)/iu.test(hay)) score += 1.2;
  }
  // (P) məna ayrımı (disambiguation) səhifəsi cavab vermir: "Doker — Docker ən çox istinad edir: liman işçisi..."
  if (/(ən\s+çox\s+istinad\s+edir|mənaları\s+ifadə\s+edə\s+bilər|aşağıdakı\s+mənaları|həmçinin\s+baxınız\s*:\s*$|may\s+refer\s+to)/iu.test(String(result.snippet || ""))) {
    score -= 3;
  }
  // (O) say sualı: SUBYEKT başlıqda olmalıdır ("Ankarada neçə rayon" → "Türkiyə rayonları" cavab deyil)
  if (isCountQ) {
    const hayTtl = azFold(String(result.title || ""));
    const subj = queryTerms.find(t => t.length >= 4 && !GENERIC_TERMS.has(t) && !/^(nece|sayi|how|many|count|var)$/.test(t));
    if (subj) {
      const fs = azFold(subj);
      if (!hayTtl.includes(fs.slice(0, Math.max(4, fs.length - 2)))) score -= 2;
    }
  }
  // (N) idman: sorğuda növ göstərilibsə, BAŞQA növ cəzalanır; ümumi "milli/oyun" sualında futbol önə
  if (/(?<![\p{L}])(oyun|oyunu|matç|match|game|milli|komanda)(?![\p{L}])/iu.test(qRaw)) {
    const SPORTS = ["futbol", "xokkey", "basketbol", "voleybol", "hentbol", "reqbi", "tennis"];
    const lq = String(qRaw || "").toLowerCase(), lh = String(hay || "").toLowerCase();
    const qSport = SPORTS.find(sp => lq.includes(sp.slice(0, 5)));
    const hSport = SPORTS.filter(sp => lh.includes(sp.slice(0, 5)));
    if (qSport) {
      if (hSport.length && !hSport.includes(qSport)) score -= 3;
    } else if (hSport.length && !hSport.includes("futbol")) {
      score -= 1.6;
    }
  }
  // (M) "növbəti/gələn oyun" sualı → tarix və ya gələcək marker olmalıdır
  if (/(?<![\p{L}])(növbəti|novbeti|gələn\s+oyun|gelen\s+oyun|next\s+(match|game))(?![\p{L}])/iu.test(qRaw)) {
    const hasDate = /(keçiriləcək|kecirilecek|oynanacaq|olacaq|tarix|\d{1,2}\s+(yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr))/iu.test(hay) && /\d/.test(hay);
    if (!hasDate) score -= 2.5;
    // oyunun özü + tarix birlikdə varsa — bu, düzgün cavabdır
    if (hasDate && /(oyun|matç|matc|görüş|gorus|keçiriləcək|oynanacaq)/iu.test(hay)) score += 2;
  }

  if (result.rrfScore) score += result.rrfScore * 50;
  if (result.anchorBonus) score += 1.5;
  if (result.source === "arxiv" && queryTerms.some(t => NON_ACADEMIC_TERMS.has(t))) score -= 2.5;

  try {
    const nu = new URL(result.url);
    if (/^news\.google\./i.test(nu.hostname) && nu.pathname.includes("/articles/")) score -= newsQ ? 0.2 : 1.5;
  } catch {}

  const isWiki = result.source === "wikipedia" || /\.wikipedia\.org$/i.test((() => { try { return new URL(result.url).hostname; } catch { return ""; } })());
  if (newsQ && result.source === "az-news") score += 2.6;
  if (newsQ && (result.source === "google-news" || result.source === "bing-news")) score += 1.5;
  // Xəbər sualında portal ana səhifəsi (path="/" və tarixsiz) əvəzinə tarixli konkret xəbəri üstün tut
  if (newsQ && !result.published_at) {
    try {
      if (new URL(result.url).pathname === "/") score -= 2.5;
    } catch {}
  }
  // Xəbər sualında ensiklopediya məqalələri ("Gəncə bombalanmaları", "Azərbaycan") bugünkü xəbər DEYİL
  if (newsQ && isWiki) score -= 3.5;
  // v49: AZ yer adı sorğuda varsa, xarici ümumi mənbə (ABŞ əmək stat., BLS) cavab DEYİL.
  // "Bakıda işsizlik səviyyəsi" → ABŞ ştatlarının işsizlik cədvəli gəlirdi.
  {
    const qn = normalizeAz(String(queryRaw || ""));
    // şəkilçili formalar da tutulur: "bakida", "genceye", "azerbaycanda"
    const AZ_PLACE = /(?<![a-z])(baki[a-z]*|azerbaycan[a-z]*|naxcivan[a-z]*|gence[a-z]*|sumqayit[a-z]*|seki[a-z]*|lenkeran[a-z]*|mingecevir[a-z]*|sirvan[a-z]*|qebele[a-z]*|susa[a-z]*|xankendi[a-z]*|quba[a-z]*|salyan[a-z]*|agdam[a-z]*|berde[a-z]*|qazax[a-z]*|tovuz[a-z]*|zengilan[a-z]*|cabrayil[a-z]*|fuzuli[a-z]*|agcabedi[a-z]*|imedli[a-z]*|bilesuvar[a-z]*|celilabad[a-z]*|masalli[a-z]*|astara[a-z]*|lerik[a-z]*|yardimli[a-z]*)/;
    if (AZ_PLACE.test(qn)) {
      const blob = normalizeAz(`${result.title || ""} ${result.snippet || ""} ${String(result.content || "").slice(0, 400)}`);
      // ölkə adı və ya .az domeni tələb olunur — TR xəbəri bir dəfə "Bakı" yazsa da cavab deyil
      const localHit = /(?:azerbaycan|azərbaycan)/.test(blob) || host.endsWith(".az");
      if (!localHit) score -= 3;
    }
  }
  // v48.2: "Sabirabad rayonu hansı iqtisadi rayona aiddir" → Zərdab rayonu səhifəsi gəlirdi.
  // Sorğudakı XÜSUSİ AD (böyük hərflə) başlıqda yoxdursa, səhifə başqa obyektdir.
  if (String(queryRaw || "").length) {
    const capWords = [...String(queryRaw).matchAll(/(?<![\p{L}])(\p{Lu}[\p{Ll}əöüğçşı]{3,})(?![\p{L}])/gu)].map(m => m[1]);
    const COMMON_CAP = new Set(["python", "bakı", "baki", "azerbaycan", "azərbaycan", "türkiyə", "turkiye", "google", "microsoft"]);
    const proper = capWords.find(w => { const nw = normalizeAz(w); return !COMMON_CAP.has(nw) && nw.length >= 5; });
    if (proper) {
      const t = normalizeAz(String(result.title || ""));
      // hal şəkilçisini at, sonra ilk 5 hərflə müqayisə et (fransanin → frans, sabirabad → sabir)
      let stem = normalizeAz(proper);
      const sfx = /(?:larinin|lerinin|nın|nin|nun|nün|dan|den|dən|da|de|də|in|un|ın|ün|ya|yə|ye)$/;
      if (stem.length > 7 && sfx.test(stem)) stem = stem.replace(sfx, "");
      const probe = stem.slice(0, 5);
      if (probe.length >= 4 && !t.includes(probe)) score -= 2.4;
    }
  }
  // v45.2: "son/ən son/latest" sualında TARİXSİZ ensiklopediya səhifəsi (1943-cü il seçkiləri)
  // cavab sayılmır — tarixli fakt varsa, o üstün olmalıdır
  if (isWiki && !result.published_at && /(?<![\p{L}])(son|ən\s+son|latest|last|current)(?![\p{L}])/iu.test(queryRaw || "")) score -= 2.2;
  // Wikipedia istinad/dipnot təsadüfi tutması: MediaWiki axtarışı "Arxivləşdirilib / Wayback Machine / Retrieved"
  // qaytarırsa, deməli uyğunluq məqalənin özündə yox, altdakı biblioqrafiya/istinad siyahısında tapılıb!
  if (isWiki && titleHits <= 1 && /\b(Retrieved|arxivləşdirilib|İstifadə tarixi|Archived from|Wayback Machine|ISBN\s+\d)/iu.test(result.snippet || "")) {
    score -= 3.2;
  }
  if (isWiki && titleHits === 0 && WEBSITE_LIST_QUERY_RE.test(queryRaw)) {
    score -= 2.8;
  }
  // Köhnə mənbə cəzası: müasir reytinq/xəbər/versiya sualında 4+ il əvvəlki postları (məs. 2012 Alexa) aşağı sal
  if (result.published_at && CURRENT_INTENT_RE.test(queryRaw) && !/\b(1\d{3}|20[01]\d)\b/.test(queryRaw)) {
    const pubTs = Date.parse(result.published_at);
    if (!Number.isNaN(pubTs)) {
      const ageYears = (Date.now() - pubTs) / (365.25 * 24 * 3600 * 1000);
      if (ageYears > 4) score -= 2.5;
    }
  }
  // v57.1: təzəlik — "son xəbərlər" tipli sualda 48 saat içindəki xəbər üstünlük alır,
  // 30 gündən köhnə xəbər cəzalanır. Ümumi qaydadır (sayta bağlı deyil): məqsəd
  // "News.az ana səhifəsi / CNN son xəbərlər" əvəzinə REAL və TƏZƏ məqalənin gəlməsidir.
  if (result.published_at && CURRENT_INTENT_RE.test(queryRaw) && !/\b(1\d{3}|20[01]\d)\b/.test(queryRaw)) {
    const pubTs2 = Date.parse(result.published_at);
    if (!Number.isNaN(pubTs2)) {
      const ageHours = (Date.now() - pubTs2) / 3_600_000;
      if (ageHours >= -24 && ageHours <= 48) score += 1.2;
      else if (ageHours > 24 * 30) score -= 1.5;
    }
  }
  // v57.3: xəbər sualında ana səhifə/siyahı səhifəsi cavab deyil — real məqalə lazımdır
  if (/(?<![\p{L}])(x[əe]b[əe]r|xeber|news|son|latest|headlines)(?![\p{L}])/iu.test(queryRaw || "")) {
    try {
      const pth = new URL(result.url).pathname.replace(/\/$/, "");
      const segs = pth.split("/").filter(Boolean);
      const slugLike = segs.some(x => x.length >= 18 && /[-\d]/.test(x));
      if (!slugLike && (segs.length <= 1 || pth.length < 12)) score -= 1.8;
    } catch {}
  }
  if (!result.snippet || result.snippet.trim().length < 20) score -= 1;

  // v15/v17 (Claude #8 + P5 hallüsinasiya qoruması):
  // Çox spesifik/uzun sualda (məs. 8-9 anlayışlı uydurma sualda) təkcə 2-3 ümumi sözün
  // ("Qara" + "pirat" + "kapitan") tutması əlaqəsiz məqaləni keçirməməlidir!
  // v46.1: 3 söz tələbi provayder örtüyü zəif olanda cavabı TAMAM boşaldırdı
  // ("Türkiyədə son seçkilər" → 0 nəticə). Geri 2-yə qaytarıldı.
  let minHits = conceptCount <= 2 ? 1 : 2;
  if (conceptCount >= 6) {
    // Əgər mürəkkəb sualda konkret tarixi il (məs. 1847) tələb olunursa, il heç yerdə yoxdursa uyğun deyil
    const histYearMatch = (queryRaw || "").match(/\b(1[0-9]{3}|200\d)\b/);
    if (histYearMatch && !titleTerms.has(histYearMatch[1]) && !snippetTerms.has(histYearMatch[1])) {
      return 0;
    }
    // İkidilli dublikatları ("qara"+"black") iki ayrı anlayış saymamaq üçün
    // həm orijinal, həm də əlavə (tərcümə) terminlər üzrə tutumu ayrıca yoxla
    let origHits = 0, extraHits = 0;
    for (const qt of queryTerms) {
      const grams = qGrams.get(qt);
      let matched = titleTerms.has(qt) || snippetTerms.has(qt);
      if (!matched) {
        for (const t of titleTerms) { if (trigramSimilarity(qt, t, grams) >= 0.7) { matched = true; break; } }
      }
      if (!matched) {
        for (const t of snippetTerms) { if (trigramSimilarity(qt, t, grams) >= 0.7) { matched = true; break; } }
      }
      if (matched) {
        if (origSet && origSet.has(qt)) origHits++;
        else extraHits++;
      }
    }
    const effectiveHits = Math.max(origHits, extraHits);
    const reqConcepts = Math.max(3, Math.ceil(conceptCount * 0.45));
    if (effectiveHits < reqConcepts) return 0;
  }
  // v57.3: yalnız ümumi sözlərdən ibarət xəbər sorğusunda ("son xəbərlər") termini
  // olmayan REAL tarixli məqalə atılmır — təzəlik qaydası ilə sıralanır
  // v95: AZ/EN söz sırasında mövzu sualın ƏVVƏLİNDƏ durur ("React state idarəetməsi",
  // "Xəzər dənizinin sahəsi"). Əsas mövzu başlıqda tutulubsa, 3 anlayışlı sualda
  // ikinci köməkçi anlayışın olmaması nəticəni atmamalıdır — bu, dəstləri 2-3 nəticəyə
  // düşürən əsas səbəb idi ("React" məqaləsi 0 bal alırdı).
  // v98.2: GÜCLÜ ANCHOR — sualda hərf+rəqəm tokeni varsa ("GPT-5", "iPhone 15", "5G")
  // nəticədə həmin token olmalıdır. Yoxsa "GPT-5 nə vaxt çıxdı" sualına "PS5 nə vaxt çıxdı"
  // məqalələri cavab kimi qayıdırdı (canlı golden testdə tapıldı).
  // v101: anchor YALNIZ bitişik tokenlərdir ("GPT-5", "iPhone15", "5G"). "movies 2025"
  // kimi "söz + il" cütü anchor DEYİL — tək il ilə idarə olunur (əvvəlki versiya
  // "best sci-fi movies 2025" sorğusunda bütün nəticələri sıfırlayırdı).
  const anchorKey = strongAnchor(queryRaw);
  if (anchorKey) {
    const hayKey = `${result.title || ""} ${result.snippet || ""}`.toLowerCase().replace(/[\s-]/g, "");
    if (!hayKey.includes(anchorKey)) return 0;
  }
  // v96: PROVAYDER KONSENSUSU — eyni nəticəni 2+ müstəqil provayder qaytarıbsa,
  // bu "ən çox görünən sayt" siqnalıdır (pulsuz, trafik reytinqi lazım deyil).
  // Kiçik və məhdud bonusdur: uyğunsuzluğu örtmür, sadəcə razılaşmanı qaldırır.
  const consens = Array.isArray(result.providers) ? new Set(result.providers).size : Number(result.voteCount || 1);
  if (consens >= 2) score += Math.min(0.9, 0.3 * (consens - 1));
  if (queryTerms.length && termHits < minHits && !primaryTermHit && !(genericOnlyQ && result.published_at)) return 0;
  return Math.round(score * 10) / 10;
}

// v114: YAXIN DUBLİKATLARIN SİLİNMƏSİ.
// Eyni xəbər 3-4 saytda eyni başlıqla gedir → nəticə kvotası eyni məzmunla dolur,
// müxtəlif mənbələr görünmür. Başlıq tokenləri ≥90% üst-üstə düşürsə BİR nəticə saxlanılır
// (daha zəngin snippet-li olan). Sayta bağlı deyil — başlıq müqayisəsidir.
function titleKey(t) {
  return String(t || "").toLowerCase()
    .replace(/[«»"'“”„()\[\]{}|–—:\/.,!?…]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function jaccard(a, b) {
  const A = new Set(a.split(" ").filter(w => w.length > 2));
  const B = new Set(b.split(" ").filter(w => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
export function dedupeNearDuplicates(sorted = [], window = 40) {
  const kept = [];
  const keys = [];   // paralel massiv: kept[i] üçün başlıq açarı
  for (const r of sorted) {
    const k = titleKey(r.title);
    let dupAt = -1;
    if (k.length >= 10) {
      for (let i = Math.max(0, keys.length - window); i < keys.length; i++) {
        const kk = keys[i];
        if (!kk) continue;
        if (kk === k || jaccard(kk, k) >= 0.9) { dupAt = i; break; }
      }
    }
    if (dupAt >= 0) {
      const prev = kept[dupAt];
      // eyni başlıq: mətn daha zəngindirsə əvəzlə (bal fərqi kiçik olsun)
      const prevLen = String(prev.snippet || prev.content || "").length;
      const newLen = String(r.snippet || r.content || "").length;
      const richer = newLen > prevLen + 20 || (prevLen < 40 && newLen >= 40);
      if (richer && (prev.score ?? 0) - (r.score ?? 0) < 0.5) { kept[dupAt] = r; keys[dupAt] = k; }
      continue;
    }
    kept.push(r); keys.push(k);
  }
  return kept;
}

export function diversifyByDomain(sortedResults, maxResults, maxPerDomain = 2, trustedMaxPerDomain = maxPerDomain) {
  const selected = [];
  const domainCount = {};
  const seenTitles = [];
  for (const r of sortedResults) {
    if (selected.length >= maxResults) break;
    let host = "";
    try { host = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase(); } catch { host = r.url; }
    const isTrustedDoc = trustedMaxPerDomain > maxPerDomain
      && (r.score || 0) >= 3.5
      && TRUSTED_MULTI_DOMAINS.some(d => host === d || host.endsWith("." + d));
    const cap = isTrustedDoc ? trustedMaxPerDomain : maxPerDomain;
    if ((domainCount[host] || 0) >= cap) continue;
    // Near-dedup: stopword-suz Jaccard bənzərliyi >= 0.8 olduqda təkrar sayılır
    const titleSet = new Set(tokenize(r.title || ""));
    let isDup = false;
    for (const seen of seenTitles) {
      if (!titleSet.size || !seen.size) continue;
      let inter = 0;
      for (const w of titleSet) if (seen.has(w)) inter++;
      const union = titleSet.size + seen.size - inter;
      const jaccard = union ? inter / union : 0;
      const maxOverlap = inter / Math.max(titleSet.size, seen.size);
      if (jaccard >= 0.75 || maxOverlap >= 0.8) { isDup = true; break; }
    }
    if (isDup) continue;
    domainCount[host] = (domainCount[host] || 0) + 1;
    seenTitles.push(titleSet);
    selected.push(r);
  }
  return selected;
}

export function extractQuotedPhrases(query) {
  const matches = query.match(/"([^"]+)"/g) || [];
  return matches.map(m => m.slice(1, -1).trim()).filter(Boolean);
}

export function containsPhrase(text, phrase) {
  return normalizeAz(text || "").includes(normalizeAz(phrase));
}

export function hostMatches(url, domain) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const d = domain.toLowerCase().replace(/^www\./, "");
    return h === d || h.endsWith("." + d);
  } catch {
    return false;
  }
}

const HARD_ERROR_STATUSES = new Set(["error", "rate_limited", "blocked", "timeout", "cooldown", "bad_request"]);
export function computeConfidence(results, providerErrors, usedFallback) {
  if (!results.length) return "none";
  const hardErrors = Object.values(providerErrors || {}).filter(s => HARD_ERROR_STATUSES.has(s)).length;
  const multi = results.some(r => (r.providers || []).length >= 2 || (r.voteCount || 0) >= 2);
  const substantial = results.some(r => (r.content || "").length > 300);
  const structuredTop = results[0] && typeof results[0].source === "string"
    && /open-meteo|cbar\.az|asia-baku/.test(results[0].source);
  if (usedFallback) return "low";
  if (hardErrors >= 4) return "low";
  // v19: "high" yalnız məzmun da güclü uyğunluq göstərəndə (say yox, keyfiyyət)
  const scoredAny = results.some(r => typeof r.score === "number");
  const strongContent = results.filter(r => (r.score ?? 0) >= 4 && (r.content || "").length >= 200).length;
  if (structuredTop) return "high";
  if (multi && substantial && (!scoredAny || strongContent >= 1)) return "high";
  return "medium";
}

// v101: GÜCLÜ ANCHOR — bitişik hərf+rəqəm tokeni ("GPT-5", "iPhone15", "5G").
// "movies 2025" kimi "söz + il" cütü anchor DEYİL. Qaytarır: kiçik hərfli açar və ya null.
export function strongAnchor(queryRaw = "") {
  const m = String(queryRaw || "").match(/(?<![\p{L}\d])([\p{L}]{2,}([-\s]?)(\d{1,4})|(\d{1,4})([-\s]?)([\p{L}]{2,}))(?![\p{L}\d])/u);
  if (!m) return null;
  const token = m[1];
  const sep = m[2] ?? m[5] ?? "";
  const digits = m[3] ?? m[4] ?? "";
  const yearLike = /^(19|20)\d{2}$/.test(digits);
  if (sep === " " && yearLike) return null;              // "film 2025"
  if (sep === " " && digits.length < 2) return null;     // "Formula 1" — say hesabı, anchor deyil
  // "12 vurulsun 3" kimi ifadələr anchor deyil: boşluqla ayrılmış formada marka adı
  // BÖYÜK hərflə yazılır ("iPhone 15", "GPT 5")
  if (sep === " " && !/[A-ZĞÜŞÖÇİ]/.test(m[1])) return null;
  if (sep === "" && yearLike && token.length === 4) return null;
  if (token.length < 3) return null;
  return token.toLowerCase().replace(/[\s-]/g, "");
}
