# v119 — Düzəlişlər (v118 sonrası canlı test nəticələrinə əsasən)

| # | Müşahidə | Səbəb | Düzəliş |
|---|----------|-------|---------|
| 1 | "новости Москва сегодня" → yalnız USA Today və CNN | Anchor "news Moscow today"; "today" USA TODAY brendinə uyğun gəlir. "сегодня"siz sorğu düzgün nəticə verir | `lib/timewords.js`: tərcümədən gələn "today/tonight/right now" anchor-dan çıxarılır (zamanı `freshness` idarə edir) |
| 2 | dailymoscow.news snippet-i "25 июля 2026 г.", amma `published_at: 2026-11-21` ("fresh") | Bing RSS `pubDate` yenidən indeksləmə vaxtı ola bilər | `reconcilePubDate()`: provayder tarixi ilə snippet tarixi >2 gün fərqlənirsə snippet seçilir; `provider_published_at` saxlanılır |
| 3 | Türkcə/rusca sorğuda `date_info.label` azərbaycanca | `buildDateInfo` yalnız az/en bilirdi | az/en/tr/ru etiketləri (`DATE_I18N`) |
| 4 | `providers_used: []` (valyuta/hava) | Native intentdə axtarış pipeline-ı işləmir | Mənbə (`cbar.az`, `open-meteo`) `providers_used`-a yazılır |

## Toxunulmayanlar / bilinən məhdudiyyətlər
- `ddg-lite: blocked` — scraping bloku, kod ilə həll olunmur (ehtiyat mühərrik/proxy lazımdır).
- Xəbər sorğusunda `wikipedia` provayderi hələ də işləyir.
- `sameDayCue` özü "bugün"ü (boşluqsuz) tanımır; `timewords.js` bunu yalnız anchor üçün tamamlayır, avtomatik `freshness` üçün deyil.
- Tarix toqquşması qaydası (2 gün tolerans) heuristikadır.
- Dəyişikliklər unit səviyyəsində test olunub (637 keçir); canlı provayderlərlə yoxlanmayıb.
