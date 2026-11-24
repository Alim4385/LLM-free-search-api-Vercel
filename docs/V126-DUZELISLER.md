# v126 — `provider_diag` bagın səbəbini göstərdi: ru-news "straggler" idi

## v125 canlı test (`последние новости России`)
`meta.provider_diag["ru-news"]`: `ria.ru` ✅ 20 xəbər (526 ms), `kommersant.ru` ✅ 353 (1089 ms), `vedomosti.ru` ✅ 200 (794 ms), `meduza.io` ✅ 30 (435 ms), `lenta.ru` ❌ timeout (1803 ms). `state: done`, `items: 603`, **`matched: 10`** — amma son 5 nəticədə rus mənbə yox, `ru-news` `providers_used`-da da yox.

## Kök səbəb
`search.js` `collect()`: `if (pending <= stragglersAllowed && Date.now() - t0 >= 1100) finish();` — 1100 ms-dən sonra tapşırıqların ≤20%-i bitməyibsə gözləmədən davam edir. `ru-news` ən yavaş feed-i (lenta.ru, 1803 ms) gözlədiyi üçün straggler olurdu, nəticəsi səssizcə atılırdı (nə `providers_used`, nə `provider_errors`).

## Düzəlişlər
| # | Dəyişiklik |
|---|-----------|
| 1 | `searchRuNews`: **≥3 feed hazırdırsa** (`early: "enough"`) və ya **800 ms keçibsə və ≥1 feed hazırdırsa** (`early: "grace"`) gözləmədən qayıdır. Yavaş feed-lər arxa planda davam edib 5 dəq keşi doldurur. `diag.early`: `enough \| grace \| all \| overall_timeout` |
| 2 | `promoteNativeNews` (`finalize.js`) + `route.js`: xəbər sorğusunda ilk `maxResults`-da ən azı **2 yerli-mənbə** (`ru-news`, `az-news`, `azertag`) nəticəsi olmalıdır (namizəd varsa). Yerlilər ən aşağı xallı qeyri-yerli nəticələrin yerinə keçir; sonra xala görə yenidən sıralanır; heç nə itmir. `degraded_stages`: `native_news_promoted` |

## Niyə kvota?
Tək provayderdən gələn real, təzə məqalə 2-3 provayderin "səsi"ni (`voteCount`) toplayan hub səhifələri (reuters.com/world/russia/, aljazeera.com/where/russia/) qarşısında itir. Mock-da ru-news məqaləsi 4.6, canlıda hub-lar 5.5–7.2 idi. Xal kalibrasiyası əvəzinə kvota seçildi (xal kalibrasiyası canlı data olmadan təxminidir).

## Bilinən məhdudiyyətlər
- Kvota yalnız yerli nəticə `finalResults`-a düşübsə (gating/xal keçibsə) işləyir.
- Kvota siyasətdir: hub səhifələri əvəzinə yerli xəbərlər görünür. Dəyişmək üçün `quota` (defolt 2).
- Hub səhifə cəzası (`v57.3`, `segs.length <= 1 || pth.length < 12`) `/world/russia/` kimi 2 seqmentli yolları tutmur; toxunulmayıb.
- `lenta.ru` canlıda timeout verir (1.8 s); `RU_NEWS_FEEDS` ilə dəyişdirilə bilər.
- Canlı provayderlərlə yoxlanmayıb (772 unit test + yerli smoke).
