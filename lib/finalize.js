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
