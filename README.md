# VortexSearch — LLM-Free Web Search & MCP API

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAlim4385%2FLLM-free-search-api-Vercel)

A fast, zero-API-key, **LLM-free** web search engine and **Model Context Protocol (MCP)** server built for AI agents, RAG pipelines, and developers. Runs on Next.js App Router and deploys to Vercel in 30 seconds.

---

## Why VortexSearch?

- **Zero LLM & Zero Paid API Keys:** Aggregates multiple free web sources, Wikipedia, GitHub, Open-Meteo, and CBAR without requiring paid search or LLM keys.
- **Self-Hostable (Your Own IP & Quota):** Deploy your own instance on Vercel in one click so you never hit shared rate limits or IP blocks.
- **MCP Ready (`/api/mcp`):** Native JSON-RPC 2.0 (`2024-11-05`) endpoint for Claude Desktop, Cursor, Windsurf, and custom agents.
- **AI-Safe Output:**
  - Guaranteed `snippet` (~240 chars) on every result to save tokens.
  - Full `content` wrapped in `<untrusted>...</untrusted>` against prompt injection.
  - `is_official` & `domain` detection + `navigational` intent routing.
  - `score_normalized` (`0–1`), `provider_agreement`, `dup_group`, and `date_info`.
- **Multi-Language Support:** Automatic & explicit support for **Azerbaijani (`az`)**, **Turkish (`tr`)**, **English (`en`)**, and **Russian (`ru`)**.
- **Built-in Interactive Web UI:** Test queries, inspect JSON, and verify results directly from the home page (`/`).

---

## Quick Start (Self-Host on Vercel)

1. Click **Deploy with Vercel** above (or fork this repository and import it in [Vercel](https://vercel.com/new)).
2. Deploy — no environment variables are required.
3. Your dedicated endpoints will be live at:
   - **Web UI:** `https://your-app.vercel.app/`
   - **REST API:** `https://your-app.vercel.app/api/search`
   - **MCP Endpoint:** `https://your-app.vercel.app/api/mcp`

### Local Development

```bash
git clone https://github.com/Alim4385/LLM-free-search-api-Vercel.git
cd LLM-free-search-api-Vercel
npm install
npm run dev
```

Open `http://localhost:3000` to use the interactive Web UI.

---

## REST API Usage

### `GET /api/search`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `q` | string | *(required)* | Search query |
| `n` | integer | `5` | Max results (`1–10`) |
| `lang` | string | `auto` | `auto`, `az`, `tr`, `en`, `ru` |
| `freshness` | string | — | `day`, `week`, `month`, `year` |

**Example:**

```bash
curl "https://your-app.vercel.app/api/search?q=Kaggle&n=3"
```

---

## MCP (Model Context Protocol) Usage

Connect any MCP-compatible client (Claude Desktop, Cursor, etc.) to `https://your-app.vercel.app/api/mcp`:

```json
{
  "mcpServers": {
    "vortex-search": {
      "url": "https://your-app.vercel.app/api/mcp"
    }
  }
}
```

**Available Tool:** `web_search` (`query`, `max_results`, `lang`, `freshness`).

---

## Testing

```bash
npm test
node tests/query-quality-tests.mjs
node tests/text-noise-tests.mjs
node tests/adjacent-words-tests.mjs
```

## License

MIT
