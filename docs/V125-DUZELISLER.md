# v125 — v124 canlı test (24 Noyabr) nəticələrinə əsasən

v124 canlıda: `providers_attempted` işləyir, `ru-news` orada görünür; rus sorğusunda 5 nəticə, `confidence: high`, `fallback: false` (əvvəl 2 nəticə / low). Amma #1 nəticə 177 günlük Reuters səhifəsi idi və `ru-news` nə `providers_used`-da, nə `provider_errors`-da görünürdü.

| # | Müşahidə | Kök səbəb | Düzəliş |
|---|----------|-----------|---------|
| 1 | Rus sorğusunda relevantlıq gating-i/xallandırma faktiki söndürülüb (xallar 0.6–2.1, əlaqəsiz tag/hub səhifələri) | `rank.js` `tokenize()` yalnız `[a-z0-9]+` tuturdu → **bütün kiril hərfləri atılırdı** → `tokenize("последние новости России") = []` → sorğu termini yox | `tokenize`: `[a-z0-9]+\|[\p{Script=Cyrillic}]+`; kiril sözlər üçün `stemRu` (Москва/Москвы/Москве → `моск`) və `RU_STOPWORDS` (zaman/ümumi xəbər/sual sözləri). **Latın tokenizasiyası dəyişmir** (tr/az testləri ilə təsdiqlənib) |
| 2 | "последние новости" sorğusunda 177 günlük səhifə #1 | `CURRENT_INTENT_RE` (təzəlik +1.2 / köhnə −1.5 qaydası) rusca/türkcə təzəlik sözlərini bilmirdi | `последн*`, `свеж*`, `сегодня`, `сейчас`, `актуальн*`, `güncel`, `en yeni`, `şimdi`, `newest`, `breaking` əlavə olundu |
| 3 | `ru-news`: çağırılır, amma nəticə/xəta qeydi yoxdur (qlobal deadline-a qədər bitməməsi ehtimalı) | Bilinmir | `searchRuNews`: hər feed ayrıca ölçülür, **ümumi büdcə 2600 ms** (asılan feed-lər gözlənilmir), `meta.provider_diag["ru-news"] = { state, feeds: { host: { status, ms, items\|error } }, items, matched, total_ms, overall_timeout? }` |

## Deploy-dan sonra yoxla
`последние новости России` sorğusu → `meta.provider_diag["ru-news"]`:
- `feeds.*.error = "http_403"` / `"timeout"` → saytlar Vercel IP-lərini bloklayır/yavaşdır (feed siyahısını dəyiş: `RU_NEWS_FEEDS`).
- `state: "done"` amma nəticələrdə görünmürsə → xal/gating problemidir (bu halda `matched` sayına bax).
- `provider_diag` yoxdursa → `ru-news` task-ı həqiqətən işə düşmür.

## Bilinən məhdudiyyətlər
- Qalan `[a-z0-9]+` regex-ləri (`search.js:554`, `expand.js:96`, `translate.js:31`, `conflict.js`) kiril/digər yazıları hələ də atır; yalnız `tokenize` düzəldildi. Digər qeyri-latın yazılar (ərəb, yunan…) üçün eyni problem var.
- `stemRu` kobud (son 2 hərfi atır); mürəkkəb morfologiya üçün kifayət deyil.
- Rus nəticələrinin xalı artıq gating-ə düşdüyündən, bəzi əvvəllər görünən (əlaqəsiz) nəticələr indi 0 alıb çıxarıla bilər → nəticə sayı azala bilər.
- Canlı provayderlərlə yoxlanmayıb (756 unit test + yerli handler smoke testi).
