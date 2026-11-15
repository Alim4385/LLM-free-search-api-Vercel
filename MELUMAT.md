# Qaqa Search API — Məlumat (2026-11-14)

Bu paket **LLM-in tool kimi çağırıb istifadə edəcəyi key-siz axtarış API-sidir**.
İçində LLM yoxdur — sən öz LLM-ini qoşursan, o bu API-ni çağırır.
**Heç bir API key lazım deyil. Vercel-də işləyir.**

---

## Paketin içində nə var?

```
qaqa-search-api/
├── app/
│   ├── api/search/route.js    ← ƏSAS: POST/GET /api/search
│   ├── api/health/route.js    ← GET /api/health
│   ├── api/engines/route.js   ← GET /api/engines (provayder statistikası)
│   ├── page.js, layout.js     ← Sadə ana səhifə
├── lib/
│   ├── search.js      ← 10 provayder, paralel axtarış, RRF vote, circuit breaker
│   ├── score.js       ← Azərbaycan stemming + skorlama + near-dedup
│   ├── expand.js      ← Sorğu genişləndirmə (AZ→EN lüğət)
│   ├── translate.js   ← Uzun AZ sorğular üçün MyMemory tərcümə (EN anchor)
│   ├── circuit.js     ← Provayder circuit breaker (blok qorunması)
│   ├── weather.js     ← Open-Meteo hava (scraping yoxdur)
│   ├── time.js        ← Bakı vaxtı (Intl, Asia/Baku)
│   ├── currency.js    ← Mərkəzi Bank valyuta (CBAR XML)
│   ├── cache.js       ← Upstash Redis / yaddaş cache (1 saat)
│   ├── ratelimit.js   ← 30 sorğu/dəq IP başına
│   ├── extract.js     ← linkedom + Readability (SSRF qorunması ilə)
│   ├── suggest.js     ← Google Suggest genişləndirmə
│   ├── rank.js        ← BM25 excerpt sıralaması
│   └── tool-schema.json ← LLM tool çağırışı üçün JSON schema
├── tests/             ← 7 test faylı (aşağıda)
├── scripts/test-providers.mjs
├── examples/llm-integration.js  ← LLM-ə necə qoşmaq olar (nümunə)
├── searxng/           ← İxtiyari: öz SearXNG-ni VPS-də qurmaq üçün
├── package.json, vercel.json, next.config.js, .gitignore, .env.example
├── README.md          ← Ətraflı sənəd
└── DEPLOY.md          ← GitHub → Vercel addım-addım təlimat
```

## Testlər necə işə salınır?

```bash
npm install
npm run build
npm start            # server :3000-də qalxsın

# Başqa terminaldə:
node tests/unit-tests.mjs    # 22 unit test
node tests/api-tests.mjs     # 37 API test
node tests/extra-tests.mjs   # 18 əlavə test
node tests/test-suite.js 1   # 11 sorğuluq əsas suit (1, 2, 3 run)
node tests/content-diff.mjs  # 3 run nəticələrini müqayisə et
```

## Son test nəticələri (V8, 2026-11-14)

| Test | Nəticə |
|---|---|
| Unit | **22/22** keçdi |
| API | **37/37** keçdi |
| Extra | **18/18** keçdi |
| 11-sorğuluq suit (3 run) | **33/33 ≥3 nəticə**, Test8 boş düzgün, Test10 3/3/5 |
| Latency | max **3.0s** (orta ~2s) |
| Test2/3/4 sabitliyi | Jaccard **1.00** |
| Yeni funksiyalar | `freshness`, `exclude_domains`, near-dedup, rate-limit headerləri — hamısı doğrulandı |

## API istifadəsi

```bash
# POST
curl -X POST https://qaqa-search-api.vercel.app/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"LLM axtarış motoru","max_results":5}'

# GET
curl "https://qaqa-search-api.vercel.app/api/search?q=LLM&freshness=week"
```

Cavab JSON-dur: `{query, intent, reason, results:[{id,title,url,snippet,content,source,provider,score}], meta:{...}}`
LLM nəticələri `[1] [2]` nömrələri ilə istifadə edir.

## Deploy (qısaca — ətraflı DEPLOY.md-də)

1. Bu qovluğu GitHub-da yeni repo kimi push et (`git init/add/commit/push`)
2. vercel.com → Add New → Project → Git Repository import et
3. Vercel sənə domen verir: `https://qaqa-search-api.vercel.app`
4. Test et: `/api/health` və `POST /api/search {"query":"LLM"}`

İxtiyari (olmasa da işləyir):
- Upstash Redis (pulsuz) → cache qalıcı olur: `.env.example`-a bax
- Öz SearXNG (VPS) → `SEARXNG_URL` əlavə et: `searxng/README.md`-yə bax

## Nə çıxarıldı (artıq şeylər)

Köhnə test çıxışları (`*.txt`, `*.json`), 30+ tarixi hesabat (`*-REPORT.md`),
debug skriptləri (`brave.mjs`, `debug.mjs` və s.), log faylları (`*.log`),
köhnə test skriptləri (`deepseek-*.mjs`, `retest*.mjs`, `user-*.mjs` və s.)
— hamısı təmizləndi. Yalnız yuxarıdakı 40 fayl qaldı.

## Vacib qeydlər

- **Heç bir API key yoxdur** — Tavily keyless rəsmi açarsız rejimdir (header ilə).
- Keyless axtarış kövrəkdir: Bing/DDG Vercel IP-sini bloklaya bilər → 10 provayder + circuit breaker + fallback var.
- Tavily keyless gündəlik limitlidir (`daily_cap_reached` ola bilər) — o gün Bing+arXiv+News+HN işləyir.
- Rate limit: 30 sorğu/dəq/IP. Limit keçsə 429 + `Retry-After` qaytarır.
- Hava sorğuları Open-Meteo API-dən gəlir (scraping deyil).
