// Relevance scoring + domain diversification
// v10 🟡: spam siyahısı İKİ yerdə deyildi (bura + search.js inline) - indiki
// tək mənbə buradadır, search.js bunu import edir.
// v12: JUNK domains (B2B directory-lər cavab HƏC VAXT verməz), homepage drop,
// dil uyğunsuzluğu cəzası, mövzu-qaydaları (Tavily topic/include_domains taktikası)
import { tokenize, normalizeAz, trigramSimilarity, trigrams } from "./rank.js";

export const SPAM_DOMAINS = [
  'gitee.com',
  'pinterest.com', 'quora.com',
  'cataliahealth.com' // Vietnam spam (Test10-da Bing-dən gəldi)
];

// v12: B2B/company directory-lər — sorğu cavabı verən səhifə DEYİLDİR.
// (Tavily exclude_domains taktikası; diagnostic: rocketreach "Harada Corporation"
// "Bakıda çimərliklər" sorğusunda #1 olub — "harada" sözü şirkət adıyla matched)
export const JUNK_DOMAINS = [
  'rocketreach.com', 'rocketreach.co', 'linkedin.com', 'glassdoor.com',
  'crunchbase.com', 'zoominfo.com', 'apollo.io', 'owler.com',
  'contactout.com', 'lusha.com', 'theorg.com', 'signalhire.com',
  'snov.io', 'leadgenius.com', 'rocketreach.ru', 'zoominfo.co.uk'
];

export function isSpamDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    // v10 🟡: `includes` YOXDUR - "nogitee.com" false-positive keçirdi;
    // exakt host və ya subdomen (host === d / host.endswith(".d"))
    return SPAM_DOMAINS.some(d => host === d || host.endsWith("." + d));
  } catch { return false; }
}

export function isJunkDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return JUNK_DOMAINS.some(d => host === d || host.endsWith("." + d));
  } catch { return false; }
}

// v12: mövzu detektorları (sadə, deterministik regex — Tavily topic taktikası)
const NEWS_RE = /(son\s+(xeber|xəbər)|xəbər|xeber|xəbərlər|xeberler|gündəm|gundem|son\s+saat|breaking\s+news|latest\s+news|today'?s?\s+news|gündem\s+xəbər)/i;
const TECH_RE = /(javascript|typescript|python|golang|nodejs|node\.?js|react|vue\.js|angular|svelte|api|json|framework|library|docker|kubernetes|\bsql\b|git\w*|\bcode\b|\bkod\b|\bbug\b|\bhata\b|\berror\b|program\w*|algoritm|\brag\b|\bllm\b|\bgpt\b|chatgpt|machine\s+learning|yapay\s+zeka|sönət|sönetya|server|software|\bmühəndis\w*)/i;

// v10 🟠11: "google.com" +0.8 bonusu YOX - Google News redirect səhifələri
// (news.google.com) səhv bonus alırdı; "news.google.com" ayrıca kiçik bonus alır.
const DOMAIN_BONUS = {
  "wikipedia.org": 1, "arxiv.org": 0.5, "github.com": 1, "microsoft.com": 1,
  "cloud.google.com": 1, "learn.microsoft.com": 1, "news.google.com": 0.3,
  "spring.io": 0.8, "britannica.com": 0.8, "geeksforgeeks.org": 0.5
};
// v10 🟡: EN UZUN domen əvvəl + hostMatches (düzgün subdomen sınayışı).
// Əvvəl `host.includes(dom)` + `break` olduğu üçün "cloud.google.com" əvvəl
// "google.com"-a düşüb 0.8 alırdı (1.0 heç vaxt çatanmırdı), "learn.microsoft.com"
// eyni problem - "microsoft.com" 1.0 ilə eyni olduğu üçün görünməzdi amma
// includes("google.com") "googleapis.com" kimi saxta host-lara da bonus verirdi.
const BONUS_DOMAINS = Object.entries(DOMAIN_BONUS).sort((a, b) => b[0].length - a[0].length);
// Qeyri-akademik sorğularda arXiv cəzası (Test10 fix): JSON/format/snippet sorğusunda arxiv akademik kağızlar
// ümumi axtarış nəticələrini sıxışdırır - ona görə -1 cəza
const NON_ACADEMIC_TERMS = new Set(["json", "format", "snippet", "url", "api", "response"])

// v12 imza: (result, queryTerms, lang = "en", queryRaw = "")
// lang = sorğunun dili (az/tr/en) — dil uyğunsuzluğu cəzası üçün
// queryRaw = orijinal sorğu — mövzu qaydaları (news/tech) üçün
// v12.3 perf: queryTerms array-i -> trigram Map (WeakMap cache).
// route.js eyni array-i bütün nəticələrə keçirir → Map 1 dəfə qurulur;
// array sorğu bitəndə GC-ə düşür (strong ref yoxdur, leak olmaz).
const QGRAMS_CACHE = new WeakMap();
function qGramsFor(queryTerms) {
  let m = QGRAMS_CACHE.get(queryTerms);
  if (!m) {
    m = new Map(queryTerms.map(qt => [qt, trigrams(qt)]));
    QGRAMS_CACHE.set(queryTerms, m);
  }
  return m;
}

export function scoreResult(result, queryTerms, lang = "en", queryRaw = "") {
  // v12: directory-lər HƏC VAXT cavab vermir — hard drop
  if (isJunkDomain(result.url)) return 0;
  const titleTerms = new Set(tokenize(result.title || ""));
  const snippetTerms = new Set(tokenize(result.snippet || ""));
  // v12.3 perf: hər query term-in trigramı 1 dəfə (müqayisə loop-unda değil).
  // route.js eyni qTerms massivini BÜTÜN nəticələrə keçirir → WeakMap cache
  // (array-ə görə) sorğu bitəndə GC-ə gedir, hər nəticədə Map qurumuruq.
  const qGrams = qGramsFor(queryTerms);
  let score = 0;
  let termHits = 0;
  const hitTerms = new Set();
  for (const qt of queryTerms) {
    let hit = false;
    if (titleTerms.has(qt)) { score += 2; hit = true; } // title match x2
    else if (snippetTerms.has(qt)) { score += 1; hit = true; } // snippet match x1
    else {
      // v10 🟠8: stemming mismatch — "azerbayca"→"azerbayc" vs "azerbaycan"→"azerbayca"
      // exakt Set hitə düşmürdü → termHits=0 → score 0 → nəticə filtrdən atılırdı.
      // Həll: trigram bənzərliyi ≥0.7 olan term (snippet ekvivalenti, x1).
      // 0.7 səbəbi: tam gözlənilən mismatch cütü (azerbayc/azerbayca) 0.727-dir;
      // fərqli köklər ("neft"/"nefti"=0.63, "qaz"/"qazi"=0.57) 0.7-nin altına düşür.
      let best = 0;
      const grams = qGrams.get(qt);
      for (const t of titleTerms) { const s = trigramSimilarity(qt, t, grams); if (s > best) best = s; }
      if (best < 0.7) for (const t of snippetTerms) { const s = trigramSimilarity(qt, t, grams); if (s > best) best = s; }
      if (best >= 0.7) { score += 1; hit = true; }
    }
    if (hit) { termHits++; hitTerms.add(qt); }
  }
  // Domen bonusu
  let host = "";
  try {
    host = new URL(result.url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.endsWith(".az")) score += 1; // AZ sorğusunda .az domen boost (DeepSeek P0-3)
    for (const [dom, bonus] of BONUS_DOMAINS) {
      if (hostMatches(result.url, dom)) { score += bonus; break; }
    }
  } catch {}
  // v12: dil uyğunsuzluğu cəzası — AZ sorğusunda EN-only nəticə, TR sorğusunda
  // EN-only nəticə demoted edilir (Google tərzi: lokal dil üstündür).
  // LOCA markerı: ə = AZ-yaxşısı (TR-də yoxdur); şğıüöç = turk-unik.
  // Domen markerı: .az / .com.tr / .tr.
  if (lang === "az" || lang === "tr") {
    const blob = ((result.title || "") + " " + (result.snippet || "")).toLowerCase();
    const local =
      lang === "az"
        ? (blob.includes("ə") || host.endsWith(".az"))
        : (/[şğğüüöç]/.test(blob) || host.endsWith(".com.tr") || host.endsWith(".tr"));
    if (!local) score -= 1.5;
  }
  // v12: mövzu qaydaları (Tavily topic taktikası) — GitHub/HN/arXiv texniki
  // sorğular üçün DÖZƏLİR, amma film/xəbər sorğusunda zibildir.
  const isCodey = result.source === "github" || result.source === "hacker-news" || result.source === "arxiv";
  const isNewsQuery = NEWS_RE.test(queryRaw);
  const isTechQuery = TECH_RE.test(queryRaw);
  if (isCodey && !isTechQuery) {
    score -= isNewsQuery ? 1.5 : 1; // news sorğusunda daha güclü, qalannda kiçik
  }
  // RRF bonusu (FreeSearch taktikası): bir neçə mühərrikin yüksək sıraladığı səhifə öndədir
  if (result.rrfScore) score += result.rrfScore * 50;
  // EN anchor bonusu (DeepSeek anchor strategiyası): EN tərcümə axtarışında top-3-ə düşən URL
  // uzun AZ sorğusunda da üstün tutulur - determinizm artır
  if (result.anchorBonus) score += 1.5;
  // arXiv qeyri-akademik cəzası (Test10 fix: arxiv akademik kağızlar Tavily nəticələrini sıxışdırır)
  if (result.source === "arxiv" && queryTerms.some(t => NON_ACADEMIC_TERMS.has(t))) score -= 2;
  // v10.1 🟠5: çözülməyən Google News redirect link (decodeGoogleNewsUrl uğursuz
  // olduqda news.google.com/articles/ qalır) — extract orada boş yer edir,
  // nəticə snippet-only olur → kiçik cəza (atılmır, sona yaxınlaşır)
  try {
    const nu = new URL(result.url);
    if (/^news\.google\./i.test(nu.hostname) && nu.pathname.includes("/articles/")) score -= 1;
  } catch {}
  // v12: news sorğusunda news mənbələri boost edilir (Tavily topic=news taktikası)
  if (isNewsQuery && result.source === "google-news") score += 0.7;
  // Snippet boşdursa cəza
  if (!result.snippet || result.snippet.trim().length < 20) score -= 1;
  // Sorğu termini title/snippet-də heç yoxdursa - junk (vote/domain bonusu təkbaşına keçə bilməz)
  const minHits = queryTerms.length <= 2 ? 1 : 2;
  if (queryTerms.length && termHits < minHits) return 0;
  return Math.round(score * 10) / 10;
}

export function diversifyByDomain(sortedResults, maxResults, maxPerDomain = 2) {
  const selected = [];
  const domainCount = {};
  const seenTitles = []; // near-dedup: eyni məzmunlu sindikat məqalələr (H21x taktikası)
  for (const r of sortedResults) {
    if (selected.length >= maxResults) break;
    let host = "";
    try { host = new URL(r.url).hostname.replace(/^www\./, ""); } catch { host = r.url; }
    if ((domainCount[host] || 0) >= maxPerDomain) continue;
    // Near-dedup: başlıq token-ları 80%+ üst-üstə düşürsə, təkrar sayılır (daha yüksək skorlu saxlanılır)
    const titleSet = new Set(tokenize(r.title || ""));
    let isDup = false;
    for (const seen of seenTitles) {
      if (!titleSet.size || !seen.size) continue;
      let inter = 0;
      for (const w of titleSet) if (seen.has(w)) inter++;
      const sim = inter / Math.max(titleSet.size, seen.size);
      if (sim >= 0.8) { isDup = true; break; }
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

// site: filter üçün exakt host uyğunluğu - substring (includes) istifadə etmirlər:
// "wikipedia.org" domaini "evil-wikipedia.org.fake.com"-u keçirməməlidir
export function hostMatches(url, domain) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const d = domain.toLowerCase().replace(/^www\./, "");
    return h === d || h.endsWith("." + d);
  } catch {
    return false;
  }
}

// v14 (user review #1): confidence v3 — provider XƏTALARI AYRILIR.
// Əvvəlki versiyada "no_results" DA XƏTA sayılırdı (provider qərəzsiz 0 nəticə
// verməsi normaldır) → 10 providerdən 3+ "no results" verdiyi üçün HƏR sorğu
// "low" çıxırdı. İndi:
//   none   — nəticə yoxdur
//   low    — fallback (relevance keçməyib) və ya 4+ HARD xəta (degraded run)
//   high   — struktur API (Open-Meteo/CBAR/vaxt) və ya (2+ provider razılığı
//            VƏ 300+ char substantial content)
//   medium — digər hallar (tək provider, qısa content)
// KƏRƏK SEMANTİKA: bu, cavabın DÜZGÜNLÜYÜ deyil — mənbələrin razılığı + relevantlıqdır.
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
  if (structuredTop || (multi && substantial)) return "high";
  return "medium";
}
