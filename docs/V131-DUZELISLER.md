# v131 — v130 canlı debug (26 Noyabr): trace-in göstərdikləri

## Canlı nəticə (`последние новости России #debug`, `engine_version: v130`)
3 nəticə, `confidence: medium`, `fallback: false`:
1. `meduza.io` — bu gün 19:07 (xal 5.4) ✅ real
2. `ria.ru` — bu gün (xal 1.4) ✅ real
3. `cbc.ca` — **2022-12-08** (xal 0.9), `revived: score_gates` (gate_relaxed ilə "doldurucu")

`search_timing`: `expand_ms: 87`, `wave1_limit_ms: 2806`, `wave1_ms: 1387` — pəncərə sağlamdır. `ru-news`: `early: enough` (429 ms), kommersant bu dəfə ok (710 xəbər, 1547 ms). `yahoo`: `cutoff` (late 9 xəbər, 1639 ms). `ddg-lite`: 403.

## Düzəlişlər
| # | Dəyişiklik |
|---|-----------|
| 1 | `dropStaleForRecency` (`finalize.js`) + `route.js`: "последние/свежие/latest/breaking/son dakika/bugün/son xəbər…" işarəli XƏBƏR sorğusunda >365 günlük nəticə atılır — yalnız daha təzə nəticə qalırsa (siyahı boşalmır); tarixsizlərə toxunulmur. `degraded_stages`: `stale_dropped`; trace mərhələsi `stale_for_recency_query` |
| 2 | `clean.js`: ria.ru "Краткий пересказ от РИА ИИ" etiketi mətndən silinir (mətnə yapışıq gəlir, cümlə səviyyəli silmə uyğun deyil) |
| 3 | Test: tam handler ssenarisi AYRI PROSESDƏ (`tests/sim-stale.mjs`) — modul keşləri (ru-news keşi, circuit breaker) və provayder keşi unit-test prosesində ssenarini dəyişirdi |

## Geri götürülən təcrübələr (nəticəyə faydası olmadı)
- **google-news istisnası** (xəbər sorğusunda `news.google.com/rss/articles/…` junk sayılmasın) + **fetch-i atlamaq**: xallar 0 → 0.2 / −1.2 oldu, `min_score_1.5`-in altında qaldı; biri `dropJunkDomains`-də yenə düşdü.
- **`.ru` ccTLD mövzu işarəsi** (ölkə adı terminləri + ölkə domeni → mövzu uyğunluğu): `news.mail.ru` 0 → −1.5; başlıq uyğunluğu da saysaq −4.3 (daha pis). Nəticəyə düşmədi.
Səbəb: xalı kimin cəzalandırdığı bilinmir (`scoreResult` xalın TƏRKİBİNİ göstərmir). Növbəti real addım: `explain`-ə xalın hissə-hissə tərkibi.

## Açıq qalanlar (trace-də görünür)
1. **google-news provayderi ölü yükdür:** 10/10 nəticə `junk_domain_or_auth_root` (JUNK_DOMAINS, v55.1). URL-lər redirectdir (`decodeGoogleNewsUrl` yeni formatı açmır). Seçimlər: provayderi xəbər dalğasından çıxarmaq və ya düzgün URL açmaq (batchexecute).
2. **`retry_simplified` yolu v128 gating-indən yan keçir:** simulyasiyada `abcnews.com` (xal 4.8) təkrar-axtarış yolu ilə nəticəyə düşür.
3. `news.mail.ru`, `dw.com/ru` kimi real rusdilli xəbərlər literal `росс` termini olmadığı üçün düşür (yuxarıdakı təcrübə həll etmədi).
4. `yahoo` provayderi 1639 ms-də gəlir, `collect` 1334 ms-də bağlanır.
5. Rus xəbər saytlarının ana səhifələri mənfi xal alır (hub/tarixsiz cəzaları).

## Test
848 keçir (+19). Route hook-u olmadan 3 inteqrasiya testi uğursuz olur.
