// v68: KRİPTOVALYUTA QİYMƏTİ — CoinGecko (açarsız, pulsuz).
// Səbəb: "Bitcoin-in qiyməti nə qədərdir" sualına sistem ensiklopediya məqaləsi
// qaytarırdı (qiymət yox). Qiymət rəqəm olmalıdır — canlı yoxlanıldı (2026-11).
const API = "https://api.coingecko.com/api/v3/simple/price";
const UA = "Mozilla/5.0 (compatible; LLMSearchAPI/1.0)";

// AZ/EN adlar → CoinGecko id
const COINS = [
  { id: "bitcoin", sym: "BTC", names: ["bitcoin", "bitkoin", "биткоин"] },
  { id: "ethereum", sym: "ETH", names: ["ethereum", "efirium", "эфириум"] },
  { id: "tether", sym: "USDT", names: ["tether", "usdt"] },
  { id: "binancecoin", sym: "BNB", names: ["bnb", "binance coin", "binancecoin"] },
  { id: "solana", sym: "SOL", names: ["solana"] },
  { id: "ripple", sym: "XRP", names: ["xrp", "ripple"] },
  { id: "cardano", sym: "ADA", names: ["cardano"] },
  { id: "dogecoin", sym: "DOGE", names: ["dogecoin", "doge"] },
  { id: "toncoin", sym: "TON", names: ["toncoin", "ton coin"] }
];

// şəkilçiyə icazə: "qiyməti", "qiyməti nə qədərdir", "kursu"
const PRICE_Q = /(?<![\p{L}])(qiym[əe]t\p{L}*|price|kurs\p{L}*|курс\p{L}*|nec[əe]|n[əe]\s+q[əe]d[əe]r\p{L}*|how\s+much)/iu;

export function matchCrypto(query = "") {
  const q = String(query || "").toLowerCase();
  if (!PRICE_Q.test(q)) return { hit: false, exact: false };
  for (const c of COINS) {
    for (const n of c.names) {
      const re = new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu");
      if (re.test(q)) return { hit: true, exact: true, id: c.id, sym: c.sym, name: n };
    }
  }
  return { hit: false, exact: false };
}

const CACHE = new Map();
let BLOCK_UNTIL = 0;

export async function fetchCryptoPrice(m, ms = 1800) {
  if (!m || !m.hit) return null;
  const cached = CACHE.get(m.id);
  if (cached && Date.now() - cached.t < 60000) return cached.v; // 1 dəqiqə
  if (Date.now() < BLOCK_UNTIL) return null;
  const url = `${API}?ids=${encodeURIComponent(m.id)}&vs_currencies=usd,azn`;
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  } catch { return null; }
  if (res.status === 429) { BLOCK_UNTIL = Date.now() + 300000; return null; }
  if (!res.ok) return null;
  let j;
  try { j = await res.json(); } catch { return null; }
  const row = j && j[m.id];
  if (!row || typeof row.usd !== "number") return null;
  const out = {
    id: m.id, sym: m.sym,
    usd: row.usd,
    azn: typeof row.azn === "number" ? row.azn : null,
    fetched_at: new Date().toISOString(),
    source: "coingecko.com"
  };
  CACHE.set(m.id, { t: Date.now(), v: out });
  return out;
}

const fmt = (n) => String(Math.round(n * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function cryptoToText(c) {
  if (!c) return "";
  const name = c.sym;
  const azn = c.azn != null ? ` (${fmt(c.azn)} AZN)` : "";
  return `${name} hazırkı qiyməti: ${fmt(c.usd)} USD${azn}. Mənbə: CoinGecko, ${c.fetched_at.slice(0, 16).replace("T", " ")} UTC. Qeyd: kripto qiyməti dəqiqəbədəqiqə dəyişir — bu, sorğu anındaki dəyərdir.`;
}
