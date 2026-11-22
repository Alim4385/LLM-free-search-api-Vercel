# v123 — canlı test (23 Noyabr) nəticələrinə əsasən

| # | Müşahidə | Düzəliş |
|---|----------|---------|
| 1 | `isNewsQuery("İstanbul son dakika haberleri")` = **false** → türkcə xəbər sorğusunda Wikipedia çağırılır, xəbərə xas xal qaydaları söndürülür | `NEWS_RE`: `haber/haberi/haberleri/haberlerini/haberlerinde`, `son dakika`, `sondakika`, `manşet(ler)`, `новость/новостей/новостях` (Unicode sərhədi ilə; `haberleşme`, `haberdar` tutulmur) |
| 2 | Hürriyet snippet/content-də `&middot;` olduğu kimi qalır | `lib/entities.js`: 40-a yaxın adlı entity; səhv rəqəmli kod artıq `RangeError` atmır; **ikiqat decode yoxdur** (mövcud test qorunur); yekun mərhələdə `angle:false` (`&lt;/&gt;` toxunulmaz) |
| 3 | Brend adları tərcümə olunur: "Silicon UK"→"Кремний UK", "Ground News"→"Zemin Haberleri", "Daily Mail"→"Ежедневная почта" | `brandTermsFromResult(title, url)`: başlıq `\| · • – — -` ilə bölünür, domenlə uyğun hissə tərcümədən qorunur (`protectWithTerms`) |
| 4 | Rusca sorğuda rusdilli xəbər mənbəyi yoxdur (nəticələr: tag/hub səhifələri, hamısı `mwmbl`) | `lib/ru-news.js`: Lenta, RIA, Kommersant, Vedomosti, Meduza RSS; 5 dəq keş, stale fallback, hər feed fail-soft, saytdan ≤3 xəbər; `ru-news` +2.6 xal (az-news kimi); circuit breaker |

## ⚠️ ru-news haqqında
- Feed ünvanları üçüncü tərəf siyahılardan (Feeder, infomate `boards.yml`) götürülüb, **canlıda yoxlanmayıb**. TASS feed-i həmin siyahıda `is_parsable: false` idi → daxil edilmədi. DW feed-i RDF-dir (parser onu da oxuyur, amma defolta salınmayıb).
- Bəzi rusiya saytları xarici/cloud IP-lərini bloklaya bilər. Vercel-də `provider_errors["ru-news"]`-a bax.
- `RU_NEWS_FEEDS="url1,url2"` env dəyişəni ilə siyahı dəyişdirilə bilər.
- Mənbə seçimi redaksiya mövqeyi baxımından qarışıqdır (dövlətə yaxın + müstəqil); ehtiyac olsa env ilə dəyiş.

## Toxunulmayanlar
- `ddg-lite: blocked` (scraping bloku).
- `age_days` 24 saat əsaslıdır (gecə yarısı ətrafında "bugün" göstərə bilər); düzəliş istifadəçi saat qurşağını tələb edir (`tz` parametri).
- `mwmbl`-in rus sorğularında üstünlüyünün (`gate_relaxed`) əsl səbəbi araşdırılmayıb; `ru-news` bunu yan keçir, amma izah etmir.

## Test
720 unit test (680 + 40 yeni) + yerli handler smoke testi (şəbəkəsiz). Canlı provayderlərlə yoxlanmayıb.
