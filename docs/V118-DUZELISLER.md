# v118 — Düzəlişlər (test nəticələrinə əsasən)

MCP üzərindən aparılan canlı testlərdə (az/tr/ru/en) görünən problemlər və onların səbəbləri.

| # | Problem | Səbəb | Düzəliş |
|---|---------|-------|---------|
| 1 | Rus sorğusunda ("новости Москва сегодня") yalnız USA Today və CNN qayıdır | `finalize.js`: ≥2 tarixli nəticə varsa BÜTÜN tarixsizlər atılırdı; tarixli olan yeganə iki nəticə zəif idi | Tarixsizlər yalnız tarixlilərdən açıq zəif olmadıqda atılır (`UNDATED_STRONGER = 1.5`). Atılma `undated_dropped` ilə görünür |
| 2 | `cbar.az` üçün `is_official: false` | `AZ_OFFICIAL` siyahısı yalnız skor üçün idi | `isAzOfficialHost()` `is_official`-a bağlandı (alt-domen rəsmi, `evil-cbar.az` deyil) |
| 3 | Rus/ingilis xəbər sorğusunda `azertag: error` | AZƏRTAC hər xəbər sorğusunda çağırılırdı | `azertagRelevant()`: az-da həmişə; ru/en-də yalnız Azərbaycan/Bakı işarəsi varsa |
| 4 | Hürriyet `content`-i menyu zibili | Boşluqsuz birləşmiş BÖYÜK HƏRFLİ söz yığını `isJunkLine`-dan keçirdi | 18+ böyük hərfdən ibarət ≥3 söz olan sətir zibil sayılır |
| 5 | `dated_results: 0`, halbuki snippet-də "21 Kasım 2026" var | Mətndən tarix çıxaran kod yox idi | `lib/textdate.js`: yalnız mətnin ƏVVƏLİNDƏKİ tarix; `date_source: "snippet"` ilə işarələnir |

## Bilinən məhdudiyyətlər
- Mətn tarixi saat qurşağını bilmir, `12:00 UTC` qəbul edilir.
- `UNDATED_STRONGER` heuristikadır; `eval/` ilə kalibrasiya olunmalıdır (`npm run test:golden`).
- İngilis sorğusunda artıq AZƏRTAC yalnız Azərbaycan işarəsi olduqda çağırılır.
- `degraded_stages` içindəki `freshness_filter` "filtr işləmədi" deyil, "filtr nəticələri azaltdı" deməkdir.
