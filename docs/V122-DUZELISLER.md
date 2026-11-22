# v122 — izlənə bilənlik, təhlükəsiz şəkilçi kəsmə, junk domen "doldurucu" problemi

| # | Dəyişiklik | Niyə |
|---|------------|------|
| 1 | `meta.translate_input` və `meta.rewritten_query` | "bugün→bug" kimi bag 1 baxışda görünsün: MT-yə dəqiq nə göndərildi. `rewritten_query` yalnız sorğudan fərqlənəndə yazılır |
| 2 | `stripAzCaseForTranslate`: 2 hərfli şəkilçilər (`ın/in/un/ün/da/də/dan/dən/ya/yə/na/nə`) yalnız BÖYÜK hərflə başlayan sözlərə | Kiçik hərfli adi sözlər (`dünya`, `qadın`, `bugün`) korlanmasın. 3 hərfli (`nın/nin/nun/nün`) köhnə kimi |
| 3 | `finalize.js` `dropJunkDomains()` + `route.js`: junk domen (instagram/facebook/tiktok/x/twitter…) real nəticə ≥3 olduqda çıxarılır (`junk_domain_dropped`) | `isJunkDomain` xalı 0 edirdi, amma nəticəni SİLMİRDİ → namizəd azdırsa "doldurucu" kimi siyahıda qalırdı (türkcə xəbər sorğusunda Instagram #5) |

## İstisnalar
- Real nəticə <3 olarsa junk saxlanılır (boş cavab verilmir).
- Sorğuda saytın adı keçirsə ("instagram giriş") toxunulmur.

## Düzəliş (öz səhvim)
İlk variantda xəbər sorğularında sosial şəbəkələrə əlavə xal cəzası yazmışdım. Sonra məlum oldu ki, `isJunkDomain` onsuz da bu domenləri 0-a endirir; problem xal yox, "silinməmək" idi. Cəza kodu çıxarıldı, yerinə `dropJunkDomains` yazıldı.

## Bilinən məhdudiyyətlər
- Junk siyahısında olmayan `t.me` və `fb.com` toxunulmur (Telegram kanalları bu regionda real xəbər mənbəyi ola bilər).
- Kiçik hərflə yazılmış AZ sorğularda `bakıda`/`gəncədə` artıq kəsilmir; MT-nin özü tərcümə edir (canlıda yoxlanmayıb).
- Canlı provayderlərlə yoxlanmayıb; 680 unit test + yerli handler smoke testi (şəbəkəsiz) keçir.
