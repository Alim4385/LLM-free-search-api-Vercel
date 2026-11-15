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
    { "id": 2, "title": "...", "url": "https://...", "content": "aidiyyəti abzas..." }
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
const res = await fetch("https://SENIN-PROEKTIN.vercel.app/api/search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(toolCall.arguments)
});
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
- ✅ linkedom + readability ilə sayt təmizləmə
- ✅ Open-Meteo ilə hava (scraping yoxdur)
- ✅ Upstash Redis cache (optional, olmasa in-memory)
- ✅ Rate limit (IP başına 30/dəq) + prompt injection qorunması
- ✅ JSON + JSONL format

## Limitlər
- Vercel Hobby: funksiya ~10-60 saniyə. Sistem paralel fetch edir, adətən 2-4 saniyəyə cavab verir.
- Bəzi saytlar bot qorumasına görə açılmaya bilər — o zaman snippet istifadə olunur.
