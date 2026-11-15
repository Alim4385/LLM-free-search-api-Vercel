// Upstash Redis (optional) + in-memory fallback
let redis = null;
let redisTried = false;

// Export olunub: rate limit də eyni Redis bağlantısını istifadə edir (shared counter)
export async function getRedis() {
  if (redisTried) return redis;
  redisTried = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const { Redis } = await import("@upstash/redis");
      redis = new Redis({ url, token });
    } catch { redis = null; }
  }
  return redis;
}

// In-memory fallback (local dev üçün) - LRU eviction + ÜMUMİ MB limit
// v12.3 perf: element sayı (MEM_MAX=1000) yerinə 5 MB limit — hər val 20-30 KB
// search JSON-u idi, köhnə limit 20-30 MB RAM götürürdü (serverless OOM riski).
const mem = new Map();
const MEM_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
let memBytes = 0;
const valBytes = (val) => {
  const s = typeof val === "string" ? val : JSON.stringify(val);
  return s ? s.length : 0; // UTF-16 length ≈ bytes (ASCII-də exact)
};
function memGet(key) {
  const v = mem.get(key);
  if (!v) return null;
  if (Date.now() > v.exp) { memBytes -= v.size; mem.delete(key); return null; }
  // LRU: oxunanı sona köçür (ən köhnə əvvəl silinir)
  mem.delete(key);
  mem.set(key, v);
  return v.val;
}
function memSet(key, val, ttlSec) {
  const old = mem.get(key);
  if (old) { mem.delete(key); memBytes -= old.size; }
  const size = valBytes(val);
  mem.set(key, { val, exp: Date.now() + ttlSec * 1000, size });
  memBytes += size;
  // Limitdən artıqdırsa ən köhnələri sil (Map insertion order).
  // mem.size > 1: tək entry limitdən böyükdürsə onu silyib boş döngüyə düşmə.
  while (memBytes > MEM_MAX_BYTES && mem.size > 1) {
    const oldest = mem.keys().next().value;
    const ov = mem.get(oldest);
    memBytes -= ov.size;
    mem.delete(oldest);
  }
}

export async function cacheGet(key) {
  const r = await getRedis();
  if (r) {
    try { return await r.get(key); } catch { return memGet(key); }
  }
  return memGet(key);
}

export async function cacheSet(key, val, ttlSec = 600) {
  const r = await getRedis();
  if (r) {
    try { await r.set(key, val, { ex: ttlSec }); return; } catch {}
  }
  memSet(key, val, ttlSec);
}

export function cacheKey(prefix, obj) {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj);
  // Full key (hash collision fix): 32-bit hash fərqli sorğulara eyni nəticə verə bilərdi
  // Redis/Map string keyləri təhlükəsiz idarə edir
  return `${prefix}:${s}`;
}
