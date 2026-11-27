// v131: tam handler ssenarisi (stub şəbəkə) — AYRI PROSESDƏ işlədilir ki, modul keşləri/circuit breaker-lər qarışmasın.
// Canlı trace-i təkrarlayır: tək təzə ru-news xəbəri + gate_relaxed/retry ilə qaytarılan 2022-ci il məqaləsi.
// Çıxış: bir sətir JSON (SIM_RESULT ...).
const nowMs = Date.now();
const hrs = (h) => new Date(nowMs - h * 3600000).toUTCString();
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel>${items.map(([t, l, d, h]) => `<item><title>${t}</title><link>${l}</link><description>${d}</description><pubDate>${h}</pubDate></item>`).join("")}</channel></rss>`;
const FEED = [["Россия будет содействовать социальной адаптации участников СВО", "https://ria.ru/20261126/a.html", "Краткий пересказ от РИА ИИ Россия будет содействовать", hrs(2)]];
const BING_NEWS = [["Главное из брифинга Минобороны 25 ноября 2026 года: последние новости", "https://news.mail.ru/svo/73230458/", "Минобороны сообщило об итогах недели на фронте и в тылу", hrs(5)], ["Главные новости к вечеру 26 ноября 2026 года", "https://news.mail.ru/society/73250187/", "Главное за день в стране", hrs(1)]];
const BING = [["ABC News - Breaking News, Latest News and Videos", "https://abcnews.com/", "Latest news and videos", hrs(1)], ["Brittney Griner freed from Russia in prisoner exchange | CBC News", "https://www.cbc.ca/1.6678465", "Brittney Griner freed from Russia in a prisoner exchange for Viktor Bout", new Date("2022-12-08T13:26:05Z").toUTCString()]];
const GNEWS = [["Украина: Россия снова бьёт по энергетике, Киев поразил российские НПЗ - Deutsche Welle", "https://news.google.com/rss/articles/CBMivwFBVV95cUxQUTM2a2U3Ny1EYUtreGN1aS1IQkQ2RVBfQ2Jz", "Украина: Россия снова бьёт по энергетике Deutsche Welle", hrs(2)]];
const page = "<p>Подробности события. В российских регионах сообщили о новых решениях властей, экспертам предстоит оценить последствия для экономики страны. Страна продолжает обсуждение ключевых вопросов внутренней и внешней политики и отношений с соседними государствами.</p>".repeat(3);
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url)); const host = u.hostname.replace(/^www\./, "");
  if (host === "translate.google.com") { const pp = new URLSearchParams(String((init && init.body) || "")); const q = pp.get("q") || ""; return new Response(JSON.stringify([[[(pp.get("tl") === "en" && /последние новости России/.test(q)) ? "latest news from Russia" : q, q, null, null, 1]], null, "ru"]), { status: 200 }); }
  if (host === "ria.ru" && /rss/i.test(u.pathname)) return new Response(rss(FEED), { status: 200 });
  if (host === "bing.com" && u.pathname.startsWith("/news") && String(url).includes("format=rss")) return new Response(rss(BING_NEWS), { status: 200 });
  if (host === "bing.com" && String(url).includes("format=rss")) return new Response(rss(BING), { status: 200 });
  if (host === "news.google.com" && u.pathname.startsWith("/rss/search")) return new Response(rss(GNEWS), { status: 200 });
  if (host === "news.google.com") return new Response("<html><body>Redirecting… Google News</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  if (/ria\.ru|cbc\.ca|abcnews|mail\.ru/.test(host)) return new Response(`<html><head><title>Новости</title></head><body><article>${page}</article></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  throw new Error("offline");
};
const { POST } = await import("../app/api/search/route.js");
const res = await POST(new Request("http://localhost/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "последние новости России #debug", lang: "ru", max_results: 5 }) }));
const j = await res.json(); const m = j.meta || {};
console.log("SIM_RESULT " + JSON.stringify({ status: res.status, urls: (j.results || []).map((r) => r.url), degraded: m.degraded_stages || [], candidates: ((m.debug || {}).candidates || []).map((c) => ({ url: c.url, status: c.status, stage: c.stage, why: c.why })) }));
process.exit(0);
