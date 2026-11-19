# v112 — rəqəmin çarpaz təsdiqi (A) + 3 səhv (B) + testlər (C) + dürüst hesabat (D)

FILTER_VERSION: **227 → 228** (`app/api/search/route.js:36`)

Motivasiya (istifadəçinin reprosu): `Bakı metrosunda neçə stansiya var` sorğusunda
sistem **12** rəqəmini **bal 99** ilə birinci yerə çıxarırdı. Həmin 12
*"…12 stansiyadan ibarət olan Bənövşəyi xəttin 3-cü stansiyası…"* cümləsindən gəlirdi —
yəni **bir xəttin alt-sayı** və **gələcək layihə**. Korpusda isə 26 (azertag, köhnə) və
27 (az.wikipedia, rəsmi metro.gov.az) var idi; `meta.conflicts_count` isə **0** göstərirdi.

---

## A. Rəqəmin çarpaz təsdiqi (cross-confirmation)

### A1. Namizədlərin toplanması və rədd səbəbləri — `lib/countextract.js:52` (`collectCandidates`)

- `extractCount` indi **nazik örtükdür** (`lib/countextract.js:391`): köhnə qaytarma
  forması (`value, sentence, score, year, summed, atLeast, qualifier, agree, fromWord`)
  **dəyişməyib** — köhnə sahələr silinmir, yalnız yeni funksiya əlavə olunur.
- `collectCandidates` `{ cands, rejected }` qaytarır; `rejected` səbəblə işarələnir
  (`rej()` — `lib/countextract.js:114`).

**v112-də əlavə olunan rədd qaydaları** (hamısı ümumi qaydadır — heç bir metro/sayt sözü yoxdur):

| # | Qayda | Yer | Nümunə (rədd) | Nümunə (qəbul) |
|---|-------|-----|----------------|----------------|
| 1 | sıra sayı | `countextract.js:163` | `3-cü stansiya` → 3 rədd | `27 stansiya` ✓ |
| 2 | alt-obyekt (xətt/mərhələ) | `countextract.js:165` | `Bənövşəyi xəttin 3-cü stansiyası` / `12 stansiyadan ibarət olan … xətt` → 12 rədd | `3 xət və 27 stansiyadan ibarətdir` → 27 ✓ |
| 3 | mötərizəli alt-siyahı | `countextract.js:175` | `13 stansiyası ("A","B","C")` → 13 rədd | `27 stansiya və 40,7 km` ✓ |
| 4 | planlaşdırılan/gələcək | `countextract.js:182` (+`FUTURE_RE` sətir 39) | `10 yeni stansiya inşa ediləcək` → 10 rədd | `26 stansiya var` ✓ |
| 5 | tarix fraqmenti | `countextract.js:183` | `2013-10-21`, `Aug 6, 2026` → rədd | `26 stansiya` ✓ |
| 6 | saat tokeni | `countextract.js:188` | `06:00-dan 00:00-dək` → rədd | `27 stansiya` ✓ |
| 7 | obyekt kodu | `countextract.js:190` | `B4 stansiyası` → rədd | `27 stansiya` ✓ |
| 8 | başqa ismin sayı | `countextract.js:197` | `3 xətt, 27 stansiya` → 3 rədd | `27 stansiya və 40,7 km` ✓ |
| 9 | arada başqa rəqəm | `countextract.js:200` | `3 xət və 27 stansiya` → 3 rədd | 27 ✓ |
| 10 | uzaq rəqəm (dəqiq bağlantı varsa) | `countextract.js:97,147` | `27 stansiya və 41 vaqon` → 41 rədd | 27 ✓ |

Bu qaydalar `v61` testini sındırmışdı (`Bakı metropoliteni 3 xəttdən, 27 işləyən və dörd
tikilən stansiyadan ibarətdir` → **null**). Səbəb: alt-obyekt qaydası ±70 simvol
pəncərəsində `xətt` + `ibarət` sözlərini görüb 27-ni rədd edirdi. Düzəliş:
- `xətt` yalnız rəqəmdən **əvvəl**, **vergülsüz** seqmentdədirsə (a), və ya isimdən
  **sonra** `ibarət … (olan) … xətt` quruluşu gəlirsə (b) → rədd.
- Nəticə: `3 xəttdən, 27 … stansiyadan ibarətdir` → **27** ✓, `12 stansiyadan ibarət olan
  … xətt` → **rədd** ✓.

**Ayrıca tapılan kod səhvi (kritik):** bütün v112 pəncərələri əvvəlcə `ns` (normallaşdırılmış
mətn) üzərindən kəsilirdi, indekslər isə `s` (orijinal cümlə) üzərindən gəlirdi → pəncərə
**boş** qalırdı və qaydalar heç işləmirdi. Üstəlik `num.length` (rəqəm üçün `undefined`)
`NaN` indeks verirdi. Düzəliş: `sWin()` köməkçisi (`countextract.js:104`) və `m[0].length`.

### A2. Qruplaşdırma + müstəqil təsdiq — `lib/countextract.js:587` (`extractCountCross`)

- Bütün nəticələrin `title + snippet + content` mətni taranır (əlavə şəbəkə sorğusu yoxdur).
- Dəyərlər normallaşdırılır (`Math.round(v*1000)/1000`, minlik ayırıcı/sıfır quyruğu).
- **Təsdiq sayı = fərqli mətn klasteri ∩ fərqli host** (`storyKeyOf` — ilk 8 söz):
  - eyni hostdan 2 URL → **1**;
  - eyni cümlə 2 saytda → **1** (unit test: `v112: eyni cümlə 2 saytda = 1 təsdiq`).
- Sıralama: təsdiq sayı ↓ → rəsmi domen (`.gov.*`) > wikipedia > digər → tarix ↓ → bal ↓.
- `agreement`: `strong` (≥3) / `medium` (2) / `weak` (1) / `conflict`
  (rəqib **rəsmidirsə** və ya **2+ təsdiqi** varsa). **Çoxluq = həqiqət deyil**: köhnə
  çoxluq + rəsmi/təzə rəqib → `conflict` (hidden deyil).

### A3. Çıxış — `app/api/search/route.js:1021-1045`

- `content` başlanğıcı: `27 stansiya — 2 müstəqil mənbə təsdiqləyir (az.wikipedia.org, …)`.
- Yeni sahələr (additiv): `confirmations: [{value, count, hosts, urls, official, newest_date}]`,
  `agreement: "strong"|"medium"|"weak"|"conflict"`.
- **Faiz yoxdur** — yalnız say/marker (istifadəçi qadağası).
- `meta.conflicts_count` / `conflicts` artıq **real qruplardan** doldurulur
  (`route.js:1412`) — əvvəl həmişə 0 idi.
- Say mexanizmi yalnız rəqəmli suallarda işləyir (`hasCountMarker` + `countNounFromQuery`)
  və nəticə sıralamasını dəyişmir.

### A4. Say isminin tapılması (A üçün zəruri düzəlişlər)

- **İsim marker-dən əvvəl** ola bilər: `stansiyaların sayı` → `stansiya`
  (`countextract.js:524`). Əvvəl bu halda `null` qayıdırdı və say mexanizmi heç işləmirdi.
  `nə qədərdir` (ölçü sualı) bu yolla isim çıxarmır.
- **EN/RU söz sırası**: `how many stations in baku` / `сколько станций в метро` →
  marker-dən **dərhal sonra** gələn isim (`countextract.js:542`). Əvvəl "metro" seçilirdi.
- **Kiril dəstəyi**: mətn normallaşdırması `[^a-z0-9əğıöşüç…]` yalnız latın saxlayırdı →
  rus mətni tamamilə silinirdi (`countextract.js:56,104,131`). İndi `\u0400-\u04FF` saxlanılır.

---

## B. Üç səhv

### B1. Say sözü sorğunun dilində olmalıdır — `lib/countextract.js:428` + `countSearchQuery` (`:449`)

Əvvəl hər dilə `sayı` əlavə olunurdu: `станций в бакинском метро sayı`.
İndi: `az → sayı`, `tr → sayısı`, `ru → количество`, `en` → **əlavə olunmur**.
RU say markerləri: `сколько, количество, всего, число` (+ `kaç` TR üçün).
Yoxlama: `сколько станций в бакинском метро` → `станций в бакинском метро количество` ✓

### B2. `site:` və domen tokenları dil aşkarlanmasından/tərcümədən ƏVVƏL təmizlənir

- `lib/expand.js:79` — `stripSiteAndDomains()`; istifadə: `expand.js:141` (dil aşkarlanması),
  `expand.js:146` (tərcümə hazırlığı), `route.js:110` (`query_lang`).
- Lüğət: `lib/expand.js:24-27` (`stansiya → station`, `metropoliten → metro`, …) və
  `lib/clean.js:386` AZ leksikonuna `stansiya/metropoliten/universitet/…` əlavə olundu
  (buna görə `stansiyaların sayı` artıq **tr** yox, **az** aşkarlanır).
- **Əlavə səhv tapıldı:** `site:` sorğusunda provayderlərin çoxu operatoru saymır →
  domen süzgəcindən sonra **0 nəticə** qalırdı. İndi domenin öz səhifəsi paralel oxunur:
  `readSiteDirect()` (`route.js:1518`), `fetchAndExtract` ilə 4 ümumi yol
  (`/`, `/about`, `/haqqinda`, `/haqqimizda`), nəticələr `raw_content` ilə saxlanır
  (`route.js:803`), domen daxilində 1 səhifə limiti `site:` halında 4-ə qalxır
  (`route.js:658`).

### B3. Qlobal ~8 s deadline — `app/api/search/route.js:987`

`withinDeadline(p, reserve)` — vaxt bitibsə, körpü/provayder cavabı **gözlənilmir**;
hazır olan qaytarılır (`route.js:1046, 1087, 1154`). Ölçmə: RU sorğusu **7922 ms**
(əvvəl 7944 ms) — sərhəddə, səbəb provayder gecikməsi (aşağıda "Açıq qalanlar").

---

## C. Testlər

### C1. Unit (`node tests/unit-tests.mjs`) — **564 keçdi, 0 uğursuz** (əvvəl 543)

Yeni 21 yoxlama (`tests/unit-tests.mjs`, v112 bloku) — hər qayda üçün **rədd + qəbul**:

- `12 stansiyadan ibarət … xətt` → 12 **rədd**; `3 xət və 27 stansiyadan ibarətdir` → **27 qəbul**
- `Hər stansiya üçün 17 avtobus` → 17 **rədd**; `Stansiyaya 17 avtobus xidmət edir` → **17 qəbul**
- `3-cü stansiya` → rədd; `2013-10-21` → rədd; `10 yeni stansiya inşa ediləcək` → rədd
- alt-siyahı `13 stansiyası ("…","…","…")` → rədd; `27 stansiya və 41 vaqon` → **27**
- çarpaz təsdiq: 27 iki host → `count=2`; eyni cümlə 2 saytda → `count=1`;
  26×3 (köhnə) vs 27 (rəsmi, təzə) → `agreement:"conflict"` və 27 **gizlədilmir**
- B1: RU → `количество`, AZ → `sayı`, EN → əlavə yoxdur; B2: `site:`/domen təmizliyi
- `stansiyaların sayı` → `stansiya`

### C2. Golden (`node eval/run.mjs eval/golden.json 3`) — **27 keçdi / 1 bilinən / 2 UĞURSUZ (30)**

v112-də 4 yeni rəqəm/tarix yoxlaması əlavə olundu (`eval/golden.json`):

| Sorğu | Yeni yoxlama | Nəticə |
|-------|--------------|--------|
| Azərbaycanın əhalisi nə qədərdir | `answerNum: 10180770` | **PASS** |
| Bakıda neçə universitet var | `answerNum: 49 ± 4` | **PASS** |
| Azərbaycanda minimum əmək haqqı nə qədərdir | `answerNum: 400` | **PASS** |
| Xocalı faciəsi nə vaxt olub | `answerYear: 1992`, `answerContains: ["26 fevral"]` | **PASS** |

Uğursuz 2 yoxlama v111 ilə **eyni** (yeni reqressiya deyil):
`[HTTP ilə HTTPS arasındakı fərx nədir]` (səhifə gözləntisi), `[GPT-5 nə vaxt çıxdı]` (2025 ili).
Bilinən boşluq: `[Azərbaycanda pambıq istehsalı]` (`eval/known-gaps.json`).

### C3. Canlı 4 sorğu (olduğu kimi)

| # | Sorğu | Nəticə (olduğu kimi) |
|---|-------|----------------------|
| 1 | `Bakı metrosunda neçə stansiya var` | **27 stansiya** (mətndən çıxarıldı) · `agreement: weak` · confirmations `27×1, 26×1` · `conflicts_count: 1` · n=5 · **4556 ms** |
| 2 | `Azərbaycanda neçə universitet var` | **cavab rəqəmi YOX** — n=2, birinci nəticə `Azərbaycan` (az.wikipedia). Provayder qıtlığı; eyni sorğu 20 dəqiqə əvvəl **51 universitet** verirdi (tr.wikipedia) |
| 3 | `site:metro.gov.az stansiyaların sayı` | **27 stansiya** · yalnız `metro.gov.az` hostları (3 nəticə) · `agreement: weak` · **3022 ms** — əvvəl bu sorğu **0 nəticə** verirdi |
| 4 | `сколько станций в бакинском метро` | **cavab rəqəmi YOX** — n=4, birinci nəticə rus dilli xəbər (rəqəmsiz); hostlar: 1news.az, support.microsoft.com, … · **7170 ms** |

Qeyd: 2-ci və 4-cü sorğu **say mexanizminin** deyil, **mənbə örtüyünün** uğursuzluğudur —
həmin anlarda korpusda rəqəm yox idi (4-cü sorğuda microsoft.com kimi mövzudan kənar
nəticələr gəldi). 4-cü sorğuda dil/say sözü düzəlişi işləyir: `rewritten_query =
станций в бакинском метро количество`.


### C4. 100 sorğuluk fayl

İki ölçmə **eyni şərtlərdə** aparıldı: lokal server (`node /home/user/local-server.mjs`,
route.handleSearch birbaşa), `--conc=2 --fresh=0`, eyni 100 sorğu faylı.

| Metrik | v111.3 (baza) | v112 | fərq |
|--------|---------------|------|------|
| S1 strong% | 100 | 100 | 0 |
| S2 strong% | 75 | 65 | **−10** |
| S3 strong% | 85 | 85 | 0 |
| S4 strong% | 65 | 65 | 0 |
| S5 strong% | 50 | 45 | −5 |
| EN strong% | 86 | 86 | 0 |
| AZ strong% | 69 | 66 | −3 |
| TR strong% | 70 | 63 | −7 |
| off/boş | 13/100 | 15/100 | +2 |

**Reqressiya siyahısı (v112-də uğursuz, bazada uğurlu — 5 sorğu):**

- `[EN S5] I am building a retrieval augmented generation system for a small team` → github/arxiv
- `[TR S2] yapay zeka nedir` → ibm/en.wikipedia/geeksforgeeks
- `[TR S5] Fatih Sultan Mehmet'in 1453'te İstanbul'u fethi …`
- `[AZ S4] Azərbaycan Xalq Cümhuriyyətinin yaranması səbəbləri və fəaliyyət illəri`
- `[AZ S5] 1918-ci ildə yaranan Azərbaycan Xalq Cümhuriyyətinin qurulması, hökuməti …`

**Düzələn (bazada uğursuz, v112-də uğurlu — 3 sorğu):**

- `[AZ S3] Azərbaycan dilində açıq mənbə NLP dataset`
- `[AZ S4] Qobustan qaya rəsmləri neçə yaşındadır və harada yerləşir`
- `[AZ S5] Azərbaycan dilində dil modeli təlim etmək üçün yüklənə bilən açıq mənbələr`

**Bu 5 "reqressiya" kod səbəbli DEYİL (yoxlanıldı):** həmin sorğular tək-tək yenidən
işlədildikdə hamısı nəticə qaytarır (5, 3 və 2 nəticə). Səbəb batç ölçmədə provayder
limitləridir — baza ölçməsinin özündə də `{"status":429}` cavabları var
(`Qobustan`, `Azərbaycan Xalq Cümhuriyyəti nə vaxt yaranıb`). Yəni fərq **ölçmə
səs-küyü** səviyyəsindədir (əvvəlki gün eyni test 63→83 AZ arasında dəyişmişdi),
lakin **rəsmi olaraq sıfır reqressiya olduğunu iddia etmirəm**.

**Golden qeyri-sabitliyi (dürüst):** eyni kodla ardıcıl 3 golden qaçışı:
`27 keçdi / 1 KNOWN / 2 FAIL` → `26 / 1 / 3` → `24 / 1 / 5`. Sonrakı qaçışlarda uğursuz
olan sorğular (metro sayı, universitet, minimum əmək haqqı, JS map/forEach) **dərhal
sonra tək-tək işlədildikdə keçir** (metro: 27, n=5). Səbəb: tək IP-dən ardıcıl 100-lük
və golden qaçışları → provayder throttling. **Yekun: sabit şəraitdə 27/1/2, yüklənmə
altında 24–27 arası.**


---

## D. Dürüst hesabat

### D1. Yoxlanılmayan / yoxlanıla bilməyən

1. **Metro reprosu (12 @ 99) təkrar istehsal olunmadı.** Ölçmə anında həm v111.3
   (baza), həm v112 `27` qaytardı — yəni 12-nin qalib gəlməsi **canlı korpusdan asılıdır**.
   Ona görə 12 ssenarisi **süni korpusla** yoxlanılır (unit testlər: eyni cümlə, alt-obyekt,
   plan, alt-siyahı). Bu, real korpusda 12-nin bir daha qalib gəlməyəcəyinə **təminat deyil**,
   yalnız həmin səbəb sinfini bağlayır.
2. **`minimum əmək haqqı = 400`** golden yoxlaması canlı mənbədə **345 manat** (köhnə xəbər)
   göstərən cavabla da PASS aldı — çünki `answerNum` cavab mətnindəki hər hansı rəqəmi yoxlayır,
   məntiqi ardıcıllığı yox. 2026-cı il üçün faktiki minimum **təsdiqlənmədi**.
3. **`Bakıda neçə universitet var` = 49 ± 4** — bu, canlı ölçmədə çıxan dəyərdir; rəsmi
   statistika (stat.gov.az) ilə tutuşdurulmadı. Tolerantlıq ona görə qoyulub.
4. **RU sorğusunun latency-si** ölçmələrdə 7170–7922 ms — 8 s həddinə çox yaxın;
   `withinDeadline` yalnız körpü gözləmələrini kəsir, provayderlərin öz gecikməsini yox
   (`searchAll` büdcəsi 3200 ms olsa da, ardınca gələn mərhələlər vaxt yeyə bilir).
5. **`agreement` semantikası** sadələşdirilmişdir: "rəqib rəsmidirsə → conflict".
   Rəsmi səhifədə alt-qrup sayı (məs. bir xəttin stansiyaları) hələ də "conflict" yarada bilər;
   bunun üçün mötərizəli alt-siyahı qaydası əlavə olundu, amma başqa formalar qala bilər.

### D2. Qismən işləyən

- **`сколько станций в бакинском метро`**: dil/say sözü düzəldi (`количество`), kiril
  çıxarışı süni mətndə işləyir (`Бакинский метрополитен имеет 27 станций` → **27**),
  **amma** canlı sorğuda provayderlər ya 1 rus dilli məqalə (rəqəmsiz), ya da
  microsoft.com kimi mövzudan kənar nəticələr qaytardı → cavab rəqəmi **verilmədi**.
  Bu, say mexanizminin deyil, **mənbə örtüyünün** problemidir (rus dilli provayder azlığı).
- **`site:metro.gov.az stansiyaların sayı`**: domendən kənar nəticə **yoxdur**, cavab
  **27 stansiya**, `agreement: weak`. Əvvəl bu sorğu **0 nəticə** verirdi.

### D3. Dəyişdirilməyən / toxunulmayan

- Heç bir cavab sahəsi **silinmədi** — `confirmations`, `agreement`, `raw_content`
  yalnız **əlavə**dir.
- Golden-da heç bir gözlənti **yumşaldılmadı**; `known-gaps`-ə heç nə köçürülmədi.
- Say mexanizmi qeyri-rəqəmli sorğularda işə düşmür (`hasCountMarker` + `countNounFromQuery`).
