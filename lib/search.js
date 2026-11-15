// Key-siz axtarış provayderləri - test olunub (2026-11-14)
// Əsas: Tavily keyless (rəsmi, açarsız) + DDG HTML + Bing HTML + Brave HTML + Google News RSS + Wikipedia
// PRİNSİP: heç bir API key yoxdur - Brave API silindi (key tələb edir)
// Qeyd: Bing RSS və DDG Lite datacenter IP-dən bloklanır, ona görə HTML versiyalar istifadə olunur
import { XMLParser } from "fast-xml-parser";
import { parseHTML } from "linkedom";
import { expandQueryAsync } from "./expand.js";
import { tokenize } from "./rank.js";
import { isCircuitOpen, recordSuccess, recordFailure } from "./circuit.js";
import { fetchSuggestions } from "./suggest.js";
import { isSpamDomain } from "./score.js"; // v10 🟡: spam siyahısının tək mənbəsi
import { detectQueryLanguage } from "./clean.js"; // v12: dil → mkt/country

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function fetchTimeout(url, opts = {}, ms = 5000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms), headers: { "User-Agent": UA, "Accept-Language": "az-AZ,az;q=0.9,en;q=0.8", ...(opts.headers || {}) } });
}

// Multi-provider vote üçün URL normallaşdırma (FreeSearch + metasearch-rust taktikası)
// Tracking parametrləri silinir, mənalı query saxlanılır və sıralanır
// Bug tarixçəsi:
// v0: query tamamilə atılırdı - YouTube ?v=AAA və ?v=BBB eyni sayılırdı
// v1: bütün qeyri-tracking saxlanılırdı - Bing ?form=QBLH Tavily clean URL-dən fərqlənir
// v2 (v10): whitelist (v,id,q,p,t,...) - viewtopic?t= düzəldildi amma KÖVRƏK qaldı:
//   YouTube ?t=30 timestamp-i fərqli URL edirdi, ?page/?newsid/?tid itirdi
// v3 (v10.1 🟠10): QARA SİYAHI — yalnız məlum tracking parametrləri silinir,
//   qalanı (t, page, newsid, tid, ...) saxlanılır. YouTube timestamp-i hosta
//   görə ayrıca silinir.
const DROP_PARAMS = /^(utm_\w+|fbclid|gclid|mc_\w+|igshid|igsh|ref|ref_src|msclkid|twclid|yclid|_hsenc|_hsmi|spm|sc|scsig|form|sapiv|ckla|adurl)$/i;
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/$/, "") || "/";
    const params = [];
    for (const [k, v] of u.searchParams) {
      if (DROP_PARAMS.test(k)) continue; // tracking/referral
      // YouTube timestamp (?t=30 / ?start=30) səhifə identity-DƏYİL - sil
      const kl = k.toLowerCase();
      if ((kl === "t" || kl === "start") && /(^|\.)(youtube\.com|youtu\.be)$/.test(host)) continue;
      params.push([k, v]);
    }
    params.sort((a, b) => a[0].localeCompare(b[0]));
    const qs = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
    return host + path + qs;
  } catch { return url; }
}

// HTML entity decode (ChenneyZhuang taktikası): başlıqlarda &amp; və s. təmizlənir
// v10 🟡: TEK PASS ( əvvəl ardıcıl replace-lər "&amp;lt;"-i "&lt;"-yə çevirib
// 2-ci pass-da "<" edirdi - double-decode) + HEX entity-lər (&#x27; - əvvəl yox idi)
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

// Retry strategiyası (DeepSeek Strategiya 1+2 + 429 fix):
// - Timeout olduqda retry YOX - provayder atılır (latency qorunur)
// - Boş nəticə və ya 429/403 (rate limit) olduqda 1 dəfə retry (429 tez uğursuz olur, retry ucuzdur)
// - Ümumi büdcə cap: 4s-dən çox çəkmir
// 429 retry provayder sabitliyini artırır: Brave/Tavily 429-u müvəqqətidir, retry çox vaxt uğur verir
export async function fetchWithRetry(fn, query, count, budgetMs = 4000) {
  const start = Date.now();
  try {
    return await fn(query, count);
  } catch (e) {
    const msg = e.message || "";
    const isEmpty = /no results/i.test(msg);
    const isRateLimit = /429|403|rate limit/i.test(msg);
    if ((isEmpty || isRateLimit) && Date.now() - start < budgetMs - 500) {
      await new Promise(r => setTimeout(r, isRateLimit ? 400 : 200));
      return await fn(query, count);
    }
    throw e;
  }
}

// Tavily keyless - rəsmi açarsız rejim (docs.tavily.com/agents)
// Header: X-Tavily-Access-Mode: keyless - heç bir API key, qeydiyyat yoxdur
// Rate limit var (IP əsaslı), amma LLM sorğuları üçün kifayətdir
export async function searchTavilyKeyless(query, count = 8, opts = {}) {
  const body = { query, max_results: count, search_depth: "basic", include_answer: false };
  // Freshness (Tavily time_range) + domain filter (server-side)
  if (opts.freshness && ["day","week","month","year"].includes(opts.freshness)) body.time_range = opts.freshness;
  // v12 P3: country boost (Tavily docs: general topic-da məməliyyətdən hasilatları üstün tut)
  const tLang = detectQueryLanguage(query);
  if (tLang === "az") body.country = "az";
  else if (tLang === "tr") body.country = "tr";
  if (opts.excludeDomains && opts.excludeDomains.length) body.exclude_domains = opts.excludeDomains.slice(0, 150);
  if (opts.includeDomains && opts.includeDomains.length) body.include_domains = opts.includeDomains.slice(0, 300);
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tavily-Access-Mode": "keyless" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2000)
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

// Hacker News Algolia API - tam keyless, rəsmi JSON API (saatda 10K sorğu limiti)
// Scraping yoxdur, datacenter IP-dən etibarlıdır. Texniki sorğular üçün müstəqil mənbədir.
export async function searchHN(query, count = 8) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${count}`;
  const res = await fetchTimeout(url, {}, 1500);
  if (!res.ok) throw new Error("hn algolia " + res.status);
  const j = await res.json();
  const hits = j.hits || [];
  if (!hits.length) throw new Error("hn no results");
  return hits.slice(0, count).map(h => {
    const title = decodeEntities(String(h.title || h.story_title || "")).slice(0, 200);
    const link = h.url || `https://news.ycombinator.com/item?id=${h.objectID}`;
    const rawText = String(h.story_text || h.comment_text || "").replace(/<[^>]+>/g, "").trim();
    // Link post-larda mətn yoxdur - metadata snippet kimi istifadə olunur (real məlumatdır)
    const snippet = decodeEntities(rawText || `${h.points || 0} points, ${h.num_comments || 0} comments on Hacker News`).slice(0, 500);
    return { title, url: link, snippet, source: "hacker-news", published_at: h.created_at || null };
  }).filter(x => x.url.startsWith("http") && x.title);
}

// GitHub Search API - tam keyless (auth-suz 10 sorğu/dəq limit)
// Rəsmi JSON API, scraping yoxdur. Dev sorğuları üçün etibarlı mənbədir.
export async function searchGitHub(query, count = 8) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${count}&sort=stars`;
  const res = await fetchTimeout(url, { headers: { "Accept": "application/vnd.github+json" } }, 1500);
  if (!res.ok) throw new Error("github api " + res.status);
  const j = await res.json();
  const items = j.items || [];
  if (!items.length) throw new Error("github no results");
  return items.slice(0, count).map(i => ({
    title: decodeEntities(String(i.full_name || "")).slice(0, 200),
    url: String(i.html_url || ""),
    snippet: decodeEntities(String(i.description || `${i.stargazers_count || 0} stars on GitHub`)).slice(0, 500),
    source: "github",
    published_at: i.updated_at || null
  })).filter(x => x.url.startsWith("http") && x.title);
}

// arXiv API - tam keyless akademik axtarış (AgentSearch vertical taktikası)
export async function searchArxiv(query, count = 8) {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${count}&sortBy=relevance`;
  const res = await fetchTimeout(url, {}, 1500);
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

// 1. DuckDuckGo HTML (Lite-dan fərqli olaraq işləyir)
export async function searchDDG(query, count = 8) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchTimeout(url, {}, 1200);
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

// 2. Bing HTML (RSS junk qaytarır, HTML işləyir)
// v12 P3: mkt/setlang sorğusunun DİLİNƏ görə — əvvəl az-AZ hardcoded idi:
// TR/EN sorğular AZ marketplace-də rank-lanırdı (TR nəticə zəifliyi səbəblərindən biri).
// Taktika: SearXNG "language selection" + DDGS region param + Tavily country.
export async function searchBing(query, count = 8) {
  const qLang = detectQueryLanguage(query);
  const mkt = qLang === "az" ? "az-AZ" : qLang === "tr" ? "tr-TR" : "en-US";
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${mkt}&mkt=${mkt}`;
  const res = await fetchTimeout(url, {}, 1200);
  if (!res.ok) throw new Error("bing html " + res.status);
  const html = await res.text();
  const { document } = parseHTML(html);
  const results = [];
  // Bing HTML strukturu dəyişə bilər - fallback selectorlar (robustness)
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
  if (!results.length) throw new Error("bing no results");
  return results.slice(0, count);
}


// 3b. Brave HTML (DDG bloklansa ehtiyat)
export async function searchBrave(query, count = 8) {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetchTimeout(url, {}, 1200);
  if (!res.ok) throw new Error("brave " + res.status);
  const html = await res.text();
  const { document } = parseHTML(html);
  const results = [];
  document.querySelectorAll(".snippet").forEach(el => {
    const a = el.querySelector("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (!href.startsWith("http") || href.includes("brave.com")) return;
    const full = decodeEntities((el.textContent || "").trim()).replace(/\s+/g, " ");
    if (full.length < 30) return;
    const titleDec = decodeEntities((a.textContent || "").trim()).slice(0, 120);
    // v10 🟠12: snippet title-lə BAŞLAMIRDI (title = txt.slice(0,120), snippet =
    // txt.slice(0,500) → snippet title-i özündə daşıyır). scoreResult-da hər term
    // title (x2) + snippet (x1) = x3 sayılırdı - Brave nəticələrinə gizli bonus.
    let snippet = full.startsWith(titleDec) ? full.slice(titleDec.length).trim() : full;
    if (snippet.length < 20) snippet = full;
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
}

// 3. Google News RSS (təzə xəbərlər üçün) - dil sorğuya görə seçilir (EN sorğuya AZ xəbər lazımsızdır)
// v10 🟠11: RSS linkləri news.google.com/rss/articles/... JS redirect-ləridir.
// Real URL article id-də base64url kodlanıb - decode edirik (köhnə protobuf
// formatda URL base64 içində düz yazılır, yeni formatda news.google.com/url?q= var).
// Decode mümkün olmadısa orijinal link qalır (fetchAndExtract orada boş yer edir).
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

export async function searchGoogleNews(query, count = 5) {
  const isAz = /[əğışöüç]/.test(query.toLowerCase());
  const hl = isAz ? "az" : "en";
  const gl = isAz ? "AZ" : "US";
  const ceid = isAz ? "AZ:az" : "US:en";
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const res = await fetchTimeout(url, {}, 1500);
  if (!res.ok) throw new Error("google news " + res.status);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: true });
  const j = parser.parse(xml);
  const items = j?.rss?.channel?.item || [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.slice(0, count).map(it => ({
    title: decodeEntities(String(it.title || "")).slice(0, 200),
    url: decodeGoogleNewsUrl(String(it.link || "")), // v10 🟠11: redirect link → real URL
    snippet: decodeEntities(String(it.description || "").replace(/<[^>]+>/g, "")).slice(0, 500),
    source: "google-news",
    published_at: it.pubDate || null
  })).filter(x => x.url.startsWith("http"));
}

// 4. Wikipedia AZ + EN
// Keyfiyyət fix: sual partikulları ("kimdir", "nə vaxt", "hansıdır", "which/what...")
// wiki-phrase axtarışını seyrekləşdirir - təmiz variant əlavə olunur.
// Əlavə: "İlhəm Əliyev" kimi ə-sərvətli yazılışlar "İlham Əliyev" məqaləsini tapmur
// (məqalə adları çox vaxt "a" ilə) - ə->A variantı generasiya olunur.
const WIKI_PARTICLES = new Set([
  // AZ sual/partikl
  "kimdir","nədir","necədir","hardır","hansıdır","hansılardır","haradadır","hansı","nə","vaxt",
  "harada","yerləşir","olunub","edilib","edilir","edib","olacaq","olub","olurmu","oldumu",
  "kaçdır","neçədir","kim","oldu","edir",
  // EN question/function words
  "which","what","where","when","who","whom","whose","how","why","is","are","was","were",
  "the","a","an","in","between","with","does","do","did","has","have","had","of","to","and","on","at","for"
]);
function wikiVariants(query) {
  // v12.1: əvvəl sorğu sözləri atılır ("İlham Əliyev kimdir" → "İlham Əliyev")
  const q = stripQuestionWords(query);
  const base = new Set();
  base.add(q.trim());
  const cleaned = q.trim().split(/\s+/).filter(t => t && !WIKI_PARTICLES.has(t.toLowerCase()));
  if (cleaned.length) base.add(cleaned.join(" "));
  const out = new Set();
  for (const v of base) {
    out.add(v);
    if (/[əƏ]/.test(v)) out.add(v.replace(/ə/g, "a").replace(/Ə/g, "A"));
  }
  return [...out].slice(0, 4);
}
// v12.1: MediaWiki full-text search SORĞU SÖZLƏRİNDƏN nəfərlənir —
// "İlham Əliyev kimdir" → az top-5-də "İti qovan kimi qovuruq" qayıdır
// (wiki "İlham Əliyev" HƏC VAXT listəyə düşmür). SearXNG tərzi query cleaning:
// sorğu sözlərini (kimdir/nədir/what is/...) wiki axtarışından əvvəl atırıq.
const WIKI_QUESTION_WORDS = /(?<![\p{L}\p{N}])(kimdir|kim|nədir|nedir|necədir|necə|haqqında|haqqinda|barəsində|baresinde|hansı|hansi|niyə|niye|harada|yerləşir|yerlesir|yerləşən|yerlesen|nə vaxt|nəvaxt|vaxtdır|vaxtdir|nə|ne|what is|what's|who is|who's|how is|how do|how does|how to|tell me|about|when|where|why|which|what|who|how)(?![\p{L}\p{N}])/giu;

export function stripQuestionWords(q) {
  const s = String(q || "").replace(WIKI_QUESTION_WORDS, " ").replace(/\s{2,}/g, " ").trim();
  return s.length >= 3 ? s : String(q || ""); // çox qısa olduqsa orijinalı saxla
}

export async function searchWikipedia(query, count = 5) {
  const variants = wikiVariants(query);
  const perLang = await Promise.all(["az", "en"].map(async (lang) => {
    const chunks = await Promise.all(variants.map(async (v) => {
      try {
        const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(v)}&format=json&srlimit=${count}`;
        const res = await fetchTimeout(url, {}, 1500);
        if (!res.ok) return [];
        const j = await res.json();
        const arr = j.query?.search || [];
        return arr.map(r => ({
          title: decodeEntities(String(r.title)).slice(0, 200),
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
          snippet: decodeEntities(String(r.snippet || "").replace(/<[^>]+>/g, "")).slice(0, 500),
          source: "wikipedia",
          published_at: r.timestamp || null
        }));
      } catch { return []; }
    }));
    // Dedup by title (ilk variantın prioriteti var)
    const seen = new Set();
    const all = [];
    for (const chunk of chunks) for (const r of chunk) {
      if (!seen.has(r.title)) { seen.add(r.title); all.push(r); }
    }
    return all;
  }));
  // v10 🟠12: round-robin (interleave) - əvvəl flat().slice(0,count) idi:
  // AZ wiki count qədər nəticə verdikdə EN variantlar TAMAMEN atılırdı
  // (EN-də daha dəqiq/səhv az olan məqalələr itirdi)
  const [azResults, enResults] = perLang;
  const all = [];
  const maxLen = Math.max(azResults.length, enResults.length);
  for (let i = 0; i < maxLen && all.length < count; i++) {
    if (azResults[i]) all.push(azResults[i]);
    if (all.length < count && enResults[i]) all.push(enResults[i]);
  }
  // Boş nəticədə throw et - fetchWithRetry 1 dəfə retry edir (Wikipedia baseline etibarlılığı üçün)
  if (!all.length) throw new Error("wikipedia no results");
  return all;
}

// 4b. DuckDuckGo Instant Answer API - keyless, çox sürətli (FreeSearch taktikası)
// Definition/hesablama sorğularında dərhal cavab verir. Boş olarsa throw (retry yoxdur).
export async function searchDDGInstant(query, count = 3) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const res = await fetchTimeout(url, {}, 1200);
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
  // Related topics (əgər varsa)
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

// 5. SearXNG - self-hosted (VPS) - yalnız SEARXNG_URL varsa (açıq instancelar captcha verir, çağırılmır)
// SEARXNG_URL env varsa öz instance-ın istifadə olunur (ən etibarlı variant)
// Yoxdursa açıq instancelar paralel cəhd edilir (ilk uğurlu qazanır)
export async function searchSearXNG(query, count = 8) {
  const own = (process.env.SEARXNG_URL || "").replace(/\/$/, "");
  if (!own) throw new Error("searxng not configured");
  const instances = [own];
  const attempts = instances.map(async (base) => {
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
    const res = await fetchTimeout(url, {}, 2500);
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
  // Promise.any: ilk uğurlu instance qazanır, hamısı uğursuz olarsa reject
  return Promise.any(attempts);
}

// Əsas: paralel axtarış + query expansion
// EN anchor strategiyası (DeepSeek): uzun AZ sorğuda EN tərcümə "anchor" olur,
// hər iki dil axtarışında görünən URL-lər üstün tutulur - determinizm artır
export async function searchAll(query, count = 8, opts = {}) {
  const providersUsed = [];
  const errors = {};
  // v10.1 🔴4: TEK ÜMUMİ BÜDCƏ (5s) — hər mərhələ QALAN vaxta görə işləyir.
  // Əvvəl mərhələlər ayrı-ayrılıqda idi: MyMemory 1.2s + provider 3.5s +
  // suggest 2x0.8s (ardıcıl) + faz 2 1.5s = 7.8s pisi → route timeout-una düşüb
  // 504 toplanmış nəticələri atırdı (faz 2 məhz nəticələr az olanda işləyir).
  const BUDGET_MS = 5000;
  const started = Date.now();
  const left = () => BUDGET_MS - (Date.now() - started);
  // Tərcümə büdcəsi: provider fazası üçün 3.6s ehtiyat saxla
  const { expanded, english, translated } = await expandQueryAsync(query, Math.min(1200, Math.max(0, left() - 3600)));
  const queries = [query];
  if (expanded && expanded !== query) queries.push(expanded);
  if (english && english !== query && english !== expanded) queries.push(english);
  // Anchor variant: EN tərcümə (uzun AZ-da) və ya dictionary EN
  const anchorQuery = (translated && english) ? english : (english && english !== query ? english : null);
  // Short query boost (DeepSeek): tək sözlü/akronim sorğu üçün "definition" variantı
  // "LLM" → "LLM definition" - axtarış mühərrikləri təbii sorğuda daha yaxşı nəticə verir
  const isShortQuery = tokenize(query).length <= 1;
  const defQuery = isShortQuery ? `${query} definition` : null;
  if (defQuery && !queries.includes(defQuery)) queries.push(defQuery);

  // v10 🟠6: (provider, query) DEDEUP - faz 2 (suggestions) orijinal query ilə
  // tavily/google-news/wiki/DDG-instant-i TEKRAR çağırırdı (caller closure eyni
  // `query` idi) - provider limiti + CB counter-ları boşuna işləyirdi.
  const called = new Set();
  // v10.1 🟠11: 1 sorğuda 1 provayder = 1 failure səsli. Əvvəl hər ÇAĞIRIŞ ayrı
  // sayılırdı: DDG 3 variantla (orig/expanded/EN) düşdü → threshold 3 bir təklifsiz
  // req-də dolub 20s cooldown açılırdı.
  const failedInRequest = new Set();
  const runProviders = (qs) => {
    const tasks = [];
    const addTask = (name, fn, q, variant = "orig") => {
      const sig = `${name}::${q}`;
      if (called.has(sig)) return; // faz 1-də artıq çağrılıb
      called.add(sig);
      // Circuit breaker: soyuyan provayderi çağırma (latency qənaəti)
      if (isCircuitOpen(name)) {
        tasks.push(Promise.resolve({ name, error: "circuit open (cooldown)" }));
        return;
      }
      const t0 = Date.now();
      tasks.push(fetchWithRetry(fn, q, count).then(res => {
        recordSuccess(name, Date.now() - t0);
        return { name, res, variant };
      }).catch(e => {
        // "no results" = soft failure (soruqdan asılı, provayder qüsuru deyil) -
        // circuit-e qatma: yoxsa adi AZ sorğularda wikipedia/brave cooldown-a düşür
        // və axtarış ən stabil anchor-unu itirir (keyfiyyət bozulması).
        // Real xətalara (403/429/timeout/5xx) qatılma davam edir.
        // v10.1: req-içində dedupe — eyni provider eyni req-də 1-dən çox səs vermir
        if (!/no results/.test(e.message) && !failedInRequest.has(name)) {
          failedInRequest.add(name);
          recordFailure(name);
        }
        return { name, error: e.message };
      }));
    };
    for (const q of qs) {
      const variant = (anchorQuery && q === anchorQuery) ? "anchor" : "orig";
      addTask("duckduckgo", searchDDG, q, variant);
      addTask("bing", searchBing, q, variant);
      addTask("brave", searchBrave, q, variant);
    }
    // Tavily keyless: orijinal sorğu + EN anchor (uzun AZ-da EN daha yaxşıdır)
    // v10 🟠6: Tavily max 2x (əvvəl orig+anchor+defQuery = 3x idi - keyless limit)
    const tavilyFn = (q, c) => searchTavilyKeyless(q, c, opts);
    addTask("tavily", tavilyFn, query, "orig");
    if (anchorQuery && anchorQuery !== query) {
      addTask("tavily", tavilyFn, anchorQuery, "anchor");
    }
    // HN/GitHub/arXiv: ingilis variantı ilə axtar - AZ mətn bu API-lərdə 0 nəticə verir
    const hnGhQuery = (english && english !== query) ? english : query;
    addTask("hacker-news", searchHN, hnGhQuery, "anchor");
    addTask("github", searchGitHub, hnGhQuery, "anchor");
    addTask("arxiv", searchArxiv, hnGhQuery, "anchor");
    // SearXNG: yalnız öz instance-ın (SEARXNG_URL) varsa çağır - açıq instancelar
    // datacenter IP-dən captcha/429 verir və latency artırır, ona görə avtomatik yoxdur
    if (process.env.SEARXNG_URL) addTask("searxng", searchSearXNG, query);
    // Short query baseline: Wikipedia heç vaxt bloklanmır - definition variantı ilə ehtiyat
    if (defQuery) {
      addTask("wikipedia", searchWikipedia, defQuery);
    }
    addTask("google-news", searchGoogleNews, query);
    addTask("wikipedia", searchWikipedia, query);
    // Keyfiyyət fix: uzun AZ suallarında EN anchor (MyMemory) wiki-yə də keçir:
    // "sərhəddi olan dövlətlər hansılardır" -> "countries ... azerbaijan" -> "Borders of Azerbaijan"
    if (english && english !== query) addTask("wikipedia", searchWikipedia, english, "anchor");
    // DDG Instant Answer: qısa/definition sorğularında sürətli cavab (FreeSearch taktikası)
    if (isShortQuery || defQuery) addTask("ddg-instant", searchDDGInstant, query, "orig");
    return tasks;
  };

  // v10 🟠7: PARTIAL RESULTS - deadline çatanda artıq gələn nəticələr ilə
  // davam et (route 504-u hamısını atırdı). Aşağıdakı funksiya hər task-ı
  // gəldikcə toplayır, deadline-də qalanları gözləmir.
  // v10.1 🔴4: deadline artıq QALAN ümumi büdcədən hesablanır (max 3.5s)
  const collect = (tasks, deadlineMs) => new Promise((resolve) => {
    const out = [];
    if (!tasks.length) return resolve(out);
    const limit = Math.max(200, deadlineMs);
    let pending = tasks.length;
    const t = setTimeout(() => resolve(out), limit);
    for (const p of tasks) {
      p.then((v) => {
        out.push(v);
        if (--pending === 0) { clearTimeout(t); resolve(out); }
      });
    }
  });

  let settled = await collect(runProviders(queries), Math.min(3500, left() - 300));
  // Multi-provider vote + anchor: eyni URL-i neçə provayder verib?
  // Anchor: EN variantında top-3 + Bing top-3 (Bing ən etibarlıdır - bütün sorğularda var)
  // Bing anchor provayder varlığını sabitləşdirir: Brave/GitHub 429 olsa da, Bing top-3 qalır
  const anchorUrls = new Set();
  const bingAnchorUrls = new Set();
  const voteMap = new Map();
  const addVotes = (name, res, variant) => {
    res.forEach((r, idx) => {
      const key = normalizeUrl(r.url);
      if (variant === "anchor" && idx < 3) anchorUrls.add(key);
      if (name === "bing" && idx < 3) bingAnchorUrls.add(key);
      if (!voteMap.has(key)) voteMap.set(key, { result: r, providers: new Set(), voteCount: 0, ranks: {}, anchorHits: 0 });
      const v = voteMap.get(key);
      if (variant === "anchor") v.anchorHits++;
      // RRF üçün ən yaxşı (minimum) rank saxlanılır - eyni provayder 2 variantda verirsə, ən yüksək rank
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
  // v10 🟠7: settled indi birbaşa value-lardır ({name,res,error,variant}) - collect()
  // deadline-a qədər gələnləri toplayır, partial ola bilər
  for (const { name, res, error, variant } of settled) {
    if (error) { errors[name] = (errors[name] ? errors[name] + "; " : "") + error; continue; }
    if (res && res.length) {
      if (!providersUsed.includes(name)) providersUsed.push(name);
      addVotes(name, res, variant);
    }
  }
  const toResults = () => [...voteMap.values()].map(v => {
    // RRF: Σ 1/(60 + rank) - bir neçə mühərrikin yüksək sıraladığı səhifə öndədir (FreeSearch taktikası)
    const rrfScore = Object.values(v.ranks).reduce((s, rank) => s + 1 / (60 + rank), 0);
    // Anchor bonus: EN top-3-də olan VƏ YA Bing top-3-də olan URL (Bing ən etibarlı anchor-dır)
    const key = normalizeUrl(v.result.url);
    const anchorBonus = ((anchorUrls.has(key) && v.anchorHits >= 1) || bingAnchorUrls.has(key)) ? 1 : 0;
    return { ...v.result, voteCount: v.voteCount, providers: [...v.providers], rrfScore, anchorBonus };
  });
  let results = toResults();

  // Faz 2: əgər nəticə azdırsa (<3), Suggest-dən expansion əlavə et (yalnız lazım olduqda)
  // v10 🟠6/7: extra sorğular yenə runProviders → called-set orijinal (provider,query)
  // çağırışlarını təkrarlamır. v10.1 🔴4: yalnız QALAN büdcə kifayətdirsə işləyir
  // (suggest ≤0.8s + provider ≤1.5s) - artıq vaxt yoxdursa at, nəticəni saxla.
  if (results.length < 3 && left() > 2200) {
    try {
      const suggestions = await fetchSuggestions(query, Math.min(800, Math.max(0, left() - 1600)));
      const extraQueries = suggestions.slice(0, 2).filter(s => !queries.includes(s));
      if (extraQueries.length && left() > 800) {
        const settled2 = await collect(runProviders(extraQueries), Math.min(1500, left() - 100));
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


  // Spam filtri slice-dan əvvəl: Bing junk-u (Gitee) yaxşı nəticələri sıxışdırmasın (Test10 fix)
  // count*2 saxlanılır - count*4 Test1/5/6-nı pozdu (arxiv junk-u daxil oldu)
  // v10 🟡: siyahı score.js-dən (isSpamDomain) - əvvəl burada da ayrıca copy vardı
  const cleanResults = results.filter(r => !isSpamDomain(r.url));
  // Freshness post-filter (SearXNG time_range taktikası): tarixli köhnə nəticələr atılır, tarixsiz saxlanılır
  let finalResults = cleanResults;
  if (opts.freshness && ["day","week","month","year"].includes(opts.freshness)) {
    const days = { day: 1, week: 7, month: 30, year: 365 }[opts.freshness];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    finalResults = cleanResults.filter(r => {
      if (!r.published_at) return true; // tarix yoxdur - saxla (təsdiqlənə bilməz)
      const ts = Date.parse(r.published_at);
      if (isNaN(ts)) return true;
      return ts >= cutoff;
    });
  }
  // Exclude domains post-filter (Tavily exclude_domains server-side-də də var, digər provayderlər üçün)
  if (opts.excludeDomains && opts.excludeDomains.length) {
    finalResults = finalResults.filter(r => {
      try {
        const host = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
        return !opts.excludeDomains.some(d => host === d || host.endsWith("." + d));
      } catch { return true; }
    });
  }
  // v10 🔴2: SLICE-ƏVVƏL RANK — əvvəl finalResults sırasız (voteMap insertion order)
  // idi və count*2 truncation RANKING-dən ƏVVƏL düşürdü: 3+ provayderdə oyunan
  // URL-lər (həqiqi top) kəsilir, tək provayderin zəif nəticələri gedirdi.
  // İndi: voteCount (multi-provider oy) + rrfScore sırası ilə, sonra truncation.
  // (route.js-dəki score sort final qüvvəlidir; bu, truncation-da düzgünlükdür)
  finalResults = finalResults
    .sort((a, b) =>
      ((b.voteCount || 0) - (a.voteCount || 0)) ||
      ((b.rrfScore || 0) - (a.rrfScore || 0)) ||
      a.url.localeCompare(b.url))
    .slice(0, count * 2);
  return { results: finalResults, providersUsed, errors, queriesUsed: queries, anchorQuery, translated: !!translated };
}

function mergeResults(a, b) { return [...a, ...b]; }
