# v127 — v126 canlı test: ru-news indi `providers_used`-dadır, amma nəticələrə düşmür

## v126 canlı nəticə (`последние новости России`)
`provider_diag["ru-news"]`: `early: "enough"`, `total_ms: 781`, `matched: 8`; `providers_used` içində `ru-news` ✅ (straggler bagı həll olundu). Amma son 5 nəticədə rus mənbə yox idi və `native_news_promoted` görünmürdü.

## Kök səbəb (tam handler simulyasiyası ilə tapıldı — stub RSS + stub səhifələr)
Namizəd pulu 15 (8 hub + 7 ru-news), `filtered` (7) içində 2 ru-news var idi, AMMA:
1. `route.js` fetch dövrü ilk `maxResults` (5) uğurlu nəticədən sonra dayanır → 6–7-ci yerdəki ru-news heç oxunmurdu;
2. v126 kvotası yalnız `finalResults.length > maxResults` olanda işləyirdi, amma `finalResults` artıq 5 idi (`DBG_FINAL n=5`) → heç vaxt işə düşmürdü.

## Düzəliş
`route.js`: kvota `scoredDedup` (tam pul) üzərindən, `diversifyByDomain`-dən SONRA və fetch-dən ƏVVƏL, **ilk `maxResults`** üzərində tətbiq olunur (`promoteNativeNews([...filtered, ...poolRest], maxResults, { quota: 2 })`). `degraded_stages`: `native_news_candidates`.
Simulyasiya: əvvəl 4 hub + 1 ru-news → indi 3 hub + 2 ru-news.

## Test
`tests/unit-tests.mjs`: tam handler inteqrasiya testi (stub fetch ilə: 4 RSS feed + 8 hub + məqalə səhifələri). **Düzəlişsiz 2 uğursuz** (`native=1`, `native_news_candidates` yox), düzəlişlə 778 keçir.

## Bilinən məhdudiyyətlər
- Kvota siyasətdir (`quota: 2`, `promoteNativeNews`): hub səhifələri əvəzinə yerli xəbərlər görünür.
- Simulyasiyada hub xalları canlıdan aşağıdır (3.5–3.6 vs canlıda 5.5–7.2); kvota xal fərqindən asılı deyil, amma canlı davranış yoxlanmalıdır.
- Hub səhifə cəzası (`v57.3`) `/world/russia/` kimi 2 seqmentli yolları hələ də tutmur.
