# v120 — Düzəlişlər (v119 sonrası canlı test nəticələrinə əsasən)

| # | Müşahidə | Səbəb | Düzəliş |
|---|----------|-------|---------|
| 1 | Türkcə xəbər sorğusunda `stackoverflow`, `arxiv`, `github`, `wiki-docs` çağırılır; nəticələr arasında Wikipedia "İstanbul" | `TECH_RE`-də ASCII `\b`: "bugün" içində "bug" (ü `\w` deyil) tapılırdı → sorğu "texniki" sayılırdı | `lib/score.js`: Unicode-aware sərhəd (`(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])`, `u` flag) |
| 2 | Türkcə "bugün" avtomatik `freshness` işə salmır | `sameDayCue`-da `bu\s+g[üu]n` (boşluq məcburi) | `bu\s*g[üu]n` ("bugünün" kimi başqa sözlər tutulmur) |
| 3 | Rus nəticələrində "Доступ ограничен" bloklama səhifəsi (`thisismoney.co.uk`) | Yalnız JS/Cloudflare challenge tutulurdu | `isBlockPageText()` (`lib/clean.js`): az/ru/tr/en; `block_page_skipped` işarəsi |

## Yanlış-müsbət qorunması (bloklama detektoru)
- STRONG ifadələr yalnız QISA mətndə (≤900 simvol).
- Başlıq yalnız BÜTÖVLÜKLƏ bloklama mesajıdırsa tutulur ("Доступ ограничен"). "Twitter'a erişim engellendi" və "Access denied for journalists…" kimi xəbər başlıqları tutulmur.

## Bilinən məhdudiyyətlər
- Qalan `\b(...)\b` regex-ləri (s. audit) eyni sinif səhv verə bilər; yalnız `TECH_RE` düzəldilib.
- Rus sorğusunda nəticələrin hamısının `mwmbl`-dən gəlməsinin (`gate_relaxed`) səbəbi araşdırılmayıb.
- Canlı provayderlərlə yoxlanmayıb (658 unit test keçir).
