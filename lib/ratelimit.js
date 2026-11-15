// Rate limit: IP başına 30 sorğu / dəqiqə (sliding window)
// Vercel serverless-də in-memory counter Hər instance üçün ayrıca olduğuna görə
// faktiki limit qeyri-sabit olur (soyuq startda sıfırlanır).
// Upstash Redis (UPSTASH_REDIS_REST_URL/TOKEN env) varsa → shared counter,
// bütün instance-lar eyni limiti görür (README-dəki 30/dəq vədi tutulur).
// Upstash yoxdursa → in-memory fallback (local dev / free tier).
import { getRedis } from "./cache.js";

export const RATE_LIMIT = 30;
const WINDOW_MS = 60_000;
const hits = new Map(); // ip -> [timestamps] (in-memory fallback)

// Atomic sliding-window (Lua): 1 round-trip, race condition yoxdur
const RL_SCRIPT = `
local k = KEYS[1]
local now = tonumber(ARGV[1])
local win = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('zremrangebyscore', k, 0, now - win)
local count = redis.call('zcard', k)
if count >= limit then
  local oldest = redis.call('zrange', k, 0, 0, 'withscores')
  local retry = (oldest and oldest[2]) and (tonumber(oldest[2]) + win - now) or win
  return {0, retry, 0}
end
redis.call('zadd', k, now, member)
redis.call('pexpire', k, win)
return {1, 0, limit - count - 1}
`;

async function redisRateLimit(ip, limit, windowMs) {
  const r = await getRedis();
  if (!r) return null;
  try {
    const res = await r.eval(RL_SCRIPT, [
      `rl:${ip}`,
      String(Date.now()),
      String(windowMs),
      String(limit),
      `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    ]);
    if (Array.isArray(res) && res.length >= 3) {
      const [ok, retryMs, remaining] = [Number(res[0]), Number(res[1]), Number(res[2])];
      if (ok === 1) return { ok: true, remaining };
      return { ok: false, retryAfter: Math.max(1, Math.ceil(retryMs / 1000)) };
    }
    return null;
  } catch {
    return null; // Redis uğursuz → in-memory fallback (fail-open, lakin limit işləməli qalır)
  }
}

// async: Upstash shared counter yoxlayır, yoxdursa in-memory (per-instance)
export async function checkRateLimit(ip, limit = RATE_LIMIT, windowMs = WINDOW_MS) {
  const shared = await redisRateLimit(ip, limit, windowMs);
  if (shared) return shared;

  // In-memory fallback (local dev) - LRU-style təmizlik (memory leak fix)
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) return { ok: false, retryAfter: Math.ceil((windowMs - (now - arr[0])) / 1000) };
  arr.push(now);
  hits.set(ip, arr);
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
  s = s.replace(/<[^>]+>/g, " "); // HTML sil
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ""); // control character-lər
  return s.trim();
}
