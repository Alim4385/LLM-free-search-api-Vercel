# Kodun izahı (sadə dildə) — v18.1

Bir baxışda: **1 API endpoint, 16 fayl, ~3800 sətir kod**. Giriş nöqtəsi `app/api/search/route.js` (466 sətir), qalanı `lib/` içində köməkçi "sexlər"dir.

```
POST /api/search  { "query": "..." }
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Təhlükəsizlik qapısı → 2. Keş → 3. Niyyət (hava/valyuta) │
│ 4. Sualın təmizlənməsi → 5. Genişləndirmə + tərcümə         │
│ 6. 12+ provayder paralel → 7. Bal və süzgəc                  │
│ 8. Domen müxtəlifliyi → 9. Səhifələri aç → 10. Abzas seçimi  │
│ 11. Cavab dilinə tərcümə → 12. Meta (confidence, date_info)  │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Təhlükəsizlik qapısı — `lib/ratelimit.js`
IP-yə görə limit (dəqiqədə N sorğu), sualın sanity yoxlaması (çox uzun/boş/simvol zibili), CORS başlıqları. Limit aşılarsa `429`.

## 2. Keş — `lib/cache.js`
`cacheKey` = sual + `max_results` + `max_chars` + dil + tərcümə bayrağı + **`FILTER_VERSION`** + freshness.
`FILTER_VERSION` (indi `26`) hər kod dəyişikliyində artır — ona görə köhnə, artıq səhv nəticələr keşdən qayıtmır.
TTL: normal `300s`, xəbər/valyuta `120s`, zəif nəticə `30s`.

## 3. Niyyət aşkarlaması — `weather.js`, `time.js`, `currency.js`
Sual "Bakıda hava necədir" / "saat neçədir" / "dollar məzənnəsi"dirsə, axtarışa **heç girmir** — birbaşa rəsmi mənbəyə gedir (Open-Meteo, `Asia/Baku`, CBA). Cavab `untrusted: false` olur, çünki mənbə rəsmidir.
Qoruyucu: "dollar **nə vaxt yarandı**" kimi tarixi sual valyuta niyyəti sayılmır → normal axtarışa düşür.

## 4. Sualın təmizlənməsi — `lib/clean.js` (416 sətir)
Bu fayl "yazı" ilə məşğuldur, iki tərəfdə:
- **Giriş (sual):** danışıq formaları (`üçündü → üçündür`, `hansılardı → hansılardır`), hərf səhvləri (`flim → film`, `tərçemə → tərcümə`), **diakritiksiz yazılışın bərpası** (`gozel sheher → gözəl şəhər`), dil aşkarlaması (`az/tr/en/ru`).
- **Çıxış (mətn):** Wikipediya IPA simvolları, xəbər şablonları ("?.az xəbər verir ki,"), reklam linkləri, təkrarlanan sətirlər, promosyon blokları, "söz salatı" sətirləri.

## 5. Genişləndirmə — `lib/expand.js`
Sualdan 3 variant çıxarır:
1. `rewritten` — təmizlənmiş orijinal,
2. `expanded` — sinonim/şablonlarla genişləndirilmiş,
3. `english` — ingiliscə qarşılığı (**anchorQuery**).
Məntiq: azərbaycanca mənbə azdır → ingiliscə axtarışla düzgün səhifəni tap, sonra cavabı azərbaycancaya qaytar.

## 6. Provayderlər — `lib/search.js` (824 sətir)
Paralel işləyən mənbələr: `bing`, `brave`, `wikipedia`, `google-news`, `az-news` (4 AZ RSS), `stackoverflow` (rəsmi API), `github`, `hacker-news`, `arxiv`, `searxng`, `duckduckgo` və `tavily` (son ikisi default söndürülüb).
Hər provayder üçün: **timeout** (`fetchTimeout`), **retry**, **circuit breaker** (`lib/circuit.js` — 429/403 alan mənbə 60 saniyə açılmır), ümumi büdcə `5000ms`.
Brave xüsusi: bir sorğu = bir çağırış, `429` olduqda təkrar yox (özünü bloklamasın).
Texniki sual → SO/GitHub/HN/arXiv; xəbər sualı → AZ RSS + Google News; hər zaman → Wikipedia + Bing + Brave.

## 7. Bal və süzgəc — `lib/score.js` (330 sətir)
Hər nəticə 0-dan yuxarı bal yığır:
- söz **başlıqda** varsa `+2`, **snippetdə** `+2`, təxmini yazılış uyğunluğu `+1`,
- bir neçə provayder eyni linki verdisə `+1.8` (RRF səsi),
- `.az` domen `+1`, yerli dil `+1.2`, yad dil `-0.6`,
- cəzalar: kazino/spam, yad dil URL yolu (`/sv/`), köhnə tarix, xəbər sualında Vikipediya, "saytlar" sualında mükafat məqalələri.
**`score < 1.5` → nəticə atılır.** Hamısı atılarsa `results: []`, `fallback: true`, `confidence: "none"`.

## 8. Domen müxtəlifliyi — `diversifyByDomain`
Bir domendən 1 nəticə (rəsmi sənəd/ensiklopediya saytlarında yuxarı ballı 2 səhifə) — belə ki 5 nəticə 5 fərqli mənbə olsun.

## 9. Səhifələrin açılması — `lib/extract.js` (573 sətir)
Ən "əzələ" fayl:
- **SSRF qoruması**: daxili IP-lərə (127., 10., 192.168., `::1`) və qeyri-standart portlara giriş bloklanır.
- Wikipedia üçün **rəsmi API** (tam məqalə + infobox cədvəlləri), StackOverflow üçün **rəsmi API**.
- Adi saytlar üçün `linkedom` + Mozilla **Readability** → əsas məqalə mətni; olmasa `<p>/<h1..>'` toplusu; olmasa `<meta name="description">`.
- İnteraktiv saytlarda (Google Tərcümə, oyun səhifələri) UI xəta mətni (`requires a keyboard`, `WebGL`) məzmun sayılmır.
- **Real tarix** çıxarılır (`published_at`, yenilənmə → `updated_at`); Vikipediya redaktə tarixi heç vaxt `published_at` olmur.
- **Ehtiyat qat (v18.1):** öz çıxarışımız boş qalanda `r.jina.ai`-dən təmiz markdown götürülür və içindən sorğuya uyğun paraqraf seçilir.

## 10. Abzas seçimi — `lib/rank.js` (210 sətir)
Səhifənin bütün mətnindən **sorğuya ən uyğun abzaslar** seçilir (BM25 + triqram oxşarlığı, AZ kök/stopword dəstəyi).
Simvol büdcəsi `max_chars` (default 4000): **1-ci mənbə 36%, 2-ci 26%**, qalanı bərabər — ki cavab yarıda kəsilməsin.

## 11. Tərcümə — `lib/translate.js` (203 sətir)
Nəticə sualın dilində deyilsə (`title`/`content`) həmin dilə çevrilir. Paralel, büdcə `2400ms` — yubanırsa tərcüməsiz qaytarılır (sistem heç vaxt gözləyib ilişmir).

## 12. Çıxış — `route.js`
Hər nəticə: `id, title, url, snippet, content, source, providers, voteCount, score, published_at, updated_at, date_info, untrusted`.
Meta: `providers_used, errors, took_ms, cached, confidence, fallback, query_lang, rewritten_query, note`.
`confidence` məntiqi: boş → `none`; fallback → `low`; 4+ ağır xəta → `low`; çox mənbə + uzun məzmun → `high`; əks halda `medium`.

---

## Niyə hallüsinasiya olmur? (3 qoruyucu)
1. **Bal həddi** — uyğun olmayan nəticə ümumiyyətlə qaytarılmır (`score < 1.5`).
2. **Boş cavab açıq şəkildə boşdur** — `results: [], fallback: true, confidence: "none"`; meta `note`-da modelə "uydurma" deyilir.
3. **`untrusted: true`** + `date_info` — model mətni həqiqət kimi yox, mənbə kimi götürür və təzəliyini görür.

## Dürüst zəif yerlər
- Azərbaycanca **dərin məzmun** azdır → çox sual EN→AZ tərcümə zəncirindən keçir, bəzən məna sürüşür.
- Pulsuz mənbələr (Brave/Bing) **rate limit** qoyur; limit anında nəticə sayı azalır (`degraded`).
- **Ümumi hava sualları** ("şəhərlərdə hava necədir") hələ ideal deyil.
- `r.jina.ai` yavaşdır (0.2–5.7 s), ona görə yalnız ehtiyat qatda işlədilir.
- Niyyət anlama **qayda əsaslıdır**, LLM deyil → yeni danışıq forması çıxanda qayda əlavə etmək lazım gəlir.
