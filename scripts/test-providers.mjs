// Provayderləri test et: node scripts/test-providers.mjs
// v10 🟠13: (a) r.ok YOXLANIR — əvvəl 403/429 belə ✅ yazılırdı (yalnız status çap olunurdu);
// (b) DOĞRU endpoint-lər — koda bax: DDG HTML, Bing HTML, Brave HTML (RSS/Lite DƏYİL),
// Tavily keyless API, HN Algolia, GitHub Search, arXiv, Google News RSS, Wikipedia.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const Q = "Bakı hava";

let okCount = 0, failCount = 0;

async function test(name, url, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method: opts.method || "GET",
      headers: { "User-Agent": UA, ...(opts.headers || {}) },
      body: opts.body,
      signal: AbortSignal.timeout(6000)
    });
    const txt = await r.text();
    // v10: ok DƏYİLDİRsə ❌ (hətta body varsa)
    if (r.ok) {
      okCount++;
      console.log(`✅ ${name}: ${r.status} - ${Date.now() - t0}ms - ${txt.length} chars`);
    } else {
      failCount++;
      console.log(`❌ ${name}: HTTP ${r.status} - ${Date.now() - t0}ms`);
      console.log(txt.slice(0, 200).replace(/\n/g, " "));
    }
    console.log("---");
  } catch (e) {
    failCount++;
    console.log(`❌ ${name}: ${e.message} - ${Date.now() - t0}ms`);
    console.log("---");
  }
}

console.log("=== Qaqa Search API - Provayder Testi (kodun istifadə etdiyi endpoint-lər) ===\n");

// Kodda işlədilən DOĞRU endpoint-lər:
await test("DuckDuckGo HTML (searchDDG)", `https://html.duckduckgo.com/html/?q=${encodeURIComponent(Q)}`);
await test("Bing HTML (searchBing)", `https://www.bing.com/search?q=${encodeURIComponent(Q)}&setlang=az-AZ`);
await test("Brave HTML (searchBrave)", `https://search.brave.com/search?q=${encodeURIComponent(Q)}`);
await test("Tavily keyless (searchTavilyKeyless)", "https://api.tavily.com/search", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Tavily-Access-Mode": "keyless" },
  body: JSON.stringify({ query: Q, max_results: 5, search_depth: "basic", include_answer: false })
});
await test("HN Algolia (searchHN)", `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent("search engine")}&hitsPerPage=3`);
await test("GitHub Search (searchGitHub)", `https://api.github.com/search/repositories?q=${encodeURIComponent("search engine")}&per_page=3`);
await test("arXiv (searchArxiv)", `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent("retrieval augmented generation")}&start=0&max_results=3`);
await test("Google News RSS (searchGoogleNews)", `https://news.google.com/rss/search?q=${encodeURIComponent(Q)}&hl=az&gl=AZ&ceid=AZ:az`);
await test("Wikipedia AZ (searchWikipedia)", `https://az.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent("Bakı")}&format=json&srlimit=3`);
await test("Wikipedia EN (searchWikipedia)", `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent("Baku")}&format=json&srlimit=3`);
await test("Open-Meteo (fetchWeather)", "https://api.open-meteo.com/v1/forecast?latitude=40.4093&longitude=49.8671&current=temperature_2m&timezone=Asia%2FBaku");
await test("Open-Meteo Geocoding (fetchWeather fallback)", `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent("Lacin")}&count=1&language=az&format=json`);
await test("CBAR valyuta (fetchCBAR)", "https://cbar.az/currencies/" + new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Baku" }).split("-").reverse().join("."), );
await test("DDG Instant Answer (searchDDGInstant)", `https://api.duckduckgo.com/?q=${encodeURIComponent("LLM")}&format=json&no_html=1`);
// İstifadə ETMƏDİYƏNİ (və ya seçicili) endpointlər:
await test("[info] DDG Lite (kodda Yox)", `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(Q)}`);
await test("[info] SearXNG searx.be (yalnız SEARXNG_URL varsa)", "https://searx.be/search?q=" + encodeURIComponent(Q) + "&format=json");

console.log(`\nNƏTİCƏ: ${okCount} ok, ${failCount} fail`);
console.log("Qeyd: DDG/Bing datacenter IP-dən 403/429 verə bilər - bu, provayder İP bloku, kod səhvı deyil.");
process.exit(failCount > 6 ? 1 : 0);
