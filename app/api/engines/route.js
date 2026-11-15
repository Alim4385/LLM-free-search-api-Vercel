import { getCircuitStats } from "../../../lib/circuit.js";

// Provayder sağlamlığı endpointi (FreeSearch /engines taktikası)
// Hər mühərrikin uğur faizi, orta latency və cooldown vəziyyəti
export async function GET() {
  return Response.json({
    engines: getCircuitStats(),
    time: new Date().toISOString()
  });
}
