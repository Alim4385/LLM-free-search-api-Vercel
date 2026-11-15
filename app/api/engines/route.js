import { getCircuitStats } from "../../../lib/circuit.js";

// Provayder sağlamlığı endpointi (FreeSearch /engines taktikası)
// Hər mühərrikin uğur faizi, orta latency və cooldown vəziyyəti
export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // BUG FIX: GET route handler statik cache-ə düşürdü (donmuş time/engines)
export async function GET() {
  return Response.json({
    engines: getCircuitStats(),
    time: new Date().toISOString()
  });
}
