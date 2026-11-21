# VortexSearch — Kurulum, REST API ve MCP Rehberi (Türkçe)

[← Ana sayfaya dön](../README.md)

## 1. Vercel'de Tek Tıkla Kurulum (Önerilen)

1. [README](../README.md) sayfasındaki **Deploy with Vercel** düğmesine tıklayın (veya repoyu [vercel.com/new](https://vercel.com/new) üzerinden içe aktarın).
2. **Deploy** edin — hiçbir API anahtarı veya ortam değişkeni gerekmez.
3. Size özel (paylaşılan IP limitine takılmayan) uç noktalarınız hazır olur:
   - **Web UI:** `https://uygulamaniz.vercel.app/`
   - **REST API:** `https://uygulamaniz.vercel.app/api/search`
   - **MCP Endpoint:** `https://uygulamaniz.vercel.app/api/mcp`

## 2. Yerel Geliştirme

```bash
git clone https://github.com/Alim4385/LLM-free-search-api-Vercel.git
cd LLM-free-search-api-Vercel
npm install
npm run dev
```

Tarayıcıda `http://localhost:3000` adresini açın.

## 3. REST API (`GET /api/search`)

| Parametre | Tür | Varsayılan | Açıklama |
|---|---|---|---|
| `q` | string | *(zorunlu)* | Arama sorgusu |
| `n` | integer | `5` | Sonuç sayısı (`1–10`) |
| `lang` | string | `auto` | `auto`, `az`, `tr`, `en`, `ru` |
| `freshness` | string | — | `day`, `week`, `month`, `year` |

```bash
curl "https://uygulamaniz.vercel.app/api/search?q=Kaggle&n=3"
```

## 4. MCP Desteği (`POST /api/mcp`)

Claude Desktop, Cursor veya herhangi bir MCP istemcisine ekleyin:

```json
{
  "mcpServers": {
    "vortex-search": {
      "url": "https://uygulamaniz.vercel.app/api/mcp"
    }
  }
}
```

Araç: `web_search` (`query`, `max_results`, `lang`, `freshness`).
