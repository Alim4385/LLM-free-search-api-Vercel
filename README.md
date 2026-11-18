# 🔍 Qaqa Search API — LLM üçün key-siz axtarış

LLM-in **tool kimi çağırdığı** axtarış API-si. İçində LLM yoxdur, API açarı tələb etmir, Vercel-də işləyir.

```
LLM sual alır → qaqa_search çağırır → GET/POST /api/search
→ keyless provayderlərdən paralel axtarış + səs (RRF) → AZ stemming ilə sıralama
→ sual tipinə görə struktur cavab (say / ölçü / tarix / hava / valyuta / fakt / tədbir)
→ JSON | JSONL | simple
```

## Endpoint-lər

| Metod | Yol | Nə edir |
|---|---|---|
| GET | `/api/search?q=...&count=5` | axtarış |
| POST | `/api/search` | `{ "query": "...", "max_results": 5, "max_chars": 4000, "format": "json" }` |
| GET | `/api/health` | sağlamlıq yoxlaması |
| GET | `/api/engines` | provayder/circuit statistikası |

Formatlar: `json` (default), `jsonl` (sətir-sətir stream), `simple` (yalnız title/url/snippet).

## Cavab kontraktı (dəyişməz)

```json
{
  "query": "...",
  "intent": "general",
  "results": [
    {
      "id": 1,
      "title": "...",
      "url": "https://...",
      "snippet": "...",
      "content": "...",
      "source": "wikipedia",
      "providers": ["wikipedia", "brave"],
      "voteCount": 2,
      "published_at": "2026-03-01T10:00:00.000Z",
      "updated_at": null,
      "date_info": "fresh",
      "untrusted": true
    }
  ],
  "meta": { "providers_used": [], "took_ms": 0, "confidence": "high", "fallback": false, "degraded_stages": [] }
}
```

Qaydalar:

- **`top_answer` / hər nəticədə `answer` sahəsi yoxdur** — cavab çıxarma yalnız `extracted: true` strukturlu sətirlərdə (`source` = `count-extract`, `measure-extract`, `date-extract`, `livestat-extract`, `holiday-table`, ...) olur və həmişə mənbə cümləsi ilə birlikdə verilir.
- `published_at` yalnız **həqiqi** nəşr tarixidir; redaktə tarixi `updated_at`-ə düşür. Bilinmirsə `null`.
- `no_results` xəta deyil və `confidence`-u aşağı salmır. Hamısı filtrdən keçmirsə: `results: []`, `fallback: true`, `confidence: "none"`.
- `confidence` = mənbə razılığı + aktuallıq (cavabın həqiqət zəmanəti deyil).
- `untrusted: true` — məzmun xarici saytlardandır, LLM ona data kimi yanaşmalıdır.
- DDG və Tavily default **söndürülüb** (keyless rejimdə etibarsız).

## Provayderlər (keyless)

`brave`, `yahoo`, `bing`/`bing-rss`/`bing-news`, `google-news`, `wikipedia` (AZ/EN/TR), `mwmbl`, `hacker-news`, `github`, `stackoverflow` (yalnız texniki sorğu), `arxiv`, `az-news` (AZ RSS), `azertag`, `sitemap-news` (icma.az, iqtisadiyyat.az), `ddg-instant`/`ddg-lite` (env ilə).

Struktur mənbələr: Open-Meteo (hava), CBAR (valyuta), CoinGecko (kripto), Wikidata (fakt), USDA (qida), TheSportsDB (idman), president.az (bayram təqvimi), daxili hesablama (riyaziyyat/vahid).

## Struktur

```
app/api/search/route.js     ← əsas boru xətti (axtarış → filtr → çıxarma → cavab)
app/api/{health,engines}/   ← köməkçi endpoint-lər
lib/
  search.js      provayder fan-out, RRF səs, URL normalizasiya
  score.js       dil-üzrə sıralama, spam/domen qaydaları, confidence
  rank.js        tokenizasiya, AZ stemming, abzas seçimi
  extract.js     səhifə oxunuşu (readability + linkedom + SSRF qoruması)
  clean.js       mətn təmizliyi, dil aşkarlama, boilerplate
  countextract.js  "neçə X" say çıxarma (dil qaydaları)
  measure.js     ölçü (faiz/yaş/manat) və tarix cavabı
  livestat.js    canlı rəsmi rəqəmlər (pensiya, əmək haqqı...)
  facts.js       Wikidata faktları   holidays.js  bayram təqvimi
  weather.js currency.js crypto.js math.js units.js nutrition.js sports.js
  router.js translate.js expand.js azertag.js sitemapnews.js suggest.js
  cache.js ratelimit.js circuit.js conflict.js
lib/data/        AZ stemmer leksikonu (+ lisenziya)
tests/           unit testlər (npm test)
eval/            canlı API-də sual dəstləri (golden.json, round1/2.json)
scripts/         provayder testi
tools/           leksikon/qida ID generatorları
searxng/         ixtiyari: öz SearXNG instance-ı
docs/            daxili sənədlər (memarlıq, deploy qeydləri)
```

## Dev

```bash
npm install
npm test           # unit testlər (offline, key-less)
npm run dev        # localhost:3000
node eval/run.mjs eval/golden.json 3   # canlı API-də sual dəsti
```

Deploy: GitHub-a push → Vercel avtomatik. Ətraflı: [DEPLOY.md](DEPLOY.md).

## Env (hamısı ixtiyari)

| Env | Nə edir |
|---|---|
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | paylaşılan cache + dəqiq rate limit |
| `SEARXNG_URL` | öz SearXNG instance-ın |
| `ENGINES_API_KEY` | `/api/engines`-i qoruyur |
| `ENABLE_DDG`, `TAVILY_API_KEY`, `USDA_API_KEY` | default söndürülmüş mənbələr |

## Limitlər

- Vercel funksiyası `maxDuration: 30`; sistem adətən 2–5 saniyəyə cavab verir.
- Bəzi saytlar bot qoruması verir — o zaman snippet istifadə olunur.
- Rate limit: IP başına 30/dəq (Upstash olmadan per-instance).
- Uzun AZ sorğuları EN anchor üçün MyMemory-ə göndərilir (keyless üçüncü tərəf).

## Lisenziyalar

AZ stemmer leksikonu — [aznlp-disc/stemmer](https://github.com/aznlp-disc/stemmer) (MIT), `lib/data/AZ-STEM-LICENSE.md`. İstifadə: `lib/azstem.js` → `lib/rank.js`.
