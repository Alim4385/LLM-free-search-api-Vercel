// Relevance scoring + domain diversification
import { tokenize, normalizeAz } from "./rank.js";

export const SPAM_DOMAINS = [
  'gitee.com', 'so.gitee.com', 'ai.gitee.com',
  'pinterest.com', 'quora.com',
  'cataliahealth.com' // Vietnam spam (Test10-da Bing-dən gəldi)
];

export function isSpamDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return SPAM_DOMAINS.some(d => host === d || host.endsWith("." + d) || host.includes(d));
  } catch { return false; }
}

const DOMAIN_BONUS = {
  "wikipedia.org": 1, "arxiv.org": 0.5, "github.com": 1, "microsoft.com": 1,
  "google.com": 0.8, "cloud.google.com": 1, "learn.microsoft.com": 1,
  "spring.io": 0.8, "britannica.com": 0.8, "geeksforgeeks.org": 0.5
};
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
    if (titleTerms.has(qt)) { score += 2; termHits++; hitTerms.add(qt); } // title match x2
    if (snippetTerms.has(qt)) { score += 1; termHits++; hitTerms.add(qt); } // snippet match x1
  }
  // Domen bonusu
  try {
    const host = new URL(result.url).hostname.replace(/^www\./, "");
    if (host.endsWith(".az")) score += 1; // AZ sorğusunda .az domen boost (DeepSeek P0-3)
    for (const [dom, bonus] of Object.entries(DOMAIN_BONUS)) {
      if (host.includes(dom)) { score += bonus; break; }
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
