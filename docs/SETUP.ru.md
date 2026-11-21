# VortexSearch — Установка, REST API и MCP (Русский)

[← Назад к README](../README.md)

## 1. Деплой в 1 клик на Vercel (Рекомендуется)

1. Нажмите **Deploy with Vercel** в [README](../README.md) (или импортируйте репозиторий на [vercel.com/new](https://vercel.com/new)).
2. Нажмите **Deploy** — переменные окружения и API-ключи не требуются.
3. Вы получите собственные эндпоинты (без общих лимитов и блокировок по IP):
   - **Web UI:** `https://your-app.vercel.app/`
   - **REST API:** `https://your-app.vercel.app/api/search`
   - **MCP Endpoint:** `https://your-app.vercel.app/api/mcp`

## 2. Локальный запуск

```bash
git clone https://github.com/Alim4385/LLM-free-search-api-Vercel.git
cd LLM-free-search-api-Vercel
npm install
npm run dev
```

Откройте `http://localhost:3000` в браузере.

## 3. REST API (`GET /api/search`)

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `q` | string | *(обязательно)* | Поисковый запрос |
| `n` | integer | `5` | Количество результатов (`1–10`) |
| `lang` | string | `auto` | `auto`, `az`, `tr`, `en`, `ru` |
| `freshness` | string | — | `day`, `week`, `month`, `year` |

```bash
curl "https://your-app.vercel.app/api/search?q=Kaggle&n=3"
```

## 4. Поддержка MCP (`POST /api/mcp`)

Добавьте в Claude Desktop, Cursor или любой MCP-клиент:

```json
{
  "mcpServers": {
    "vortex-search": {
      "url": "https://your-app.vercel.app/api/mcp"
    }
  }
}
```

Инструмент: `web_search` (`query`, `max_results`, `lang`, `freshness`).
