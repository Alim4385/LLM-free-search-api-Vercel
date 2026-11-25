# v128 — v127 canlı test: rus sorğusunda Rusiya ilə əlaqəsiz Amerika ana səhifələri

## v127 canlı nəticə (`последние новости России`)
5 nəticənin hamısı Amerika xəbər saytlarının ana səhifələri idi (ABC News, USA Today, HuffPost, Fox News, Yahoo News), **heç birində Rusiya yox**, amma `confidence: "high"`. `ru-news` `providers_used`-da idi (`early: grace`, 6 uyğun xəbər), nəticələrdə yox idi. `native_news_candidates` görünmürdü — v127-nin deploy olunub-olunmadığı meta-dan bilinmirdi.

## Kök səbəblər
1. **Gating deşiyi.** `scoreResult`: `termHits` HƏR hansı termin uyğunluğunu sayır. `qTerms` ingiliscə anchor-dan (`latest news from Russia`) `latest`, `news`, `russia` da daşıyır; `news`/`latest` `GENERIC_NEWS_TERMS`-dədir, amma `termHits`-i artırır → "ABC News - …" başlığı Rusiya mövzusu olmadan keçir (xal ~6, confidence high).
2. **Qismən örtülmə cəzası yerli nəticələrə.** `ru-news` nəticələri (rusca mətn) anchor terminlərinə uyğun gələ bilmir; çoxsözlü sorğunun cəzasını alır (stub simulyasiyasında xal 1 / 0 / −0.2).
3. **Versiya görünmürdü** — hər testdə "deploy olunubmu?" sualı təkrarlanırdı.

## Düzəlişlər
| # | Dəyişiklik |
|---|-----------|
| 1 | `score.js`: mövzulu xəbər sorğusunda (NEWS_RE) yalnız ümumi sözə uyğunluq nəticəni təsdiqləmir — ≥1 MÖVZU termini (`!isGenericNewsTerm`) uyğun gəlməlidir. **Yalnız ≥5 hərfli mövzu termini olanda tətbiq olunur** (aşağıya bax) |
| 2 | `rank.js`: türkcə xəbər sözləri (`haber`, `haberler`, `haberleri`, `manset`, `mansetler`, `dakika`) `GENERIC_NEWS_TERMS`-ə əlavə olundu |
| 3 | `route.js`: yerli dildə olan nəticələr (`ru-news`, `az-news`, `azertag`) yalnız yerli sorğu terminləri ilə (`nativeTerms`) qiymətləndirilir |
| 4 | `lib/version.js` + `meta.engine_version`, `meta.commit` (`VERCEL_GIT_COMMIT_SHA`) |

## Niyə "yalnız ≥5 hərfli mövzu termini"?
Tapıldı ki, AZ stemmeri `Bakı`→`bak` (3 hərf), amma `Bakıda`→`baki`; prefiks uyğunluğu yalnız ≥5 hərfdə işləyir (v45.3). Baza versiyada "Bakıda …" məqaləsi `Bakı xəbərlər` sorğusunda **mövzu uyğunluğu almır** və yalnız ümumi `xəbər` sözü ilə keçirdi. Gating-i qısa köklərə də tətbiq etsəydik, bu məqalələr 0 alardı (AZ reqressiyası). Buna görə qısa köklü sorğular baza davranışında qalır.

## Test
- 15 yeni vahid test + tam handler inteqrasiya testi (stub RSS, stub məqalə səhifələri, **stub tərcümə** — canlıdakı `qTerms`-i təkrarlamaq üçün).
- Düzəlişsiz: inteqrasiya testi uğursuz (`abcnews.com`, `foxnews.com` nəticələrdə), vahid testlər uğursuz. Düzəlişlə: **793 keçir, 0 uğursuz**.

## Bilinən məhdudiyyətlər
- AZ stemmer uyğunsuzluğu (`Bakı` ↔ `Bakıda`) düzəldilməyib; yalnız ondan yan keçildi.
- `confidence` hələ də gating-dən asılıdır; relevantlıq real mövzu uyğunluğunu ayrıca ölçmür.
- Simulyasiyada `ru-news` yeganə provayder olanda `confidence: low` çıxır (provayder razılığı yoxdur) — dəyişdirilməyib.
- Canlı provayderlərlə yoxlanmayıb.
