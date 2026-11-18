# Master Plan — blueprint auditinin nəticəsi (v97 / FV 196)

Üç LLM-in təhlili **kodu açmadan** yazılmışdı. Bu sənəd hər iddianın **real kodda
yoxlanmasının** nəticəsidir: ✅ doğru və düzəldildi · 🟡 qismən doğru · ❌ yanlış / tətbiq
edilmədi (səbəbi ilə).

Ölçmə qaydası: iddia → `grep`/kod oxunuşu → düzəliş → `node tests/unit-tests.mjs` (509 test)
→ `npm run build` → canlı `curl` yoxlaması.

---

## 1. Memarlıq və modullaşdırma

| İddia | Hökm | Qeyd |
|---|---|---|
| `route.js ~1200`, `lib/search.js ~1233` sətir | 🟡 | real: **1261** və **1304**. Böyük fayl riski doğrudur. |
| route.js-i `lib/pipeline/*`-a bölmək | ⏳ təxirə | Geniş refactor; testlər 509 olsa da, Next route davranışı yalnız canlı yoxlamayla görünür. İlk addım artıq atıldı: `lib/finalize.js` ayrıldı. |
| Provayderləri `lib/providers/*`-a çıxarmaq | ⏳ təxirə | Mexaniki iş, riski aşağı, amma davranış dəyişmir — sürət/korrektlikdən sonra. |
| GET `count` oxunmur | ✅ **doğru** | GET yalnız `max_results` oxuyurdu. İndi `max_results → count → limit` (həm GET, həm POST body). |
| jsonl keşdə `confidence`/`fallback` itir | ✅ **doğru** | Keşlənmiş jsonl cavabı yalnız providers/took_ms verirdi; indi confidence + fallback də ötürülür. |
| jsonl canlı stream etmir | ❌ | Bu **dizayn qərarıdır**, xəta deyil: cavab tam hazır olandan sonra sətirlərə bölünür (API kontraktı). Sənədləşdirmə ilə uyğunlaşdırılmalıdır. |

## 2. Loqika və hesablama xətaları

| İddia | Hökm | Qeyd |
|---|---|---|
| Tərcümə büdcəsi həmişə 0 (`left() - 3600`, `BUDGET_MS = 3200`) | ✅ **doğru — ən ciddi** | v88-də büdcəni 5000→3200 salanda tərcümə tamamilə söndü. İndi `min(1000, max(0, left() - 2200))`. |
| Math/units `source:"hesablama"`, skip siyahısında yox | ✅ **doğru** | `OWN_SOURCES`-a `"hesablama"` əlavə olundu — daxili hesablama tərcüməyə düşmür. |
| `toFetch.map` `skipFetch`-dən əvvəl başlayır | ✅ **doğru** | `format=simple`/deadline halında belə şəbəkə sorğuları arxa fonda gedirdi. İndi `skipFetch` olanda `extractAll = null`. |
| Extraction üçün vahid `AbortController` | ⏳ təxirə | `fetchAndExtract` onsuz da öz timeout-u ilə işləyir; vahid controller faydalı olardı, lakin `Promise.race`-dən sonra vəziyyət mürəkkəbləşir. |
| `untrusted:false` + `score:99` + `voteCount:99` | ✅ **doğru** | Mətndən çıxarılan cavablar indi `untrusted:true`, `voteCount:1` (tək mənbə = tək səs). `score:99` yalnız sıralama üçündür, qaldı. |
| `max_results` structured `unshift`-dən sonra pozulur | ✅ **doğru** | İndi kəsmə struktur cavablar daxil olmaqla **yekunda** edilir: cəm ≤ `max_results`. |
| Freshness yumşaqlığı (tarixsiz nəticə "təzə") | ✅ **doğru** | Qayda `lib/finalize.js`-ə köçdü: açıq `freshness` sorğusunda tarixi təsdiqlənməyən nəticə düşür (ən azı 2 tarixli nəticə varsa), `fetched_at` təzəlik sayılmır. |

## 3. Təhlükəsizlik / production

| İddia | Hökm | Qeyd |
|---|---|---|
| Upstash olmadan production rate limit sıfırlanır | 🟡 | Faktiki olaraq doğrudur. **Fatal `throw` tətbiq etmədim**: o, açarsız pulsuz deploy-u tam 500 edərdi. Əvəzində `.env.example`/`DEPLOY.md`-də tələb kimi yazılmalıdır (növbəti addım). |
| `TRUST_PROXY=0` yenə də başlıq oxuyur | ✅ **doğru** | İndi `TRUST_PROXY=0` → sabit `u:local` bucket, başlıqlara baxılmır (self-host-da spoofing bağlandı). |
| SSRF: yalnız yoxlanmış IP ilə fetch | 🟡 | Domen + DNS + bloklanmış IP aralıqları yoxlanır, nəticə keşlənir; amma DNS rebinding-ə qarşı **IP pinning yoxdur** (undici dispatcher lazımdır). Riski qəbul edilən səviyyədə saxladım. |
| jina ehtiyatında 2 MB limit yoxdur | ✅ **doğru** | `content-length` yoxlanır + mətn 2 MB-a kəsilir. |
| `/api/engines` açıq qalır | ✅ **doğru** | Production-da açar yoxdursa 403 (`ENGINES_PUBLIC=1` ilə açıla bilər). |
| Next.js 14.2.35 köhnədir | ✅ **doğru** | Versiya sabitdir. Major/minor yüksəltmə ayrı, yoxlanmalı addımdır — kor-koranə bump etmədim. |

## 4. Test / QA

| İddia | Hökm | Qeyd |
|---|---|---|
| `eval/run.mjs eval/golden.json` işləmir | ✅ **doğru** | Runner obyekti `query` kimi göndərirdi. İndi `entry.q` oxunur, `expect` (num/unit/page/requiresDigits) yoxlanır, PASS/FAIL + yekun sayı çap olunur, uğursuzluqda `exitCode = 1`. |
| E2E golden suite (20–30 AZ sual) | ⏳ qismən | `eval/golden.json` + işlək runner var; dəstin genişləndirilməsi növbəti addım. |

---

## Real xəta kimi təsdiqlənib DÜZƏLDİLƏNLƏR (v97)

1. Tərcümə büdcəsi = 0 (mənim v88 regressiyam) → real tərcümə işləyir.
2. `"hesablama"` tərcümə skip siyahısında yox idi.
3. `skipFetch` olsa da fetch-lər başlayırdı.
4. Mətndən çıxarılan cavabda `voteCount: 99` (süni razılaşma) və `untrusted: false`.
5. `max_results` yekunda pozulurdu.
6. Tarixsiz nəticə açıq `freshness` sorğusunda "təzə" sayılırdı.
7. `TRUST_PROXY=0` zamanı IP başlıqdan oxunurdu (spoofing).
8. jina cavabında ölçü limiti yox idi.
9. `/api/engines` production-da qorunmursdu.
10. GET-də `count` parametri udulurdu.
11. Keşlənmiş jsonl-də `confidence`/`fallback` itirdi.
12. Golden runner obyekt girişlərini sındırırdı.

**Nəticə:** 509 unit test keçir, build təmiz, `lib/finalize.js` ilk modul ayrılması kimi əlavə olundu.

## Növbəti addımlar (prioritet sırası ilə)

1. `eval/golden.json`-u 20–30 suala çıxarıb hər buraxılışdan əvvəl `node eval/run.mjs eval/golden.json 3` işlətmək (rəqəmli qapı).
2. `lib/pipeline/*` bölgüsü — əvvəl `respond.js` (format/meta), sonra `structure.js`, ən sonda `retrieve.js`.
3. Tərcümənin real işlədiyini canlı ölçmək (uzun AZ sual → EN açar sözlərlə axtarış).
4. Upstash tələbini `DEPLOY.md`-də məcburi addım kimi yazmaq.
5. Next.js yüksəltməsi ayrı budaqda: `build` + 15 suallıq canlı dəst keçməzsə geri qaytarmaq.
