// Provayderləri test et: node scripts/test-providers.mjs
const UA = "Mozilla/5.0";

async function test(name, url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000) });
    const txt = await r.text();
    console.log(`✅ ${name}: ${r.status} - ${Date.now()-t0}ms - ${txt.length} chars`);
    console.log(txt.slice(0, 300).replace(/\n/g, " "));
    console.log("---");
  } catch (e) {
    console.log(`❌ ${name}: ${e.message} - ${Date.now()-t0}ms`);
  }
}

console.log("=== Qaqa Search API - Provayder Testi ===\n");
await test("Bing RSS", "https://www.bing.com/search?format=rss&q=" + encodeURIComponent("Bakı hava"));
await test("DuckDuckGo Lite", "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent("Bakı hava"));
await test("Wikipedia AZ", "https://az.wikipedia.org/w/api.php?action=query&list=search&srsearch=" + encodeURIComponent("Bakı") + "&format=json&srlimit=3");
await test("Open-Meteo", "https://api.open-meteo.com/v1/forecast?latitude=40.4093&longitude=49.8671&current=temperature_2m&timezone=Asia%2FBaku");
await test("SearXNG searx.be", "https://searx.be/search?q=" + encodeURIComponent("Bakı") + "&format=json");
console.log("Test bitdi. Hansı ✅ dirsə, o işləyir deməkdir.");
