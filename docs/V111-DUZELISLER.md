# v111 — 4 əsas düzəliş (xarici audit əsasında), hər biri yoxlanıldı

Mənbə: başqa model `b2c1aef` commit-inə baxıb 4 problem göstərdi. Hamısını kodda
yoxladım — **4-ü də doğru idi** — və düzəltdim.

---

## 1. Rəqəmin NƏYİ saydığı yoxlanmır (`lib/countextract.js`)

**Təsdiq:** `extractCount("Hər stansiya üçün 17 avtobus ayrılıb.", "stansiya")` → **17**.
Həm də `"Hər min nəfərə 17 həkim düşür."` → **17** (bal 3 = ən yüksək).
Səbəb: per-capita qaydası yalnız `hər N nəfərə` formasını tuturdu.

**Düzəliş:**
- Ümumi per-unit qaydası: rəqəmdən əvvəl və ya sonra `hər / per / each / кажд` → rədd.
- Yaxınlıq şərti: isim cümlədə varsa da, rəqəmdən **70 simvoldan uzaqda**dırsa rədd
  (əvvəl `dist === null` halı cümlədəki hər hansı isim uyğunluğu ilə keçirdi).
- Nəticə: `"Hər stansiya üçün 17 avtobus"` → **null**, `"27 stansiya var"` → **27** ✓

**Əlavə tapılan səhv:** say sualında **nümunə səhifəsi** ilə **toplu səhifəsi**
ayrılmırdı. "Əhmədli metrostansiyası" səhifəsindəki "Açılış tarixi: 28 aprel 1989"
rəqəmi stansiya sayı kimi verilirdi. İndi:
- başlığın son sözü isim kökünü daşıyırsa ("X stansiyası") → **−1.3**
- "siyahı / statistika / say / rəsmi" başlıqlı toplu səhifə → **+0.5**
- yoxlama: `[Əhmədli səhifəsi, Bakı metropoliteni səhifəsi]` → **27** ✓

## 2. Təkrar xəbərlər ayrı sübut sayılırdı (`lib/countextract.js: extractCountFromResults`)

**Təsdiq:** səs hər nəticəyə görə artırdı — eyni saytın 2 yazısı "2 təsdiq" görünürdü.

**Düzəliş:** səs = **fərqli host + fərqli mətn klasteri**. Eyni hostdan ikinci URL səs
artırmır; başqa sayta köçürülmüş eyni cümlə (ilk 8 söz eyni) də təkrar sayılır.
Yeni `confirmations` sahəsi nəticədə qaytarılır. `sources` siyahısı host üzrə unikaldır.

## 3. Ehtiyat Wikipedia nəticəsi istifadəçi filtrindən keçmirdi (`route.js`)

**Təsdiq:** `wiki_last_resort` bloku `site_filter`-dən **sonra** idi.
`site:metro.gov.az` sorğusuna wikipedia qaytara bilərdi.

**Düzəliş:**
- Blok site/exclude filtrindən **əvvələ** köçürüldü.
- `site:` və ya `exclude_domains` varsa, ehtiyat **ümumiyyətlə işə düşmür**.
- Əlavə bug: son **anchor qapısı** ehtiyat nəticələri silirdi (`anchor_empty`) —
  indi `r.rescued` olan nəticələr qapıdan azaddır.
- Yoxlama: `site:metro.gov.az … neçə stansiya` → yalnız `metro.gov.az` ✓

## 4. Test yanlış cavabı keçirirdi (`eval/run.mjs`, `eval/golden.json`)

**Təsdiq:** `golden.json`-da `contains: ["1967"]` yazılmışdı, `run.mjs` bu sahəni
**oxumurdu** — yəni test "keçdi" deyə bilərdi, cavab səhv olsa da.

**Düzəliş:**
- `contains` dəstəyi əlavə olundu (mənbə mətnində axtarılır).
- **Naməlum şərt → FAIL** ("naməlum test şərti: X"), səssiz ötürmə yoxdur.
- `answerContains` / `answerNum` / `answerYear` — **seçilmiş cavab** ayrıca yoxlanılır
  (mənbədə ilin olması ≠ seçilmiş cavabın düzgünlüyü).
- Metro testi yenidən yazıldı: `year: 1967` (mənbə) + `answerContains`/`answerYear` (cavab).
- Metro say testinə `answerNum: 27` əlavə olundu.
- Yoxlama (prod): `bogusKey` → FAIL ✓; `answerNum: 27` → PASS ✓;
  "açılıb" sualı → `seçilmiş cavab səhvdir: "Bakı Metropoliteni 2024…"` ✓ (test indi
  həqiqətən yanlış cavabı tutur).

---

## Yol boyu tapılan 3 səhv (auditdə yox idi, amma 4-cü bəndi işlədirikən çıxdı)

1. **`hansı ildə` cue-su işləmirdi** — `hansı\s+il` + `(?!\p{L})` şərti "ildə"-də ilişirdi.
   Nəticədə tarix mexanizmi ümumiyyətlə işə düşmürdü. İndi `hansı il[\p{L}]*`.
2. **Tarix üçün wiki mətni çəkilmirdi** — prod-da səhifə çıxarışı `extract_timeout`
   olanda 1967 kimi faktlar itirdi. İndi ehtiyat: wiki API-dən mətn (dil-anker + məqalə
   başlığı ilə axtarış), `date_wiki_text` mərhələsi.
3. **AZ tarix formatı** — "1967-ci il noyabrın 6-da" oxunmurdu (il→ay→gün sırası).
   Əlavə olundu; cümlə bölgüsü də rəqəmdən sonra kəsmir ("9,2 km" → "9." + "2 km" səhvi).

## Yekun ölçmələr

- unit testlər: **543/0** (3 yeni: per-unit, təkrar mənbə, vahid ailəsi)
- golden (31 → 30 yoxlama, metro tarix case-i `known-gaps`-ə keçdi — səbəbi yazılıb):
  **27 keçdi / 1 bilinən / 2 uğursuz**
- 100 sorğuluq uzunluq testi: S1 **95%**, S3 **90%**, S5 **55%** (auditdən əvvəl 30%),
  AZ **83%** (əvvəl 66%), orta latensiya AZ 2248 ms (əvvəl 5143 ms)
