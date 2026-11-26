# v130 — debug trace ilk dəfə kök səbəbi göstərdi: provayder pəncərəsi sıxılırdı

## Canlı debug (`последние новости России #debug`, v129)
Nəticə: cəmi 1 nəticə (2022-ci il CBC). Trace:
- **9 provayderin 6-sı `cutoff`**, hamısında `cutoff_after_ms: 595` (ddg-lite, yahoo, brave, ru-news, google-news, bing-news). `ru-news`: `late: { n: 6, ms: 828 }` — 6 xəbərlə gəldi, **atıldı**.
- `ru-news` feed-ləri `timeout` (613/817/823 ms) göstərirdi — əslində stage bağlananda abort olunmuşdular, real timeout (1800 ms) deyil.
- 30 raw namizəddən 30-u `min_score_1.5`-də düşdü; yalnız `gate_relaxed` 2-ni geri qaytardı (CBC 2022 + news.rin.ru).
- Əvvəlki sınaqda (v128) eyni sorğu 3 real rus xəbəri vermişdi → **nəticə yarış vəziyyətindən asılı idi**.

## Kök səbəb
`search.js`: `BUDGET_MS = 3200` bütün axtarış mərhələsinə (tərcümə daxil) verilir; 1-ci mərhələnin provayder pəncərəsi `Math.min(3400, left() - 300)`. Tərcümə/hazırlıq büdcənin çoxunu yeyəndə provayderlərə ~600 ms qalır (`cutoff_after_ms: 595` = pəncərənin sonu) və 600 ms-dən yavaş hər provayder (ru-news, yahoo, brave, google-news, bing-news) atılır. Tərcümə sürətli olanda yetişir, yavaş olanda yox → hər sınaqda fərqli nəticə.
(Bu, `cutoff_after_ms` ilə pəncərə formulunun üst-üstə düşməsindən çıxarılıb; birbaşa ölçülməyib — yeni `debug.search_timing` ilə təsdiqlənməlidir.)

## Düzəlişlər
| # | Dəyişiklik |
|---|-----------|
| 1 | `wave1Limit(left)`: provayderlərə HƏMİŞƏ ≥1600 ms (`min(3400, max(1600, left-300))`) |
| 2 | `debug.search_timing`: `expand_ms`, `left_before_wave1_ms`, `wave1_limit_ms`, `wave1_ms` — pəncərənin niyə sıxıldığını bir sorğuda göstərir |
| 3 | `ru-news`: `minFeeds` 3→2, `graceMs` 800→500 (ria+meduza ~0.5 s) |
| 4 | `ru-news` feed xətası stage abort-undan olubsa `aborted_by_stage_cutoff` (əvvəl səhv "timeout") |
| 5 | `trace` namizədlərində başlıq (`t`, ≤70 simvol) |
| 6 | Rus sayt UI zibili (ria.ru: parol bərpası, şərh qaydaları, "Срок блокировки", "Подпишитесь на канал") `PROMO_LINE_RE` ilə cümlə səviyyəsində silinir. Parol haqqında real xəbər cümləsi toxunulmur |

## Toxunulmayan, trace-də görünən məsələlər
- **Köhnə nəticə "latest" sorğusunda:** `gate_relaxed` + `final_quality_gate` 4 yaşlı məqaləni yeganə nəticə kimi qaytarır. Təzəlik işarəli sorğuda >1 yaşlı nəticəni atmaq siyasət qərarıdır, edilməyib.
- **Dəyişməz hərfi mövzu termini:** `росс` stem-i olmayan rus xəbər səhifələri `no_query_term_hit` alır (məs. Rusiya sayt xəbəri "Россия" sözünü işlətməyibsə). ccTLD (.ru) ilə mövzu işarəsi variantı müzakirə olunmalıdır.
- Rus xəbər saytlarının ana səhifələri (vesti.ru −4.1, kommersant.ru −5.7, dw.com/ru −2.8) mənfi xal alır (hub/tarixsiz cəzaları).
- Pəncərəni 1600 ms-ə qaldırmaq yavaş-tərcümə halında cavabı ~700 ms gecikdirə bilər.

## Test
829 keçir (+10): `wave1Limit`, ru-news defolt/abort təsnifatı, ria.ru UI sample (təmizlənir/real cümlələr qalır), trace başlıqları.
