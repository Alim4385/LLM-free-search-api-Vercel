// Circuit breaker: uğursuz provayderi müvəqqəti soyut (FreeSearch taktikası)
// Provayder ardıcıl uğursuz olarsa soyuyur, digərləri işləməyə davam edir
// Next.js route-ları izolyasiya edir, ona görə state fayla da yazılır (engines endpointi üçün körpü)
// Per-provider konfiq: arXiv/Tavily/Brave/Bing daha az aqressiv (əsas provayderlər tez soyumamalıdır)
import fs from "fs";
const FILE = "/tmp/qaqa-circuit.json";
const state = globalThis.__qaqaCircuitState || (globalThis.__qaqaCircuitState = new Map());

// v10.1 🟠11: debounce — əvvəl HƏR çağırışda (bir sorğuda 8+ provayder!)
// sinxron fs.writeFileSync edirdi. İndi: 1s-də ən çox 1 yazı; unref() serverless
// exit-ini təxirə salmır (state globalThis-də qalır, fayl engines endpoint
// körpüsü üçün 1s-də bir sync olunur)
let persistTimer = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const obj = {};
      for (const [k, v] of state) obj[k] = v;
      fs.writeFileSync(FILE, JSON.stringify(obj));
    } catch {}
  }, 1000);
  if (persistTimer && typeof persistTimer.unref === "function") persistTimer.unref();
}

function loadFromFile() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const [k, v] of Object.entries(data)) {
      if (!state.has(k)) state.set(k, v);
    }
  } catch {}
}

// Per-provider threshold/cooldown: əsas provayderlər daha uzun dözür
const CIRCUIT_CONFIG = {
  "bing":        { threshold: 5, cooldownMs: 15000 }, // əsas - tez soyutma
  "tavily":      { threshold: 5, cooldownMs: 15000 }, // əsas - 429 tez-tez olur, amma dəyərlidir
  "brave":       { threshold: 5, cooldownMs: 15000 }, // əsas ehtiyat
  "arxiv":       { threshold: 5, cooldownMs: 10000 }, // az aqressiv - meta sorğular üçün kritik (DeepSeek tövsiyəsi)
  "hacker-news":   { threshold: 4, cooldownMs: 15000 },
  "github":        { threshold: 4, cooldownMs: 15000 },
  "stackoverflow": { threshold: 4, cooldownMs: 15000 },
  "wikipedia":     { threshold: 4, cooldownMs: 15000 },
  "google-news": { threshold: 4, cooldownMs: 15000 },
  "duckduckgo":  { threshold: 3, cooldownMs: 20000 }, // tez-tez bloklanır - aqressiv soyutma latency qənaət edir
  "ddg-instant": { threshold: 3, cooldownMs: 20000 }, // tez-tez boşdur (instant cavab yoxdur) - aqressiv soyutma
  "searxng":     { threshold: 3, cooldownMs: 20000 },
};
const DEFAULT_CONFIG = { threshold: 4, cooldownMs: 15000 };

export function getCircuitConfig(provider) {
  return CIRCUIT_CONFIG[provider] || DEFAULT_CONFIG;
}

function getState(provider) {
  if (!state.has(provider)) {
    state.set(provider, { failures: 0, cooldownUntil: 0, successes: 0, total: 0, totalLatency: 0 });
  }
  return state.get(provider);
}

export function isCircuitOpen(provider) {
  const s = state.get(provider);
  if (!s) return false;
  return Date.now() < s.cooldownUntil;
}

export function recordSuccess(provider, latencyMs) {
  const s = getState(provider);
  s.successes++;
  s.total++;
  s.totalLatency += latencyMs || 0;
  s.failures = 0;
  s.cooldownUntil = 0;
  persist();
}

export function recordFailure(provider) {
  const s = getState(provider);
  s.failures++;
  s.total++;
  const cfg = getCircuitConfig(provider);
  if (s.failures >= cfg.threshold) {
    s.cooldownUntil = Date.now() + cfg.cooldownMs;
  }
  persist();
}

export function getCircuitStats() {
  loadFromFile();
  const out = [];
  for (const [provider, s] of state) {
    out.push({
      provider,
      status: Date.now() < s.cooldownUntil ? "cooldown" : "ok",
      successRate: s.total ? +(s.successes / s.total * 100).toFixed(1) : null,
      avgLatencyMs: s.successes ? Math.round(s.totalLatency / s.successes) : null,
      consecutiveFailures: s.failures,
      totalCalls: s.total
    });
  }
  return out.sort((a, b) => a.provider.localeCompare(b.provider));
}
