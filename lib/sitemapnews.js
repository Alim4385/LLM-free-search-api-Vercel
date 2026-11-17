// Sitemap-based AZ news sources (keyless, pulsuz).
// Səbəb: bu saytların daxili axtarışı yoxdur/bağlıdır, AMMƏ sitemap açıqdır və hər xəbərin
// URL slug-unda başlıq var (".../news/uefa-milletler-liqasi-danimarka-norvecle-..."), üstəlik
// məqalə səhifəsində og:title / og:description / article:published_time / og:image durur.
// Ona görə: sitemap-dən linkləri yığ → slug üzrə sorğuya uyğunlaşdır → məqaləni aç → OG parse.
//
// Yoxlanılıb (2026-11-18, adi GET, Chrome UA):
//   icma.az/news/sitemap.xml        → 200, 205 KB, lastmod ±04:00, ~4.5 s
//   iqtisadiyyat.az/sitemap-news.xml→ 200, 108 KB, news:publication_date, ~1.2 s
//   baku.ws/sitemap.xml             → 403 Cloudflare JS challenge → İSTİFADƏ OLUNMUR
import { normalizeAz } from "./rank.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const SITEMAP_SOURCES = [
  { name: "icma", host: "icma.az", url: "https://icma.az/news/sitemap.xml", lang: "az" },
  { name: "iqtisadiyyat", host: "iqtisadiyyat.az", url: "https://iqtisadiyyat.az/sitemap-news.xml", lang: "az" }
];

const TTL = 10 * 60 * 1000;        // 10 dəq təzə
const STALE_MAX = 3 * 60 * 60 * 1000;
const CACHE = new Map();   // name -> { t, items }
const BLOCK = new Map();   // name -> timestamp
const INFLIGHT = new Map();// name -> Promise
const MAX_ITEMS = 400;     // sayt başına ən son 400 xəbər

const decodeEnt = (s) => String(s || "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, "\"").replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

// XML sitemap → [{url, lastmod, slugWords}]
export function parseSitemap(xml) {
  const out = [];
  const re = /<url>([\s\S]*?)<\/url>/g;
  let m;
  while ((m = re.exec(String(xml || ""))) && out.length < MAX_ITEMS + 50) {
    const block = m[1];
    const loc = (block.match(/<loc>\s*([^<]+?)\s*<\/loc>/) || [])[1];
    if (!loc || !/^https?:\/\//.test(loc)) continue;
    const lastmod = (block.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/) || [])[1] || null;
    const newsDate = (block.match(/<news:publication_date>\s*([^<]+?)\s*<\/news:publication_date>/) || [])[1] || null;
    const slug = loc.split("/").filter(Boolean).pop() || "";
    const slugWords = normalizeAz(decodeEnt(slug).replace(/-\d+$/, "").replace(/[-_]+/g, " "))
      .split(/[^a-z0-9]+/).filter(w => w.length >= 3);
    out.push({ url: loc, lastmod: newsDate || lastmod, slugWords });
  }
  // ən təzə əvvəldə
  out.sort((a, b) => String(b.lastmod || "").localeCompare(String(a.lastmod || "")));
  return out.slice(0, MAX_ITEMS);
}

// Sorğu ↔ slug uyğunluğu (slug transliterasiya olunmuş başlıqdır)
const STOP = new Set(["son", "bu", "gun", "gün", "ve", "və", "ile", "ilə", "ucun", "üçün", "ne", "nə",
  "nece", "necə", "olan", "olub", "haqqinda", "haqqında", "dair", "nelerdir", "kimdir", "hansidir",
  "the", "and", "for", "with", "about", "news", "what", "how"]);

export function matchSitemapItems(items, query, count = 4) {
  const terms = [...new Set(normalizeAz(query).split(/[^a-z0-9əğıöşüç]+/).filter(w => w.length >= 4 && !STOP.has(w)))];
  if (!terms.length) return [];
  const scored = [];
  for (const it of items) {
    const words = it.slugWords;
    if (!words.length) continue;
    let hits = 0;
    for (const t of terms) {
      const stem = t.slice(0, Math.max(4, t.length - 2));
      if (words.some(w => w.startsWith(stem) || stem.startsWith(w.slice(0, Math.max(4, w.length - 2))))) hits++;
    }
    if (!hits) continue;
    // tək ümumi söz kifayət deyil — ən azı 2 uyğunluq, ya da 1 uyğunluq + uzun söz
    const strong = terms.some(t => t.length >= 7 && words.some(w => w.startsWith(t.slice(0, 5))));
    if (hits < 2 && !strong) continue;
    scored.push({ it, rank: hits * 10 + (it.lastmod ? 0 : -2) });
  }
  scored.sort((a, b) => b.rank - a.rank || String(b.it.lastmod || "").localeCompare(String(a.it.lastmod || "")));
  return scored.slice(0, count).map(x => x.it);
}

// məqalə HTML-indən OG/meta + ilk paraqraflar
export function parseArticleHtml(html) {
  const h = String(html || "");
  const meta = (prop) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']{0,400})`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']{0,400})["'][^>]*(?:property|name)=["']${prop}["']`, "i");
    return decodeEnt((h.match(re) || h.match(re2) || [])[1] || "");
  };
  const title = meta("og:title") ||
    decodeEnt(((h.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i) || [])[1] || "").replace(/<[^>]+>/g, "")).trim() ||
    decodeEnt(((h.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i) || [])[1] || "").replace(/<[^>]+>/g, "")).trim();
  let body = (h.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || [])[1] || "";
  if (!body) {
    // <article> yoxdursa: ən çox <p> olan div-i təxmin et
    const divs = h.match(/<div[^>]*>[\s\S]{200,20000}?<\/div>/gi) || [];
    let best = "";
    for (const d of divs) { const p = (d.match(/<p[\s>]/gi) || []).length; if (p >= 3 && d.length > best.length) best = d; }
    body = best;
  }
  const paras = (body.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [])
    .map(p => decodeEnt(p.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter(p => p.length >= 40);
  const text = paras.join("\n\n").slice(0, 2500);
  const desc = meta("og:description") || meta("description") || paras[0] || "";
  const raw = meta("article:published_time") || meta("datePublished") ||
    ((h.match(/<time[^>]*datetime=["']([^"']+)/i) || [])[1] || "");
  let published = null;
  if (raw) { const d = new Date(raw); if (!Number.isNaN(d.getTime())) published = d.toISOString(); }
  const image = meta("og:image") || "";
  return { title: title.slice(0, 200), description: desc.slice(0, 500), text, published_at: published, image: image.slice(0, 400) };
}

async function fetchFresh(source, ms, signal) {
  if (INFLIGHT.has(source.name)) return INFLIGHT.get(source.name);
  const sig = signal && source.name ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms);
  const p = (async () => {
    const res = await fetch(source.url, {
      headers: { "User-Agent": UA, Accept: "application/xml,text/xml,*/*", "Accept-Language": "az,en;q=0.8" },
      signal: sig
    });
    if (!res.ok) throw new Error(`${source.name} sitemap ${res.status}`);
    const items = parseSitemap(await res.text());
    if (items.length) CACHE.set(source.name, { t: Date.now(), items });
    return items;
  })().finally(() => INFLIGHT.delete(source.name));
  INFLIGHT.set(source.name, p);
  return p;
}

export async function fetchSitemapItems(source, ms = 3000, signal) {
  const c = CACHE.get(source.name);
  if (c && Date.now() - c.t < TTL) return c.items;
  if (c && Date.now() - c.t < STALE_MAX) {
    fetchFresh(source, 15000).catch(() => {});
    return c.items;
  }
  if ((BLOCK.get(source.name) || 0) > Date.now()) return [];
  // Sitemap böyükdür (icma.az 205 KB, ~4.5 s) və ümumi axtarış büdcəsi ~3.5 s-dir.
  // Ona görə: tam yükləmə ARXADA davam edir (INFLIGHT dedupe), cavabı isə qısa
  // yarışla gözləyirik. Vaxtında gəlməzsə "no results" atırıq — bu provayder xətası
  // sayılmır, keş isə növbəti sorğu üçün dolur.
  const bg = fetchFresh(source, 15000);
  bg.catch(() => { BLOCK.set(source.name, Date.now() + 5 * 60 * 1000); });
  const raced = await Promise.race([
    bg.catch(() => null),
    new Promise(r => setTimeout(() => r(null), Math.min(ms, 2200)))
  ]);
  if (raced && raced.length) return raced;
  if (c) return c.items;
  throw new Error("sitemap news no results");
}

async function enrich(item, source, ms, signal) {
  try {
    const res = await fetch(item.url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*", "Accept-Language": "az,en;q=0.8" },
      signal: signal ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms)
    });
    if (!res.ok) throw new Error(String(res.status));
    const a = parseArticleHtml(await res.text());
    if (!a.title) throw new Error("no title");
    return {
      title: a.title,
      url: item.url,
      snippet: a.description || a.text.slice(0, 300),
      content: a.text || undefined,
      source: source.host,
      // icma.az og:article:published_time-ı sorğu anına bərabər verir (dinamikdir) —
      // REAL tarix sitemap-in lastmod-undadır, ona görə o üstün tutulur
      published_at: item.lastmod || a.published_at || null,
      updated_at: null,
      image: a.image || undefined
    };
  } catch {
    // məqalə açılmadı — slug-dan başlıq düzəlt ki, heç olmasa link işləsin
    const title = (item.slugWords || []).join(" ");
    if (!title) return null;
    return {
      title: title.charAt(0).toUpperCase() + title.slice(1),
      url: item.url,
      snippet: "",
      source: source.host,
      published_at: item.lastmod || null,
      updated_at: null,
      slug_only: true
    };
  }
}

// Əsas giriş: sorğuya uyğun xəbərləri tap, məqalələri aç, OG ilə zənginləşdir
export async function searchSitemapNews(query, count = 4, signal, opts = {}) {
  const sitemapMs = opts.sitemapMs || 3000;
  const articleMs = opts.articleMs || 1500;
  const perSource = Math.max(1, Math.min(3, count));
  const lists = await Promise.all(SITEMAP_SOURCES.map(async (s) => {
    try {
      const items = await fetchSitemapItems(s, sitemapMs, signal);
      return matchSitemapItems(items, query, perSource).map(it => ({ it, s }));
    } catch { return []; }
  }));
  const picked = lists.flat().slice(0, count);
  if (!picked.length) throw new Error("sitemap news no match");
  const enriched = await Promise.all(picked.map(({ it, s }) => enrich(it, s, articleMs, signal)));
  const out = enriched.filter(Boolean);
  if (!out.length) throw new Error("sitemap news no results");
  return out;
}
