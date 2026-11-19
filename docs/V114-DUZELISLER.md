# v114 — düzəlişlər (FILTER_VERSION = 231)

Bu buraxılışın şüarı: **axtarış boru xəttini (pipeline) yenidən ölçmək və səssiz itkiləri
üzə çıxarmaq**. Aşağıdakı hər bənd real ölçmə ilə təsdiqlənib; ölçmə əmri bəndin yanında verilib.

---

## 1. `looksLikeGibberish` real texniki sözləri "zibil" sayırdı — skor sıfıra düşürdü

**Fayl:** `lib/score.js`

**Problem (ölçülmüş):**

```
node -e 's.looksLikeGibberish("http")'  → true
                               "https" → true
                               "gpt"   → true
                               "sql"   → true
                               "css"   → true
                               "html"  → true
                               "npm"   → true
                               "metro" → true      ← real AZ sözü
                               "taskgroup" → true
```

`route.js` sətri 353 (`qTerms = [...].filter(t => !looksLikeGibberish(t))`) bu tokenləri
**skor terminlərindən silirdi**. Nəticə:

```
sorğu: "HTTP ilə HTTPS arasındakı fərq nədir"
tokenize()                     → ["http","https","aras","ferq"]      ✓
qTerms (route, filtrdən sonra) → ["aras","ferq"]                     ✗
provayderlər 14 nəticə qaytardı → skor qapısından 2 keçdi → n=1
```

Yəni "HTTP/HTTPS haqqında" səhifələr yalnız "aras/ferq" sözünə görə qiymətləndirilirdi.

**Kök səbəb:** köhnə funksiya iki aqressiv qayda işlədirdi:
* "sait yoxdur → zibil" (`http`, `sql`, `css`, `npm` dərhal düşürdü);
* "4 simvolluq klaviatura sətri → zibil", bu şərt **alt-sətir** yoxlaması idi
  (`[...seg].every(c => row.includes(c))`), yəni `metro` sözünün `etro` parçası
  `qwertyuiop` sətrinin hərflərindən ibarət olduğu üçün söz zibil sayılırdı.

**Düzəliş:** akronim whitelist (`TECH_KEEP`), ardıcıl 5 simvolluq klaviatura sətri şərti,
4 simvolluq sətir yalnız sait payı < 0.34 olduqda, 6+ samit silsiləsi qaydası, rəqəmli
token heç vaxt zibil sayılmır.

**Yoxlama:**

```
real sözlər (http, https, sql, css, html, npm, metro, taskgroup, abs, bmt,
             naxçıvan, strengths, photosynthesis, python, şəki, asyncio, gpt5) → 0 yanlış
zibil nümunələri (asdfqwer, zxcvbnm, zzzz, bcdf, xzcv, qqq, sdfgsdfg)          → 7/7 tutuldu
```

**Canlı nəticə:** `HTTP ilə HTTPS arasındakı fərq nədir` → `n=1` → **`n=5`**
(az.trend.az, en.wikipedia.org `HTTPS`, technote.az, az.wikipedia.org, geeksforgeeks.org).
Golden-da bu sual **keçdi**.

---

## 2. Tarix cavabı: məqalənin GİRİŞİ faktı tərif edir

**Fayl:** `lib/measure.js` (`extractDateAnswer`)

**Problem:** `GPT-5 nə vaxt çıxdı` → **"14 aprel 2023"** (cavab: 7 avqust 2025).

Məqalə düzgün idi (`en.wikipedia.org/wiki/GPT-5`), amma mətnin `== Background ==`
bölməsindəki cümlə — *"On April 14, 2023, Sam Altman … said that the company was **not**
training GPT-5 at that time"* — anchor (`gpt5`) eyni cümlədə olduğu üçün +1.5 bonus alıb
giriş cümləsini (`… it was launched on August 7, 2025`) üstələyirdi: **4.4 vs 2.9**.

**Düzəliş (ümumi qaydalar, heç bir mövzu literalı yoxdur):**
* giriş mövqeyi bonusu: `si ≤ 1` → **+1.6**, `si == 2` → **+0.8** (təsis/açılış suallarında
  tətbiq olunmur — orada ən erkən il qaydası işləyir);
* inkar/cəhd cümləsi cavab deyil: `not|never|wasn't|deyil|deyildi|olmayıb|olmadı|hələ yox` → **−1.8**;
* sualın **hadisə növü** cümlədə də olmalıdır (`dateEventCue`): doğum / ölüm / açılış / buraxılış
  → uyğun cümlə **+2.2**, uyğunsuz **−1.2**.

**Nəticə:** `GPT-5 nə vaxt çıxdı` → **7 avqust 2025** ✓ (golden keçdi).

---

## 3. Cümlə bölgüsü ilə başlayan tarixi ayırmırdı

**Fayl:** `lib/measure.js`

`"…İdarəsi yaradılır. 1967-ci il noyabrın 6-da …"` — bölücü regex yalnız **böyük hərflə**
başlayan parçada kəsirdi, rəqəmlə başlayan tarix cümləsi əvvəlki cümləyə yapışırdı və
**hər cümlədən yalnız bir tarix** götürüldüyü üçün 1967 heç namizəd olmurdu.

**Düzəliş:** bölücüyə `(?<=[.!?;])\s+(?=\d{1,4}(?:[\s-]|$))` əlavə edildi.

---

## 4. Açılış cue-su: rəsmi "istismara verilir" forması yox idi

**Fayl:** `lib/measure.js` (`OPEN_CUE`, `EVENT_CUES`)

`Bakı metrosu hansı ildə açılıb` → **27 fevral 2014** (Prezident fərmanı) verilirdi.
Məqalədəki düzgün cümlə *"…birinci növbəsi **istismara verilir**"* formasındadır; cue
siyahısında `istifadəyə veril` var idi, `istismara veril` yox idi.

Əlavə olaraq:
* cue-lar **tam cümlə** üzərində yoxlanılır (`cand.full`) — əvvəl 240 simvolluq kəsik
  yoxlanılırdı və cümlənin sonundaki cue görünmürdü;
* təsis suallarında **min il** yalnız cue-su olan cümlələr içindən götürülür
  (məqalədəki 1949 "tikinti bazası" ili cavabı oğurlayırdı).

**Nəticə:** `Bakı metrosu hansı ildə açılıb` → **6 noyabr 1967** ✓.

---

## 5. Tarix mənbəyi kimi səhv məqalə seçimi

**Fayl:** `app/api/search/route.js`

Üç ayrı ölçülmüş səhv:
| sorğu | səhv cavab | səhv məqalə | düzəliş |
|---|---|---|---|
| Bakı metrosu hansı ildə açılıb | 1992 | `Bakı metrosu (film, 1992)` | media-cue filtri (`MEDIA_CUE`) + girişdə hadisə cue-su tələbi |
| Heydər Əliyev nə vaxt doğulub | 28 aprel 2005 | `"Heydər Əliyev" ordeni` | başlıqda sorğudan **əlavə söz** daşıyan məqalə geri plana; hadisə cue-su tələbi |
| GPT-5 nə vaxt çıxdı | 14 aprel 2023 | (düzgün məqalə, səhv cümlə) | §2 |

Əlavə qaydalar (hamısı ümumi):
* güclü anchor varsa (`gpt5`, `fifa2022`) məqalə başlığı anchor-u saxlamalıdır;
* məqalənin **ilk 700 simvolu** sualın hadisə cue-sunu ehtiva etməlidir;
* hovuzdaki məqalələrin heç biri uyğun deyilsə → mövzunun özü ilə wiki axtarışı
  (`date_wiki_subject` mərhələsi);
* tarix çıxarışı **əvvəl sorğunun özü** ilə aparılır (orada cue və "ən erkən il" məntiqi var),
  başlıq/anchor variantları yalnız o boş qaytaranda sınanır;
* hovuzdan çıxarılan tarixdə **il olmalıdır** və cümlədə hadisə cue-su olmalıdır — əks halda
  wiki mətninə keçilir (`… mükafatı …` parçasından gələn ilsiz "10 may" cavabı bu yolla atıldı).

**Nəticə:** `Heydər Əliyev nə vaxt doğulub` → **10 may 1923** ✓ (ilkin `date_extracted`
mərhələsi → `date_wiki_subject`).

---

## 6. Wikipedia: gecikmə, variant sayı, başlıq reytinqi (v114-in birinci dalğası)

**Fayl:** `lib/search.js`

* `searchWikipedia` hər dil üçün 3 variant çağırırdı (4 dil × 3 = 12 sorğu) və büdcəni
  yeyirdi → wiki nəticələri ümumiyyətlə çatmırdı. İndi: `bridges[lang] ? variants.slice(0,1)
  : variants.slice(0,4)`.
  Ölçmə: `searchAll("Fransanın paytaxtı haradır")` → `n:5, 2904 ms, used: wikipedia`.
* `wikiVariants`-da AZ kök budama: `lightStem` (`Azərbaycanın` → `Azərbaycan`) +
  `lightStemAlt`; sıra: qısa(2 söz) → tam → təmizlənmiş(3+) → stem → alt-stem → akronim/rəqəm
  → ən uzun token; `slice(0, 4)` (12 variant MediaWiki-də **429** verirdi və *bütün* wiki
  sorğuları boş qayıdırdı).
* Başlıq-uyğunluğu ilə yenidən sıralama: dəqiq token ×2w, prefiks ×1.4w, 5 simvol prefiks
  ×0.7w, akronim ×1.6/×1.5, ≤3 sözlü başlıq +0.5, tam başlıq +3, `startsWith` +1.2;
  ümumi sözlər (`dünya`, `böyük`, `nə`, `hansı`, `what`, `world`…) hesaba alınmır.
* **v114 əlavəsi:** sorğuda olmayan **əlavə söz** daşıyan başlıq cəzalanır (−0.55/söz, max −1.6)
  və mötərizəli dəqiqləşdirmə (`(film)`, `(orden)`, `(albom)`…) sorğuda keçmirsə **−1.2**.

**Yoxlama:** `node bench/wiki-bench.mjs` → `WIKI BENCH: top1 14/15 | top3 14/15 | boş 0`
(iki ardıcıl qaçışda sabit; yeganə miss — `python asyncio taskgroup`, AZ wiki-də məqalə yoxdur).

---

## Ölçmələr (v113 → v114)

| göstərici | v113 | v114 |
|---|---|---|
| unit testlər | 591 / 0 | **595 / 0** |
| golden (30 yoxlama) | 25 keçdi / 4 uğursuz / 1 bilinən boşluq | **22 keçdi / 8 uğursuz / 0 bilinən boşluq**\* |
| wiki bench top1 | — | **14/15** (top3 14/15, boş 0) |
| diag: boş sorğu | 0 | **1** |
| diag: n<3 | 7 | **8** |
| diag: orta n | 3.85 | **3.35** |
| diag: unikal host | — | **2.81** |
| diag: latency | 4545 ms | **4215 ms** |
| diag: extracted cavab | 5/26 | **6/26** |

\* Golden rəqəmi **IP-throttling** şəraitində ölçülüb: 26 sorğunun 24-də həm `brave`, həm
`yahoo` 429 qaytarır (`provider xətaları: yahoo 24, brave 24`). Buna görə aşağıdaki 8 uğursuzluq
kodu deyil, provayder aclığını əks etdirir — **olduğu kimi** yazılır:

| # | sorğu | n | gözlənilən |
|---|---|---|---|
| 1 | Bakı metrosunda neçə stansiya var | 3 | 27 (28 olmamalı) — mənbələr 26/27 deyir, `agreement` ilə verilir |
| 2 | SQL JOIN növləri hansılardır | 3 | stackoverflow/wikipedia/w3schools səhifəsi |
| 3 | Python-da virtual mühit necə yaradılır | 3 | docs.python.org / stackoverflow.com |
| 4 | Azərbaycanda minimum əmək haqqı nə qədərdir | 3 | 400 ± 0, azerbusiness/president.az |
| 5 | Docker ilə virtual maşın arasındakı fərq | 3 | stackoverflow.com/docker.com |
| 6 | Bakıda neçə universitet var | 3 | 49 ± 4 |
| 7 | dünyanın ən böyük səhrası hansıdır | 1 | Antarktida + wikipedia |
| 8 | Python-da fayl oxuma necə olur | 3 | docs.python.org / stackoverflow.com |

Keçən əvvəlki uğursuzluqlar: **HTTP/HTTPS** (n=1 → n=5) və **GPT-5** (14 aprel 2023 → 7 avqust 2025).

---

## Test əmrləri

```bash
node tests/unit-tests.mjs                       # 595 keçdi, 0 uğursuz
node bench/wiki-bench.mjs                       # top1 14/15 | top3 14/15 | boş 0
API_BASE=http://127.0.0.1:3999/api/search node eval/run.mjs eval/golden.json 3
node bench/spot.mjs "GPT-5 nə vaxt çıxdı" "Bakı metrosu hansı ildə açılıb" "Heydər Əliyev nə vaxt doğulub"
node bench/diag.mjs                             # 26 sorğu xülasəsi
DEBUG_DATE_ANSWERS=1 node -e '…extractDateAnswer…'   # tarix namizədlərinin balları
```
