// v123: rusdilli xəbər RSS-ləri. Niyə: "новости Москва сегодня" sorğusunda bütün rus mənbələri əskik idi —
// nəticələr yalnız qlobal ingilisdilli etiket/hub səhifələri (silicon.co.uk/tag, apnews.com/hub) olurdu.
// Dizayn azertag.js ilə eynidir: açar yoxdur, 5 dəq keş, köhnə nüsxə (stale) saxlanılır, hər feed ayrıca xəta verə bilər.
//
// ⚠️ Feed ünvanları üçüncü tərəf siyahılardan (Feeder, infomate boards.yml) götürülüb, CANLIDA yoxlanmayıb.
// Bəzi rusiya saytları xarici/cloud IP-lərini bloklaya bilər → hər feed fail-soft-dur; RU_NEWS_FEEDS ilə dəyişdirilə bilər:
//   RU_NEWS_FEEDS="https://lenta.ru/rss,https://ria.ru/export/rss2/index.xml"
import { XMLParser } from "fast-xml-parser";
import { decodeEntities } from "./entities.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const DEFAULT_RU_FEEDS = [
  "https://lenta.ru/rss",
  "https://ria.ru/export/rss2/index.xml",
  "https://www.kommersant.ru/RSS/news.xml",
  "https://vedomosti.ru/rss/news",
  "https://meduza.io/rss/all"
];
const TTL = 5 * 60 * 1000;
const STALE_MAX = 60 * 60 * 1000;
const FEED_TIMEOUT_MS = 1800;
const PER_FEED_CAP = 3; // nəticədə bir saytdan ən çox 3 xəbər (müxtəliflik)
const CACHE = new Map();    // url -> { t, items }
const INFLIGHT = new Map(); // url -> Promise

export function ruFeedUrls(env = (typeof process !== "undefined" ? process.env : {})) {
  const raw = String((env && env.RU_NEWS_FEEDS) || "").trim();
  const list = raw ? raw.split(",").map((s) => s.trim()).filter((u) => /^https?:\/\//i.test(u)) : [];
  return list.length ? list : DEFAULT_RU_FEEDS;
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, " "), { angle: false }).replace(/\s+/g, " ").trim();
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }

// RSS 2.0 (rss.channel.item) və RDF (rdf:RDF.item) formatları
export function parseRssItems(xml, feedUrl = "") {
  const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });
  let j;
  try { j = parser.parse(xml); } catch { return []; }
  const raw = j?.rss?.channel?.item ?? j?.["rdf:RDF"]?.item;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  for (const it of arr) {
    const title = stripTags(it.title);
    const link = String(it.link || it.guid || "").trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    const snippet = stripTags(it.description);
    let published = null;
    const pd = it.pubDate ? new Date(it.pubDate) : (it["dc:date"] ? new Date(it["dc:date"]) : null);
    if (pd && !Number.isNaN(pd.getTime())) published = pd.toISOString();
    out.push({ title: title.slice(0, 200), url: link, snippet: snippet.slice(0, 500), source: "ru-news", published_at: published, feed: hostOf(feedUrl) || hostOf(link) });
  }
  return out;
}

async function fetchFeed(url, ms, signal) {
  const hit = CACHE.get(url);
  if (hit && Date.now() - hit.t < TTL) return hit.items;
  if (INFLIGHT.has(url)) return INFLIGHT.get(url);
  const sig = signal ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms);
  const p = (async () => {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml,*/*" }, signal: sig });
      if (!res.ok) throw new Error("ru-news " + res.status);
      const items = parseRssItems(await res.text(), url);
      if (items.length) CACHE.set(url, { t: Date.now(), items });
      return items;
    } catch (e) {
      // köhnə nüsxə varsa (≤1 saat) onu ver — sayt bu an cavab vermirsə də nəticə itməsin
      if (hit && Date.now() - hit.t < STALE_MAX) return hit.items;
      throw e;
    }
  })().finally(() => INFLIGHT.delete(url));
  INFLIGHT.set(url, p);
  return p;
}

// ── uyğunlaşdırma ────────────────────────────────────────────────────────────
const RU_STOP = new Set([
  "новости", "новость", "новостей", "новостях", "сегодня", "сейчас", "последние", "последняя", "свежие", "главные",
  "актуальные", "срочно", "события", "что", "как", "где", "когда", "про", "это", "для", "или", "при", "все", "всё",
  "из", "на", "по", "за", "от", "до", "под", "над", "без", "его", "ещё", "уже", "так", "чем", "они", "она", "нас",
  "вас", "есть", "был", "была", "было", "были", "день", "дня"
]);
const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");
const stem = (t) => t.slice(0, Math.max(4, t.length - 2)); // "москва/москвы/москве/московский" → "моск"

export function ruQueryTerms(query) {
  return [...new Set(
    norm(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !RU_STOP.has(w))
  )];
}

export function matchRuNewsItems(items, query, count = 6) {
  const terms = ruQueryTerms(query);
  const list = Array.isArray(items) ? items : [];
  const byDateDesc = (a, b) => String(b.published_at || "").localeCompare(String(a.published_at || ""));
  let ranked;
  if (!terms.length) {
    // "последние новости" — konkret mövzu yoxdur → ən təzə xəbərlər
    ranked = list.slice().sort(byDateDesc).map((it) => ({ it, rank: 0 }));
  } else {
    ranked = [];
    for (const it of list) {
      const blob = norm(`${it.title} ${it.snippet}`);
      const titleBlob = norm(it.title);
      let hits = 0, titleHits = 0;
      for (const t of terms) {
        const st = stem(t);
        if (blob.includes(st)) hits++;
        if (titleBlob.includes(st)) titleHits++;
      }
      if (!hits) continue;
      // təsadüfi uyğunluq girməsin: 1 sözlü sorğuda 1 uyğunluq kifayətdir; çox sözlüdə başlıqda ya da ≥2 söz
      if (terms.length === 1 ? hits < 1 : (titleHits < 1 && hits < 2)) continue;
      ranked.push({ it, rank: titleHits * 2 + hits - (it.published_at ? 0 : 1) });
    }
    ranked.sort((a, b) => b.rank - a.rank || byDateDesc(a.it, b.it));
  }
  const perFeed = new Map();
  const seen = new Set();
  const out = [];
  for (const { it } of ranked) {
    if (seen.has(it.url)) continue;
    const n = perFeed.get(it.feed) || 0;
    if (n >= PER_FEED_CAP) continue;
    perFeed.set(it.feed, n + 1);
    seen.add(it.url);
    out.push(it);
    if (out.length >= count) break;
  }
  return out;
}

// v125: per-feed diaqnostika + ÜMUMİ vaxt büdcəsi.
// Niyə: canlıda ru-news `providers_attempted`-də görünürdü, amma nə nəticə, nə xəta qeydə alınırdı (task qlobal deadline-a
// qədər bitməyib və səssizcə atılıb ehtimalı). İndi (1) hər feed ayrıca ölçülür və `diag`-a yazılır,
// (2) ümumi büdcə (defolt 2600 ms) bitəndə hazır olan feed-lərin nəticəsi ilə davam edilir — heç nə asılı qalmır.
// diag formatı: { state, feeds: { "lenta.ru": { status: "pending|ok|error", ms, items?, error? } }, items?, matched?, total_ms? }
function shortErr(e) {
  const m = String((e && (e.message || e.name)) || e || "error");
  if (e && (e.name === "TimeoutError" || /timeout|aborted/i.test(m))) return "timeout";
  const code = m.match(/ru-news (\d{3})/);
  if (code) return "http_" + code[1];
  return m.replace(/\s+/g, " ").slice(0, 60);
}

export async function searchRuNews(query, count = 6, signal, feeds = ruFeedUrls(), diag = {}, opts = {}) {
  const feedMs = opts.feedTimeoutMs || FEED_TIMEOUT_MS;
  const overallMs = opts.overallMs || 2600;
  const t0 = Date.now();
  diag.state = "running";
  diag.feeds = {};
  const collected = [];
  const jobs = feeds.map((u) => {
    const host = hostOf(u) || u;
    diag.feeds[host] = { status: "pending" };
    const f0 = Date.now();
    return fetchFeed(u, feedMs, signal).then((items) => {
      diag.feeds[host] = { status: "ok", ms: Date.now() - f0, items: items.length };
      collected.push(...items);
    }).catch((e) => {
      diag.feeds[host] = { status: "error", ms: Date.now() - f0, error: shortErr(e) };
    });
  });
  let timer;
  const overall = new Promise((res) => { timer = setTimeout(() => res("overall_timeout"), overallMs); });
  const winner = await Promise.race([Promise.allSettled(jobs).then(() => "all_settled"), overall]);
  clearTimeout(timer);
  diag.total_ms = Date.now() - t0;
  diag.items = collected.length;
  if (winner === "overall_timeout") diag.overall_timeout = true;
  if (!collected.length) { diag.state = "failed"; throw new Error("ru-news no results"); }
  const matched = matchRuNewsItems(collected, query, count);
  diag.matched = matched.length;
  if (!matched.length) { diag.state = "failed"; throw new Error("ru-news no match"); }
  diag.state = "done";
  return matched;
}
