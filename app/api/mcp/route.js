import { GET as searchGet } from "../search/route.js";

const SERVER_INFO = { name: "vortex-search", version: "1.1.0" };
const ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: true };
const TOOLS = [
  {
    name: "web_search",
    description: "Search the web (Azerbaijani, Turkish, English, Russian) with clean extracted content, snippets, official domain detection, source_type, and date metadata.",
    annotations: ANNOTATIONS,
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
  {
    name: "verify_claim",
    description: "Verify a factual claim against independent web sources and return supporting evidence snippets and URLs.",
    annotations: ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {
        claim: { type: "string", description: "Factual claim to verify" },
        max_results: { type: "integer", minimum: 1, maximum: 8, default: 5 },
      },
      required: ["claim"],
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
    const args = params.arguments || {};
    if (params.name === "web_search") {
      const q = String(args.query || "").trim();
      if (!q) return err(id, -32602, "Missing required argument: query");
      const sp = new URLSearchParams({ q });
      if (args.max_results) sp.set("n", String(args.max_results));
      if (args.lang && args.lang !== "auto") sp.set("lang", String(args.lang));
      if (args.freshness) sp.set("freshness", String(args.freshness));
      const res = await searchGet(new Request(`http://localhost/api/search?${sp.toString()}`, { method: "GET" }));
      const data = await res.json();
      return ok(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], isError: !res.ok });
    }
    if (params.name === "verify_claim") {
      const claim = String(args.claim || "").trim();
      if (!claim) return err(id, -32602, "Missing required argument: claim");
      const sp = new URLSearchParams({ q: claim, n: String(args.max_results || 5) });
      const res = await searchGet(new Request(`http://localhost/api/search?${sp.toString()}`, { method: "GET" }));
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];
      const terms = claim.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
      const evidence = results.map(r => {
        const hay = `${r.title || ""} ${r.snippet || ""} ${r.content || ""}`.toLowerCase();
        const matched = terms.filter(t => hay.includes(t)).length;
        return { url: r.url, domain: r.domain, source_type: r.source_type, is_official: r.is_official, term_coverage: terms.length ? Number((matched / terms.length).toFixed(2)) : 0, snippet: r.snippet };
      });
      const strong = evidence.filter(e => e.term_coverage >= 0.5);
      const report = {
        claim,
        verdict: strong.length >= 2 ? "supported" : "inconclusive",
        supporting_count: strong.length,
        evidence,
      };
      return ok(id, { content: [{ type: "text", text: JSON.stringify(report, null, 2) }], isError: !res.ok });
    }
    return err(id, -32601, `Unknown tool: ${params.name}`);
  }
  return err(id, -32601, `Method not found: ${method}`);
}
