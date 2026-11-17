// AZƏRTAC (azertag.az) — Azərbaycan Dövlət İnformasiya Agentliyi.
// Niyə ayrı modul: saytın HTML axtarış səhifəsi Cloudflare ilə bloklanır (/az/search → 403),
// AMMA /rss açıqdır və 3 dildə işləyir: /rss (az), /ru/rss, /en/rss — hər biri son 50 xəbər.
// Key yoxdur, limit yoxdur. 5 dəqiqə keş → sorğu başına əlavə yük yox.
// Nəticə: "son xəbərlər", "bu gün idmanda", konkret hadisə suallarında rəsmi dövlət agentliyi
// mənbəyi axtarış motorlarının buraxdığı yerdə də cavab verir.
import { XMLParser } from "fast-xml-parser";
import { normalizeAz } from "./rank.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const FEEDS = {
  az: "https://azertag.az/rss",
  ru: "https://azertag.az/ru/rss",
  en: "https://azertag.az/en/rss"
};
const TTL = 5 * 60 * 1000;        // təzə sayılan müddət
const STALE_MAX = 60 * 60 * 1000; // köhnə olsa da verilir (sayt yavaşdır: 1-12 s arası dəyişir)
const CACHE = new Map(); // lang -> { t, items }
const BLOCK = new Map(); // lang -> timestamp
const INFLIGHT = new Map(); // lang -> Promise

function parseFeed(xml, lang) {
  const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });
  let j;
  try { j = parser.parse(xml); } catch { return []; }
  const raw = j?.rss?.channel?.item;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  for (const it of arr) {
    const title = String(it.title || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const link = String(it.link || "").trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    const desc = String(it.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    let published = null;
    const pd = it.pubDate ? new Date(it.pubDate) : null;
    if (pd && !Number.isNaN(pd.getTime())) published = pd.toISOString();
    out.push({ title: title.slice(0, 200), url: link, snippet: desc.slice(0, 500), source: "azertag", published_at: published, lang });
  }
  return out;
}

async function fetchFresh(lang, ms, signal) {
  if (INFLIGHT.has(lang)) return INFLIGHT.get(lang);
  const sig = signal ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms);
  const p = (async () => {
    const res = await fetch(FEEDS[lang], { headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml,*/*" }, signal: sig });
    if (!res.ok) throw new Error("azertag " + res.status);
    const xml = await res.text();
    const items = parseFeed(xml, lang);
    if (items.length) CACHE.set(lang, { t: Date.now(), items });
    return items;
  })().finally(() => INFLIGHT.delete(lang));
  INFLIGHT.set(lang, p);
  return p;
}

// Saytın cavab müddəti 1 s-dən 12 s-ə qədər dəyişir → "stale-while-revalidate":
// əlimizdə köhnə nüsxə varsa DƏRHAL onu veririk, yeniləmə arxa planda gedir.
export async function fetchAzertagFeed(lang = "az", ms = 1600, signal) {
  const l = FEEDS[lang] ? lang : "az";
  const c = CACHE.get(l);
  if (c && Date.now() - c.t < TTL) return c.items;
  if (c && Date.now() - c.t < STALE_MAX) {
    fetchFresh(l, 12000).catch(() => {});
    return c.items;
  }
  if ((BLOCK.get(l) || 0) > Date.now()) return [];
  try {
    const items = await fetchFresh(l, ms, signal);
    if (items.length) return items;
  } catch (e) {
    if (c) return c.items;
    BLOCK.set(l, Date.now() + 120000);
    throw e;
  }
  if (c) return c.items;
  throw new Error("azertag no results");
}

// Sorğu sözləri ilə başlıq/təsvir uyğunluğu. AZ üçün diakritik normalizasiyası ilə.
const STOP = new Set(["son", "bu", "gun", "gün", "ve", "və", "ile", "ilə", "ucun", "üçün", "ne", "nə", "necə", "nece", "olan", "olub", "haqqinda", "haqqında", "dair", "the", "and", "for", "with", "about", "news"]);

export function matchAzertagItems(items, query, count = 6) {
  const terms = [...new Set(
    normalizeAz(query).split(/[^a-z0-9əğıöşüç]+/).filter(w => w.length >= 4 && !STOP.has(w))
  )];
  if (!terms.length) return [];
  const scored = [];
  for (const it of items) {
    const blob = normalizeAz(`${it.title} ${it.snippet}`);
    let hits = 0;
    for (const t of terms) if (blob.includes(t.slice(0, Math.max(4, t.length - 2)))) hits++;
    if (!hits) continue;
    // başlıqda uyğunluq daha dəyərli
    const titleBlob = normalizeAz(it.title);
    const titleHits = terms.filter(t => titleBlob.includes(t.slice(0, Math.max(4, t.length - 2)))).length;
    // sərt şərt: ya başlıqda uyğunluq, ya da ən azı 2 söz uyğunluğu (təsadüfi xəbər girməsin)
    if (titleHits < 1 && hits < 2) continue;
    scored.push({ it, rank: titleHits * 2 + hits - (it.published_at ? 0 : 1) });
  }
  scored.sort((a, b) => b.rank - a.rank || String(b.it.published_at || "").localeCompare(String(a.it.published_at || "")));
  return scored.slice(0, count).map(x => x.it);
}

export async function searchAzertag(query, count = 6, lang = "az", signal) {
  let items = [];
  try {
    items = await fetchAzertagFeed(lang, 1600, signal);
  } catch {
    // /ru/rss və /en/rss arabir cavab vermir → AZ feed-inə düş (nəticələr sonra tərcümə olunur)
    if (lang !== "az") { try { items = await fetchAzertagFeed("az", 1600, signal); } catch { items = []; } }
  }
  if (!items.length) throw new Error("azertag no results");
  const matched = matchAzertagItems(items, query, count);
  if (!matched.length) throw new Error("azertag no match");
  return matched;
}

// Sualın dilinə uyğun feed: az → az, ru → ru, en → en
export function azertagLangFor(qLang) {
  return qLang === "ru" ? "ru" : qLang === "en" ? "en" : "az";
}
