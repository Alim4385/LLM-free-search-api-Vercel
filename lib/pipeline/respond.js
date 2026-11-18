// v100 — Cavab qatı (respond): JSON / JSONL / sadə formatlar və başlıqlar.
// Blueprint-in `lib/pipeline/respond.js` addımı. Şəbəkə yoxdur → unit testlərlə qorunur.

// route.js-dəki başlıqlarla EYNİ olmalıdır (davranış dəyişməsin)
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-Request-Id"
};

export function makeJsonResponse(obj, status = 200, extraHeaders = {}, opts = {}) {
  const pretty = opts.pretty !== false;   // route.js əvvəl pretty JSON verirdi
  return new Response(JSON.stringify(obj, null, pretty ? 2 : 0), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS, ...extraHeaders }
  });
}

export function rateLimitHeaders(rl, requestId, limit) {
  const h = {
    "X-RateLimit-Limit": String(limit ?? rl?.limit ?? 0),
    "X-RateLimit-Remaining": String(rl?.remaining ?? 0),
    "X-Request-Id": requestId
  };
  if (rl && !rl.ok && Number.isFinite(rl.retryAfter)) h["Retry-After"] = String(rl.retryAfter);
  return h;
}

// JSONL: meta → hər nəticə → done. Sətirlər `start()` daxilində mikro-tasklarla yazılır.
// Saf funksiya (test üçün): JSONL sətirləri
export function jsonlLines(results, meta) {
  const list = Array.isArray(results) ? results : [];
  const lines = [JSON.stringify({ type: "meta", ...meta })];
  for (const r of list) lines.push(JSON.stringify({ type: "result", ...r }));
  lines.push(JSON.stringify({ type: "done", count: list.length }));
  return lines;
}

export function makeJsonlResponse(results, meta, extraHeaders = {}) {
  const list = Array.isArray(results) ? results : [];
  const lines = jsonlLines(list, meta);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let i = 0;
      const next = () => {
        if (i < lines.length) {
          controller.enqueue(encoder.encode(lines[i++] + "\n"));
          setTimeout(next, 0);
        } else controller.close();
      };
      next();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS, ...extraHeaders }
  });
}

export function makeSimpleResponse(query, results, extraHeaders = {}) {
  const list = Array.isArray(results) ? results : [];
  return makeJsonResponse({
    query,
    results: list.map(r => ({ title: r.title, url: r.url, snippet: (r.snippet || r.content || "").slice(0, 200) }))
  }, 200, extraHeaders);
}
