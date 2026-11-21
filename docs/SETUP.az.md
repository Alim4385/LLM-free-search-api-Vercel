# VortexSearch — Quraşdırma, REST API və MCP Bələdçisi (Azərbaycan)

[← Əsas səhifəyə qayıt](../README.md)

## 1. Vercel-də 1 Kliklə Quraşdırma (Tövsiyə olunur)

1. [README](../README.md) səhifəsində **Deploy with Vercel** düyməsinə klikləyin (və ya reponu [vercel.com/new](https://vercel.com/new) üzərindən import edin).
2. **Deploy** edin — heç bir API açarı və ya environment variable tələb olunmur.
3. Özünüzə məxsus (ortaq IP blokuna düşməyən) endpoint-lər hazır olacaq:
   - **Web UI (Test interfeysi):** `https://sizin-app.vercel.app/`
   - **REST API:** `https://sizin-app.vercel.app/api/search`
   - **MCP Endpoint:** `https://sizin-app.vercel.app/api/mcp`

## 2. Lokal İşə Salma

```bash
git clone https://github.com/Alim4385/LLM-free-search-api-Vercel.git
cd LLM-free-search-api-Vercel
npm install
npm run dev
```

Brauzerdə `http://localhost:3000` ünvanını açın.

## 3. REST API (`GET /api/search`)

| Parametr | Tip | Standart | İzah |
|---|---|---|---|
| `q` | string | *(məcburi)* | Axtarış sorğusu |
| `n` | integer | `5` | Nəticə sayı (`1–10`) |
| `lang` | string | `auto` | `auto`, `az`, `tr`, `en`, `ru` |
| `freshness` | string | — | `day`, `week`, `month`, `year` |

```bash
curl "https://sizin-app.vercel.app/api/search?q=Bak%C4%B1%20hava&n=3"
```

## 4. MCP Dəstəyi (`POST /api/mcp`)

Claude Desktop, Cursor və ya digər MCP müştərilərinə əlavə edin:

```json
{
  "mcpServers": {
    "vortex-search": {
      "url": "https://sizin-app.vercel.app/api/mcp"
    }
  }
}
```

Alət: `web_search` (`query`, `max_results`, `lang`, `freshness`).

## 5. Testlər

```bash
npm test
node tests/query-quality-tests.mjs
node tests/text-noise-tests.mjs
node tests/adjacent-words-tests.mjs
```
