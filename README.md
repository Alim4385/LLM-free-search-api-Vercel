# 🔍 Qaqa Search API — LLM üçün Key-siz Axtarış

Bu sistem **LLM-in özünün çağırıb istifadə edəcəyi** axtarış API-sidir.
İçində LLM yoxdur — sən LLM-i qoşursan, o bu API-ni tool kimi çağırır.

**Key lazım deyil. Vercel-də işləyir.**

## Necə işləyir?

```
LLM sual alır → qaqa_search tool-un çağırır → POST /api/search
→ 8 keyless provayderdən paralel axtarış (Tavily keyless, DDG, Bing, Brave HTML, Google News, Wikipedia, HN Algolia, GitHub)
→ Multi-provider vote + Azərbaycan stemming ilə sırala
→ Hava sualıdırsa Open-Meteo-dan dəqiq məlumat
→ JSON / JSONL qaytar → LLM [1], [2] ilə cavab verir
```

> **Prinsip: heç bir API key yoxdur.** Tavily keyless rəsmi açarsız rejimdir (header ilə işləyir). HN Algolia və GitHub Search rəsmi keyless JSON API-lərdir. Bing RSS və DuckDuckGo Lite datacenter IP-dən bloklanır (testdə təsdiqləndi), ona görə HTML versiyalar istifadə olunur.

## API

### POST /api/search
```json
{ "query": "Bakı hava bu gün necədir?", "max_results": 5, "max_chars": 4000, "format": "json" }
```

### GET /api/search?q=Bakı hava
### GET /api/health

### Cavab (JSON)
```json
{
  "query": "Bakı hava bu gün necədir?",
  "intent": "weather",
  "results": [
    { "id": 1, "title": "Bakı - hava (Open-Meteo)", "url": "https://open-meteo.com", "content": "Bakı hazırda: temperatur 18°C..." },
    { "id": 2, "title": "...", "url": "https://...", "content": "aidiyyəti abzas...", "answer": "sorğuya ən uyğun cavab cümləsi..." }
  ],
  "meta": { "providers_used": ["bing","wikipedia"], "took_ms": 1200 }
}
```

### Cavab (JSONL) — `format: "jsonl"`
Hər sətir bir JSON obyektidir (stream üçün):
```
{"type":"meta","query":"..."}
{"type":"result","id":1,"title":"...","content":"..."}
{"type":"result","id":2,...}
{"type":"done","count":2}
```

## LLM-ə necə qoşmaq olar?

### 1. OpenAI / OpenAI-uyğun (Function Calling)
`lib/tool-schema.json`-dakı şemanı tool kimi ver:

```js
const tools = [{
  type: "function",
  function: {
    name: "qaqa_search",
    description: "Key-siz veb axtarışı...",
    parameters: { /* tool-schema.json içindəki */ }
  }
}];

// LLM tool çağırsa:
// OpenAI-da toolCall.function.arguments ARTIQI JSON string-dir -
// JSON.stringify(toolCall.arguments) ikiqat kodlaşdırar və API "missing_query" qaytarar!
const args = typeof toolCall.function.arguments === "string"
  ? toolCall.function.arguments
  : JSON.stringify(toolCall.function.arguments);
const res = await fetch("https://SENIN-PROEKTIN.vercel.app/api/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: args
});
if (!res.ok) throw new Error(`Search API ${res.status}`); // 429/504 cavabı HTML ola bilər
const data = await res.json();
// data.results-i LLM-ə ver, o [1][2] ilə cavab versin
```

### 2. İstənilən LLM (Pollinations, Groq, Gemini...)
Eyni məntiq: LLM-ə de "axtarış lazımdırsa bu URL-ə POST et", cavabı ona qaytar.

## Vercel-də Deploy

```bash
npm install
npm run test:providers   # əvvəlcə provayderləri test et
npx vercel               # və ya GitHub-a push et, Vercel avtomatik deploy edir
```

Deploy-dan sonra URL belə olacaq:
`https://qaqa-search-api.vercel.app/api/search`

## Xüsusiyyətlər
- ✅ Key-siz: DDG HTML + Bing HTML + Google News RSS + Wikipedia (+ SearXNG ehtiyat)
- ✅ Azərbaycan stemming: Bakı/Bakıda eyni sayılır
- ✅ Cavab keyfiyyəti (v12): Wikipedia üçün təmiz TextExtracts API (heç bir `[n]`/`[edit]`/TOC zibilli), məzmun junk-cleaner (cədvəl/tarix/symbol-soup sətirləri, boilerplate başlıqlar), hər nəticədə `answer` field (sorğuya ən uyğun cümlə), B2B directory domenlərinin qadağası (rocketreach/linkedin və s.), dil uyğunsuzluğu cəzası (AZ sorğuda EN-only nəticələr arxaya düşür), mövzu qaydaları (film sorğusunda GitHub/HN demoted), domen diversifikasiyası (hər sayt top-N-də 1 dəfə — Google tərzi), Bing `mkt`/Tavily `country` sorğu dilinə görə (AZ/TR lokal rank)
- ✅ linkedom + readability ilə sayt təmizləmə + SSRF qorunması (yalnız public IP; redirect-lər hər hop-da yoxlanılır, port 80/443)
- ✅ Open-Meteo ilə hava (scraping yoxdur)
- ✅ Upstash Redis cache (optional, olmasa in-memory)
- ✅ Rate limit (IP başına 30/dəq) + prompt injection qorunması
- ✅ JSON + JSONL (real stream) + simple format
- ✅ Circuit breaker + soft-fail (boş nəticə provayderi cooldown-a salmır)

## Opsional Env Dəyərləri (Vercel → Settings → Environment Variables)
| Env | Nə edir |
|-----|---------|
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | **Tövsiyə olunur.** Cache + rate limit shared counter olur (bütün serverless instance-lar eyni 30/dəq limitini görür; olmasa limit per-instance olur və soyuq startda sıfırlanır) |
| `SEARXNG_URL` | Öz SearXNG instance-ın (self-hosted) — ən etibarlı keyless provider |
| `ENGINES_API_KEY` | `/api/engines` endpoint-ini `x-api-key` header ilə qoruyur (qoymasan açıq qalır) |

## Limitlər
- Vercel Hobby: funksiya ~10-60 saniyə (route `maxDuration: 30` qoyulub). Sistem paralel fetch edir, adətən 2-4 saniyəyə cavab verir.
- Bəzi saytlar bot qorumasına görə açılmaya bilər — o zaman snippet istifadə olunur.
- Rate limit Upstash olmadan per-instance-dir (Vercel serverless xüsusiyyəti) — dəqiq 30/dəq üçün Upstash əlavə et.
- **Mahiyyət (privacy):** uzun Azərbaycan dili sorğuları (3+ söz) üçün EN tərcümə (anchor) almaq məqsədilə sorğu mətni **MyMemory**-ə (api.mymemory.translated.net) göndərilir — üçüncü tərəf xidmətidir, API key tələb etmir. Qısa sorğular üçün heç bir xarici tərcümə xidməti çağırılmır.
- Hər web nəticə `untrusted: true` işarəsi daşır — məzmun istehsalçı səhifələrdən gəlir, LLM ona data kimi yanaşmalıdır (təlimat kimi yox).

## Üçüncü tərəf data və lisenziyalar

- **AZ kök ayırıcı (stemmer) leksikonu** — `lib/data/azlex.js` faylı
  [aznlp-disc/stemmer](https://github.com/aznlp-disc/stemmer) layihəsindən götürülüb
  (MIT, Copyright (c) 2018 AzerbaijaniNLP Research Group): `words.txt` (75 670 söz)
  və `suffix.txt` (101 şəkilçi). `tools/gen-azlex.mjs` ilə `normalizeAz` üzərindən
  ASCII formaya salınır. Lisenziya mətni: `lib/data/AZ-STEM-LICENSE.md`.
  İstifadə yeri: `lib/azstem.js` → `lib/rank.js` `tokenize()`.
