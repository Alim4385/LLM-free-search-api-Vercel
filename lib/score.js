// Relevance scoring + domain diversification
// v10 🟡: spam siyahısı İKİ yerdə deyildi (bura + search.js inline) - indiki
// tək mənbə buradadır, search.js bunu import edir.
import { tokenize, normalizeAz, trigramSimilarity } from "./rank.js";

export const SPAM_DOMAINS = [
  'gitee.com',
  'pinterest.com', 'quora.com',
  'cataliahealth.com' // Vietnam spam (Test10-da Bing-dən gəldi)
];

export function isSpamDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    // v10 🟡: `includes` YOXDUR - "nogitee.com" false-positive keçirdi;
    // exakt host və ya subdomen (host === d / host.endswith(".d"))
    return SPAM_DOMAINS.some(d => host === d || host.endsWith("." + d));
  } catch { return false; }
}

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

export function scoreResult(result, queryTerms) {
  const titleTerms = new Set(tokenize(result.title || ""));
  const snippetTerms = new Set(tokenize(result.snippet || ""));
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
      for (const t of titleTerms) { const s = trigramSimilarity(qt, t); if (s > best) best = s; }
      if (best < 0.7) for (const t of snippetTerms) { const s = trigramSimilarity(qt, t); if (s > best) best = s; }
      if (best >= 0.7) { score += 1; hit = true; }
    }
    if (hit) { termHits++; hitTerms.add(qt); }
  }
  // Domen bonusu
  try {
    const host = new URL(result.url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.endsWith(".az")) score += 1; // AZ sorğusunda .az domen boost (DeepSeek P0-3)
    for (const [dom, bonus] of BONUS_DOMAINS) {
      if (hostMatches(result.url, dom)) { score += bonus; break; }
    }
  } catch {}
  // RRF bonusu (FreeSearch taktikası): bir neçə mühərrikin yüksək sıraladığı səhifə öndədir
  if (result.rrfScore) score += result.rrfScore * 50;
  // EN anchor bonusu (DeepSeek anchor strategiyası): EN tərcümə axtarışında top-3-ə düşən URL
  // uzun AZ sorğusunda da üstün tutulur - determinizm artır
  if (result.anchorBonus) score += 1.5;
  // arXiv qeyri-akademik cəzası (Test10 fix: arxiv akademik kağızlar Tavily nəticələrini sıxışdırır)
  if (result.source === "arxiv" && queryTerms.some(t => NON_ACADEMIC_TERMS.has(t))) score -= 2;
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
