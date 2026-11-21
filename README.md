<div align="center">

# VortexSearch

**LLM-Free Web Search Engine & MCP Server for AI Agents**

Zero API keys · Self-hostable on Vercel · AI-safe `<untrusted>` output · Built-in Web UI

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAlim4385%2FLLM-free-search-api-Vercel)

**Read Setup & API Guide in your language:**  
[English](docs/SETUP.md) · [Azərbaycan](docs/SETUP.az.md) · [Türkçe](docs/SETUP.tr.md) · [Русский](docs/SETUP.ru.md)

</div>

---

## What is VortexSearch?

VortexSearch is an open-source, **LLM-free** web search API and **Model Context Protocol (MCP)** server built on Next.js App Router. It aggregates free web sources, Wikipedia, GitHub, Open-Meteo, and CBAR into clean, structured, token-efficient JSON—without requiring any paid search or LLM API keys.

### Why Use It?

| Feature | Benefit |
|---|---|
| **Zero API Keys** | Works out of the box with no OpenAI, Brave, or Serper keys |
| **Your Own Vercel IP** | 1-click deploy gives you a dedicated endpoint with no shared rate limits |
| **MCP Ready (`/api/mcp`)** | Native JSON-RPC 2.0 (`2024-11-05`) for Claude Desktop, Cursor, and Windsurf |
| **AI-Safe Output** | Guaranteed `snippet` (~240 chars) + `<untrusted>` wrapped `content` against prompt injection |
| **Smart Ranking** | `is_official` detection, `navigational` intent, `score_normalized` (`0–1`), `dup_group` |
| **Multi-Language** | Supports **Azerbaijani (`az`)**, **Turkish (`tr`)**, **English (`en`)**, and **Russian (`ru`)** |
| **Built-in Web UI** | Interactive search & JSON inspector right at `/` |

---

## Documentation

- **Setup, Self-Hosting, REST API & MCP:**
  - [English Guide (`docs/SETUP.md`)](docs/SETUP.md)
  - [Azərbaycan Bələdçisi (`docs/SETUP.az.md`)](docs/SETUP.az.md)
  - [Türkçe Rehber (`docs/SETUP.tr.md`)](docs/SETUP.tr.md)
  - [Руководство на русском (`docs/SETUP.ru.md`)](docs/SETUP.ru.md)

## Credits & Open-Source Projects

VortexSearch is built with and powered by:
- [Next.js](https://nextjs.org/) & [React](https://react.dev/)
- [Linkedom](https://github.com/WebReflection/linkedom) (fast server-side HTML parsing)
- Public data APIs: [Wikipedia](https://www.mediawiki.org/wiki/API:Main_page), [GitHub](https://docs.github.com/en/rest), [Open-Meteo](https://open-meteo.com/), and [CBAR](https://www.cbar.az/)

## License

[VortexSearch Attribution License (v1.0)](LICENSE) — Free to use, modify, distribute, and commercialize.  
**Mandatory Condition:** Any project, fork, or commercial product using this code must prominently display attribution to **VortexSearch** by **Alim4385** (`https://github.com/Alim4385/LLM-free-search-api-Vercel`) in its main `README.md`. Removing this attribution immediately terminates all usage rights.
