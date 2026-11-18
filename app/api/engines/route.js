import { getCircuitStats } from "../../../lib/circuit.js";

// Provayder sağlamlığı endpointi (FreeSearch /engines taktikası)
// Hər mühərrikin uğur faizi, orta latency və cooldown vəziyyəti
// Opsional qoruma: ENGINES_API_KEY env dəyəri varsa, x-api-key header tələb olunur
// (env yoxdursa açıq qalır - geriyyətlilik üçün)
export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // BUG FIX: GET route handler statik cache-ə düşürdü (donmuş time/engines)
export async function GET(req) {
  const key = process.env.ENGINES_API_KEY;
  if (key && req.headers.get("x-api-key") !== key) {
    return Response.json({ error: "unauthorized", message: "x-api-key header tələb olunur" }, { status: 401 });
  }
  // v97: production-da açar yoxdursa endpoint bağlıdır (provayder sağlamlığı daxili məlumatdır)
  if (!key && process.env.NODE_ENV === "production" && process.env.ENGINES_PUBLIC !== "1") {
    return Response.json({ error: "disabled", message: "ENGINES_API_KEY təyin olunmayıb; endpoint bağlıdır (ENGINES_PUBLIC=1 ilə açıla bilər)" }, { status: 403 });
  }
  return Response.json({
    engines: getCircuitStats(),
    time: new Date().toISOString()
  });
}
