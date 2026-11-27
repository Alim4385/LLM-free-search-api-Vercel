import { isJunkDomain } from "./score.js";
// v97 — Yekun mərhələ (finalize): limitlər və təzəlik qaydaları tək yerdə.
// Blueprint-in "finalizeResponse()" tələbinin test oluna bilən hissəsi.
// Bu funksiyalar təmizdir (şəbəkə yoxdur) — unit testlə qorunur.

/**
 * max_results limitini tətbiq edir. Strukturlaşdırılmış cavablar (structured)
 * bundan SONRA unshift olunur, yəni limit ayrıca pozulmur.
 */
export function applyFinalLimits(results, maxResults) {
  const list = Array.isArray(results) ? results : [];
  const n = Math.max(1, Number(maxResults) || 5);
  return list.length > n ? list.slice(0, n) : list.slice();
}

// Ən yaxşı tarixsiz nəticənin xalı təzə-tarixlinin xalından bu qədər dəfə çoxdursa, tarixsizlər saxlanılır.
export const UNDATED_STRONGER = 1.5;

/**
 * freshness=day|week|month verildikdə:
 *  - tarixi təsdiqlənməyən (published_at yoxdur) nəticə "təzə" sayılmır;
 *  - lakin ən azı 2 tarixli nəticə yoxdursa, boş cavab verməmək üçün saxlanılır.
 * Tarix `published_at`-dan oxunur; `fetched_at` (bizim yükləmə vaxtımız) təzəlik sayılmır.
 */
export function filterByFreshness(results, freshness, now = Date.now(), sourceDates = {}) {
  const list = Array.isArray(results) ? results : [];
  if (!freshness || freshness === "any") return { results: list.slice(), dropped: 0, droppedUndated: 0, undatedKept: 0, applied: false };
  const days = freshness === "day" ? 2 : freshness === "week" ? 9 : freshness === "month" ? 40 : 400;
  const dateOf = (r) => {
    const raw = r && (r.published_at || sourceDates[r && r.url] || null);
    const t = Date.parse(raw || "");
    return Number.isNaN(t) ? null : t;
  };
  const scoreOf = (r) => (Number.isFinite(Number(r && r.score)) ? Number(r.score) : 0);
  const dated = list.filter(r => dateOf(r) !== null);
  const freshDated = dated.filter(r => (now - dateOf(r)) / 86400000 <= days);
  const undated = list.filter(r => dateOf(r) === null);
  // v118: tarixsiz nəticələr YALNIZ aşağıdakı hallarda atılır:
  //  - ən azı 2 tarixli nəticə var VƏ
  //  - tarixli nəticələr tarixsizlərdən açıq şəkildə zəif deyil (ən yaxşı tarixsizin xalı
  //    ən yaxşı təzə-tarixlinin xalından UNDATED_STRONGER dəfə çox deyil).
  // Səbəb: 2 təsadüfi tarixli nəticə (məs. Bing RSS-dən USA Today/CNN ana səhifəsi) real, uyğun,
  // lakin tarixsiz mənbələri sıxışdırıb çıxarmasın.
  const bestUndated = undated.reduce((m, r) => Math.max(m, scoreOf(r)), 0);
  const bestFresh = freshDated.reduce((m, r) => Math.max(m, scoreOf(r)), 0);
  const undatedClearlyStronger = bestUndated > 0 && bestUndated > bestFresh * UNDATED_STRONGER;
  const keepUndated = dated.length < 2 || undatedClearlyStronger;
  const out = [];
  let dropped = 0, droppedUndated = 0, undatedKept = 0;
  for (const r of list) {
    const t = dateOf(r);
    if (t === null) {
      if (keepUndated) { out.push(r); undatedKept++; } else { dropped++; droppedUndated++; }
      continue;
    }
    if ((now - t) / 86400000 <= days) out.push(r);
    else dropped++;
  }
  return { results: out, dropped, droppedUndated, undatedKept, applied: true };
}

// v122: junk domen (instagram/facebook/tiktok/x/twitter…) xalı 0-a düşür, amma nəticə SİLİNMİRDİ:
// namizəd azdırsa "doldurucu" kimi siyahıda qalırdı (türkcə xəbər sorğusunda Instagram profili #5).
// Qayda: junk olmayan ən azı `minKeep` nəticə varsa, junk domenlər çıxarılır.
// İstisna: sorğuda saytın öz adı keçirsə ("instagram giriş") toxunulmur.
export function dropJunkDomains(results, query = "", minKeep = 3) {
  const list = Array.isArray(results) ? results : [];
  const q = String(query || "").toLowerCase();
  const brandInQuery = (url) => {
    try {
      const labels = new URL(url).hostname.replace(/^www\./, "").toLowerCase().split(".");
      const brand = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
      return brand.length >= 3 && q.includes(brand);
    } catch { return false; }
  };
  const isJunk = (r) => !!(r && isJunkDomain(r.url)) && !brandInQuery(r.url);
  const keep = list.filter(r => !isJunk(r));
  if (keep.length < minKeep) return { results: list.slice(), dropped: 0 };
  return { results: keep, dropped: list.length - keep.length };
}

// v126: YERLİ XƏBƏR KVOTASI. Tək provayderdən gələn real, təzə məqalə (ru-news/az-news/azertag) 2-3 provayderin "səs"ini
// toplayan hub/bölmə səhifələri (reuters.com/world/russia/, aljazeera.com/where/russia/) qarşısında itirdi.
// Qayda: xəbər sorğusunda ilk `maxResults`-da ən azı `quota` yerli-mənbə nəticəsi olmalıdır (əgər namizəd varsa).
// Yerli nəticələr ən aşağı xallı qeyri-yerli nəticələrin yerinə keçir; sonra yenidən xala görə sıralanır.
export const NATIVE_NEWS_SOURCES = ["az-news", "ru-news", "azertag"];
export function promoteNativeNews(results, maxResults, { quota = 2, sources = NATIVE_NEWS_SOURCES } = {}) {
  const list = Array.isArray(results) ? results.slice() : [];
  const max = Math.max(1, Number(maxResults) || 1);
  const isNative = (r) => !!r && (sources.includes(r.source) || (Array.isArray(r.providers) && r.providers.some((p) => sources.includes(p))));
  const scoreOf = (r) => Number(r && r.score) || 0;
  const head = list.slice(0, max);
  const have = head.filter(isNative).length;
  if (have >= quota) return list;
  const tail = list.slice(max).filter(isNative).sort((a, b) => scoreOf(b) - scoreOf(a));
  const need = Math.min(quota - have, tail.length);
  if (need <= 0) return list;
  const victims = head.map((r, i) => ({ r, i })).filter((x) => !isNative(x.r)).sort((a, b) => scoreOf(a.r) - scoreOf(b.r)).slice(0, need);
  if (!victims.length) return list;
  const dropIdx = new Set(victims.map((v) => v.i));
  const promoted = tail.slice(0, victims.length);
  const newHead = head.filter((_, i) => !dropIdx.has(i)).concat(promoted).sort((a, b) => scoreOf(b) - scoreOf(a));
  const usedTail = new Set(promoted);
  const rest = list.slice(max).filter((r) => !usedTail.has(r)).concat(victims.map((v) => v.r));
  return [...newHead, ...rest];
}

// v131: "последние новости" / "latest" / "son dakika" sorğusunda 1 ildən köhnə nəticə (canlı trace: 2022-ci il CBC məqaləsi gate_relaxed ilə
// "doldurucu" kimi qaytarılırdı) atılır — YALNIZ daha təzə nəticə qalırsa (siyahı boşalmasın). Tarixsiz nəticələrə toxunulmur.
export const RECENCY_CUE_RE = /(?<![\p{L}])(последн\p{L}*|свеж\p{L}*|сегодня|сейчас|latest|breaking|newest|today|tonight|güncel|bugün|bu\s*gün|son\s+dakika|son\s+x[əe]b[əe]r\p{L}*|hazırda)(?![\p{L}])/iu;
export function dropStaleForRecency(results, query, { maxAgeDays = 365, now = Date.now() } = {}) {
  const list = Array.isArray(results) ? results.slice() : [];
  if (!RECENCY_CUE_RE.test(String(query || ""))) return { results: list, dropped: 0 };
  const ageDays = (r) => { const t = Date.parse((r && r.published_at) || ""); return Number.isNaN(t) ? null : (now - t) / 86400000; };
  const fresh = list.filter((r) => { const a = ageDays(r); return a === null || a <= maxAgeDays; });
  if (!fresh.length || fresh.length === list.length) return { results: list, dropped: 0 };
  return { results: fresh, dropped: list.length - fresh.length };
}
