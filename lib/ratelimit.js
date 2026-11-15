// Rate limit: IP başına 30 sorğu / dəqiqə
const hits = new Map(); // ip -> [timestamps]

export function checkRateLimit(ip, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) return { ok: false, retryAfter: Math.ceil((windowMs - (now - arr[0])) / 1000) };
  arr.push(now);
  hits.set(ip, arr);
  // təmizlik: köhnə IP-ləri sil (memory leak fix)
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      const last = v[v.length - 1];
      if (!v.length || now - last > windowMs) hits.delete(k);
    }
  }
  return { ok: true, remaining: limit - arr.length };
}

export function getClientIp(req) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// Prompt injection qorunması: istifadəçi sualını təmizlə
export function sanitizeQuery(q) {
  if (typeof q !== "string") return "";
  let s = q.trim().slice(0, 500);
  // açıq injection nümunələri sil
  s = s.replace(/ignore (all )?(previous|prior) instructions/gi, "");
  s = s.replace(/system prompt/gi, "");
  s = s.replace(/<[^>]+>/g, ""); // HTML sil
  return s.trim();
}
