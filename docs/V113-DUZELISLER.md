# v113 — düzəlişlər (FV 229)

Tarix: 2026-11-16. Əsas: v112 (`4e34087`, FV 228).
Bütün dəyişikliklər **additivdir**: köhnə cavab sahələri silinməyib, yalnız yeniləri əlavə olunub.
Qaydalar **ümumidir** — kodda metro/şəhər/obyekt adı literalı yoxdur.

## 1. Say — ölçü suallarına "sayı" əlavə olunmur (#2)

**Problem:** `countSearchQuery()` hər "neçə / nə qədər" sualına "<isim> sayı" əlavə edirdi;
"Everestin hündürlüyü nə qədərdir" → *"Everestin hündürlüyü sayısı"* kimi mənasız sorğu.

**Düzəliş:** `lib/countextract.js`
- `MEASURE_NOUN_RE` + `isMeasureQuery()` — ölçü isimləri (hündürlük, uzunluq, dərinlik, məsafə,
  sahə, ərazi, əhali, yaş, çəki, həcm, sürət, temperatur, faiz, qiymət, gəlir, xərc, borc,
  pensiya, əmək haqqı + EN/RU qarşılıqları) siyahısı; şəkilçilərə davamlıdır (`hündürlüyü`,
  `məsafəsi`, `əhalisi`).
- `countSearchQuery()` ölçü sualında `null` qaytarır; `app/api/search/route.js:1011` say bloku da
  `!isMeasureQuery(...)` ilə qapadılır.

Nəticə: ölçü sualı öz axtarışı ilə gedir (`measure-extract`), say bloku işə düşmür.

## 2. Hashtag və spam cümlələrdən rəqəm çıxarılmır (#3)

`lib/countextract.js`
- Rəqəm `#` işarəli tokenin içindədirsə (`#Bakı27`) → `rejected: "hashtag"`.
- `SPAM_SENT_RE` (kredit, kazino, bonus, pulsuz qazan, 1xbet, lotereya, реклама, займ, казино …)
  uyğun gələn **cümlə tamamilə** atlanır — rəqəm namizədi kimi götürülmür.

## 3. Alt-domenlər bir nəşriyyatdır (#4)

`lib/countextract.js`: `regDomain()` + `regOfUrl()`.
- `portal.azertag.az` ≡ `azertag.az` ≡ `news.azertag.az`.
- `.gov.az`, `.com.az` kimi ikinci səviyyələr düzgün hesablanır: `sub.metro.gov.az` → `metro.gov.az`.
- Tətbiq yeri: `extractCountCross` (təsdiq sayı) və `extractCountFromResults`;
  `lib/measure.js` ölçü təsdiqlərində də eyni qayda.

## 4. Fərqli rəqəm qrupu → `agreement: "conflict"` (#5)

`lib/countextract.js` (`rivalStrong`) və `lib/measure.js`.
- Əvvəl yalnız **rəsmi** və ya **2+ təsdiqli** rəqib ziddiyyət sayılırdı; indi **hər fərqli dəyər
  qrupu** `conflict` verir (istifadəçi qərarı). Faiz/etimad rəqəmi qaytarılmır — yalnız marker.

## 5. `Bakıda / Bakıdan / Bakının` kök testi (#6)

`tests/unit-tests.mjs`: `stemAz("Bakıda") === stemAz("Bakıdan") === stemAz("Bakının") === "baki"`,
həmçinin şəhər halının sayılan isim kimi götürülmədiyi yoxlanılır
(`"Bakıdan neçə stansiya keçir"` → `stansiya`).

## 6. Türkcə "kaç … var" nişanları (#7)

`lib/countextract.js`
- `kaç` marker kimi tanınır (`hasCountMarker`), sayğaclar (`tane/adet/dane`) `NOUN_STOP`-a əlavə edildi.
- Söz sırası: `kaç tane müze var` → isim **markerdən sonra** götürülür (EN/RU qaydası ilə eyni).
- Sorğu təmizliyi: `"İstanbulda kaç tane müze var"` → `"İstanbulda müze sayısı"`.

## 7. Ölçü cavabının keyfiyyəti (Everest / Eyfel üçün kritik)

| Düzəliş | Nə üçün | Harada |
|---|---|---|
| `DELTA_RE` (−3.0) | "hündürlüyə 50 metrə qədər **əlavə** olunub", "10 santimetr **artır**", "6 metr **böyüyüb**", "qonşuları **üzərində**" — bunlar dəyişmə/müqayisə rəqəmidir, dəyər deyil | `lib/measure.js` |
| təxminilik cəzası (−0.6) | `təxminən / about / около / yaklaşık` | eyni |
| ölçü sözü çərçivəsi (+0.5) | "hündürlüyü **300 metr**" — ölçü sözü rəqəmdən dərhal əvvəl | eyni |
| entitiya süzgəci | sualın entitiyası sənəddə olmalıdır; "Eyfel hündürlüyü" sorğusuna Everest-in rəqəmi qarışmırdı | eyni (`entityTerms`, `docHasEntity`) |
| vahid ailəsi | uyğunsuz ailə (hündürlük sualında "ton") tam atılır | eyni (`unitFamilyOfQuery` + şəkilçi dəstəyi) |
| yaxın dəyər qrupu | `8848` və `8848,86` **bir faktdır** (≤0,5 %) — çarpaz təsdiq parçalanmırdı | eyni (`nearKey`) |
| çarpaz təsdiq | ölçüdə də `confirmations` / `agreement` / `conflicts` sahələri (saytdaki kimİ) | `lib/measure.js` + `route.js` |
| vikipediya ehtiyatı | səhifə çıxarışı `extract_timeout` olanda yalnız ~130 simvolluq snippet qalır; vikipediya mətni (≈300 ms) ölçü üçün oxunur, **yalnız ölçü sözü olan cümlələr** qəbul edilir (`strict`) | `route.js` (`measure_wiki_text`) |

## 8. Testlər

- `node tests/unit-tests.mjs` → **591 keçdi, 0 uğursuz** (v112: 564).
- Yeni testlər: #2 ölçü/`sayı`, #3 hashtag + spam, #4 alt-domen, #5 conflict/tək qrup,
  #6 Bakı kökü, #7 türkcə "kaç", ölçü delta/entitiya/yaxın dəyər/minimum əmək haqqı/pambıq.
- `node eval/run.mjs eval/golden.json 3` → **25 keçdi, 1 bilinən boşluq, 4 uğursuz** (30 yoxlama).
  Batch rejimində provayder throttling-i (eyni IP) səbəbindən dəyişir; tək yoxlamada:
  metro → **27**, min əmək haqqı sintetik mətndə → **400 manat**, pambıq → **360 min ton**.
  Uğursuz qalanlar: `minimum əmək haqqı` (mətn nazik, `extract_timeout`), `HTTP/HTTPS`,
  `Bakıda neçə universitet` (mənbə qıtlığı), `pambıq` (səhifə gözləntisi), `metro` (26 vs 27
  ziddiyyəti — hər iki rəqəm mənbələrdə var, `conflict` kimi göstərilir).

## 9. Canlı nəticələr (lokal, v113, 2026-11-16)

| Sorğu | Cavab | agreement | Təsdiqlər | ms |
|---|---|---|---|---|
| Everest dağının hündürlüyü nə qədərdir | **8848.86 metr** | conflict (8848.86×2 vs 4207×1, 10100×1) | qafqazinfo.az + yenixeber.az | ~2850 |
| Eyfel qülləsinin hündürlüyü nə qədərdir | **300 metr** | medium (300×2) / bəzən cavab yoxdur (mətn nazik) | hit.az + biletal.az | ~2900 |
| Bakı metrosunda neçə stansiya var | **27** | conflict (27×2 vs 26×1) | wikipedia.org + metro-map.net | ~2600 |
| Azərbaycanda neçə universitet var | **51** (2025) | weak (51×1) | statix.az | ~4400 |
| site:metro.gov.az stansiyaların sayı | **27** | weak (27×1) | metro.gov.az | ~2900 |

## 10. Bilinən açıq məsələlər (gizlədilmir)

1. **Everest-də rəqib səs-küyü:** axar.az mətnində başqa kontekstli rəqəmlər (4207, 10100)
   qrupu `conflict` edir — #5 qaydası olduğu kimi işləyir, rəqib siyahıda açıq göstərilir.
2. **Mətn nazik olanda cavab itir:** `extract_timeout` halında Eyfel bəzən cavabsız qalır
   (3 cəhddən 2-də 300 metr). Vikipediya ehtiyatı bunu qismən bağlayır.
3. **`26 vs 27` stansiya:** hər iki rəqəm real mənbələrdə var (keçid stansiyasının iki dəfə
   sayılması). Golden 27 tələb edir; sistem `conflict` qaytarır — səssiz seçim edilmir.
4. **`Bakıda neçə universitet`** mənbə qıtlığından (n=3, 198 simvol) cavabsız qalır.
5. Şəkilçi kökü (`qüllənin` → `qullen`) sadə kəsmlə işləyir; bəzi birləşmələrdə entitiya
   süzgəci sərtləşə bilər.
