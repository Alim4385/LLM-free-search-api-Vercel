# VortexSearch — Setup, REST API & MCP Guide (English)

[← Back to README](../README.md)

## 1. 1-Click Deploy on Vercel (Recommended)

1. Click **Deploy with Vercel** in the [README](../README.md) (or import this repo at [vercel.com/new](https://vercel.com/new)).
2. Click **Deploy** — no environment variables are needed.
3. Your own dedicated endpoints (with your own IP & quota):
   - **Web UI:** `https://your-app.vercel.app/`
   - **REST API:** `https://your-app.vercel.app/api/search`
   - **MCP Endpoint:** `https://your-app.vercel.app/api/mcp`

## 2. Local Development

```bash
git clone https://github.com/Alim4385/LLM-free-search-api-Vercel.git
cd LLM-free-search-api-Vercel
npm install
npm run dev
```

Open `http://localhost:3000` for the interactive Web UI.

## 3. REST API (`GET /api/search`)

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | *(required)* | Search query |
| `n` | integer | `5` | Max results (`1–10`) |
| `lang` | string | `auto` | `auto`, `az`, `tr`, `en`, `ru` |
| `freshness` | string | — | `day`, `week`, `month`, `year` |

```bash
curl "https://your-app.vercel.app/api/search?q=Kaggle&n=3"
```

## 4. MCP Support (`POST /api/mcp`)

Add to Claude Desktop, Cursor, or any MCP client:

```json
{
  "mcpServers": {
    "vortex-search": {
      "url": "https://your-app.vercel.app/api/mcp"
    }
  }
}
```

Tool: `web_search` (`query`, `max_results`, `lang`, `freshness`).

## 5. Testing

```bash
npm test
node tests/query-quality-tests.mjs
node tests/text-noise-tests.mjs
node tests/adjacent-words-tests.mjs
```
