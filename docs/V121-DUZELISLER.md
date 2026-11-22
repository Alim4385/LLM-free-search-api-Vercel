# v121 — "bugün" → "bug" kök səbəbi (v120 sonrası canlı test)

| Müşahidə | Səbəb | Düzəliş |
|----------|-------|---------|
| v120-dən sonra da türkcə xəbər sorğusunda `stackoverflow`/`arxiv`/`github`/`hacker-news` çağırılır; `anchor_query: "Istanbul bug breaking news"` | `translate.js` `cleanForTranslate`: AZ hal şəkilçisi kəsmə ("ün/ın/in/un/ya/yə/da/də…") **bütün dillərə** tətbiq olunurdu → "bugün" → "bug" → MT-yə "İstanbul bug son dakika…" göndərilirdi → anchor-da "bug" → `isTechQuery(anchor)` true | `prepareTranslateInput(text, sourceLang)`: şəkilçi kəsmə yalnız `sourceLang === "az"` olanda; AZ-də də `bugün/dünya/Rusiya/Türkiyə/qadın/dünən` qorunur |

## Eyni səbəbdən zərər görən başqa sözlər (əvvəl)
`dünya → dün`, `Rusiya → Rusi`, `Türkiyə → Türki`, `qadın → qad` (az sorğularda); türkcə/ingiliscə sorğularda: `bugün → bug`, `Berlin → Berl` (auto dildə).

## Bilinən məhdudiyyətlər
- Qorunan söz siyahısı tam deyil; AZ sorğuda "...ün/…ya/…də" ilə bitən 4-8 hərfli digər adi sözlər hələ də kəsilə bilər.
  Daha möhkəm həll: kəsməni yalnız böyük hərflə başlayan (xüsusi ad) tokenlərə tətbiq etmək.
- Canlı MT xidməti ilə yoxlanmayıb (şəbəkə yoxdur); 667 unit test keçir.
