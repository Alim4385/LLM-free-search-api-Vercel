export const runtime = "nodejs";
export async function GET() {
  return new Response(JSON.stringify({ ok: true, service: "qaqa-search-api", time: new Date().toISOString(), version: "1.0.0" }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
}
