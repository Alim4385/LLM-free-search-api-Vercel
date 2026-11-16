// Relevance scoring + domain diversification (v15)
import { tokenize, normalizeAz, trigramSimilarity, trigrams } from "./rank.js";

export const SPAM_DOMAINS = [
  "gitee.com",
  "pinterest.com", "quora.com",
  "cataliahealth.com"
];

export const JUNK_DOMAINS = [
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
const NEWS_RE = /(son\s+(xeber|xəbər)|xəbər|xeber|xəbərlər|xeberler|gündəm|gundem|son\s+saat|breaking\s+news|latest\s+news|today'?s?\s+news|gündem\s+xəbər)/i;

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
  "docs.python.org": 1, "developer.mozilla.org": 1, "react.dev": 0.9, "nodejs.org": 0.9,
  "arxiv.org": 0.5, "github.com": 1, "microsoft.com": 1,
  "cloud.google.com": 1, "learn.microsoft.com": 1, "news.google.com": 0.3,
  "spring.io": 0.8, "britannica.com": 0.8, "geeksforgeeks.org": 0.5
};
const BONUS_DOMAINS = Object.entries(DOMAIN_BONUS).sort((a, b) => b[0].length - a[0].length);
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

export function scoreResult(result, queryTerms, lang = "en", queryRaw = "") {
  if (isJunkDomain(result.url) || isAuthOrBareSearchRoot(result.url)) return 0;
  if (isDictionaryPage(result.url) && !DEFINITION_QUERY_RE.test(queryRaw)) return 0;
  const titleTerms = new Set(tokenize(result.title || ""));
  const snippetTerms = new Set(tokenize(result.snippet || ""));
  const qGrams = qGramsFor(queryTerms);
  let score = 0;
  let termHits = 0;
  let titleHits = 0;
  for (const qt of queryTerms) {
    let hit = false;
    if (titleTerms.has(qt)) { score += 2; hit = true; titleHits++; }
    else if (snippetTerms.has(qt)) { score += 1; hit = true; }
    else {
      let best = 0;
      const grams = qGrams.get(qt);
      for (const t of titleTerms) { const s = trigramSimilarity(qt, t, grams); if (s > best) best = s; }
      if (best >= 0.7) { score += 1; hit = true; titleHits++; }
      else {
        for (const t of snippetTerms) { const s = trigramSimilarity(qt, t, grams); if (s > best) best = s; }
        if (best >= 0.7) { score += 1; hit = true; }
      }
    }
    if (hit) termHits++;
  }

  let host = "";
  try {
    host = new URL(result.url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.endsWith(".az")) score += 1;
    for (const [dom, bonus] of BONUS_DOMAINS) {
      if (hostMatches(result.url, dom)) { score += bonus; break; }
    }
  } catch {}

  const newsQ = isNewsQuery(queryRaw);
  const techQ = isTechQuery(queryRaw);

  // v15: dil uyğunluğu — lokal mövzularda AZ/TR üstündür; amma texniki suallarda
  // və ya tərcümə olunmuş EN anchor tapıntılarında EN saytları cəzalandırılmır
  // (çünki route.js onları oxuyub sonda sualın dilinə tərcümə edir!)
  if (lang === "az" || lang === "tr") {
    const blob = ((result.title || "") + " " + (result.snippet || "")).toLowerCase();
    const local =
      lang === "az"
        ? (blob.includes("\u0259") || host.endsWith(".az"))
        : (/[şğüöç]/.test(blob) || host.endsWith(".com.tr") || host.endsWith(".tr"));
    if (local) {
      score += 0.5;
    } else if (!techQ && !result.anchorBonus) {
      score -= 1.5;
    }
  }

  const isCodey = result.source === "github" || result.source === "hacker-news" || result.source === "arxiv" || result.source === "stackoverflow";
  if (isCodey && !techQ) {
    score -= newsQ ? 2 : 1.2;
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
  if (newsQ && result.source === "google-news") score += 1.5;
  // Xəbər sualında portal ana səhifəsi (path="/" və tarixsiz) əvəzinə tarixli konkret xəbəri üstün tut
  if (newsQ && !result.published_at) {
    try {
      if (new URL(result.url).pathname === "/") score -= 2.5;
    } catch {}
  }
  // Xəbər sualında ensiklopediya məqalələri ("Gəncə bombalanmaları", "Azərbaycan") bugünkü xəbər DEYİL
  if (newsQ && isWiki) score -= 3.5;
  // Wikipedia istinad/dipnot təsadüfi tutması: MediaWiki axtarışı "Arxivləşdirilib / Wayback Machine / Retrieved"
  // qaytarırsa, deməli uyğunluq məqalənin özündə yox, altdakı biblioqrafiya/istinad siyahısında tapılıb!
  if (isWiki && titleHits <= 1 && /\b(Retrieved|arxivləşdirilib|İstifadə tarixi|Archived from|Wayback Machine|ISBN\s+\d)/iu.test(result.snippet || "")) {
    score -= 3.2;
  }
  // Köhnə mənbə cəzası: müasir reytinq/xəbər/versiya sualında 4+ il əvvəlki postları (məs. 2012 Alexa) aşağı sal
  if (result.published_at && CURRENT_INTENT_RE.test(queryRaw) && !/\b(1\d{3}|20[01]\d)\b/.test(queryRaw)) {
    const pubTs = Date.parse(result.published_at);
    if (!Number.isNaN(pubTs)) {
      const ageYears = (Date.now() - pubTs) / (365.25 * 24 * 3600 * 1000);
      if (ageYears > 4) score -= 2.5;
    }
  }
  if (!result.snippet || result.snippet.trim().length < 20) score -= 1;

  // v15 (Claude #8 + P5 hallüsinasiya qoruması):
  // Çox spesifik/uzun sualda (məs. 8-9 anlayışlı uydurma sualda) təkcə 2 ümumi sözün
  // ("Qara" + "dəniz") tutması əlaqəsiz məqaləni keçirməməlidir!
  const origSet = queryRaw ? new Set(tokenize(queryRaw)) : null;
  const conceptCount = origSet && origSet.size ? origSet.size : queryTerms.length;
  let minHits = conceptCount <= 2 ? 1 : 2;
  if (conceptCount >= 6) {
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
  if (queryTerms.length && termHits < minHits) return 0;
  return Math.round(score * 10) / 10;
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
  if (structuredTop || (multi && substantial)) return "high";
  return "medium";
}
