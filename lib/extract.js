// Sayt açmaq və təmizləmək - linkedom + readability + Wikipedia Full/Infobox + StackOverflow API
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import net from "net";
import dns from "dns/promises";
import { wikiExtractUrl, acceptLanguageHeader } from "./clean.js";
import { decodeEntities } from "./search.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const WIKI_UA = "LLM-free-search-api/1.5 (https://github.com/Alim4385/LLM-free-search-api-Vercel) keyless-search";

const BLOCK_LIST = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16]
]) BLOCK_LIST.addSubnet(addr, prefix, "ipv4");
BLOCK_LIST.addAddress("::", "ipv6");
BLOCK_LIST.addAddress("::1", "ipv6");
BLOCK_LIST.addSubnet("fc00::", 7, "ipv6");
BLOCK_LIST.addSubnet("fe80::", 10, "ipv6");

export function isBlockedIp(ip) {
  const ver = net.isIP(ip);
  if (!ver) return true;
  const mapped = String(ip).match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return BLOCK_LIST.check(mapped[1], "ipv4");
  return BLOCK_LIST.check(ip, ver === 4 ? "ipv4" : "ipv6");
}

function isPublicPort(u) {
  return u.port === "" || u.port === "80" || u.port === "443";
}

const dnsCache = new Map();
const DNS_TTL_MS = 10_000;
async function dnsLookupCached(host) {
  const hit = dnsCache.get(host);
  if (hit && Date.now() < hit.exp) return hit.addrs;
  const addrs = await dns.lookup(host, { all: true });
  dnsCache.set(host, { addrs, exp: Date.now() + DNS_TTL_MS });
  if (dnsCache.size > 500) dnsCache.delete(dnsCache.keys().next().value);
  return addrs;
}

export async function assertPublicUrl(url) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
  if (!isPublicPort(u)) throw new Error("bad port");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost") throw new Error("private host");
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error("private ip");
    return;
  }
  try {
    const addrs = await dnsLookupCached(host);
    for (const a of addrs) {
      if (isBlockedIp(a.address)) throw new Error("private ip");
    }
  } catch (e) {
    if (e.message === "private ip" || e.message === "private host" || e.message === "bad protocol") throw e;
  }
}

const MAX_REDIRECTS = 3;

export async function fetchSafe(url, timeoutMs = 2500, extraHeaders = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    let res;
    try {
      res = await fetch(current, {
        headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", ...extraHeaders },
        signal,
        redirect: "manual"
      });
    } catch (e) {
      throw e;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      try { current = new URL(loc, current).toString(); } catch { return null; }
      continue;
    }
    return res;
  }
  return null;
}

const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/g;

const extractCache = new Map();
const EXTRACT_MAX_BYTES = 4 * 1024 * 1024;
let extractBytes = 0;
function extractTtlMs(url) {
  try { return /wikipedia\.org$/i.test(new URL(url).hostname) ? 24 * 3600 * 1000 : 3600 * 1000; } catch { return 3600 * 1000; }
}
export function extractCacheGet(url) {
  const v = extractCache.get(url);
  if (!v) return null;
  if (Date.now() > v.exp) { extractBytes -= v.size; extractCache.delete(url); return null; }
  return v.val;
}
export function extractCacheSet(url, val) {
  const size = (val.text || "").length + (val.title || "").length;
  const old = extractCache.get(url);
  if (old) extractBytes -= old.size;
  extractCache.set(url, { val, exp: Date.now() + extractTtlMs(url), size });
  extractBytes += size;
  while (extractBytes > EXTRACT_MAX_BYTES && extractCache.size > 1) {
    const oldest = extractCache.keys().next().value;
    const ov = extractCache.get(oldest);
    extractBytes -= ov.size;
    extractCache.delete(oldest);
  }
}

function wikiParseTablesUrl(url, fullPage = false) {
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z-]{2,})\.wikipedia\.org$/i);
    if (!m || !u.pathname.startsWith("/wiki/") || u.pathname.length <= 6) return null;
    const title = decodeURIComponent(u.pathname.slice(6)).trim();
    if (!title) return null;
    const sec = fullPage ? "" : "&section=0";
    return `https://${m[1].toLowerCase()}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text${sec}&redirects=1&format=json`;
  } catch { return null; }
}

function extractWikiTablesHtml(html = "") {
  if (!html) return "";
  try {
    const { document } = parseHTML(html);
    document.querySelectorAll("style, script, sup.reference, .mw-editsection, .navbox, .reflist").forEach(e => e.remove());
    const lines = [];
    document.querySelectorAll("table.infobox tr").forEach(tr => {
      const cells = Array.from(tr.querySelectorAll("th, td")).map(c => c.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
      if (cells.length === 2 && cells[0].length <= 45 && cells[1].length <= 140 && !/^(bayraq|gerb|xəritə|şəkil|image|map|flag)$/i.test(cells[0])) {
        lines.push(`${cells[0]}: ${cells[1]}`);
      }
    });
    document.querySelectorAll("table.wikitable tr").forEach(tr => {
      const cells = Array.from(tr.querySelectorAll("th, td")).map(c => c.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
      if (cells.length >= 2 && cells.length <= 8) {
        const row = cells.slice(0, 5).join(" — ");
        if (row.length >= 10 && row.length <= 220) lines.push(row);
      }
    });
    return lines.slice(0, 35).join("\n");
  } catch { return ""; }
}

const WIKI_TABLE_NEED_RE = /\b(neçə\w*|əhali\w*|sahə\w*|hansılar\w*|siyahı\w*|həmsərhəd|sərhəd\w*|hangisi\w*|büyük|kaç\w*|population|borders?|most\s+visited|most\s+popular|largest)\b/iu;

function soQuestionId(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)stackoverflow\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/questions\/(\d+)(\/|$)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function normalizeValidIsoDate(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length < 8 || s.length > 64) return null;
  const ts = Date.parse(s);
  if (Number.isNaN(ts)) return null;
  const minTs = Date.UTC(1990, 0, 1);
  const maxTs = Date.now() + 2 * 24 * 3600 * 1000;
  if (ts < minTs || ts > maxTs) return null;
  return new Date(ts).toISOString();
}

export function buildDateInfo(publishedAt = null, updatedAt = null, lang = "az") {
  const pubIso = normalizeValidIsoDate(publishedAt);
  const updIso = normalizeValidIsoDate(updatedAt);
  const effIso = pubIso || updIso;
  const basis = pubIso ? "published" : (updIso ? "updated" : null);
  const isEn = lang === "en";
  if (!effIso) {
    return {
      date: null,
      basis: null,
      age_days: null,
      freshness: "unknown",
      label: isEn ? "date unknown" : "tarix göstərilməyib"
    };
  }
  const ts = Date.parse(effIso);
  const ageDays = Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
  const ymd = effIso.slice(0, 10);
  let freshness = "old";
  if (ageDays <= 7) freshness = "fresh";
  else if (ageDays <= 90) freshness = "recent";
  else if (ageDays <= 730) freshness = "moderate";

  let rel = "";
  if (ageDays === 0) rel = isEn ? "today" : "bu gün";
  else if (ageDays === 1) rel = isEn ? "1 day ago" : "dünən";
  else if (ageDays < 30) rel = isEn ? `${ageDays} days ago` : `${ageDays} gün əvvəl`;
  else if (ageDays < 365) {
    const m = Math.max(1, Math.round(ageDays / 30));
    rel = isEn ? `${m} mo ago` : `${m} ay əvvəl`;
  } else {
    const y = Math.max(1, Math.round(ageDays / 365.25));
    rel = isEn ? `${y} yr ago` : `${y} il əvvəl`;
  }

  const tagMapAz = { fresh: "təzə", recent: "yaxın tarixli", moderate: "orta köhnəlikdə", old: "köhnə mənbə" };
  const tagMapEn = { fresh: "fresh", recent: "recent", moderate: "moderate", old: "old source" };
  const tag = isEn ? tagMapEn[freshness] : tagMapAz[freshness];
  const basisNote = basis === "updated" ? (isEn ? ", updated" : ", yenilənib") : "";

  return {
    date: effIso,
    basis,
    age_days: ageDays,
    freshness,
    label: `${tag} (${rel}, ${ymd}${basisNote})`
  };
}

// v16 (Alim yeniliyi): açılan saytın öz HTML <meta> / JSON-LD / <time> teqlərindən
// HƏQİQİ nəşr (published_at) və yenilənmə (updated_at) tarixlərini çıxarır (uydurma YOXDUR!)
export function extractPageDates(document) {
  let publishedAt = null;
  let updatedAt = null;
  try {
    // 1. JSON-LD (datePublished / dateModified)
    for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
      const raw = (sc.textContent || "").trim();
      if (!raw || raw.length > 200_000) continue;
      if (!publishedAt) {
        const mp = raw.match(/"datePublished"\s*:\s*"([^"]{8,40})"/i);
        if (mp) publishedAt = normalizeValidIsoDate(mp[1]);
      }
      if (!updatedAt) {
        const mu = raw.match(/"dateModified"\s*:\s*"([^"]{8,40})"/i);
        if (mu) updatedAt = normalizeValidIsoDate(mu[1]);
      }
      if (publishedAt && updatedAt) break;
    }

    // 2. Standart <meta> teqləri
    const pubSelectors = [
      'meta[property="article:published_time"]',
      'meta[property="og:published_time"]',
      'meta[name="pubdate"]',
      'meta[name="publishdate"]',
      'meta[name="publish-date"]',
      'meta[name="sailthru.date"]',
      'meta[name="dc.date.issued"]',
      'meta[itemprop="datePublished"]'
    ];
    if (!publishedAt) {
      for (const sel of pubSelectors) {
        const el = document.querySelector(sel);
        const val = el && (el.getAttribute("content") || el.getAttribute("value"));
        const iso = normalizeValidIsoDate(val);
        if (iso) { publishedAt = iso; break; }
      }
    }

    const modSelectors = [
      'meta[property="article:modified_time"]',
      'meta[property="og:updated_time"]',
      'meta[name="lastmod"]',
      'meta[itemprop="dateModified"]'
    ];
    if (!updatedAt) {
      for (const sel of modSelectors) {
        const el = document.querySelector(sel);
        const val = el && (el.getAttribute("content") || el.getAttribute("value"));
        const iso = normalizeValidIsoDate(val);
        if (iso) { updatedAt = iso; break; }
      }
    }

    // 3. Məqalə daxilindəki <time datetime="...">
    if (!publishedAt) {
      const timeEl = document.querySelector("article time[datetime], main time[datetime], time[itemprop='datePublished'][datetime], time[datetime]");
      if (timeEl) {
        const iso = normalizeValidIsoDate(timeEl.getAttribute("datetime"));
        if (iso) publishedAt = iso;
      }
    }
  } catch {}
  return { publishedAt, updatedAt };
}

function htmlToCleanText(html = "") {
  return decodeEntities(
    String(html)
      .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n$1\n")
      .replace(/<\/(p|div|li|h1|h2|h3|pre|blockquote|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  ).replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

const WEB_APP_ERROR_RE = /(requires\s+a\s+keyboard|doesn['’]t\s+support\s*webgl|enable\s+javascript\s+to\s+run\s+this\s+app|you\s+need\s+to\s+enable\s+javascript)/i;

export async function fetchAndExtract(url, query, timeoutMs = 3500, lang = "az") {
  try {
    try {
      const gu = new URL(url);
      if (/^news\.google\./i.test(gu.hostname) && gu.pathname.includes("/articles/")) return null;
    } catch {}

    const langKey = lang ? `${url}|${lang}` : url;
    const exCached = extractCacheGet(langKey) || extractCacheGet(url);
    if (exCached) return exCached;

    // v15: StackOverflow HTML datacenter IP-dən bloklanır, rəsmi JSON API isə
    // ən yüksək səs almış cavabı 150ms-də təmiz qaytarır
    const soId = soQuestionId(url);
    if (soId) {
      try {
        const apiUrl = `https://api.stackexchange.com/2.3/questions/${soId}/answers?order=desc&sort=votes&site=stackoverflow&pagesize=2&filter=withbody`;
        const sr = await fetchSafe(apiUrl, timeoutMs, { "Accept": "application/json" });
        if (sr && sr.ok) {
          const sj = await sr.json();
          const items = sj?.items || [];
          if (items.length) {
            const answersText = items
              .map(a => htmlToCleanText(a.body || ""))
              .filter(Boolean)
              .join("\n\n")
              .replace(ZERO_WIDTH, "")
              .slice(0, 12000);
            if (answersText.length >= 80) {
              const out = { title: "", text: answersText, url };
              extractCacheSet(url, out);
              return out;
            }
          }
        }
      } catch {}
    }

    // v12 + v15: Wikipedia → tam məqalə plain text + infobox/wikitable cədvəlləri
    const wikiUrl = wikiExtractUrl(url);
    if (wikiUrl) {
      try {
        const wr = await fetchSafe(wikiUrl, timeoutMs, { "User-Agent": WIKI_UA, "Accept": "application/json" });
        if (wr && wr.ok) {
          const wj = await wr.json();
          const pages = wj?.query?.pages || {};
          const page = Object.values(pages).find(p =>
            p && !p.missing && p.extract && String(p.extract).trim().length >= 60
          );
          if (page) {
            const bodyText = String(page.extract).replace(ZERO_WIDTH, "").trim();
            let tableText = "";
            const isShortListArticle = bodyText.length < 2200;
            const wantsFacts = WIKI_TABLE_NEED_RE.test(query || "");
            if (isShortListArticle || wantsFacts) {
              try {
                const pUrl = wikiParseTablesUrl(url, isShortListArticle);
                if (pUrl) {
                  const pr = await fetchSafe(pUrl, Math.min(1800, timeoutMs), { "User-Agent": WIKI_UA, "Accept": "application/json" });
                  if (pr && pr.ok) {
                    const pj = await pr.json();
                    tableText = extractWikiTablesHtml(pj?.parse?.text?.["*"] || "");
                  }
                }
              } catch {}
            }
            const combined = tableText
              ? `${bodyText.slice(0, 1400)}\n\n${tableText}\n\n${bodyText.slice(1400, 30000)}`
              : bodyText.slice(0, 32000);
            const out = {
              title: (page.title || "").slice(0, 200),
              text: combined,
              url
            };
            extractCacheSet(url, out);
            return out;
          }
        }
      } catch {}
    }

    // v17 (Alim özəlliyi): saytları açanda sorğunun dilində Accept-Language göndər
    // (Google Translate kimi çoxdilli saytlar birbaşa həmin dildə başlıq və ön-izləmə qaytarır!)
    let fetchUrl = url;
    try {
      const tu = new URL(url);
      if (/^translate\.google\./i.test(tu.hostname) && !tu.searchParams.has("hl") && lang) {
        tu.searchParams.set("hl", lang);
        fetchUrl = tu.toString();
      }
    } catch {}

    const res = await fetchSafe(fetchUrl, timeoutMs, { "Accept-Language": acceptLanguageHeader(lang) });
    if (!res || !res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    const cl = Number(res.headers.get("content-length") || 0);
    if (cl > 2_000_000) return null;
    const html = await res.text();
    if (!html || html.length < 400 || html.length > 2_000_000) return null;

    const { document } = parseHTML(html);
    const pageDates = extractPageDates(document);
    const metaEl = document.querySelector('meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]');
    const metaDesc = (metaEl?.getAttribute("content") || "").replace(ZERO_WIDTH, "").replace(/\s+/g, " ").trim();
    let text = "";
    let title = (document.title || "").replace(ZERO_WIDTH, "");
    try {
      const reader = new Readability(document, { charThreshold: 80 });
      const article = reader.parse();
      if (article && article.textContent && article.textContent.length > 200) {
        text = article.textContent;
        title = (article.title || title).replace(ZERO_WIDTH, "");
      }
    } catch {}

    if (!text) {
      document.querySelectorAll("script,style,noscript,nav,footer,header,aside,form,iframe,svg").forEach(el => el.remove());
      const paras = Array.from(document.querySelectorAll("p, h1, h2, h3, h4, li, blockquote"))
        .map(el => {
          const tag = (el.tagName || "").toLowerCase();
          const raw = (el.textContent || "").trim();
          const minLen = tag === "li" ? 15 : 35;
          return raw.length >= minLen ? raw : "";
        })
        .filter(Boolean);
      text = [...new Set(paras)].join("\n\n");
    }

    text = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    text = text.replace(ZERO_WIDTH, "");
    // v17: İnteraktiv veb-xidmətlərdə (Google Tərcümə, oyun/alət səhifələri) body qısadırsa və ya WebGL/klaviatura xətasıdırsa,
    // rəsmi yerli ön-izləməni (<meta name="description">) əsas məzmun kimi qaytar!
    if (WEB_APP_ERROR_RE.test(text)) {
      text = metaDesc.length >= 30 ? metaDesc : "";
    } else if (text.length < 120 && metaDesc.length >= 35) {
      text = metaDesc;
    }
    if (text.length < 35) return null;
    const out = {
      title: title.slice(0, 200),
      text: text.slice(0, 20000),
      meta_description: metaDesc.length >= 35 ? metaDesc.slice(0, 400) : null,
      url,
      published_at: pageDates.publishedAt || null,
      updated_at: pageDates.updatedAt || null
    };
    extractCacheSet(langKey, out);
    return out;
  } catch {
    return null;
  }
}
