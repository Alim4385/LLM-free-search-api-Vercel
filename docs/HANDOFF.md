# HANDOFF — layihənin tam vəziyyəti (yeni sessiya üçün)

> Bu sənəd **özü-özlüyündə kifayət edir**: yeni agent/sessiya yalnız bunu oxuyub işə davam edə bilər.
> Son yenilənmə: **2026-11-16** · `main` = **`b720f2f`** · FILTER_VERSION = **233**

---

## 1. Layihə nədir (mövzu)

**LLM-free search API** — Azərbaycan dilinə fokuslanmış, **LLM-siz (açar sözsüz, keyless)** axtarış API-si.
Məqsəd: istifadəçi sualını (AZ, TR, EN) qəbul edib **mənbələri + çıxarılmış cavabı** qaytarmaq —
Google/Google-AI səviyyyəsi ilə müqayisə hədəfi ilə, tamamilə pulsuz provayderlər üzərində.

- **Müəllif**: Alim4385 · **Repo**: `https://github.com/Alim4385/LLM-free-search-api-Vercel` (branch `main`)
- **Prod (canlı)**: `https://searchapi-eta.vercel.app` → `GET/POST /api/search`
- **Stack**: Next.js (App Router, `runtime = "nodejs"`), Vercel; ayrıca lokal test üçün
  `/home/user/local-server.mjs` (sadə Node HTTP server, `0.0.0.0:3999`, GET+POST).
- **Fəlsəfə**: provayderlər pulsuz/keyless (wikipedia, bing/bing-rss, ddg-lite, mwmbl, rss xəbər mənbələri,
  Wikidata, CBAR, open-meteo/wttr.in, wikipedia-docs/stackoverflow/github …). Ölü provayderlərə qayıtmaq
  lazım deyil: qwant 403, mojeek 403, marginalia 302, searx.be HTML, stackoverflow API 429, ddg-html timeout,
  brave/yahoo tez-tez 429.

### API kontraktı

```
GET  /api/search?q=<sual>&max_results=3&debug=1
POST /api/search   { "query": "...", "max_results": 3, "max_chars": 12000, "freshness": "...", "exclude_domains": [], "debug": true }
```

Cavabın yuxarı səviyyə sahələri (`app/api/search/route.js` ≈ L1653):
`query, intent, reason, results[], conflicts[], weather?, time?, currency?, meta{}`
`results[]` elementi: `id, title, url, snippet, content, source, score, published_at, updated_at, date_info,
agreement?, confirmations?, sources[], voteCount, extracted?`
`meta`: `providers_used, provider_errors, took_ms, cached, total_chars, query_lang, anchor_query, translated,
results_translated, confidence, dated_results, conflicts_count, fallback, degraded_stages[], timing{}`

**Rate limit**: 30 sorğu / 60 san (IP üzrə, Redis varsa Redis, yoxsa in-memory) — `lib/ratelimit.js`.

**Keş**: cavab `cacheKey("search", { q, n, c, l, tr, v: FILTER_VERSION, f, x })` ilə keşlənir —
yəni `FILTER_VERSION` dəyişəndə köhnə keş avtomatik etibarsız olur. Bu, deploy-dan sonra **eyni sualı
təkrar yoxlamağa** imkan verir (köhnə cavab qayıtmır).

---

## 2. Deploy zənciri (GitHub → Vercel) — “necə öz-özünə yenilənir”

1. `main`-ə **hər push** Vercel-də avtomatik **Production** build tetikləyir (başqa branch = Preview).
2. Build ~1–3 dəqiqə çəkir; build bitənə qədər prod köhnə kodu işlədir.
3. **Yoxlama üsulu** (build-in bitdiyini görmək): `debug=1` ilə cavabda `degraded_stages` və ya
   davranış fərqinə bax. Real nümunə (v116 deploy-undan sonra):
   `Everest dağının hündürlüyü nə qədərdir` → əvvəl `"848.86 metr"`, sonra `"8,848 metr (mətndən çıxarıldı)"`.
4. Push üçün credential **repoda saxlanmır** və commit edilmir. Token yalnız in-line push URL-i ilə verilir:
   `git push "https://x-access-token:<TOKEN>@github.com/Alim4385/LLM-free-search-api-Vercel.git" HEAD:main`
   (`.git/config`-a yazılmır; `git config` dəyişmir).

> **Təhlükəsizlik**: PAT istifadəçi tərəfindən çatda paylaşılıb → işdən sonra **rotate/revoke** etməyi xatırlat.
> Heç bir fayla, heç bir commit-ə token yazılmamalıdır.

---

## 3. Kod bazasının xəritəsi

```
app/api/search/route.js   ← ƏSAS BORU XƏTTİ (çox böyük fayl, ~1700 sətir)
lib/search.js             ← provayderlər (wikipedia/bing/bing-rss/ddg-lite/mwmbl/rss…), searchAll,
                            providerTermGate, wiki variantları, Wikimedia semaforu (429 idarəsi), docs axtarışları
lib/score.js              ← scoreResult, diversifyByDomain, dedupeNearDuplicates, confidence, spam/domen filtrləri
lib/rank.js               ← normalizeAz, tokenize (AZ kök/şəkilçi), trigram, dil aşkarlama
lib/countextract.js       ← "neçə X var" → rəqəm çıxarışı (cümlə seçimi, təsdiq sayı, agreement)
lib/measure.js            ← "nə qədərdir" → rəqəm+VAHİD çıxarışı (faiz, metr, manat, km²…), delta süzgəci
lib/units.js              ← vahid çevirmələri + v116: parseNumberToken (minlik/onluq ayırıcı)
lib/facts.js              ← Wikidata struktur faktları (əhali, sahə, paytaxt, valyuta, qonşular…)
lib/holidays.js           ← bayram/tarix cədvəli (structured)
lib/currency.js           ← CBAR məzənnə
lib/weather.js            ← open-meteo + wttr.in fallback (WMO kodları)
lib/time.js               ← "hansı saatdır" (timezone)
lib/sports.js, nutrition.js, livestat.js, math.js ← xüsusi strukturlu cavablar
lib/extract.js, clean.js  ← səhifə oxunuşu/çıxarış və təmizlik
lib/translate.js          ← AZ↔TR↔EN körpü (anchor query)
lib/conflict.js           ← mənbələr arası ziddiyyət (conflict) məntiqi
lib/azertag.js, sitemapnews.js, wikilink.js, suggest.js, router.js, finalize.js, circuit.js, cache.js, crypto.js
lib/data/azlex.js         ← aznlp (MIT) kök leksikonu
tests/unit-tests.mjs      ← 601 assert (invariantlar)
eval/golden.json + eval/run.mjs ← qızıl yoxlama dəsti (30 yoxlama)
bench/r15.mjs + bench/r15-pool.mjs ← 15-lik təsadüfi qapı (hər raund FƏRQLİ suallar)
docs/V11x-DUZELISLER.md   ← buraxılış hesabatları (vəziyyət olduğu kimi)
```

---

## 4. Sərt qaydalar (istifadəçinin doktrinası — pozulmamalıdır)

1. **Sual vermə** — layihəni gücləndir, kritik yerlərdə test et, işləyirsə əlavə et.
2. **Hər test raundu FƏRQLİ suallarla** — əvvəlki raundların sualları təkrarlanmır (bench bunu özü tətbiq edir).
3. **Dil = üstünlük, blok deyil**: sorğunun dilindəki mənbələr öndə, xarici mənbələr hovuzda qalır.
   EN, TR kimi bərabər körpüdür.
4. **Cavabı mənbədən ayır**: rəqəm uyğun deyilsə mənbə qalır, rəqəm irəli çəkilmir.
5. **Səhv cavab cavabsızlıqdan pisdir** — tarix/rəqəm çıxarışı soruşulan obyektə bağlanmalıdır.
6. **Faizlə confidence YOX** — yalnız say/marker (`agreement: strong/medium/weak/conflict`).
7. **Kontrakt dəyişmir** — köhnə sahələr silinmir, yeni sahələr yalnız **əlavə** olunur.
8. **Qaydalar ümumi olmalıdır** — metro/sorğu-spesifik literal yazmaq qadağandır.
9. **Dürüst hesabat** — testi yaşıl göstərmək üçün şərt yumşaltmaq olmaz; `known-gaps` yalnız yazılı səbəblə;
   hər düzəlişə fayl+sətif; uğursuzluqlar açıq sadalanır.
10. **AZ dili birinci**, müqayisə bazası Google/Google-AI.

---

## 5. Cari vəziyyət (ölçmələr)

| Göstərici | Nəticə |
|---|---|
| `main` HEAD | **`b720f2f`** (v116c) |
| FILTER_VERSION | **233** |
| Unit testlər | **601 keçdi, 0 uğursuz** (`node tests/unit-tests.mjs`) |
| Golden (`eval/golden.json`, `max_results=3`) | **25 keçdi / 5 uğursuz** — lakin sandbox-da Wikimedia 429 səbəbindən **run-to-run 21…27** dəyişir |
| **15-lik qapı (PROD API)** | **Raund 8: 15/15** ✅ (sərt metrik də 15/15) · Raund 9: 12/15 |
| Hovuz | `bench/r15-pool.mjs` — **149 sual**, istifadə olunmayan **14** |

Golden-da daimi uğursuzlar: `Bakı metrosunda neçə stansiya var` (26 vs 27 → real ziddiyyət, `conflict`),
`Bakıda neçə universitet var` (49±4 yox, stat.gov.az gəlmir), `dünyanın ən böyük səhrası` (Antarktida yox),
bəzən `Kant kateqorik imperativ` və `Nizami əsərləri` (wiki boş gələndə).

---

## 6. Son sessiyada nə edildi (v116 / v116b / v116c)

| # | Düzəliş | Fayl (yer) | Səbəb (ölçmə) |
|---|---|---|---|
| 1 | Provayder termin qapısı: nisbət sözləri (`hansı`, `ölkədəndir`, `şəhərdədir`, `qərargah`) məzmun termini sayılmır; xüsusi ad başlıqda varsa 1 uyğunluq kifayətdir | `lib/search.js` `providerTermGate()` | “Messi hansı ölkədəndir” → n=0 |
| 2 | Wiki variantları: **subyekt tokeni** (böyük hərfli söz **və ya** ilk söz + xassə sözü) təkbaşına variant; hal şəkilçisi **-2 və -3** formada (`çinin→çin`, `fransanın→fransa`); limit 4→5 | `lib/search.js` `stripAzCase()`, `wikiVariants()` | “Mess It Up / Hot Mess”, “Çinin florası” qayıdırdı |
| 3 | **Kanonik məqalə** qaydası: hal şəkilçili ad = məqalə adı → üstünlük (skor 20) | `lib/search.js` `titleScore()` | “Azərbaycanın paytaxtı” → “Azərbaycanın mədəniyyət paytaxtı” |
| 4 | Wikimedia semaforu: `WIKI_MIN_GAP_MS` 120→**200** | `lib/search.js` | 429 → boş snippet/mətn |
| 5 | Say çıxarışında **mövzu tokeni** bonusu/cəzası | `lib/countextract.js` | “NBA-də neçə komanda” → 16 (səhv) |
| 6 | Qısa akronim (DNT/BMT/NBA/CSS/SQL) gibberish və ≥4 hərf həddindən azad (`isStrongTerm`) | `route.js` ~L347–360, 424, 645, 655, 687 | “DNT-nin açılışı” → bütün nəticələr 0 bal |
| 7 | Skor qapısından sonra **obyekt məqaləsi saxlanılır** (`entity_article_kept`) | `route.js` ~L382–402 | boş snippet səbəbindən atılırdı |
| 8 | **Rəqəm formatı**: `parseNumberToken()` — `8,848.86 → 8848.86`, `8.848,86`, `8 848,86`, `12.000`, `2,3` | `lib/units.js` (+ `measure.js`, `countextract.js`) | Everest cavabı “848.86 metr” idi |
| 9 | r15 qapısında `nMin` **buraxılışı** (struktur/çıxarılmış cavab və ya tək avtoritet mənbə), JSON-da `nMinWaived` | `bench/r15.mjs` | “Madrid hansı ölkədədir” → Wikidata cavabı, n=1 |
| 10 | Test hovuzu 87 → **149** sual (+62 yeni, təkrarsız) | `bench/r15-pool.mjs` | hər raund fərqli sual şərti |

**Deploy faktı**: push → Vercel build → prod yeni kod. Sübut: Everest sualı `"8,848 metr"` + `measure_extracted`.
Prod 15/15 raundu: `API_BASE=https://searchapi-eta.vercel.app/api/search R15_PACING=2500 node bench/r15.mjs`.

---

## 7. Haradan qalıb (prioritet sırası ilə)

1. **Obyekt məqaləsi axırda itir** (raund 9-un 3 uğursuzu — hamısı bu ailə):
   - `Misirin paytaxtı hansı şəhərdir` → pool-da “Misir” məqaləsi **ümumiyyətlə yoxdur** (yalnız Memfis /
     Aşağı Misir / Misirin yeni paytaxtı); `entity_article_kept` işə düşür, amma sonrakı mərhələdə yenə düşür.
   - `Azərbaycanda ən böyük göl hansıdır` → “Xəzər” yox.
   - `Füzulinin ən məşhur əsəri hansıdır` → “Leyli və Məcnun” yox.
   **Təklif**: `entity_article_kept` ilə əlavə olunan nəticəyə `keep: true` bayrağı ver və bütün sonrakı
   filtrlərdə (content_off_topic, junk, limit) onu qorumaq; wiki nəticələri üçün **ilk cümlə (lead)**
   content-ə mütləq əlavə olunsun (paytaxt/xassə suallarında cavab məhz lead-dədir).
2. **“Skor 0” tapmacası**: bəzən (DNT, CSS, “Aya ilk dəfə”) `scored` massivində **bütün** nəticələr
   `score: 0` olur, halbuki eyni obyekt üçün `scoreResult()` modul səviyyəsində 5.2–7.2 qaytarır.
   Nəticə: hamısı 1.5 həddindən düşür → n=0. İzləmə lazımdır (namizəd: `results` elementlərinin öz
   `score: 0` daşıması və `{...r}` ilə üzərinə yazılması / ikinci `scored` qurulması).
3. **Anchor tərcümə zibili**: `"Çinin paytaxtı hansı şəhərdir"` → `anchor_query = "cinin capital hansi city"`;
   hal şəkilçisi tərcüməyə düşür, `wiki_last_resort` mərhələsini zəhərləyir.
4. **“necə” → “sayı” çevrilməsi**: `"CSS-də rəng necə təyin olunur"` → `normQuery = "... sayı"` —
   how-to sualı say sualına çevrilir.
5. Golden-daki daimi 3 boşluq (metro conflict, Bakı universitet, Antarktida).
6. Wikimedia 429 idarəsi: sandbox-da run-to-run dəyişkənliyin əsas səbəbi; semaforu daha da yumşaltmaq
   və ya provayder müxtəlifliyini artırmaq (bing-rss, rss xəbər mənbələri).

---

## 8. Əməliyyat əmrləri (copy-paste)

```bash
# --- lokal server (hər kod dəyişikliyindən SONRA mütləq restart) ---
kill $(pgrep -f "node local-server.mjs") 2>/dev/null
cd /home/user && node local-server.mjs        # 0.0.0.0:3999, GET+POST /api/search

# --- unit testlər ---
cd /home/user/LLM-free-search-api-Vercel && node tests/unit-tests.mjs

# --- import smoke (JSX parse xətası olmayan fayllar üçün) ---
node -e 'await import("./lib/search.js"); console.log("SEARCH OK")'
node -e 'await import("./app/api/search/route.js"); console.log("ROUTE OK")'

# --- qızıl yoxlama (lokal) ---
API_BASE=http://127.0.0.1:3999/api/search node eval/run.mjs eval/golden.json 3

# --- 15-lik qapı: LOKAL ---
cd /home/user && node bench/r15.mjs
# --- 15-lik qapı: PROD (real API) ---
API_BASE=https://searchapi-eta.vercel.app/api/search R15_PACING=2500 node bench/r15.mjs
# faydalı env-lər: R15_SEED, R15_PACING, --round N ; nəticə: bench/r15-round-N.json

# --- deploy ---
cd /home/user/LLM-free-search-api-Vercel
git add -A && git -c user.email=dev@local -c user.name=dev commit -m "vXXX: ..."
git push "https://x-access-token:<TOKEN>@github.com/Alim4385/LLM-free-search-api-Vercel.git" HEAD:main
sleep 60   # build; sonra prod-da debug=1 ilə yoxla
```

**Bench qaydaları**: hovuzdakı istifadə olunmuş suallar `bench/r15-used.json`-da saxlanılır — təkrar seçilmir.
Hovuz azalanda `bench/r15-pool.mjs`-ə yeni suallar əlavə et (`{id, cat, q, must[[...]], pages[], nMin}`).
Rate limit 30/san — `R15_PACING=2500` (≈24 sorğu/dəq) təhlükəsizdir.

---

## 9. Yeni sessiyada ilk 3 addım (təklif)

1. `node tests/unit-tests.mjs` + `API_BASE=https://searchapi-eta.vercel.app/api/search node bench/r15.mjs` →
   prod-un cari vəziyyətini ölç (gözlənilən: 12–15/15, hovuzda 14 sual).
2. Bölmə 7-nin **1-ci bəndini** düzəlt (`keep: true` + lead cümlə) → lokal golden + r15 ilə yoxla → push.
3. Bölmə 7-nin **2-ci bəndini** (skor 0) instrumentasiya ilə tap və düzəlt; sonra hovuza yeni suallar əlavə edib
   ardıcıl 2 raund **15/15** alana qədər davam et (hər raund fərqli suallarla).
