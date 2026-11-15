// VAXTICI TEST ENDPOINT — provider-ları Vercel IP-lərindən probedir.
// DELETE AFTER TESTING.
import { searchDDG, searchDDGInstant, searchSearXNG, fetchTimeout } from "../../../../lib/search.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const S = new Headers();
S.set("Access-Control-Allow-Origin", "*");

async function probe(name, url, timeout = 5000) {
  const t0 = Date.now();
  try {
    const res = await fetchTimeout(url, {}, timeout);
    const text = await res.text();
    const out = { name, status: res.status, ms: Date.now() - t0, size: text.length, body_sample: text.slice(0, 80).replace(/\s+/g, " ") };
    return { out, text };
  } catch (e) {
    return { out: { name, status: 0, ms: Date.now() - t0, error: String(e.message || e).slice(0, 150) }, text: "" };
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "Azərbaycan paytaxtı";
  const out = { query: q, probed_at: new Date().toISOString() };

  const jobs = [];

  // --- DDG html ---
  jobs.push((async () => {
    const { out: r, text } = await probe("ddg-html", `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
    r.result_a_count = (text.match(/result__a/g) || []).length;
    r.links = (text.match(/class="result__a"[^>]*href="([^"]+)"/g) || []).slice(0, 3).map(s => s.replace(/.*href="/, "").slice(0, 100));
    try { const res = await searchDDG(q, 5); r.provider = { ok: true, count: res.length, first: res[0] && res[0].url }; }
    catch (e) { r.provider = { ok: false, error: String(e.message || e).slice(0, 150) }; }
    return { key: "ddg_html", value: r };
  })());

  // --- DDG lite ---
  jobs.push((async () => {
    const { out: r, text } = await probe("ddg-lite", `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`);
    r.result_link_count = (text.match(/class="result-link"/g) || []).length;
    r.result_snippet_count = (text.match(/class="result-snippet"/g) || []).length;
    r.udog_links = (text.match(/uddg=[^"&]+/g) || []).slice(0, 3).map(s => decodeURIComponent(s.slice(5)).slice(0, 100));
    r.sample = text.slice(0, 150).replace(/\s+/g, " ");
    return { key: "ddg_lite", value: r };
  })());

  // --- DDG instant ---
  jobs.push((async () => {
    try { const res = await searchDDGInstant(q, 3); return { key: "ddg_instant", value: { ok: true, count: res.length, first: res[0] && res[0].url } }; }
    catch (e) { return { key: "ddg_instant", value: { ok: false, error: String(e.message || e).slice(0, 150) } }; }
  })());

  // --- SearXNG json (20 instance paralel) ---
  const instances = [
    "https://searx.be", "https://searx.tiekoetter.com", "https://search.bus-hit.me",
    "https://paulgo.io", "https://searx.dresden.network", "https://search.inetol.net",
    "https://priv.au", "https://baresearch.org", "https://searxng.site", "https://search.ononoki.org",
    "https://searx.foss.family", "https://search.hbubli.cc", "https://northboot.xyz", "https://searx.work",
    "https://opnxng.com", "https://search.rhscz.eu", "https://search.neet.works", "https://searx.prvcy.eu",
    "https://search.im-in.space", "https://searx.exo.org"
  ];
  jobs.push((async () => {
    const results = await Promise.all(instances.map(inst => probe(inst, `${inst}/search?q=${encodeURIComponent(q)}&format=json`, 4500)));
    const jsonResults = results.map(({ out: r }) => {
      if (r.status === 200) {
        r.looks_json = r.body_sample ? r.body_sample.trim().startsWith("{") : true;
      }
      return r;
    });
    // json body check: body_sample missing — refetch ok ones is wasteful; instead count "url": occurrences not possible from sample. Keep status only.
    return { key: "searxng_json", value: jsonResults };
  })());

  // --- SearXNG provider (code path) ---
  jobs.push((async () => {
    try { const res = await searchSearXNG(q, 5); return { key: "searxng_provider", value: { ok: true, count: res.length, first: res[0] && res[0].url } }; }
    catch (e) { return { key: "searxng_provider", value: { ok: false, error: String(e.message || e).slice(0, 150) } }; }
  })());

  const settled = await Promise.all(jobs);
  for (const { key, value } of settled) out[key] = value;
  return Response.json(out, { headers: S });
}
