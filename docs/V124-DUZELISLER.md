# v124 — v123 canlı test nəticələrinə əsasən

| # | Müşahidə | Səbəb | Düzəliş |
|---|----------|-------|---------|
| 1 | Brend adı yenə tərcümə olunur: "Silicon UK" → "Кремний UK", "India TV News" → "Hindistan TV Haberleri" (amma "Ground News", "Daily Mail Online" qorunur) | `protectWithTerms` əvvəlcə ümumi tokenləri (`UK`, `TV` — `\b[A-Z]{2,6}\b`) placeholder-ə çevirirdi; sonra çox sözlü brend termini ("Silicon UK") artıq uyğun gəlmirdi. v123-də yalnız `brandTermsFromResult` test olunmuşdu, tərcümə ilə inteqrasiya yox | Sıra dəyişdi: ƏVVƏL verilmiş terminlər (uzun olan birinci), SONRA ümumi tokenlər. Placeholder-lər `PROTECT_RE`-yə uyğun gəlmir. Round-trip testləri əlavə olundu |
| 2 | Hürriyet nəticəsinin `content`-i müəllif hüququ bəyanatıdır ("…izin alınmadan, kaynak gösterilse dahi iktibas edilemez, kopyalanamaz") | `isJunkLine` hüquqi bəyanatları tanımırdı | `COPYRIGHT_NOTICE_RE` (tr/ru/az/en); "izin alınmadan" tək işlənəndə tutulmur (real xəbər: "izin alınmadan inşaat yapıldı") |
| 3 | Rus sorğusunda `ru-news` çağırılıb-çağırılmadığı bilinmir | `meta.providers_used` yalnız nəticə verənləri göstərir və (rescue_retry-dan sonra) tam siyahı deyil | `meta.providers_attempted` — `addTask` ilə həqiqətən qeydə alınan BÜTÜN provayderlər (alt axtarış daxil) |

## ⚠️ Açıq qalan
- Canlı `ru-news` davranışı hələ təsdiqlənməyib: v123-dən sonra rus sorğusunda nə `providers_used`-da, nə `provider_errors`-da görünmədi. `providers_attempted` bunu birmənalı edəcək. Yerli smoke testdə (şəbəkəsiz) `ru-news` `attempted` və `errors: no_results` ilə görünür.
- RSS ünvanları canlıda yoxlanmayıb.

## Test
733 unit test (720 + 13 yeni) + yerli handler smoke testi.
