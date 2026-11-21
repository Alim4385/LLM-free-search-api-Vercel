import { GET as searchGet } from "../search/route.js";

const SERVER_INFO = { name: "qaqa-search-api", version: "1.1.0" };
const TOOLS = [
  {
    name: "web_search",
    description: "Search the web (Azerbaijani, Turkish, English, Russian) with clean extracted content, snippets, official domain detection, and date metadata.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "integer", minimum: 1, maximum: 10, default: 5 },
        lang: { type: "string", enum: ["auto", "az", "tr", "en", "ru"], default: "auto" },
        freshness: { type: "string", enum: ["day", "week", "month", "year"] },
      },
      required: ["query"],
    },
  },
];

const ok = (id, result) => Response.json({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id, code, message) => Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status: 400 });

export async function GET() {
  return Response.json({ ok: true, protocol: "mcp", version: "2024-11-05", endpoint: "/api/mcp", tools: TOOLS.map(t => t.name) });
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return err(null, -32700, "Parse error");
  }
  const { id, method, params = {} } = body || {};
  if (method === "initialize") {
    return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  }
  if (method === "notifications/initialized") {
    return ok(id, {});
  }
  if (method === "tools/list") {
    return ok(id, { tools: TOOLS });
  }
  if (method === "tools/call") {
    if (params.name !== "web_search") return err(id, -32601, `Unknown tool: ${params.name}`);
    const args = params.arguments || {};
    const q = String(args.query || "").trim();
    if (!q) return err(id, -32602, "Missing required argument: query");
    const sp = new URLSearchParams({ q });
    if (args.max_results) sp.set("n", String(args.max_results));
    if (args.lang && args.lang !== "auto") sp.set("lang", String(args.lang));
    if (args.freshness) sp.set("freshness", String(args.freshness));
    const searchReq = new Request(`http://localhost/api/search?${sp.toString()}`, { method: "GET" });
    const res = await searchGet(searchReq);
    const data = await res.json();
    return ok(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: !res.ok });
  }
  return err(id, -32601, `Method not found: ${method}`);
}
