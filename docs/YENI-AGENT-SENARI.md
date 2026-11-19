# YENİ AGENT ƏMRLƏRİ — "qaqa-search-api" layihəsi
_Sən yeni agent sən. Bu sənəd SƏNİN üçün yazılıb. Əvvəldən axıra oxu, sonra özün başa düş: layihə nədir,
necə yüklənir, necə test olunur, haradan qalıb, necə push olunur. Sahib (Alim) sadə, "qaqa" tonda danışır,
**Azərbaycan dilində** cavab ver. Uzun sənəd istəyirsənsə `docs/HANDOFF.md`-yə, buraxılış tarixçəsinə
`docs/V115-DUZELISLER.md` / `docs/V116-DUZELISLER.md`-yə bax._

**Son yenilənmə: 2026-11-16 · `main` = `3e9241b` · FILTER_VERSION = 233**

---

## 1. Bu nədir?

**LLM-free-search-api-Vercel** — LLM-lərə (Claude/ChatGPT və s.) axtarış aləti verən **açıq mənbə,
API-açarsız (keyless) search API**. Heç bir pullu search açarı yoxdur: Wikipedia/Wikidata API, Bing +
Bing-RSS, DuckDuckGo-Lite, MWMBL, Google News RSS, azertag.az, sitemap xəbərləri, CBAR (valyuta),
Open-Meteo/WTTR.in (hava), rəsmi sənəd mənbələri (docs/StackOverflow/GitHub). Next.js (Node runtime)
üzərində **Vercel**-də host olunur. Sahibin məqsədi: öz LLM proqramında `search` tool-u kimi işlətmək +
**hallüsinasiyanın qarşısını alan** mexanizmlər (bölmə 8).

**Live API:** `https://searchapi-eta.vercel.app`

- `POST /api/search` → body:
  `{"query":"...", "max_results":3, "max_chars":12000, "lang":"az|en|tr", "format":"json|jsonl", "freshness":"day|week|month", "exclude_domains":["..."], "translate_results":false, "debug":1}`
- `GET /api/search?q=...&max_results=3&debug=1`
- `GET /api/health` → `{"ok":true,"service":"qaqa-search-api","version":"1.1.0", ...}`
- `GET /api/engines` → provayder siyahısı + status
- `debug:1` → `meta.degraded_stages[]`, `meta.provider_errors`, `meta.timing`, `meta.cached`
- Cavab: `query, intent, reason, results[], conflicts[], weather?, time?, currency?, meta{}`
  - `results[]`: `id,title,url,snippet,content,source,score,published_at,updated_at,agreement,confirmations,sources[],voteCount,extracted?`
  - `meta`: `providers_used, provider_errors, took_ms, cached, total_chars, query_lang, anchor_query, translated, results_translated, confidence, dated_results, conflicts_count, fallback, degraded_stages, timing`
- **Rate limit: 30 sorğu / 60 san** (IP üzrə; `lib/ratelimit.js`) → test edəndə **≥2.5 san fasilə** (`R15_PACING=2500`)

---

## 2. Kodu necə yüklə (yarım dəqiqə)

**Repo PUBLİK, bütün kod GitHub-dadır:**
```bash
git clone https://github.com/Alim4385/LLM-free-search-api-Vercel.git
cd LLM-free-search-api-Vercel
npm install
```
**Repo:** https://github.com/Alim4385/LLM-free-search-api-Vercel (sahib: Alim4385, branch `main`)

**Push üçün token:** token **bu sənəddə YOXDUR** (qəsdən). Repo publikdir — tokeni fayla yazsan, GitHub
secret-scanning onu dərhal ləğv edir. Sahib tokeni söhbətdə verir; yalnız in-line URL ilə istifadə et,
`.git/config`-a yazma, commit etmə:
```bash
git push "https://x-access-token:<PAT>@github.com/Alim4385/LLM-free-search-api-Vercel.git" HEAD:main
git ls-remote "https://x-access-token:<PAT>@github.com/Alim4385/LLM-free-search-api-Vercel.git" refs/heads/main  # yoxlama
```
> Push-dan sonra sahibə **tokeni rotate etməyi** xatırlat (çatda paylaşılır).
> Sahib özü "GitHub Desktop / git push" edirsə: **əvvəl commit lazımdır** — commit olunmayan dəyişiklik push-a düşmür.

Sandbox-da node_modules hazır ola bilməz (snapshot-dan çıxarılır) → `npm install` tələb olunarsa, əvvəl onu et.

---

## 3. Hal-hazır status (bu sənəd yazılanda)

| Göstərici | Dəyər |
|---|---|
| `main` HEAD | **`3e9241b`** (v116c) — v113 `440be00`, v114 `95cc962`, v115 `18d3f4b`, v116 `93048d1`, v116b `9e0487d`/`e3b90e3`, v116c `b720f2f`/`3e9241b` |
| FILTER_VERSION | **233** (keş açarındadır → versiya artanda köhnə keş avtomatik ləğv olur) |
| Unit testlər | **601 keçdi, 0 uğursuz** (`node tests/unit-tests.mjs`) |
| Golden (`eval/golden.json`, 30 yoxlama, `max_results=3`) | **25 keçdi / 5 uğursuz** — sandbox-da Wikimedia 429 səbəbindən **run-to-run 21…27** dəyişir |
| **15-lik qapı, PROD** | **Raund 8: 15/15** ✅ (sərt metrik də 15/15) · Raund 9: 12/15 |
| Suallar hovuzu | `bench/r15-pool.mjs` — **149 sual**, istifadə olunmayan **14** |

**"Yeni kod prod-da işləyirmi?" markeri** (bunu hər deploy-dan sonra yoxla):
`GET /api/search?q=Everest dağının hündürlüyü nə qədərdir&max_results=3&debug=1`
→ cavabda `"8,848 metr (mətndən çıxarıldı)"` və `degraded_stages: ["measure_extracted", …]` olmalıdır.
Köhnə kod (v115 və əvvəl) eyni suala **`"848.86 metr"`** verirdi — minlik vergülü itirdi.

**Golden-daki daimi 5:** `Bakı metrosunda neçə stansiya` (26 vs 27 → real ziddiyyət, `conflicts[]`),
`Bakıda neçə universitet` (stat.gov.az gəlmir), `dünyanın ən böyük səhrası` (Antarktida yox),
`Kant kateqoriya`, `Nizami əsərləri` (wiki boş gələndə).

---

## 4. Lokal test (push-dan ƏVVƏL MƏCBURİ)

```bash
# 0) server: hər kod dəyişikliyindən SONRA restart (modul keşi!)
kill $(pgrep -f "node local-server.mjs") 2>/dev/null    # exit -1 normaldır
cd /home/user && node local-server.mjs                   # 0.0.0.0:3999, GET+POST

# 1) unit
cd /home/user/LLM-free-search-api-Vercel && node tests/unit-tests.mjs      # 601 keçməlidir, 0 uğursuz

# 2) import smoke (sintaksis/JSX səhvləri üçün)
node -e 'await import("./lib/search.js"); console.log("SEARCH OK")'
node -e 'await import("./app/api/search/route.js"); console.log("ROUTE OK")'

# 3) golden (lokal, 3 nəticə)
API_BASE=http://127.0.0.1:3999/api/search node eval/run.mjs eval/golden.json 3

# 4) 15-lik qapı, lokal
cd /home/user && node bench/r15.mjs
```
Qeyd: server **`start_process`** ilə qaldırılmalıdır (nohup/& ölür). `node -e` ilə template literal çıxarışı
korlanır → kiçik skriptləri `.mjs` faylı kimi yaz. `node -e` + `searchAll` səssiz exit 1 verə bilər.

**Provider davranışı:** sandbox/Vercel IP-lərindən Wikipedia 429 verir → golden/r15 aşağı düşür. Bu
**provider-side** throttling-dir; kodda "düzəltməyə" çalışma. Düzgün davranış: az nəticə + `confidence: low/none`
+ `degraded_stages`. Yalnız **eyni saatda, eyni pacing-lə** run-ları müqayisə et (≥1.8 san, tövsiyə 2.5 san).

---

## 5. LIVE qəbul testi (prod API) — 15-lik qapı + 5 sorğu protokolu

### 5.1 Əsas qapı: 15 sual, hər raund FƏRQLİ
```bash
cd /home/user
API_BASE=https://searchapi-eta.vercel.app/api/search R15_PACING=2500 node bench/r15.mjs
# nəticə: bench/r15-round-N.json {round, at, poolSize, pass, total, items[]}
#         bench/r15-used.json {rounds: [[id…]]}  ← burada "rounds" obyektidir, massiv deyil!
```
- `bench/r15-pool.mjs`: `{id, cat, q, must: [[alternativlər…]], pages?, nMin?}` — 149 sual.
- Hər raund yalnız **istifadə olunmamış** sualları seçir. Hovuz azalanda **yeni suallar əlavə et** (təkrarsız!).
- `nMin` = minimum nəticə sayı. Struktur/çıxarılmış cavab və ya tək avtoritet mənbə varsa `nMinWaived: true`.
- Şərt: **ardıcıl raund 15/15** olana qədər davam et; hər raund fərqli suallarla.

### 5.2 Hallüsinasiya protokolu (hər düzəlişdən sonra 5 sorğu)
1. **FAKT:** `Azərbaycanın paytaxtı hansı şəhərdir` → Bakı, `n≥2`
2. **XƏBƏR:** `bu gün Bakıda son xəbərlər` → xəbər hostları, `published_at` dolu olanlar
3. **TEXNİKİ:** `CSS-də rəng necə təyin olunur` → sənəd mənbələri (mdn/w3schools), n≥1
4. **DAR MÖVZU:** `Vercel serverless function timeout limiti` → rəsmi sənəd
5. **QƏSDƏN BOŞ:** `Qara dənizin dibində 1847-ci ildə tapılan pirat gəmisinin kapitanının anası` →
   **n=0 / fallback**, uydurma cavab YOX.

Meyar: səhv cavab verməkdənsə boş qaytarmaq yaxşıdır; rəqəm mənbədən gəlməlidirsə mənbə də gəlməlidir.

---

## 6. Kod strukturu (bir cümləlik xəritə)

```
app/api/search/route.js  ← ƏSAS BORU XƏTTİ (~1700 sətir): qəbul → intent (hava/vaxt/valyuta/bayram/
                           ölçü/say/axtarış) → searchAll → skorlama & filtrlər (score>=1.5, junk/spam domen,
                           gibberish, termin qapısı, entity_article_kept) → diversity → extract →
                           extractMeasure/extractCount → conflicts → confidence → cavab. FILTER_VERSION burada.
app/api/health, app/api/engines ← status / provayder siyahısı
lib/search.js        ← provayderlər + providerTermGate + wikiVariants + Wikimedia semaforu (429)
lib/score.js         ← scoreResult, diversifyByDomain, computeConfidence, junk domenlər
lib/rank.js          ← normalizeAz, tokenize (AZ kök/şəkilçi), trigram, selectRelevantParagraphs, dil aşkarlama
lib/countextract.js  ← "neçə X var" → rəqəm çıxarışı + təsdiq/agreement + mövzu bonusu
lib/measure.js       ← "nə qədərdir" → rəqəm+VAHİD (+ faiz, metr, manat, km²), delta/müqayisə süzgəci
lib/units.js         ← vahid çevirmələri + **parseNumberToken** (8,848.86 → 8848.86)
lib/facts.js         ← Wikidata struktur faktları (əhali, sahə, paytaxt, valyuta, qonşular)
lib/holidays.js, lib/currency.js (CBAR), lib/weather.js (open-meteo+wttr), lib/time.js
lib/sports.js, lib/nutrition.js, lib/livestat.js, lib/math.js ← strukturlu xüsusi cavablar
lib/extract.js, lib/clean.js ← səhifə oxunuşu/çıxarış, mətn təmizliyi (cutWord)
lib/translate.js ← AZ↔TR↔EN körpü (anchor_query), lib/conflict.js ← mənbələr arası ziddiyyət
lib/router.js, lib/finalize.js, lib/pipeline/params.js, lib/cache.js (FILTER_VERSION keş açarı), lib/ratelimit.js
lib/azertag.js, lib/sitemapnews.js, lib/wikilink.js, lib/suggest.js, lib/circuit.js, lib/crypto.js, lib/expand.js
lib/data/azlex.js   ← aznlp (MIT) kök leksikonu
lib/tool-schema.json ← LLM tool description (sitat [1], yoxla, "tapmadım" qaydaları)
tests/unit-tests.mjs ← 601 assert
eval/golden.json + eval/run.mjs ← qızıl dəst (30 yoxlama, max_results=3)
bench/r15.mjs + bench/r15-pool.mjs (+ r15-used.json, r15-round-*.json) ← 15-lik qapı harness-i
docs/V115-DUZELISLER.md, docs/V116-DUZELISLER.md, docs/HANDOFF.md ← buraxılış tarixçəsi + tam ötürmə
```

**Ölü provayderlərə qayıtma** (yoxlanıldı, işləmir): qwant 403, mojeek 403, marginalia 302, searx.be HTML,
stackoverflow API 429, ddg-html timeout, brave/yahoo tez-tez 429, tavily keyless 400.

---

## 7. Vercel necə işləyir (sonsuz sadə)

1. Sən GitHub `main`-ə push edirsən.
2. GitHub Vercel-ə webhook göndərir → Vercel ən son commit-i götürüb `npm run build` edir və **öz-özü** deploy edir.
3. **Link heç vaxt dəyişmir:** həmişə `https://searchapi-eta.vercel.app` — təzə kod arxada yenilənir.
   Build ~**1–3 dəqiqə**; o vaxta qədər prod **köhnə kodu** işlədir.
4. Yoxlama: bölmə 3-dəki markeri (Everest → `8,848 metr`) vur. Gəlmirsə 2–5 dəq gözlə, sonra
   vercel.com → Deployments → "Redeploy". Webhook bəzən gecikir.
5. **Keş diqqəti:** cavab `cacheKey(..., v: FILTER_VERSION, ...)` ilə keşlənir — yəni hər düzəlişdə
   `FILTER_VERSION`-u **artır** (məs. 233 → 234), yoxsa köhnə keş yeni davranışı maskalayır.
6. Əl ilə deploy lazım olsa: vercel.com dashboard → Deploy latest commit.

---

## 8. Sahibin qəbul etdiyi QAYDALAR (bozma — geri addımdır!)

**İş tərzi**
- **Sual vermə, gücləndir**: kritik yerdə test et, işləyirsə əlavə et.
- **Hər test raundu fərqli suallarla** — eyni sualı təkrar yoxlamaq qəbul deyil.
- **Dürüst hesabat**: testi yaşıl göstərmək üçün şərt yumşaltmaq olmaz. Uğursuzluqlar adbaad yazılır,
  hər düzəliş **fayl + sətif** ilə göstərilir. Uydurma nəticə = layihəyə xəyanət.
- **Yalnız soruşulanı et**: "sualımı cavablandır, sonra heçnə et" — artıq iş görmə.
- Commit/sənəd/hesabat dili: **Azərbaycan dilində**, versiya etiketi ilə (`v116c: …`).

**Məhsul davranışı**
- **Dil = üstünlük, blok deyil**: sorğunun dilindəki mənbələr öndə, xarici mənbələr hovuzda qalır; EN də TR kimi bərabər körpüdür.
- **`top_answer` / per-result `answer` sahəsi YOXDUR** — "hazır cavab" LLM-i over-trust-a sövq edir.
- **`published_at` yalnız real dərс tarixi**; Wikipedia `updated_at` (= son redaktə) ora yazılmır. `null` = tarix yoxdur.
- **Rəqəm uyğun gəlmirsə mənbə qalır, rəqəm irəli çəkilmir.** Səhv cavab cavabsızlıqdan pisdir.
- **`no_results` provayder XƏTASI deyil.** Hard xəta yalnız: `error, rate_limited, blocked, timeout, cooldown, bad_request`.
- **Fallback → boş nəticə** (`results: []`, `fallback: true`, `confidence: none`) — zibil top-2 saxlanmır.
- **`confidence` = mənbə razılığı + relevantlıq, cavabın DÜZGÜNLÜYÜ deyil** (high/medium/low/none).
- **Faizlə confidence YOX** — yalnız say/marker (`agreement: strong|medium|weak|conflict`).
- **Kontrakt dəyişmir**: sahə silinmir, yeni sahə yalnız **əlavə** olunur (köhnə müştərilər sınmasın).
- **Qaydalar ümumi olmalıdır** — metro/sorğu-spesifik literal yazmaq qadağandır.
- Provider məzmunu `untrusted` sayılır (prompt injection qoruması), snippet `cutWord` ilə kəsilir.
- **`lib/rank.js` `tokenize`-a toxunma** (xüsusi ad/hal şəkilçisi); `diversifyByDomain` ikinci keçidini və
  `rankBoost(i)`-ı geri qaytarma — bunlar bilərəkdən çıxarılıb.

---

## 9. Haradan qalıb (prioritet sırası ilə — mövzu açıq!)

1. **Obyekt məqaləsi axırda itir** (raund 9-un 3 uğursuzu — hamısı bu ailə):
   - `Misirin paytaxtı hansı şəhərdir` → pool-da **"Misir" məqaləsi ümumiyyətlə yoxdur** (yalnız Memfis /
     Aşağı Misir / Misirin yeni paytaxtı gəlir); `entity_article_kept` işə düşür, amma sonrakı mərhələdə yenə düşür.
   - `Azərbaycanda ən böyük göl hansıdır` → "Xəzər" yox · `Füzulinin ən məşhur əsəri` → "Leyli və Məcnun" yox.
   - **Təklif:** `entity_article_kept` nəticəsinə `keep: true` ver və sonrakı filtrlərdə (content_off_topic,
     junk, limit) qoru; wiki nəticələrinin **ilk cümləsini (lead)** content-ə mütləq əlavə et —
     paytaxt/xassə suallarının cavabı məhz lead-dədir.
2. **"Skor 0" tapmacası**: bəzən (`DNT`, `CSS`, "Aya ilk dəfə") `scored` massivində **bütün** nəticələr
   `score: 0` olur, halbuki `scoreResult()` modul səviyyəsində 5.2–7.2 verir → hamısı 1.5 həddindən düşür, n=0.
   İnstrumentasiya lazımdır (namizəd: `results[]` elementlərinin öz `score: 0` daşıması / `{...r}` üzərinə yazma).
3. **Anchor tərcümə zibili**: `"Çinin paytaxtı hansı şəhərdir"` → `anchor_query = "cinin capital hansi city"` —
   hal şəkilçisi tərcüməyə düşür, `wiki_last_resort`-u zəhərləyir.
4. **"necə" → "sayı" çevrilməsi**: `"CSS-də rəng necə təyin olunur"` → `normQuery = "... sayı"` (how-to sualı say sualına çevrilir).
5. Golden-daki daimi 3–5 boşluq (bölmə 3) — xüsusən Bakı metrosu (26 vs 27) real ziddiyyətdir, `conflicts[]`-də qalmalıdır.
6. Wikimedia 429 idarəsi: run-to-run dəyişkənliyin əsas səbəbi. Semaforu (`WIKI_MIN_GAP_MS` = 200) yumşaltmaq
   və ya provayder müxtəlifliyini artırmaq (bing-rss, RSS xəbər mənbələri).
7. Hovuzda **14 sual** qalıb → növbəti raunddan əvvəl yeni (təkrarsız) suallar əlavə et.

---

## 10. Məzmun və iş qaydası

- Cavab: **Azərbaycan dili, qaqa tonu**, qısa, rol-pleysiz. Uzun cədvəllər yalnız hesabatda.
- **Əvvəl ölç, sonra düzəlt** (evidence əvvəl). Yeni provayder/düzəliş → əvvəl lokal test, işləyirsə qoş.
- Düzəliş etdin? → **unit + golden + r15 + `FILTER_VERSION` artır** → commit (AZ) → push → markeri yoxla.
- Her deploy-dan sonra sahibə **cədvəllə** hesabat: nə dəyişdi, fayl+sətif, ölçmə (əvvəl/sonra), açıq qalanlar.
- Sənədləşdirmə: hər buraxılış `docs/V1xx-DUZELISLER.md`-yə, ümumi vəziyyət `docs/HANDOFF.md`-yə.

_Oxudunsa, artıq bilirsən: layihə prod-dadır (`3e9241b`, FV 233, prod 15/15 alınıb), açıq iş bölmə 9-dadır.
Sahib "bax, düzəlt, pushla" desə — sən hazırsan. Uğurlar qaqa._
