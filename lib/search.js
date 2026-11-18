// Key-siz axtarış provayderləri - v15
// v42: Bing RSS + Bing News RSS + DDG HTML əlavə olundu (keyless, canlı yoxlanmış)
// v51: Yahoo (Google indeksli) + Mwmbl (müstəqil açıq indeks) + DDG Lite əlavə olundu
// Aktiv: Bing HTML + Bing RSS + Bing News RSS + DDG HTML + Brave HTML + Wikipedia (AZ/EN/TR) +
// Google News RSS + Hacker News Algolia + GitHub API + StackOverflow API (yalnız tech) + arXiv
// Default-off: DDG (ENABLE_DDG=1), Tavily (TAVILY_API_KEY / ENABLE_TAVILY=1), SearXNG (SEARXNG_URL)
import { XMLParser } from "fast-xml-parser";
import { parseHTML } from "linkedom";
import { expandQueryAsync } from "./expand.js";
import { tokenize } from "./rank.js";
import { isCircuitOpen, recordSuccess, recordFailure } from "./circuit.js";
import { fetchSuggestions } from "./suggest.js";
import { isSpamDomain, isTechQuery, isNewsQuery } from "./score.js";
import { searchAzertag, azertagLangFor } from "./azertag.js";
import { searchSitemapNews } from "./sitemapnews.js";
import { detectQueryLanguage, normalizeColloquialAz, acceptLanguageHeader } from "./clean.js";
import { normalizeAz } from "./rank.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const WIKI_UA = "LLM-free-search-api/1.5 (https://github.com/Alim4385/LLM-free-search-api-Vercel) keyless-search";

// v62: BİNG ÇOXSÖZLÜ SORĞUNU TƏK SÖZƏ ENDİRİR.
// Canlı yoxlama (2026-11): "how many metro stations baku" → Bing yalnız "many"/"metro" sözünə
// uyğun nəticə qaytarır (Merriam-Webster, T-Mobile). Bu, bütün zibil nəticələrin əsas mənbəyidir
// ("LA Times: rabbits", "Google Cloud VM" məhz buradan gəlirdi).
// Sayta bağlı olmayan ümumi qayda: sorğuda 2+ məzmun sözü varsa, nəticə ən azı 2-ni özündə saxlamalıdır.
export function providerTermGate(results, query) {
  const terms = Array.from(new Set(tokenize(query))).filter(w => w.length >= 3);
  if (terms.length < 2) return results;
  const need = 2;
  const kept = (results || []).filter(r => {
    const text = normalizeAz(`${r.title || ""} ${r.snippet || ""}`);
    let hit = 0;
    for (const t of terms) { if (text.includes(t)) hit++; if (hit >= need) return true; }
    return false;
  });
  // Hamısı düşürsə nəticəni boş qaytarırıq — zibil qaytarmaqdansa boş daha yaxşıdır
  return kept;
}

export async function fetchTimeout(url, opts = {}, ms = 5000, signal) {
  const sig = signal
    ? AbortSignal.any([AbortSignal.timeout(ms), signal])
    : AbortSignal.timeout(ms);
  return fetch(url, { ...opts, signal: sig, headers: { "User-Agent": UA, "Accept-Language": "az-AZ,az;q=0.9,en;q=0.8", ...(opts.headers || {}) } });
}

const DROP_PARAMS = /^(utm_\w+|fbclid|gclid|mc_\w+|igshid|igsh|ref|ref_src|msclkid|twclid|yclid|_hsenc|_hsmi|spm|sc|scsig|form|sapiv|ckla|adurl)$/i;
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    let path = u.pathname.replace(/\/$/, "") || "/";
    try { path = decodeURIComponent(path); } catch {}
    const params = [];
    for (const [k, v] of u.searchParams) {
      if (DROP_PARAMS.test(k)) continue;
      const kl = k.toLowerCase();
      if ((kl === "t" || kl === "start") && /(^|\.)(youtube\.com|youtu\.be)$/.test(host)) continue;
      params.push([k, v]);
    }
    params.sort((a, b) => a[0].localeCompare(b[0]));
    const qs = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
    return host + path + qs;
  } catch { return url; }
}

const NAMED_ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&nbsp;": " "
};
export function decodeEntities(s) {
  return String(s || "").replace(
    /&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;|&#(\d+);|&#x([0-9a-fA-F]+);/g,
    (m, dec, hex) => {
      if (dec !== undefined) return String.fromCodePoint(parseInt(dec, 10));
      if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
      return NAMED_ENTITIES[m];
    }
  );
}

export async function fetchWithRetry(fn, query, count, budgetMs = 4000, signal, providerName = "") {
  const start = Date.now();
  try {
    return await fn(query, count, signal);
  } catch (e) {
    const msg = e.message || "";
    const isEmpty = /no results/i.test(msg);
    // v15: Brave 429 verdikdə 400ms sonra yenidən vurmaq IP banını uzadır — retry etmə!
    const isRateLimit = providerName !== "brave" && /429|403|rate limit/i.test(msg);
    if ((isEmpty || isRateLimit) && Date.now() - start < budgetMs - 500 && !(signal && signal.aborted)) {
      await new Promise(r => setTimeout(r, isRateLimit ? 400 : 200));
      return await fn(query, count, signal);
    }
    throw e;
  }
}

export async function searchTavilyKeyless(query, count = 8, opts = {}) {
  const body = { query, max_results: count, search_depth: "basic", include_answer: false };
  if (opts.freshness && ["day","week","month","year"].includes(opts.freshness)) body.time_range = opts.freshness;
  const tLang = detectQueryLanguage(query);
  if (tLang === "az") body.country = "az";
  else if (tLang === "tr") body.country = "tr";
  if (opts.excludeDomains && opts.excludeDomains.length) body.exclude_domains = opts.excludeDomains.slice(0, 150);
  if (opts.includeDomains && opts.includeDomains.length) body.include_domains = opts.includeDomains.slice(0, 300);
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tavily-Access-Mode": "keyless" },
    body: JSON.stringify(body),
    signal: opts.signal
      ? AbortSignal.any([AbortSignal.timeout(2000), opts.signal])
      : AbortSignal.timeout(2000)
  });
  if (!res.ok) throw new Error("tavily keyless " + res.status);
  const j = await res.json();
  const arr = j.results || [];
  if (!arr.length) throw new Error("tavily no results");
  return arr.slice(0, count).map(r => ({
    title: decodeEntities(String(r.title || "")).slice(0, 200),
    url: String(r.url || ""),
    snippet: decodeEntities(String(r.content || "")).slice(0, 500),
    source: "tavily",
    published_at: r.published_date || null
  })).filter(x => x.url.startsWith("http"));
}

// Texniki API-lər (HN / GitHub / StackOverflow) üçün sual/müqayisə sözlərini təmizləyir
// ("What's new in Next.js 15?" -> "Next.js 15", "Python asyncio gather vs TaskGroup differences" -> "Python asyncio TaskGroup")
function cleanTechApiQuery(q) {
  let s = stripQuestionWords(q)
    .replace(/[?!,;]+/g, " ")
    .replace(/\b(what'?s\s+new|new\s+in|yeni\s+nə\s+var|yeniliklər|differences?|comparison|compare|vs\.?|versus|between|and|in|on|for|the|how\s+to)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length > 4) {
    // Çox uzun sorğuda AND-mühərriklər 0 qaytarır: ən informativ 4 tokeni saxla
    s = words.slice(0, 4).join(" ");
  }
  return s.length >= 2 ? s : q;
}

export async function searchHN(query, count = 8, signal) {
  const cleanQ = cleanTechApiQuery(query);
  const url = `https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(cleanQ)}&hitsPerPage=${count}`;
  const res = await fetchTimeout(url, {}, 1500, signal);
  if (!res.ok) throw new Error("hn algolia " + res.status);
  const j = await res.json();
  const hits = j.hits || [];
  if (!hits.length) throw new Error("hn no results");
  return hits.slice(0, count).map(h => {
    const title = decodeEntities(String(h.title || h.story_title || "")).slice(0, 200);
    const link = h.url || `https://news.ycombinator.com/item?id=${h.objectID}`;
    const rawText = String(h.story_text || h.comment_text || "").replace(/<[^>]+>/g, "").trim();
    const snippet = decodeEntities(rawText || `${title} — ${h.points || 0} points, ${h.num_comments || 0} comments on Hacker News`).slice(0, 500);
    return { title, url: link, snippet, source: "hacker-news", published_at: h.created_at || null };
  }).filter(x => x.url.startsWith("http") && x.title);
}

export async function searchGitHub(query, count = 8, signal) {
  const cleanQ = cleanTechApiQuery(query);
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(cleanQ)}&per_page=${count}&sort=stars`;
  const res = await fetchTimeout(url, { headers: { "Accept": "application/vnd.github+json", "User-Agent": WIKI_UA } }, 1500, signal);
  if (!res.ok) throw new Error("github api " + res.status);
  const j = await res.json();
  const items = j.items || [];
  if (!items.length) throw new Error("github no results");
  return items.slice(0, count).map(i => ({
    title: decodeEntities(String(i.full_name || "")).slice(0, 200),
    url: String(i.html_url || ""),
    snippet: decodeEntities(String(i.description || `${i.stargazers_count || 0} stars on GitHub`)).slice(0, 500),
    source: "github",
    published_at: i.created_at || null,
    updated_at: i.updated_at || null
  })).filter(x => x.url.startsWith("http") && x.title);
}

// v15: StackOverflow rəsmi JSON API (keyless, yalnız texniki suallarda çağırılır!)
export async function searchStackOverflow(query, count = 5, signal) {
  const cleanQ = cleanTechApiQuery(query);
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=${count}&filter=withbody&q=${encodeURIComponent(cleanQ)}`;
  const res = await fetchTimeout(url, { headers: { "Accept": "application/json", "User-Agent": WIKI_UA } }, 1600, signal);
  if (!res.ok) throw new Error("stackoverflow " + res.status);
  const j = await res.json();
  const items = j.items || [];
  if (!items.length) throw new Error("stackoverflow no results");
  return items.slice(0, count).map(it => {
    const title = decodeEntities(String(it.title || "")).slice(0, 200);
    const bodyText = decodeEntities(String(it.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    return {
      title,
      url: String(it.link || ""),
      snippet: (bodyText || title).slice(0, 500),
      source: "stackoverflow",
      published_at: it.creation_date ? new Date(it.creation_date * 1000).toISOString() : null,
      updated_at: it.last_activity_date ? new Date(it.last_activity_date * 1000).toISOString() : null
    };
  }).filter(x => x.url.startsWith("http") && x.title);
}

export async function searchArxiv(query, count = 8, signal) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${count}&sortBy=relevance`;
  const res = await fetchTimeout(url, {}, 1500, signal);
  if (!res.ok) throw new Error("arxiv " + res.status);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: true });
  const j = parser.parse(xml);
  const entries = j?.feed?.entry || [];
  const arr = Array.isArray(entries) ? entries : [entries];
  if (!arr.length) throw new Error("arxiv no results");
  return arr.slice(0, count).map(e => ({
    title: decodeEntities(String(e.title || "").replace(/\s+/g, " ").trim()).slice(0, 200),
    url: String(e.id || ""),
    snippet: decodeEntities(String(e.summary || "").replace(/\s+/g, " ").trim()).slice(0, 500),
    source: "arxiv",
    published_at: e.published || null
  })).filter(x => x.url.startsWith("http") && x.title);
}

function decodeDDG(href) {
  try {
    const u = new URL(href, "https://html.duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
  } catch {}
  return href;
}

function decodeBing(href) {
  try {
    if (!href.includes("/ck/a")) return href;
    const u = new URL(href);
    const uu = u.searchParams.get("u");
    if (uu && uu.startsWith("a1")) {
      const decoded = Buffer.from(uu.slice(2), "base64").toString("utf-8");
      if (decoded.startsWith("http")) return decoded;
    }
  } catch {}
  return href;
}

export async function searchDDG(query, count = 8, signal) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchTimeout(url, {}, 1200, signal);
  if (!res.ok) throw new Error("ddg html " + res.status);
  const html = await res.text();
  if (html.includes("anomaly-modal") || html.includes("bots use DuckDuckGo")) throw new Error("ddg bot challenge");
  const { document } = parseHTML(html);
  const results = [];
  document.querySelectorAll(".result").forEach(el => {
    const a = el.querySelector(".result__a");
    const s = el.querySelector(".result__snippet");
    if (!a) return;
    const href = decodeDDG(a.getAttribute("href") || "");
    if (!href.startsWith("http")) return;
    results.push({
      title: decodeEntities((a.textContent || "").trim()).slice(0, 200),
      url: href,
      snippet: decodeEntities((s?.textContent || "").trim()).slice(0, 500),
      source: "duckduckgo",
      published_at: null
    });
  });
  if (!results.length) throw new Error("ddg no results");
  return results.slice(0, count);
}

export async function searchBing(query, count = 8, signal) {
  const qLang = detectQueryLanguage(query);
  // v17: Bing-də mkt=az-AZ etibarsız market kodudur (0 nəticə qaytarırdı!);
  // dilə uyğun setlang + Accept-Language ilə sorğunun öz dilində nəticə və ön-izləmə gətirilir
  const MKT = { az: "&setlang=az", tr: "&setlang=tr&mkt=tr-TR", ru: "&setlang=ru&mkt=ru-RU", fr: "&setlang=fr&mkt=fr-FR", es: "&setlang=es&mkt=es-ES", de: "&setlang=de&mkt=de-DE", pt: "&setlang=pt&mkt=pt-PT", en: "&setlang=en&mkt=en-US" };
  const langParam = MKT[qLang] || "&setlang=en&mkt=en-US";
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}${langParam}`;
  const runBing = async () => {
  const res = await fetchTimeout(url, { headers: { "Accept-Language": acceptLanguageHeader(qLang) } }, 1200, signal);
  if (!res.ok) throw new Error("bing html " + res.status);
  const html = await res.text();
  const { document } = parseHTML(html);
  const results = [];
  let items = document.querySelectorAll("li.b_algo");
  if (!items.length) items = document.querySelectorAll(".b_algo, .b_algoheader, li[data-id]");
  items.forEach(el => {
    const a = el.querySelector("h2 a") || el.querySelector("a[href]");
    const p = el.querySelector("p") || el.querySelector(".b_caption p") || el.querySelector("div");
    if (!a) return;
    const href = decodeBing(a.getAttribute("href") || "");
    if (!href.startsWith("http")) return;
    results.push({
      title: decodeEntities((a.textContent || "").trim()).slice(0, 200),
      url: href,
      snippet: decodeEntities((p?.textContent || "").trim()).slice(0, 500),
      source: "bing",
      published_at: null
    });
  });
  return results;
  };
  let results = await runBing();
  if (!results.length) throw new Error("bing no results");
  // v62: Bing bəzən çoxsözlü sorğunu tək sözə endirir (Merriam-Webster/T-Mobile zibili).
  // Gate-dən sonra BOŞ qalırsa bir dəfə təkrar soruşuruq (Bing qeyri-deterministikdir).
  let gated = providerTermGate(results, query);
  if (!gated.length && Array.isArray(tokenize(query)) && tokenize(query).length >= 2) {
    try {
      results = await runBing();
      gated = providerTermGate(results, query);
    } catch { /* təkrar uğursuzdursa boş qaytarırıq */ }
  }
  return gated.slice(0, count);
}

// v15: Həqiqi Promise-chain mutex — əvvəl paralel variantlar eyni anda timestamp oxuyub
// eyni millisaniyədə 3 istək vururdu -> dərhal Brave 429 IP ban!
function acquireBraveSlot(signal) {
  const prev = globalThis.__qaqaBraveChain || Promise.resolve();
  let release;
  const current = new Promise(r => { release = r; });
  globalThis.__qaqaBraveChain = prev.then(() => current);
  return prev.then(async () => {
    const wait = 1150 - (Date.now() - (globalThis.__qaqaLastBrave || 0));
    if (wait > 0) {
      await new Promise(r => setTimeout(r, wait));
    }
    if (signal && signal.aborted) {
      release();
      throw new Error("aborted");
    }
    globalThis.__qaqaLastBrave = Date.now();
    return release;
  });
}

const BRAVE_REL_PREFIX_RE = /^(?:\d+\s+(?:hours?|days?|weeks?|months?|years?|minutes?|saat|gün|həftə|ay|il)\s+(?:ago|öncə|əvvəl)|yesterday|today)\s*[-·–—]\s*/i;
const BRAVE_AI_NOISE_RE = /^AI can make mistakes[^.]*\.\s*(?:\.{2,}\s*)?/i;

export async function searchBrave(query, count = 8, signal) {
  const release = await acquireBraveSlot(signal);
  try {
    const qLang = detectQueryLanguage(query);
    const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
    const res = await fetchTimeout(url, { headers: { "Accept-Language": acceptLanguageHeader(qLang) } }, 1500, signal);
    if (!res.ok) throw new Error("brave " + res.status);
    const html = await res.text();
    const { document } = parseHTML(html);
    const results = [];
    document.querySelectorAll(".snippet").forEach(el => {
      const a = el.querySelector("a.l1[href], a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("http") || href.includes("brave.com")) return;
      const titleEl = el.querySelector(".title, .search-snippet-title");
      const descEl = el.querySelector(".generic-snippet .content, .generic-snippet, .snippet-description");
      let titleDec = decodeEntities((titleEl ? titleEl.textContent : a.textContent || "").trim()).replace(/\s+/g, " ");
      if (!titleEl && titleDec.includes("›")) {
        const parts = titleDec.split("›");
        titleDec = parts[parts.length - 1].trim();
      }
      titleDec = titleDec.slice(0, 160);
      // Video karusel zibilini ("05:42 YouTube Git #12 ... Hamısına bax") keç
      if (/^\d{1,2}:\d{2}\s+YouTube\b/i.test(titleDec)) return;

      let snippet = decodeEntities((descEl ? descEl.textContent : el.textContent || "").trim()).replace(/\s+/g, " ");
      if (!descEl && snippet.startsWith(titleDec)) snippet = snippet.slice(titleDec.length).trim();
      snippet = snippet.replace(BRAVE_REL_PREFIX_RE, "").replace(BRAVE_AI_NOISE_RE, "").trim();
      if (/^Videolar\s+\d{1,2}:\d{2}/i.test(snippet)) return;
      if (!titleDec || snippet.length < 20) return;
      results.push({
        title: titleDec,
        url: href,
        snippet: snippet.slice(0, 500),
        source: "brave",
        published_at: null
      });
    });
    if (!results.length) throw new Error("brave no results");
    return results.slice(0, count);
  } finally {
    release();
  }
}

function decodeGoogleNewsUrl(link) {
  try {
    const m = String(link).match(/\/articles\/([^?]+)(\?|$)/);
    if (!m) return link;
    let b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const dec = Buffer.from(b64, "base64").toString("utf8");
    let hay = dec;
    try { hay = dec + " " + decodeURIComponent(dec); } catch {}
    const gnu = hay.match(/news\.google\.com\/url\?q=([^&\s]+)/);
    if (gnu) {
      try {
        const real = decodeURIComponent(gnu[1]);
        if (real.startsWith("http") && real.length < 500) return real;
      } catch {}
    }
    const mm = hay.match(/https?:\/\/[^\s"\\&{}[\]]+/);
    if (mm) {
      const u = mm[0].replace(/\\u0026/g, "&");
      if (u.startsWith("http") && u.length > 10 && u.length < 500 && !u.includes("news.google.com")) return u;
    }
  } catch {}
  return link;
}

// v16: Birbaşa Azərbaycan xəbər agentliklərinin rəsmi RSS axınları (açarsız, həqiqi URL + real tarix!)
// Google News-un şifrəli CBMi... linklərindən fərqli olaraq bu məqalələr tam açılır və oxunur.
const AZ_NEWS_FEEDS = [
  { name: "qafqazinfo", url: "https://qafqazinfo.az/rss" },
  { name: "milli", url: "https://news.milli.az/rss/" },
  { name: "azertag", url: "https://azertag.az/rss" },
  { name: "bbc-az", url: "https://feeds.bbci.co.uk/azeri/rss.xml" }
];
const GENERIC_NEWS_WORDS = new Set(["xeber", "xeberler", "son", "bugun", "gundem", "melumat", "haqqinda", "hakda", "yeni", "indi"]);

export async function searchAzNewsRss(query, count = 6, signal) {
  const parser = new XMLParser({ ignoreAttributes: true });
  const normQ = normalizeAz(query);
  const rawTokens = (normQ.match(/[a-z0-9]+/g) || []).filter(w => w.length > 2);
  const specificTokens = rawTokens.filter(w => !GENERIC_NEWS_WORDS.has(w) && w !== "azerbaycan" && w !== "azerbaycanda");
  const wantsAzLocal = /\bazerbaycan/.test(normQ);

  const wantsHoroscope = /\b(qoroskop|burc|horoscope)\b/.test(normQ);
  const perFeed = await Promise.all(AZ_NEWS_FEEDS.map(async (f) => {
    try {
      const res = await fetchTimeout(f.url, {}, 1600, signal);
      if (!res.ok) return [];
      const xml = await res.text();
      const j = parser.parse(xml);
      const items = j?.rss?.channel?.item || [];
      const arr = Array.isArray(items) ? items : [items];
      return arr.slice(0, 20).map(it => {
        const title = decodeEntities(String(it.title || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim()).slice(0, 200);
        const link = String(it.link || "").trim();
        const desc = decodeEntities(String(it.description || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
        const pub = it.pubDate ? new Date(Date.parse(it.pubDate)).toISOString() : null;
        return {
          title,
          url: link,
          snippet: (desc.length >= 25 ? `${desc} — Azərbaycanda son xəbərlər` : `${title} — Azərbaycanda son xəbərlər`).slice(0, 500),
          source: "az-news",
          published_at: pub && !pub.includes("Invalid") ? pub : (it.pubDate || null)
        };
      }).filter(x => x.url.startsWith("http") && x.title && (wantsHoroscope || (!/\/horoscope\//i.test(x.url) && !/\bqoroskop/iu.test(x.title))));
    } catch { return []; }
  }));

  const all = [];
  const maxLen = Math.max(0, ...perFeed.map(a => a.length));
  for (let i = 0; i < maxLen; i++) {
    for (const feedItems of perFeed) {
      if (feedItems[i]) all.push(feedItems[i]);
    }
  }
  if (!all.length) throw new Error("az-news no results");

  // Əgər sualda konkret mövzu/şəhər varsa (məs. "Bakıda", "neft", "külək"), onu tutan xəbərləri önə çək
  if (specificTokens.length > 0) {
    const matched = all.filter(it => {
      const hay = normalizeAz(`${it.title} ${it.snippet}`);
      return specificTokens.some(tok => hay.includes(tok.slice(0, Math.max(3, tok.length - 1))));
    });
    if (matched.length >= 2) return matched.slice(0, count);
    if (matched.length === 1) return [...matched, ...all.filter(x => x !== matched[0])].slice(0, count);
  }
  // Ümumi "Azərbaycanda son xəbərlər" sorğusunda yerli Azərbaycan xəbərlərini xarici xəbərlərdən önə çək
  if (wantsAzLocal) {
    const localRe = /\b(azerbaycan|baki|prezident|ilham|milli|nazir|qaraba|sumqayit|gence|naxcivan|manat|xankendi|susa)\b/;
    const localItems = all.filter(it => localRe.test(normalizeAz(`${it.title} ${it.snippet}`)));
    const rest = all.filter(it => !localItems.includes(it));
    return [...localItems, ...rest].slice(0, count);
  }
  return all.slice(0, count);
}


// v42: YENİ KEY-SİZ PROVAYDERLƏR (canlı test: 200 OK, 150–600 ms)
// 1) Bing RSS — təmiz XML, sürətli, rate-limit yox
export async function searchBingRss(query, count = 8, signal) {
  // Bing RSS non-ASCII (AZ) sorğunu zibilləşdirir (LinkedIn profilləri) → yalnız ASCII/Cyrillic
  if (/[əğıöşüçƏĞİÖŞÜÇ]/.test(query)) { const e = new Error("bing-rss: language not supported (skip)"); e.skip = true; throw e; }
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=${count}`;
  const res = await fetchTimeout(url, { headers: { "User-Agent": UA } }, 2500, signal);
  if (!res.ok) throw new Error("bing-rss " + res.status);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: true });
  const j = parser.parse(xml);
  const items = j?.rss?.channel?.item || [];
  const arr = Array.isArray(items) ? items : [items];
  const rssMapped = arr.slice(0, count).map(it => ({
    title: decodeEntities(String(it.title || "")).slice(0, 200),
    url: String(it.link || "").trim(),
    snippet: decodeEntities(String(it.description || "").replace(/<[^>]+>/g, "")).slice(0, 500),
    source: "bing-rss",
    published_at: it.pubDate || null
  })).filter(x => x.url.startsWith("http") && x.title);
  return providerTermGate(rssMapped, query).slice(0, count);
}

// 2) Bing News RSS — xəbər sualları üçün tarixli nəticə
export async function searchBingNewsRss(query, count = 6, signal) {
  const qLang = detectQueryLanguage(query);
  // AZ bazarı Bing News-də YOXDUR (polyak nəticələri qaytarır) → az üçün bu provayder işlədilmir
  if (qLang === "az") { const e = new Error("bing-news: az market unsupported (skip)"); e.skip = true; throw e; }
  const mkt = qLang === "tr" ? "tr-TR" : qLang === "ru" ? "ru-RU" : qLang === "es" ? "es-ES" : qLang === "fr" ? "fr-FR" : qLang === "de" ? "de-DE" : "en-US";
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&count=${count}&mkt=${mkt}`;
  const res = await fetchTimeout(url, { headers: { "User-Agent": UA } }, 2500, signal);
  if (!res.ok) throw new Error("bing-news " + res.status);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: true });
  const j = parser.parse(xml);
  const items = j?.rss?.channel?.item || [];
  const arr = Array.isArray(items) ? items : [items];
  const fixNewsUrl = (u) => {
    const m = String(u || "").match(/[?&]url=([^&]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch { return u; } }
    return u;
  };
  return arr.slice(0, count).map(it => ({
    title: decodeEntities(String(it.title || "")).slice(0, 200),
    url: fixNewsUrl(String(it.link || "").trim()),
    snippet: decodeEntities(String(it.description || "").replace(/<[^>]+>/g, "")).slice(0, 500),
    source: "bing-news",
    published_at: it.pubDate || null
  })).filter(x => x.url.startsWith("http") && x.title && !/apiclick/.test(x.url));
}

// 3) DuckDuckGo HTML — keyless, JSON yox, HTML parse (uddg= yönləndirməsi açılır)
export async function searchDDGHtml(query, count = 8, signal) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchTimeout(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } }, 2500, signal);
  if (!res.ok) throw new Error("ddg-html " + res.status);
  const html = await res.text();
  const unescape = (t) => decodeEntities(String(t || "").replace(/<[^>]+>/g, ""));
  const out = [];
  const blocks = html.split(/class="result__body"|class="result results_links/).slice(1);
  for (const b of blocks) {
    const m = b.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    let href = m[1];
    const u = href.match(/[?&]uddg=([^&]+)/);
    if (u) { try { href = decodeURIComponent(u[1]); } catch {} }
    if (href.startsWith("//")) href = "https:" + href;
    const sn = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const title = unescape(m[2]).trim();
    if (!title || !href.startsWith("http")) continue;
    out.push({ title: title.slice(0, 200), url: href, snippet: unescape(sn ? sn[1] : "").slice(0, 500), source: "ddg-html", published_at: null });
    if (out.length >= count) break;
  }
  if (!out.length) throw new Error("ddg-html parse empty");
  return out;
}

// v51: DDG Lite (lite.duckduckgo.com) — html.duckduckgo.com bloklananda işləyən
// ikinci endpoint. Eyni indeks, fərqli IP limiti → AZ suallarında Brave/Bing-in
// buraxmadığı səhifələri (az.wikipedia kateqoriyaları, yerli saytlar) qaytarır.
const DDGLITE_CHALLENGE = /bots use DuckDuckGo|anomaly|challenge to confirm/i;

export function parseDDGLite(html, count = 8) {
  const out = [];
  const LINK_RE = /<a[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g;
  const SNIP_RE = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/;
  const matches = [];
  let m;
  while ((m = LINK_RE.exec(html)) !== null) {
    matches.push({ idx: m.index, end: LINK_RE.lastIndex, inner: m[1], tag: m[0] });
    if (matches.length > count * 3) break;
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const hrefM = cur.tag.match(/href=["']([^"']+)["']/);
    if (!hrefM) continue;
    let href = decodeEntities(hrefM[1]);
    if (href.startsWith("//")) href = "https:" + href;
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) { try { href = decodeURIComponent(uddg[1]); } catch {} }
    if (!href.startsWith("http")) continue;
    if (/duckduckgo\.com\/(l|y)\.js/.test(href)) continue;
    const title = decodeEntities(String(cur.inner || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!title) continue;
    // snippet: bu linkdən sonra, növbəti linkdən əvvəl
    const span = html.slice(cur.end, i + 1 < matches.length ? matches[i + 1].idx : Math.min(html.length, cur.end + 2500));
    const sn = span.match(SNIP_RE);
    const snippet = sn ? decodeEntities(String(sn[1] || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
    out.push({ title: title.slice(0, 200), url: href, snippet: snippet.slice(0, 500), source: "ddg-lite", published_at: null });
    if (out.length >= count) break;
  }
  return out;
}

export async function searchDDGLite(query, count = 8, signal) {
  const qLang = detectQueryLanguage(query);
  const kl = qLang === "az" ? "az-az" : qLang === "tr" ? "tr-tr" : qLang === "ru" ? "ru-ru" : "en-us";
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=${kl}`;
  const res = await fetchTimeout(url, { headers: { "User-Agent": UA, "Accept-Language": acceptLanguageHeader(qLang) } }, 2600, signal);
  const html = await res.text();
  // 202 / captcha = IP limiti. Bu "boş nəticə" deyil → circuit breaker-ə yazılır,
  // sonrakı sorğularda provayder soyuyur (latency itkisi olmur).
  if (res.status === 202 || DDGLITE_CHALLENGE.test(html)) throw new Error("ddg-lite bot challenge");
  if (!res.ok) throw new Error("ddg-lite " + res.status);
  const out = parseDDGLite(html, count);
  if (!out.length) throw new Error("ddg-lite no results");
  return out;
}

// v51: Mwmbl (api.mwmbl.org) — açıq mənbəli, icma tərəfindən crawlanan müstəqil
// indeks. Key yoxdur, captcha yoxdur, cavab JSON və sürətli (~300 ms).
// Məqsəd: Bing/Brave/DDG eyni indeks ailəsindəndir; üçüncü müstəqil səs
// voteCount/a agreement üçün lazımdır.
function flattenMwmblParts(parts) {
  if (Array.isArray(parts)) return parts.map(p => (p && typeof p === "object" ? String(p.value || "") : String(p || ""))).join("");
  return String(parts || "");
}

export function normalizeMwmbl(arr, count = 8) {
  const list = Array.isArray(arr) ? arr : [];
  const out = [];
  for (const it of list) {
    if (!it || !it.url) continue;
    let href = String(it.url).trim();
    if (href.startsWith("//")) href = "https:" + href;
    if (!href.startsWith("http")) continue;
    const title = decodeEntities(flattenMwmblParts(it.title)).replace(/\s+/g, " ").trim();
    const snippet = decodeEntities(flattenMwmblParts(it.extract)).replace(/\s+/g, " ").trim();
    if (!title) continue;
    out.push({ title: title.slice(0, 200), url: href, snippet: snippet.slice(0, 500), source: "mwmbl", published_at: null });
    if (out.length >= count) break;
  }
  return out;
}

export async function searchMwmbl(query, count = 8, signal) {
  const url = `https://api.mwmbl.org/search?s=${encodeURIComponent(query)}`;
  const res = await fetchTimeout(url, { headers: { "Accept": "application/json", "User-Agent": WIKI_UA } }, 2500, signal);
  if (!res.ok) throw new Error("mwmbl " + res.status);
  const j = await res.json();
  const out = normalizeMwmbl(j, count);
  if (!out.length) throw new Error("mwmbl no results");
  return out;
}

// v51.1: Yahoo Japan (search.yahoo.co.jp) — Google indeksli, keyless.
// Sınaqda AZ sorğularda Brave/Bing-in tapmadığı düzgün səhifələri verdi
// (Füzulinin əsərləri → anl.az PDF, fotosintez → az.wikipedia/Khan Academy,
// Şəki hava → weather.com/metbuat.az). DC IP-lərindən bloklanmır.
const YJ_SKIP_HOST = /(^|\.)(yahoo\.co\.jp|yahoo\.com|lycorp\.co\.jp|yahoo\.net)$/i;

export function parseYahooJP(html, count = 8) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || "").split('class="sw-CardBase"').slice(1);
  for (const b of blocks) {
    const hrefM = b.match(/<a[^>]+href="(https?:\/\/[^"]+)"/);
    if (!hrefM) continue;
    let href = decodeEntities(hrefM[1]);
    if (YJ_SKIP_HOST.test((() => { try { return new URL(href).hostname; } catch { return ""; } })())) continue;
    if (!/^https?:\/\//.test(href)) continue;
    const titleM = b.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const title = titleM ? decodeEntities(titleM[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
    if (!title) continue;
    const snM = b.match(/<p[^>]*class="[^"]*sw-Card__summary[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const snippet = snM ? decodeEntities(snM[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
    const key = href.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: title.slice(0, 200), url: href, snippet: snippet.slice(0, 500), source: "yahoo", published_at: null });
    if (out.length >= count) break;
  }
  return out;
}

export async function searchYahoo(query, count = 8, signal) {
  const qLang = detectQueryLanguage(query);
  const url = `https://search.yahoo.co.jp/search?p=${encodeURIComponent(query)}&ei=UTF-8`;
  const res = await fetchTimeout(url, { headers: { "User-Agent": UA, "Accept-Language": acceptLanguageHeader(qLang) } }, 2800, signal);
  if (!res.ok) throw new Error("yahoo " + res.status);
  const html = await res.text();
  if (/<title>[^<]*(アクセス|エラー|captcha)/i.test(html)) throw new Error("yahoo challenge");
  const out = parseYahooJP(html, count);
  if (!out.length) throw new Error("yahoo no results");
  return out;
}

// v52: Milli Arxiv İdarəsi (milliarxiv.gov.az) — rəsmi .gov.az mənbə.
// Öz sayt daxili axtarışı var (?q=), HTML qaytarır, keyless. AZ tarixi, arxiv
// sənədləri, muzey/repressiya/soyqırım kimi mövzularda başqa heç bir provayderin
// vermədiyi rəsmi materialı verir. Yalnız mövzu uyğun olanda çağırılır.
const ARXIV_TOPIC_RE = /(?<![\p{L}])(arxiv[\p{L}]*|s[əe]n[əe]d[\p{L}]*|tarix[\p{L}]*|muzey[\p{L}]*|q[əe]dim|sovet|repressiya|soyq[ıi]r[ıi]m[\p{L}]*|[şs][əe]hid[\p{L}]*|m[üu]hacir[əe]t|köç|qovulma|dövlət arxivi)(?![\p{L}])/iu;

export function isArchiveTopic(query = "") {
  return ARXIV_TOPIC_RE.test(String(query));
}

export function parseMilliArxiv(html, origin = "https://milliarxiv.gov.az", count = 8) {
  const out = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*class="search-result"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = decodeEntities(m[1]);
    const inner = m[2];
    const tM = inner.match(/<h4[^>]*>([\s\S]*?)<\/h4>/);
    const title = tM ? decodeEntities(tM[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
    if (!title) continue;
    let snippet = "";
    const sM = inner.match(/<p[^>]*class="search-links"[^>]*>([\s\S]*?)<\/p>/);
    if (sM) {
      snippet = inner
        .replace(/<h4[^>]*>[\s\S]*?<\/h4>/, " ")
        .replace(/<p[^>]*class="search-links"[^>]*>[\s\S]*?<\/p>/, " ");
      snippet = decodeEntities(snippet.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    } else {
      snippet = decodeEntities(inner.replace(/<h4[^>]*>[\s\S]*?<\/h4>/, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    }
    let url = href.startsWith("http") ? href : origin + (href.startsWith("/") ? href : "/" + href);
    if (!/^https?:\/\//.test(url)) continue;
    out.push({ title: title.slice(0, 200), url, snippet: snippet.slice(0, 500), source: "milliarxiv", published_at: null });
    if (out.length >= count) break;
  }
  return out;
}

export async function searchMilliArxiv(query, count = 6, signal) {
  const qLang = detectQueryLanguage(query);
  const loc = qLang === "ru" ? "ru" : qLang === "az" ? "az" : "en";
  const url = `https://milliarxiv.gov.az/${loc}/search?q=${encodeURIComponent(query)}`;
  const res = await fetchTimeout(url, { headers: { "User-Agent": UA, "Accept-Language": acceptLanguageHeader(qLang) } }, 3500, signal);
  if (!res.ok) throw new Error("milliarxiv " + res.status);
  const html = await res.text();
  const out = parseMilliArxiv(html, "https://milliarxiv.gov.az", count);
  if (!out.length) throw new Error("milliarxiv no results");
  return out;
}

export async function searchGoogleNews(query, count = 5, signal) {
  const qLang = detectQueryLanguage(query);
  const hl = ["az","tr","ru","fr","es","de","pt","en"].includes(qLang) ? qLang : "en";
  const GLMAP = { az: "AZ", tr: "TR", ru: "RU", fr: "FR", es: "ES", de: "DE", pt: "PT", en: "US" };
  const gl = GLMAP[qLang] || "US";
  const ceid = `${gl}:${hl}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await fetchTimeout(url, {}, 1500, signal);
  if (!res.ok) throw new Error("google news " + res.status);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: true });
  const j = parser.parse(xml);
  const items = j?.rss?.channel?.item || [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.slice(0, count).map(it => ({
    title: decodeEntities(String(it.title || "")).slice(0, 200),
    url: decodeGoogleNewsUrl(String(it.link || "")),
    snippet: decodeEntities(String(it.description || "").replace(/<[^>]+>/g, "")).slice(0, 500),
    source: "google-news",
    published_at: it.pubDate || null
  })).filter(x => x.url.startsWith("http"));
}

const WIKI_PARTICLES = new Set([
  "kimdir","nədir","necədir","hardır","hansıdır","hansılardır","hansılar","haradadır","hansı","nə","vaxt",
  "üçündür","üçün","haqqında","məlumat","saytı",
  "harada","yerləşir","olunub","edilib","edilir","edib","olacaq","olub","olurmu","oldumu",
  "kaçdır","neçədir","kim","oldu","edir","nələrdir","hangisidir","hangileri","kaçtır","nerededir",
  "which","what","where","when","who","whom","whose","how","why","is","are","was","were",
  "the","a","an","in","between","with","does","do","did","has","have","had","of","to","and","on","at","for",
  "world","countries","share","dünyada","dövlətlər"
]);

const WIKI_QUESTION_WORDS = /(?<![\p{L}\p{N}])(yaranıb|yaranib|yaradılıb|yaradilib|yaradılmış|yaradilmis|qurulub|qurulmuş|qurulmus|təsis|tesis|baş\s+verib|bas\s+verib|başlayıb|baslayib|açılıb|acilib|keçirilib|kecirilib|keçiriləcək|kecirilecek|çatıb|catib|doğulub|dogulub|vəfat|vefat|olub|edilib|həyata\s+keçirilib|heytata\s+keсirilib|neçə|nece|kimdir|kim|nədir|nedir|nələrdir|necədir|necə|neçədir|haqqında|haqqinda|məlumat|melumat|barəsində|baresinde|üçündür|ucundur|üçün|ucun|hansılardır|hansılar|hansıdır|hansı|hansi|hangisidir|hangileri|kaçtır|nerededir|niyə|niye|harada|yerləşir|yerlesir|yerləşən|yerlesen|nə vaxt|nəvaxt|vaxtdır|vaxtdir|nə|ne|what is|what's|what are|who is|who's|how is|how do|how does|how to|tell me|about|when|where|why|which|what|who|how)(?![\p{L}\p{N}])/giu;

export function stripQuestionWords(q) {
  const raw = String(q || "").trim();
  const s = raw
    .replace(/[?!]+$/g, "")
    .replace(WIKI_QUESTION_WORDS, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s.length >= 3 ? s : raw;
}

function wikiVariants(query) {
  const q = stripQuestionWords(query).replace(/['’](nin|nın|nun|nün|da|də|ta|tə)\b/gi, "");
  const base = new Set();
  if (q.trim()) base.add(q.trim());
  const cleaned = q.trim().split(/\s+/).filter(t => t && !WIKI_PARTICLES.has(t.toLowerCase()));
  if (cleaned.length) base.add(cleaned.join(" "));
  // v15: MediaWiki strict AND axtarışında 4+ sözlü ifadələr bəzən 0 qaytarır —
  // 2-3 əsas sözlü yığcam variant əlavə et (məs. "most popular websites in the world" -> "most popular websites")
  if (cleaned.length >= 3) {
    base.add(cleaned.slice(0, 2).join(" "));
    if (cleaned.length >= 4) base.add(cleaned.slice(0, 3).join(" "));
  }
  if (/Azərbaycanla\s+həmsərhəd/i.test(query)) {
    base.add("Azərbaycanın sərhədləri");
  }
  const out = new Set();
  for (const v of base) {
    out.add(v);
    if (/[əƏ]/.test(v)) out.add(v.replace(/ə/g, "a").replace(/Ə/g, "A"));
  }
  return [...out].slice(0, 4);
}

// v54.4: az.wikipedia birbaşa axtarışı — "site:" operatoru provayderlərdə işləmirdi,
// ona görə v54.1-dəki azwiki_hint heç vaxt nəticə qaytarmırdı. Burada 4 namizəd sorğu
// paralel gedir (API ~200 ms), ən yaxşısı skorla seçilir.
export async function searchAzWikiHint(query, terms = [], count = 5, signal) {
  const norm = String(query || "").toLowerCase().replace(/[?!.]+$/g, "").trim();
  if (!norm) return [];
  const t = (terms || []).filter(x => String(x).length >= 3).map(String);
  const cands = [];
  const push = (v) => { v = String(v || "").trim(); if (v.length >= 3 && !cands.includes(v) && cands.length < 5) cands.push(v); };
  push(t.slice(-2).join(" "));        // baş söz birləşməsi: "ilk metro"
  push(t.join(" "));
  // v54.5: AZ kontekstli sualda mərkəz şəhəri ilə birləşmə — "ilk metro" =>
  // "Bakı metro" => az.wikipedia "Bakı metrosu" məqaləsi (Çikaqo metrosu əvəzinə)
  const AZ_CENTER = { "azerbaycan": "bakı", "türkiyə": "ankara", "turkiye": "ankara", "gürcüstan": "tbilisi", "rusiya": "moskva" };
  for (const k of Object.keys(AZ_CENTER)) {
    if (!t.includes(k)) continue;
    const others = t.filter(x => x !== k).slice(0, 2);
    for (const o of others) push(`${AZ_CENTER[k]} ${o}`);
  }
  push(norm);
  const perCand = await Promise.all(cands.map(async (v) => {
    try {
      const url = `https://az.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${count}` +
        `&srsearch=${encodeURIComponent(v)}`;
      const res = await fetchTimeout(url, { headers: { "User-Agent": WIKI_UA } }, 1200, signal);
      if (!res.ok) return [];
      const j = await res.json();
      return (j.query?.search || []).map(r => ({
        title: decodeEntities(String(r.title)).slice(0, 200),
        url: `https://az.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g, "_"))}`,
        snippet: decodeEntities(String(r.snippet || "").replace(/<[^>]+>/g, "")).slice(0, 500),
        source: "wikipedia",
        published_at: null,
        updated_at: r.timestamp || null
      }));
    } catch { return []; }
  }));
  const seen = new Set();
  const out = [];
  for (const chunk of perCand) for (const r of chunk) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out.slice(0, count + 2);
}

export async function searchWikipedia(query, count = 5, signal) {
  const variants = wikiVariants(query);
  const qLang = detectQueryLanguage(query);
  // v17: EN sorğuda ("Minecraft", "Translation") yalnız en.wikipedia axtarılır — az.wikipedia EN sorğunu üstələməməlidir!
  const langs = qLang === "en" ? ["en"] : ["tr","ru","fr","es","de","pt","az"].includes(qLang) ? [qLang, "en"] : ["az", "en"];
  const perLang = await Promise.all(langs.map(async (lang) => {
    const chunks = await Promise.all(variants.map(async (v) => {
      try {
        const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(v)}&format=json&srlimit=${count}`;
        const res = await fetchTimeout(url, { headers: { "User-Agent": WIKI_UA } }, 1500, signal);
        if (!res.ok) return [];
        const j = await res.json();
        const arr = j.query?.search || [];
        return arr.map(r => ({
          title: decodeEntities(String(r.title)).slice(0, 200),
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
          snippet: decodeEntities(String(r.snippet || "").replace(/<[^>]+>/g, "")).slice(0, 500),
          source: "wikipedia",
          published_at: null,
          updated_at: r.timestamp || null
        }));
      } catch { return []; }
    }));
    const seen = new Set();
    const all = [];
    for (const chunk of chunks) for (const r of chunk) {
      if (!seen.has(r.title)) { seen.add(r.title); all.push(r); }
    }
    return all;
  }));

  const [primaryResults = [], enResults = []] = perLang;
  const all = [];
  const maxLen = Math.max(primaryResults.length, enResults.length);
  for (let i = 0; i < maxLen && all.length < count; i++) {
    if (primaryResults[i]) all.push(primaryResults[i]);
    if (all.length < count && enResults[i]) all.push(enResults[i]);
  }
  if (!all.length) throw new Error("wikipedia no results");
  return all;
}

export async function searchDDGInstant(query, count = 3, signal) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const res = await fetchTimeout(url, {}, 1200, signal);
  if (!res.ok) throw new Error("ddg instant " + res.status);
  const j = await res.json();
  const results = [];
  const abstract = j.AbstractText || j.Abstract;
  const abstractUrl = j.AbstractURL;
  if (abstract && abstractUrl && abstractUrl.startsWith("http")) {
    results.push({
      title: decodeEntities(String(j.Heading || query).slice(0, 200)),
      url: String(abstractUrl),
      snippet: decodeEntities(String(abstract).slice(0, 500)),
      source: "ddg-instant",
      published_at: null
    });
  }
  const topics = j.RelatedTopics || [];
  for (const topic of topics.slice(0, 2)) {
    if (topic.Text && topic.FirstURL && topic.FirstURL.startsWith("http")) {
      results.push({
        title: decodeEntities(String(topic.Text).slice(0, 120)),
        url: String(topic.FirstURL),
        snippet: decodeEntities(String(topic.Text).slice(0, 500)),
        source: "ddg-instant",
        published_at: null
      });
    }
  }
  if (!results.length) throw new Error("ddg instant no results");
  return results.slice(0, count);
}

export async function searchSearXNG(query, count = 8, signal) {
  const own = (process.env.SEARXNG_URL || "").replace(/\/$/, "");
  if (!own) throw new Error("searxng not configured");
  const instances = [own];
  const attempts = instances.map(async (base) => {
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
    const res = await fetchTimeout(url, {}, 2500, signal);
    if (!res.ok) throw new Error("searxng " + res.status);
    const j = await res.json();
    const arr = j.results || [];
    if (!arr.length) throw new Error("searxng no results");
    return arr.slice(0, count).map(r => ({
      title: String(r.title || "").slice(0, 200),
      url: String(r.url || ""),
      snippet: String(r.content || "").slice(0, 500),
      source: "searxng",
      published_at: r.publishedDate || null
    })).filter(x => x.url.startsWith("http"));
  });
  return Promise.any(attempts);
}

export async function searchAll(query, count = 8, opts = {}) {
  const providersUsed = [];
  const errors = {};
  const BUDGET_MS = 5000;
  const started = Date.now();
  const left = () => BUDGET_MS - (Date.now() - started);

  const { expanded, english, translated, rewritten } = await expandQueryAsync(query, Math.min(1200, Math.max(0, left() - 3600)));
  const effQuery = rewritten || normalizeColloquialAz(query) || query;
  const qLangEarly = detectQueryLanguage(effQuery);
  const queries = [effQuery];
  if (expanded && expanded !== effQuery) queries.push(expanded);
  // v19: AZ xəbər sualında ingiliscə variantı AXTARMA — "bu gün idmanda" → ABŞ xəbərləri gəlirdi
  const azNewsIntent = qLangEarly === "az" && isNewsQuery(effQuery);
  // v20: "cədvəl/standings" sualında turnir cədvəlini verən səhifələr üçün əlavə variant
  if (/(?<![\p{L}])(cədvəl[\p{L}]*|cedvel|standings|puan\s+durumu)(?![\p{L}])/iu.test(effQuery)) {
    queries.push(`${effQuery} standings`);
  }
  if (!azNewsIntent && english && english !== effQuery && english !== expanded) queries.push(english);
  const anchorQuery = (translated && english) ? english : (english && english !== effQuery ? english : null);

  const isShortQuery = tokenize(effQuery).length <= 1;
  const overviewIntent = /(?<![\p{L}])(nədir|nedir|nə\s+üçündür|nə\s+işə\s+yarayır|ne\s+işe\s+yarar|haqqında(\s+məlumat)?|what\s+is)(?![\p{L}])/iu.test(effQuery);

  const called = new Set();
  const deadlineAbort = new AbortController();
  const failedInRequest = new Set();

  const runProviders = (qs, allowBrave = true) => {
    const tasks = [];
    const addTask = (name, fn, q, variant = "orig") => {
      const sig = `${name}::${q}`;
      if (called.has(sig)) return;
      called.add(sig);
      if (isCircuitOpen(name)) {
        tasks.push(Promise.resolve({ name, error: "circuit open (cooldown)" }));
        return;
      }
      const t0 = Date.now();
      tasks.push(fetchWithRetry(fn, q, count, undefined, deadlineAbort.signal, name).then(res => {
        recordSuccess(name, Date.now() - t0);
        return { name, res, variant };
      }).catch(e => {
        if (e && (e.name === "AbortError" || /aborted/i.test(e.message || ""))) {
          return { name, error: "deadline abort" };
        }
        // v43: "skip" = provayder bu dildə işləmir → ÇÖKMƏ DEYİL, cəza yazılmır
        if (e && (e.skip === true || /skip|unsupported/i.test(e.message || ""))) {
          return { name, error: "skipped (language)" };
        }
        if (!/no results/.test(e.message) && !failedInRequest.has(name)) {
          failedInRequest.add(name);
          recordFailure(name);
        }
        return { name, error: e.message };
      }));
    };

    const ddgOn = process.env.ENABLE_DDG === "1";
    for (const q of qs) {
      const variant = (anchorQuery && q === anchorQuery) ? "anchor" : "orig";
      if (ddgOn) addTask("duckduckgo", searchDDG, q, variant);
      addTask("bing", searchBing, q, variant);
      // v45.2: AZ (non-ASCII) sorğunu bing-rss rədd edirdi → ASCII anchor ilə göndəlir
      {
        const nonAscii = /[əğıöşüçƏĞİÖŞÜÇ]/.test(q);
        const asciiQ = nonAscii
          ? (anchorQuery && !/[əğıöşüçƏĞİÖŞÜÇ]/.test(anchorQuery) ? anchorQuery : null)
          : q;
        if (asciiQ) addTask("bing-rss", searchBingRss, asciiQ, variant);
      }
      // v51: ddg-lite əsas DDG endpointidir; ddg-html yalnız lite soyuyanda ehtiyat.
      // (İkisini eyni anda vurmaq eyni IP limitini ikiqat yandırır.)
      // v64: ddg-lite Vercel-dən HƏMİŞƏ 403 verir (canlı yoxlama) → dövrə açıqsa heç cəhd etmirik,
      // vaxt büdcəsini brave/yahoo-ya saxlayırıq.
      if (variant === "orig" && !isCircuitOpen("ddg-lite")) addTask("ddg-lite", searchDDGLite, q, variant);
      if (variant === "orig" && isCircuitOpen("ddg-lite")) addTask("ddg-html", searchDDGHtml, q, variant);
      addTask("mwmbl", searchMwmbl, q, variant);
      // v51.1: yahoo = Google indeksli keyless mənbə → AZ örtüyü üçün ən dəyərlisi
      if (variant === "orig" || variant === "anchor") addTask("yahoo", searchYahoo, q, variant);
    }

    const qLang = qLangEarly;
    const hnGhQuery = (english && english !== effQuery) ? english : effQuery;
    const techDetected = isTechQuery(effQuery) || isTechQuery(hnGhQuery);
    const scienceDetected = /\b(arxiv|paper|research|theorem|quantum|neural|transformer|llm|rag|physics|biology|chemistry|math|algorithm|model|dataset|benchmark)\b/i.test(`${effQuery} ${hnGhQuery}`);
    const newsDetected = isNewsQuery(effQuery);

    // v17 (Alim özəlliyi — dilə görə axtarış və yerli ön-izləmə):
    // İstifadəçi AZ/TR dilində soruşanda (məs. "Tərcümə", "GitHub haqqında məlumat", "En iyi filmler", "Azərbaycanda saytlar"),
    // Brave-ə birbaşa istifadəçinin öz dilində sorğu + Accept-Language göndərilir ki, həmin dildə cavab verən saytlar
    // ("Google Tərcümə — Ödənişsiz təklif olunan Google xidməti...") çıxsın. Yalnız dar texniki xəta/limit sualında EN anchor gedir!
    if (allowBrave) {
      const trafficRankingIntent = /(?<![\p{L}])(ən\s+çox\s+(istifadə|ziyarət|girilən)|reytinq|statistika|most\s+visited)(?![\p{L}])/iu.test(effQuery);
      const useAnchorForBrave = anchorQuery && qLang !== "en" && (
        trafficRankingIntent ||
        (techDetected && !overviewIntent && !/\b(azerbaycan|baki|turkiye)\b/i.test(normalizeAz(effQuery))) ||
        (techDetected && overviewIntent && /(?<![\p{L}])(rebase|async|await|promise|closure|hook|useeffect|middleware|compose|postgres\w*|mysql|redis|nginx|dockerfile)(?![\p{L}])/iu.test(effQuery))
      );
      const braveQ = useAnchorForBrave ? anchorQuery : effQuery;
      addTask("brave", searchBrave, braveQ, braveQ === anchorQuery ? "anchor" : "orig");
    }

    const tavilyOn = !!process.env.TAVILY_API_KEY || process.env.ENABLE_TAVILY === "1";
    if (tavilyOn) {
      const tavilyFn = (q, c, sig) => searchTavilyKeyless(q, c, sig ? { ...opts, signal: sig } : opts);
      addTask("tavily", tavilyFn, effQuery, "orig");
      if (anchorQuery && anchorQuery !== effQuery) {
        addTask("tavily", tavilyFn, anchorQuery, "anchor");
      }
    }

    // "GitHub nə üçündür" / "GitHub haqqında məlumat" kimi ümumi tanışlıq sualında StackOverflow xəta mövzularını çağırma
    if (techDetected && !overviewIntent) {
      addTask("hacker-news", searchHN, hnGhQuery, "anchor");
      addTask("github", searchGitHub, hnGhQuery, "anchor");
      addTask("stackoverflow", searchStackOverflow, hnGhQuery, "anchor");
    } else if (techDetected && overviewIntent) {
      addTask("github", searchGitHub, hnGhQuery, "anchor");
      // v22: "Git rebase nədir" / "async await necə işləyir" kimi TEXNİKİ izah sualında
      // StackOverflow ən yaxşı mənbədir — ümumi "nədir" filtrinə görə itirməsin
      if (/(?<![\p{L}])(rebase|async|await|promise|closure|hook|useEffect|index|join|query|middleware|dockerfile|compose|migration|typescript|interface|type\s+alias|postgres\w*|mysql|redis|kafka|nginx)(?![\p{L}])/iu.test(hnGhQuery)) {
        addTask("stackoverflow", searchStackOverflow, hnGhQuery, "anchor");
        if (!overviewIntent) addTask("hacker-news", searchHN, hnGhQuery, "anchor");
      }
    }
    if ((techDetected || scienceDetected) && !overviewIntent) {
      addTask("arxiv", searchArxiv, hnGhQuery, "anchor");
    }

    if (process.env.SEARXNG_URL) addTask("searxng", searchSearXNG, effQuery);

    // v23: idman "növbəti oyun" sualında iyelik forması axtarışı korlayır
    if (/(növbəti\s+oyun|novbeti\s+oyun|next\s+(match|game|fixture))/iu.test(query)) {
      const fix = query.replace(/\s+(nə\s+vaxtdır|nə\s+vaxt|ne\s+vaxt|nədir|nedir)\s*\??$/iu, "")
        .replace(/(\p{L}+)\s+millisinin/giu, "$1 milli komandası");
      addTask("brave", searchBrave, fix, "sport");
    }

// v27: how-to suallarında kanonik İNGİLİSCƏ ifadə ilə hədəfli axtarış
    // (AZ söz sırası axtarışı korlayır: "Python-da virtual mühit necə yaradılır")
    const CANON = [
      [/(virtual\s*m[üu]hit|venv|virtualenv)/iu, "python create virtual environment venv"],
      [/(coroutine|korutin)/iu, "kotlin coroutines guide"],
      [/(fayl\w*\s+sil|delete\s+(a\s+)?file|rm\s+command)/iu, "linux rm command delete file"],
      [/(t[üu]rkiy[əe]nin\s+[əe]n\s+b[öo]y[üu]k\s+[şs][əe]h[əe]ri|largest\s+city\s+in\s+turkey)/iu, "largest cities in Turkey by population"],
      [/(minimum\s+[əe]m[əe]k\s+haqq|[əe]m[əe]k\s+haqq[ıi])/iu, `Azərbaycanda minimum əmək haqqı ${new Date().getFullYear()}`],
      [/([əe]n\s+[çc]ox\s+oxunan\s+kitab)/iu, "Azərbaycan dilində ən çox oxunan kitablar"],
      // v54: "Excel-də cəmi necə hesablanır" → ümumi məqalə gəlirdi, düstur yox idi
      [/(excel[\s\S]{0,25}(c[əe]mi|cum|sum|topla|hesabla)|(c[əe]mi|cum|sum)[\s\S]{0,25}excel)/iu, "excel SUM formula add numbers support.microsoft.com"],
      [/(word[\s\S]{0,25}(c[əe]dv[əe]l|table))/iu, "microsoft word insert table"],
      // v54.1: "C vitamini hansı qidalarda var" — miqdar deyil, SİYAHI sualıdır
      [/(c\s+vitamini[\s\S]{0,30}(qida|məhsul|meyvə|tərəvəz)|(qida|məhsul)[\s\S]{0,30}c\s+vitamini)/iu, "foods highest in vitamin C list"],
      [/(d\s+vitamini[\s\S]{0,30}(qida|məhsul)|(qida|məhsul)[\s\S]{0,30}d\s+vitamini)/iu, "foods highest in vitamin D list"],
      [/(d[əe]mir[\s\S]{0,25}(qida|məhsul)|(qida|məhsul)[\s\S]{0,25}d[əe]mir)/iu, "foods highest in iron list"],
      [/(kalsium[\s\S]{0,25}(qida|məhsul)|(qida|məhsul)[\s\S]{0,25}kalsium)/iu, "foods highest in calcium list"],
      [/(protein[\s\S]{0,25}(qida|məhsul))/iu, "foods highest in protein list"],
      // v59.1: raund-18 — "iPhoneda batareyanı necə qoruyum" → YouTube/uzbek bloqu gəlirdi
      [/(iphone[\s\S]{0,30}(batareya|battery)|(batareya|battery)[\s\S]{0,30}iphone)/iu, "iphone battery health tips apple support"],
      // "quş qripi nədir" → vox/en.wikipedia qarışığı; rəsmi izahat lazımdır
      [/(qu[şs]\s*qripi|bird\s*flu|h5n1)/iu, "bird flu H5N1 symptoms causes who.int"],
      // v60: raund-19 — "ətiri necə saxlamaq olar" → Vikikitab "Bizimlə əlaqə" (n=1)
      [/([əe]tir[\p{L}]*|perfume)[\s\S]{0,25}(saxla|storage|store)/iu, "how to store perfume properly"],
      // "kompüteri tozdan necə təmizləyim" → ekran təmizliyi məqaləsi gəlirdi
      [/(komp[üu]ter|pc|computer)[\s\S]{0,25}(toz|dust|t[əe]mizl|clean)/iu, "how to clean desktop computer dust inside pc"],
    ];
    // v56: "Bakıdan Şəkiyə neçə kilometrdir" → 0 nəticə. Məsafə sualını ayrı forma ilə axtar.
    if (/(ne[çc][əe]\s*(kilometr|km)|m[əe]saf[əe]|distance)/iu.test(query)) {
      const places = tokenize(query).filter(t => t.length >= 3 && !/^(nece|kilometr|mesafe|qeder|arasinda|yol)$/.test(t)).slice(0, 3);
      if (places.length >= 2) { addTask("brave", searchBrave, `${places.join(" ")} arası məsafə km`, "canon"); addTask("bing", searchBing, `${places.join(" ")} məsafə kilometr`, "canon"); }
    }
    for (const [re, canon] of CANON) {
      // v59.2: CANON yalnız brave ilə gedirdi — brave rate-limit olanda qayda heç işləmirdi
      if (re.test(query)) { addTask("brave", searchBrave, canon, "canon"); addTask("bing", searchBing, canon, "canon"); break; }
    }


    // v22: texniki sualda hədəfli rəsmi sənəd sorğusu (MDN, git-scm, postgresql, python docs)
    if (techDetected && !newsDetected) {
      const DOCS_MAP = [
        [/\bgit\b|rebase|merge\s+conflict|cherry-?pick/i, "git-scm.com"],
        [/postgres\w*/i, "postgresql.org"],
        [/mysql|innodb/i, "dev.mysql.com"],
        [/usep?effect|usestate|react\s+(hook|component)|jsx/i, "react.dev"],
        [/\bpython\b|asyncio|django|flask|pandas|numpy/i, "docs.python.org"]
      ];
      for (const [re, dom] of DOCS_MAP) {
        if (re.test(`${effQuery} ${english || ""}`)) {
          addTask("bing", searchBing, `${effQuery.split("\n")[0]} site:${dom}`, "docs");
          break;
        }
      }
      // v24: AZ dilli texniki sualı İNGİLİSCƏ kod tokenları ilə də axtar
      // ("Python-da list ilə tuple fərqi" → "python list tuple difference")
      const codeToks = String(query).match(/[A-Za-z][A-Za-z0-9_.]{2,}/g) || [];
      const uniqToks = [...new Set(codeToks.map(t => t.replace(/[._]+$/, "")))].filter(t => !/^(the|and|with|for|nedir|what|how|js|vs)$/i.test(t));
      if (uniqToks.length) {
        const cmp = /(fərq|ferq|difference|vs\.?|müqayisə|compare)/i.test(query);
        const docsQ = `${uniqToks.slice(0, 3).join(" ")} ${cmp ? "difference" : "documentation"}`;
        addTask("brave", searchBrave, docsQ, "codetoks");
      }
    }
    if (newsDetected && qLang === "az") {
      addTask("az-news", searchAzNewsRss, effQuery, "orig");
    }
    // v53: AZƏRTAC — rəsmi dövlət agentliyi, 3 dildə RSS (az/ru/en), son 50 xəbər.
    // Xəbər niyyətində və ya "son xəbər" tipli sorğuda həmişə iştirak edir.
    if ((newsDetected || /(?<![\p{L}])(x[əe]b[əe]r|xeber|news|son\s+d[əe]qiq[əe]|headlines?)(?![\p{L}])/iu.test(effQuery))
        && ["az", "ru", "en"].includes(qLang)) {
      const azLang = azertagLangFor(qLang);
      addTask("azertag", (q, c, sig) => searchAzertag(q, c, azLang, sig), effQuery, "orig");
    }
    // v57: sitemap əsaslı AZ xəbər mənbələri (icma.az, iqtisadiyyat.az) — cütlük/limiti yox,
    // sitemap açıqdır, məqalədə og:title/description/published_time var. Yalnız xəbər
    // niyyətində iştirak edir və HEÇ BİR xüsusi prioritet almır (adi skorla sıralanır).
    if (newsDetected && qLang === "az") {
      addTask("sitemap-news", (q, c, sig) => searchSitemapNews(q, Math.min(4, c), sig), effQuery, "orig");
    }
    addTask("google-news", searchGoogleNews, effQuery);
    addTask("bing-news", searchBingNewsRss, effQuery);
    if (!newsDetected && anchorQuery && anchorQuery !== effQuery) {
      addTask("google-news", searchGoogleNews, anchorQuery, "anchor");
    }
    if (!newsDetected) {
      addTask("wikipedia", searchWikipedia, effQuery);
      if (english && english !== effQuery) addTask("wikipedia", searchWikipedia, english, "anchor");
    }
    if (ddgOn && isShortQuery) addTask("ddg-instant", searchDDGInstant, effQuery, "orig");
    return tasks;
  };

  const collect = (tasks, deadlineMs) => new Promise((resolve) => {
    const out = [];
    if (!tasks.length) return resolve(out);
    const limit = Math.max(200, deadlineMs);
    let pending = tasks.length;
    const t = setTimeout(() => { deadlineAbort.abort(); resolve(out); }, limit);
    for (const p of tasks) {
      p.then((v) => {
        out.push(v);
        if (--pending === 0) { clearTimeout(t); resolve(out); }
      });
    }
  });

  let settled = await collect(runProviders(queries, true), Math.min(3500, left() - 300));
  const anchorUrls = new Set();
  const voteMap = new Map();
  const addVotes = (name, res, variant) => {
    res.forEach((r, idx) => {
      const key = normalizeUrl(r.url);
      if (variant === "anchor" && idx < 3) anchorUrls.add(key);
      if (!voteMap.has(key)) voteMap.set(key, { result: r, providers: new Set(), voteCount: 0, ranks: {}, anchorHits: 0 });
      const v = voteMap.get(key);
      if (!v.result.published_at && r.published_at) v.result.published_at = r.published_at;
      if (!v.result.updated_at && r.updated_at) v.result.updated_at = r.updated_at;
      if (variant === "anchor") v.anchorHits++;
      const rank = idx + 1;
      if (!v.providers.has(name)) {
        v.providers.add(name);
        v.voteCount++;
        v.ranks[name] = rank;
      } else if (rank < v.ranks[name]) {
        v.ranks[name] = rank;
      }
    });
  };

  for (const { name, res, error, variant } of settled) {
    if (error) { errors[name] = (errors[name] ? errors[name] + "; " : "") + error; continue; }
    if (res && res.length) {
      if (!providersUsed.includes(name)) providersUsed.push(name);
      addVotes(name, res, variant);
    }
  }

  const toResults = () => [...voteMap.values()].map(v => {
    const rrfScore = Object.values(v.ranks).reduce((s, rank) => s + 1 / (60 + rank), 0);
    const key = normalizeUrl(v.result.url);
    // v15 (Claude #2 fix): tək Bing nəticəsinə süni anchorBonus verilmir —
    // yalnız EN anchor top-3-də olan VƏ YA 2+ müstəqil mənbənin təsdiqlədiyi URL bonus alır!
    const anchorBonus = ((anchorUrls.has(key) && v.anchorHits >= 1) || v.voteCount >= 2) ? 1 : 0;
    return { ...v.result, voteCount: v.voteCount, providers: [...v.providers], rrfScore, anchorBonus };
  });
  let results = toResults();

  if (results.length < 3 && left() > 2200) {
    try {
      const suggestions = await fetchSuggestions(query, Math.min(800, Math.max(0, left() - 1600)));
      const extraQueries = suggestions.slice(0, 2).filter(s => !queries.includes(s));
      if (extraQueries.length && left() > 800) {
        const settled2 = await collect(runProviders(extraQueries, false), Math.min(1500, left() - 100));
        for (const { name, res, error } of settled2) {
          if (error) continue;
          if (res && res.length) {
            if (!providersUsed.includes(name)) providersUsed.push(name);
            res.forEach((r, idx) => {
              const key = normalizeUrl(r.url);
              if (!voteMap.has(key)) voteMap.set(key, { result: r, providers: new Set([name]), voteCount: 1, ranks: { [name]: idx + 1 }, anchorHits: 0 });
              else if (!voteMap.get(key).providers.has(name)) { voteMap.get(key).providers.add(name); voteMap.get(key).voteCount++; voteMap.get(key).ranks[name] = idx + 1; }
            });
          }
        }
        results = toResults();
        queries.push(...extraQueries);
      }
    } catch {}
  }

  const cleanResults = results.filter(r => !isSpamDomain(r.url));
  let finalResults = cleanResults;
  if (opts.freshness && ["day","week","month","year"].includes(opts.freshness)) {
    const days = { day: 1, week: 7, month: 30, year: 365 }[opts.freshness];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    finalResults = cleanResults.filter(r => {
      if (!r.published_at) return true;
      const ts = Date.parse(r.published_at);
      if (isNaN(ts)) return true;
      return ts >= cutoff;
    });
  }
  if (opts.excludeDomains && opts.excludeDomains.length) {
    finalResults = finalResults.filter(r => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
        return !opts.excludeDomains.some(d => host === d || host.endsWith("." + d));
      } catch { return true; }
    });
  }

  finalResults = finalResults
    .sort((a, b) =>
      ((b.voteCount || 0) - (a.voteCount || 0)) ||
      ((b.rrfScore || 0) - (a.rrfScore || 0)) ||
      a.url.localeCompare(b.url))
    .slice(0, count * 3);
  return { results: finalResults, providersUsed, errors, queriesUsed: queries, anchorQuery, rewrittenQuery: effQuery, translated: !!translated };
}
