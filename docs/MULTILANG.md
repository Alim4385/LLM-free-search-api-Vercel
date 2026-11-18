# Çoxdilli axtarış eksperimenti (v105)

Sual: "Sistem ingiliscə axtarır — TR/RU və başqa dilləri də əlavə etsək nəticə yaxşılaşar?"

## 1. Ölçmə: TR/RU axtarış nə qədər YENİ nəticə gətirir?

`eval/multilang.mjs`, 10 AZ sorğu (rəqəm, say, tarix, coğrafiya, anlayış):

| metrik | nəticə |
|---|---|
| AZ qolu (AZ+EN, hazırkı sistem) | 24 nəticə/sorğu, 80 "faydalı" |
| TR+RU qolları əlavə etdi | +293 nəticə, +140 yeni host |
| onlardan FAYDALI (gözlənilən açar söz var) | **+27** |
| latency | TR ~2.2 s, RU ~1.9 s (paralel getsə də hər biri ayrı fan-out) |

➡️ Həcm böyük (+29 nəticə/sorğu), **fayda kiçik** (+27/10 sorğu ≈ 2.7).

## 2. Ölçmə: tərcümə ilə vikipediya körpüsü

AZ sorğunu TR/RU-ya tərcümə edib həmin dilli vikipediyada axtarmaq (10 sorğu):

| vəziyyət | nəticə | faydalı |
|---|---|---|
| AZ sorğu ilə tr.wikipedia | 7 | 2 |
| **TR-yə tərcümə edilmiş sorğu ilə tr.wikipedia** | **50** | **26** |
| RU-ya tərcümə ilə ru.wikipedia | 50 | 10 |

➡️ Tərcümə şərtdir (tərcüməsiz TR/RU axtarışı demək olar ki, boş qaytarır).
TR korpusu AZ mövzularında həqiqətən zəngindir: `Hocalı Katliamı`, `Şeki`, `Azerbaycan'daki üniversiteler listesi` (içində **51** — həmin sualın cavabı).

## 3. A/B: sistemin son cavabı dəyişirmi?

`AZ_BRIDGE=0/1`, 10 sorğu, növbəli (interleaved) ölçmə:

| metrik | OFF | ON |
|---|---|---|
| düzgün cavab tapıldı | 7/10 | **7/10** |
| nəticə sayı | 23 | 21 |
| orta latency | 4489 ms | 4434 ms |
| körpü nə vaxt işə düşdü | — | 3/10 |

➡️ Cavab sayı dəyişmir, latency dəyişmir. Körpü yalnız nəticə çox az olanda işə düşür.

## 4. Nəticə və qərar

1. **Körpü kodu saxlanıldı, default SÖNÜK** (`AZ_BRIDGE=1` ilə açılır). Səbəb: qazanc
   cavab səviyyəsində görünmədi, əvəzində hər sorğuya əlavə Wikimedia API çağırışı gəlir və
   prod-da `wikipedia: error` (429) hallarını artırır — bu isə əvvəl işləyən sualları sındırır.
2. **Wikimedia API keşi (10 dəq)** qaldı — bu, 429 yükünü real azaldır (v105.5).
3. **Ən böyük problem dil deyil, çıxarışdır (extraction):** tr.wikipedia səhifəsində "51"
   rəqəmi var, amma (a) səhifə mətnini götürmək lazımdır (API `explaintext` ~300 ms),
   (b) say çıxarışı "51 üniversite" kimi TR ismi tanımalıdır. Növbəti addım budur:
   körpü səhifələrinin MƏTNİNİ API-dən götürüb say/ölçü/tarix çıxarışına vermək.
4. Provayder hovuzu genişlənəndə (brave/yahoo limiti açılanda) çoxdilli fan-out yenidən ölçülməlidir —
   `eval/multilang.mjs` hazırdır, keş sayəsində təkrar ölçmə sürətlidir.

## 5. Golden qapısı (canlı, v105.6 / FV 213)

`26 keçdi / 1 bilinən / 3 uğursuz`. Uğursuzluqlar: `GPT-5` (prod-da wikipedia 429 →
tarix mətni gəlmir), `minimum əmək haqqı` və `HTTP-vs-HTTPS` (mənbə hostu). Gün ərzində
provayderlər dəyişdiyi üçün qapı 26–29 arasında oynayır.

---

# v106 — məqalə səviyyəsində dil körpüsü (işləyən versiya)

Fikir: axtarışı TR/RU-da TƏKRARLAMAQ əvəzinə, tapılmış məqalənin `langlinks`-i ilə
qarşılığını götürmək (1–2 API çağırışı, determinist, ~600 ms, 10 dəq keş).

Yeni modul: `lib/wikilink.js`
- `wikiTitleFromUrl`, `cleanWikiQuery` — saf funksiyalar (test olunur)
- `bridgeByQuery(enQuery)` — EN wiki axtarışı → `langlinks` → TR/RU mətn (`explaintext`)
- `bridgeCount(azQuery, enQuery, noun)` — yalnız məqalənin GİRİŞİNDƏ (ilk 900 simvol) "N + isim"
- `bridgeDate(azQuery, enQuery)` — çıxarış məqalənin öz dilindəki başlıqla aparılır

`lib/measure.js`: TR ayları (`Şubat`, `Mayıs`, `Ağustos`…) əlavə edildi və tarix nümunələri
normallaşdırılmış mətn üzərində işləyir (əvvəl `Şubat` ümumiyyətlə oxunmurdu).
`AZ_BRIDGE` (axtarış səviyyəsindəki köhnə körpü) default sönük qalır — bu yenisi ondan fərqlidir.

## Ölçmə (canlı, v106)

| sual | əvvəl | indi | mexanizm |
|---|---|---|---|
| Azərbaycanda neçə universitet var | cavab yox | **51 universitet** | tr.wiki "Azerbaycan'daki üniversiteler listesi" (girişdə "51") |
| Bakı metrosunda neçə stansiya | 27 (bəzən) | **27 stansiya** | yerli mətn + körpü |
| Xocalı soyqırımı nə vaxt | 26 fevral 1992 | **26 fevral 1992** | tr.wiki "Hocalı Katliamı" (TR ayı oxunur) |
| Azərbaycan himni nə vaxt | dəyişkən | **1918-ci ildə** | yerli mətn (körpü ehtiyat) |
| pambıq istehsalı | 784 min ton (1986) | açıq qalır | retrieval məhdudiyyəti |

**Ölçü (measure) suallarında körpü QƏSDƏN söndürülüb:** türkcə "üretim/alan" sözləri AZ
dimensiya qaydalarına (`istehsal/sahə`) uyğun gəlmir və köhnə rəqəm qalib gəlirdi
("pambıq istehsalı" → 1913-cü ilin 1,1 milyonu). Say və tarixdə isə qazanc aydındır.

## Yekun

- `npm test`: **535 keçdi, 0 uğursuz** (4 yeni test: TR tarix, AZ format qorunması, URL parse, sorğu təmizliyi)
- Golden: **27 keçdi / 1 bilinən / 2 uğursuz** — qalan ikisi mənbə-host gözləntisidir, cavab məzmunu deyil.

---

# v108 — "ölç" nəticələri: körpü ölçü suallarında

## Tapılan BUG (ən qiymətli nəticə)

`prop=extracts` çağırışında `exchars=6000` göndərirdik, amma **server onu ~1200 simvolda kəsir**:

| sorğu | nəticə |
|---|---|
| `Pamuk` + `exchars=6000` | **1205 simvol** |
| `Pamuk` (parametrsiz) | **4855 simvol** |

Yəni bütün dil körpüləri (say, tarix, ölçü) acından qalırdı — mətn 4 dəfə qısa gəlirdi.
Düzəliş: `exchars` silindi, tam mətn alınır və **özümüz** `maxChars`-a kəsirik (`lib/wikilink.js`).

## Ölçü körpüsünün ölçməsi (5 sual, canlı wiki)

| sual | körpü mətni | cavab | qərar |
|---|---|---|---|
| pambıq istehsalı | tr «Azerbaycan'da pamuk üretimi» | **831.000 ton** | ✅ qəbul (əvvəl: 1,1 milyon — 1913-cü il) |
| neft hasilatı | tr «Azerbaycan'da petrol endüstrisi» | 21 metr → **rədd** | bal < 3 |
| Xəzər sahəsi | tr «Hazar Depresyonu» | 28 metr → **rədd** | bal < 3 |
| əhali | tr «Azerbaycan demografisi» | 14 yaş → **rədd** | bal < 3 |
| qaz hasilatı | ru «Список стран по добыче…» | null | mətn tapılmadı |

Nəticə: **1/5 qazanc, 0/5 zərər** — çünki hədd yüksəkdir (≥3). Ona görə körpü yalnız
**yerli mətndən rəqəm çıxmadıqda** işə düşür (`measure_bridge` mərhələsi).

## Köməkçi qaydalar (özü də ölçüldü)

1. **Vahid ailəsi** (`unitFamilyOfQuery` / `unitFamilyOfUnit`): sual "hasilat" soruşursa
   vahid kütlə/həcm olmalıdır; "sahə" → km²/hektar; "əhali" → nəfər; "uzunluq" → metr.
   Uyğunsuz vahid −2.4 bal. Tək miqyas sözü ("1,1 milyon") ölçü cavabı sayılmır.
   Bu qayda olmadan "21 metr", "14 yaş" kimi təsadüfi rəqəmlər qalib gəlirdi.
2. **Ölçü sualında SAY mexanizmi söndürülür**: "nə qədər" hər iki markerə düşürdü və say
   körpüsü ölçü körpüsünü əvəz edirdi (pambıq sualı "say" kimi emal olunurdu).
3. **Körpü üçün EN sorğu tərcümə ilə qurulur** ("How much cotton is produced in Azerbaijan?"):
   AZ sorğu ilə `list=search` yanlış səhifə qaytarır. Tərcümə paralel gedir, cavabı bloklamır.

## Geri götürülən təcrübə

v107-də əlavə etdiyim "başqa dilli səhifə sorğunun ≥2 termini ilə uyğunlaşırsa, dil cəzası
ləğv olunur" qaydası **zərərli çıxdı**: "JavaScript-də map ilə forEach fərqi" sualında
perlmonks.org (2.40) MDN-i üstələdi. Texniki suallar artıq `techQ` ilə azaddır — qayda
geri götürüldü. Sərt "kiril/ərəb mətni = 0 bal" blokunun cəzaya (−2.0) çevrilməsi isə QALIR.

## Yekun

- unit: **536/0**
- golden (FV 218): **28 keçdi / 1 bilinən / 1 uğursuz**
- pambıq: canlı cavab **831.000 ton** (mənbə: tr.wiki məqaləsi)

---

# v109 — metro.gov.az və client-rendered rəsmi saytlar

## Problem

`https://metro.gov.az/about` bizim üçün **boş səhifə** idi (çıxarış 0 simvol). Səbəb:
sayt Next.js ilə qurulub, görünən DOM boşdur, bütün mətn "hydration payload"
(`self.__next_f.push([1,"…"])`) içindədir — `\u003cp\u003e…` kimi escape olunmuş HTML.
Bu, `.gov.az` saytlarının böyük hissəsinin quruluşudur.

## Düzəliş (`lib/extract.js`, `extractHydrationText`)

1. `self.__next_f.push` parçaları JSON kimi açılır (+ `__NEXT_DATA__` dəstəyi).
2. HTML teqləri atılır, `\u003c` kimi escape-lər açılır.
3. Cümlə səviyyəsində təmizləmə: 40–420 simvol, CSS/JS zibili (`{`, `:where(`, `--ant-`) atılır.
4. React element massivlərindəki `"children":"…"` sətirləri də götürülür.
5. Yalnız görünən mətn 400 simvoldan az olduqda işə düşür — normal saytlara toxunmur.

Nəticə: `metro.gov.az/about` → **6 188 simvol** mətn, o cümlədən:
> "Bu gün isə Bakı metropoliteni **3 xətt, 27 stansiya və 40,7 kilometrlik** şəbəkəsi ilə…"

## Əlavə qaydalar (ümumi, sayta bağlı deyil)

| qayda | nə üçün |
|---|---|
| `.gov.az` hostuna +0.9 bal | rəsmi ilkin mənbə medianın arxasında qalırdı |
| `.gov.az` səhifəsindən say +0.6 | medianın "20 vaqon"u rəsmi "377 vaqon"u üstələyirdi |
| say çıxarışında **tarix rəqəmi rədd** | "28 aprel 1989" (stansiyanın açılışı) say kimi oxunurdu |
| "hansı ildə açılıb/təsis olunub" → **ən erkən il** | 1967 yerinə 2026-cı ilin fərman tarixi seçilirdi |
| `transport` topic → `metro.gov.az` site-hint | `SITE_HINT_FOR` xəritəsinə əlavə (legal/edu/econ/health yanına) |
| **site-hint axtarışı paralel** | əvvəl ardıcıl idi və "2 saniyədən tez" şərti ilə uzun axtarışlarda heç vaxt işləmirdi |

## Canlı nəticələr

| sual | cavab |
|---|---|
| Bakı metrosunda neçə stansiya var | **27 stansiya** ✅ (golden: PASS) |
| Bakı metropoliteni hansı ildə açılıb | **1967** ✅ (golden: PASS) |
| Bakı metropoliteni neçə stansiya və xətt var | 3 xətt ✅ |
| Bakı metrosunun uzunluğu | 40,7 km (rəsmi mənbə tapılanda) — provayderdən asılıdır |

Yekun: unit **540/0**, golden **28 keçdi / 1 bilinən / 2 uğursuz** (31 yoxlama; 2 yeni metro
case-i əlavə olundu və hər ikisi keçir).
