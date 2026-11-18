# Buraxılış qapısı (release gate)

Hər dəyişiklikdən sonra **iki** yoxlama işlədilir:

```bash
npm test                # 511 unit test (offline, sürətli)
npm run test:golden     # 30 canlı sual — /api/search üzərindən
npm run calib           # filtr kalibrasiyası (Vikipediya etalonu)
```

## `test:golden` nə edir

- `eval/golden.json` — 30 sual + `expect` şərtləri:
  `num`/`tol`, `year`, `all`, `any`, `must_not`, `codeTokens`, `page`, `unit`, `requiresDigits`.
- Hər sual üçün cavab yoxlanılır; uğursuzluqda **1 dəfə təkrar** edilir (provayder 429/timeout
  halında yalançı uğursuzluq olmasın).
- Nəticə: `GOLDEN: N keçdi, M bilinən boşluq, K UĞURSUZ`. `UĞURSUZ > 0` → `exit code 1`
  (CI/buraxılış bloklanır).
- **Bilinən boşluqlar** `eval/known-gaps.json`-da səbəbi ilə saxlanılır; onlar buraxılışı
  bloklamır, amma hesabatda ayrıca görünür. Boşluq bağlananda fayldan silinir.

## Cari vəziyyət (v98.2 / FV 199)

| ölçmə | nəticə |
|---|---|
| unit testlər | 511 keçdi / 0 uğursuz |
| golden dəst | **28 keçdi**, 2 bilinən boşluq, 0 uğursuz |
| filtr kalibrasiyası | Precision ~88 %, Recall ~62 % (14 sual, Vikipediya etalonu) |

Bilinən boşluqlar: `Azərbaycanda pambıq istehsalı` (rəsmi stat mənbəyi tapılmır),
`GPT-5 nə vaxt çıxdı` (rəsmi buraxılış tarixi mənbəyi zəif).


---

## v102 — vəziyyət (FV 203)

**Bağlanan boşluq:** `GPT-5 nə vaxt çıxdı` → **7 avqust 2025** (3/3 yerli yoxlama, 3.1–3.7 s).
Mexanizm: (1) güclü anchor (`GPT-5`, `iPhone 15`) skorda SƏRT şərtdir — anchorsuz nəticə 0 bal;
(2) tarix sualında anchor-hədəfli axtarış (`GPT-5 release date`) əsas axtarışla **paralel** başlayır,
latency artmır; (3) tarix cümləsində anchor varsa +1.5 bonus — qonşu cümlədəki başqa tarix
(«12 noyabr 2025») artıq qalib gəlmir.

**Açıq qalan:** `pambıq istehsalı` — pulsuz provayderlər `site:stat.gov.az` nəticəsi qaytarmır,
tərcümə "cotton" generic səhifələrinə aparır. Tapılan real rəqəm wikipedia-dakı 1986 ilidir (784 min ton).

**Ən böyük problem (dürüst):** provayder hovuzu nazikdir. Eyni gündə `brave` və `yahoo`
`rate_limited`, `bing-news` skipped olur; qalan üç mənbə (wikipedia, google-news, mwmbl) ilə
nəticə örtüyü düşür və golden balı **26–29/30** arasında oynayır — məntiq dəyişməsə də.
Mojeek/DDG/Startpage datacenter IP-ni bloklayır (yoxlanıldı: 403).
