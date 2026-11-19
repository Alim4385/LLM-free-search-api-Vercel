# v115 — provayder müqaviməti (resilience) və texniki suallar (FILTER_VERSION = 232)

v114-ün qapıları yenidən, provayderlər **canlı** ikən qaçırıldı (`brave`/`yahoo` 429-suz).
Nəticə: 8 uğursuzluq kod qüsuru idi, throttling deyil. Aşağıda ölçmə ilə təsdiqlənmiş
düzəlişlər.

---

## 1. Texniki sualda İNGİLİSCƏ anchor yox idi → AZ zibil səhifələr

**Fayl:** `lib/search.js` (`techEnQuery`, `searchAll` sətri ~1217), `app/api/search/route.js` (sətri 353)

**Ölçmə (düzəlişdən əvvəl):**
```
sorğu: Python-da virtual mühit necə yaradılır
anchor_query: null                      ← tərcümə "skip" olunur, EN variant yoxdur
provayderlərə gedən sorğu: AZ mətni
nəticələr: code.mu, youtube.com, edu-cisco.org, sobes.tech, products.fileformat.com
```
Yəni texniki sualda AZ dilində yazılmış səhifələr gəlir, kanonik mənbələr (docs.python.org,
stackoverflow.com) heç sorğuya düşmür.

**Düzəliş:** `techEnQuery(query)` — kod tokenləri (böyük hərflə başlayan / rəqəm-daşıyan:
`Python`, `Docker`, `gpt-5`, `useState`) + ~60 sözlük texniki lüğət (`mühit→environment`,
`fayl→file`, `oxuma→read`, `fərq→difference`, `maşın→machine`…) və AZ sual köməkçilərinin
atılması. AZ hal şəkilçiləri kəsilir (`Python-da → python`).

```
"Python-da virtual mühit necə yaradılır" → "python virtual environment create"
"Python-da fayl oxuma necə olur"         → "python file read"
"Docker ilə virtual maşın arasındakı fərq" → "docker virtual machine difference"
"Bakı metrosunda neçə stansiya var"      → "" (texniki deyil → işə düşmür)
```

Anchor həm provayder sorğularına (`anchorQuery`), həm də **skor terminlərinə** əlavə olunur —
əks halda `docs.python.org` səhifələri AZ terminləri ilə 0 bal alıb süzgəcdən düşürdü.

---

## 2. Rəsmi sənəd (docs) üçün ayrılmış yer — `docs_slot`

**Fayl:** `app/api/search/route.js` (limit kəsməsindən SONRA)

**Problem:** AZ dil üstünlüyü qaydası ilə ilk 5 yeri AZ səhifələr tutur; `docs.python.org`,
`developer.mozilla.org`, `stackoverflow.com` kənarda qalır (texniki sualda bu, cavabın
keyfiyyətini aşağı salır).

**Düzəliş (dil qaydası pozulmur, AZ nəticələr qalır):**
* `isTechQuery` olanda və siyahıda kanonik sənəd hostu yoxdursa — hovuzdan ən yaxşı sənəd
  namizədi götürülür və **ən zəif AZ nəticə** onunla əvəz olunur (`extracted`/`site-direct`
  toxunulmazdır);
* sənəd mənbələrinə skor döşəməsi (`≥ 3.0`) verilir — `scored` bir neçə mərhələdə yenidən
  hesablandığı üçün döşəmə təkrar tətbiq olunur;
* blok **limit kəsməsindən sonra** işləyir (əvvəl `applyFinalLimits` onu atırdı).

**Nəticə (spot, canlı):**
```
Python-da virtual mühit → … docs.python.org        (stages: docs_slot)
Python-da fayl oxuma   → … docs.python.org        (stages: docs_slot)
Docker ilə virtual maşın → … stackoverflow.com    (stages: docs_slot)
SQL JOIN növləri       → … stackoverflow.com      (stages: docs_slot)
```

---

## 3. `searchOfficialDocs` — deterministik sənəd domeni (şəbəkəsiz)

**Fayl:** `lib/search.js` (`DOCS_DOMAINS`, `searchOfficialDocs`)

Bing `site:` operatorunu artıq **nəzərə almır** (ölçmə: `site:docs.python.org virtual
environment` → nəticələr python.org/jetbrains/codecademy), Brave/Yahoo isə 429 verir.
Ona görə texnologiya → rəsmi sənəd domeni cədvəli ayrıca provayder kimi işlədilir:
`python→docs.python.org`, `docker→docs.docker.com`, `react→react.dev`, `node→nodejs.org`,
`git→git-scm.com`, `postgres→postgresql.org`, `mysql→dev.mysql.com`, `sql→w3schools.com`.
Şəbəkə çağırışı yoxdur (~0 ms), 429 riski yoxdur.

> Qeyd: əvvəlki variant en.wikipedia `extlinks` ilə **dəqiq səhifə** tapırdı, lakin 2 əlavə
> Wikimedia çağırışı 429 yaradırdı və nəticə qeyri-sabit idi (bir qaçışda işləyir, digərində
> "wiki-docs no article"). Ona görə statik cədvəl seçildi — mənbə domeninə görə düzgündür,
> konkret səhifəyə görə yox.

---

## 4. `providerTermGate`: `site:` sorğusunda sayt məhdudiyyəti özü zəmanətdir

**Fayl:** `lib/search.js` sətri 27

Ölçmə: `site:docs.python.org virtual environment` → Bing 7 nəticə qaytarır, gate **0** saxlayır
(2 termin tələbi qısa snippet-də ödənmir). `site:` olan sorğuda gate keçirilmir.

---

## 5. Wikimedia yükünün idarəsi (öz-özünü 429-a salmamaq)

**Fayl:** `lib/search.js` (`wikiSlot`)

* paralel Wikimedia çağırışı **3 → 2**;
* çağırışlar arasında **minimum 120 ms** fasilə (`WIKI_MIN_GAP_MS`);
* yeni sənəd provayderi də eyni semafor/keşdən (`wikiApiJson`) keçir.

Ölçmə: düzəlişdən əvvəl ardıcıl `wiki` çağırışları 429 qaytarırdı (`STATUS 429`), fasilə ilə
sabit 200.

---

## 6. Hava: `api.open-meteo.com` əlçatmaz olanda wttr.in ehtiyatı

**Fayl:** `lib/weather.js` (`fetchWttrFallback`, `WWO_TO_WMO`), `route.js` (hava bloku)

Ölçmə (bu şəbəkədə): `api.open-meteo.com` → **12 s timeout, HTTP 000**;
`geocoding-api.open-meteo.com` → 200/0.7 s; `wttr.in/Baku?format=j1` → **200/0.8 s**.

Düzəliş: open-meteo uğursuz olarsa wttr.in JSON-u **eyni formata** çevrilir
(WWO hava kodları WMO-ya map olunur: 116→2 "az buludlu", 122→3, 296→61 …) və cavab mətni
həmin formatdan qurulur. Mənbə adı/URL **faktiki provayderə** görə yazılır (`wttr.in`),
"open-meteo" yazmaq yanlış mənbə olardı.

```
Bakı hazırda: az buludlu, temperatur 13°C, hiss olunan 7°C, rütubət 64%, külək 29 km/saat.
Bu gün (…): max 16°C, min 9°C …
```

---

## 7. Ölçmələr

| göstərici | v114 | v115 |
|---|---|---|
| unit testlər | 601 / 0 | **601 / 0** |
| golden (30 yoxlama) | 22 keçdi / 8 uğursuz | **26 keçdi / 4 uğursuz / 0 boşluq** |
| wiki bench | top1 14/15 | top1 14/15 (dəyişməyib) |

**Qalan 4 uğursuzluq (olduğu kimi):**

| # | sorğu | səbəb |
|---|---|---|
| 1 | Bakı metrosunda neçə stansiya var | mənbələr 26/27 deyir, `agreement: conflict` — kod düzəlişi deyil, mənbə ziddiyyəti |
| 2 | Python-da virtual mühit necə yaradılır | sənəd səhifəsi (docs.python.org) siyahıdadır, lakin **"venv" kod tokeni** mətnində yoxdur (kök səhifə verilir) |
| 3 | Bakıda neçə universitet var | rəsmi siyahı səhifəsi (stat.gov.az/edu.gov.az) gəlmir; say 49±4 yox |
| 4 | dünyanın ən böyük səhrası hansıdır | Antarktida cavabı yox (AZ wiki-də "Səhra" məqaləsi seçilir) |

**Növbəti addımlar:** (a) sənəd provayderində kök yerinə **mövzuya uyğun səhifə**
(`/3/library/venv.html` səviyyəsi — sitemap/`objects.inv` və ya sənəd daxili axtarışla);
(b) say suallarında rəsmi statistika domenlərinin (`stat.gov.az`, `edu.gov.az`) prioriteti;
(c) superlativ suallarda ("ən böyük") vikipediya cavabının birbaşa çıxarılması.

---

## Test əmrləri

```bash
node tests/unit-tests.mjs                                   # 601 keçdi, 0 uğursuz
API_BASE=http://127.0.0.1:3999/api/search node eval/run.mjs eval/golden.json 3
node bench/spot.mjs "Python-da virtual mühit necə yaradılır" "Docker ilə virtual maşın arasındakı fərq"
node bench/wiki-bench.mjs
DEBUG_DOCS=1 node local-server.mjs                          # sənəd sorğusu/slot izləri
```
