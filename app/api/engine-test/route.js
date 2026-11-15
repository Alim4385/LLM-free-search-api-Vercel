// VAXTICI TEST ENDPOINT — provider-ları Vercel IP-lərindən probedir.
// DELETE AFTER TESTING.
import { searchDDG, searchDDGInstant, searchSearXNG, fetchTimeout } from "../../../lib/search.js";

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

  // --- SearXNG json (20 instance paralel) + real results for the ones that return JSON ---
  const instances = [
    "https://searx.be", "https://searx.tiekoetter.com", "https://search.bus-hit.me",
    "https://paulgo.io", "https://searx.dresden.network", "https://search.inetol.net",
    "https://priv.au", "https://baresearch.org", "https://searxng.site", "https://search.ononoki.org",
    "https://searx.foss.family", "https://search.hbubli.cc", "https://northboot.xyz", "https://searx.work",
    "https://opnxng.com", "https://search.rhscz.eu", "https://search.neet.works", "https://searx.prvcy.eu",
    "https://search.im-in.space", "https://searx.exo.org"
  ];
  jobs.push((async () => {
    const results = await Promise.all(instances.map(async (inst) => {
      const { out: r, text } = await probe(inst, `${inst}/search?q=${encodeURIComponent(q)}&format=json`, 4500);
      if (r.status === 200 && text.trim().startsWith("{")) {
        r.looks_json = true;
        try {
          const j = JSON.parse(text);
          const arr = j.results || [];
          r.result_count = arr.length;
          r.top = arr.slice(0, 4).map(x => ({ t: String(x.title || "").slice(0, 80), u: String(x.url || "").slice(0, 90) }));
        } catch (e) { r.looks_json = false; }
      } else if (r.status === 200) {
        r.looks_json = false;
      }
      return r;
    }));
    return { key: "searxng_json", value: results };
  })());

  // --- Detailed quality probe: dresden.network with an AZ and an EN query ---
  if (searchParams.get("detail") === "1") {
    const detailQs = [
      { label: "AZ", q2: "Azərbaycan paytaxtı" },
      { label: "AZ2", q2: "Necati İmamverdiyev kimdir" },
      { label: "EN", q2: "capital of Azerbaijan" }
    ];
    for (const d of detailQs) {
      const { out: r, text } = await probe("dresden-" + d.label, `https://searx.dresden.network/search?q=${encodeURIComponent(d.q2)}&format=json`, 6000);
      r.query = d.q2;
      if (r.status === 200 && text.trim().startsWith("{")) {
        try {
          const j = JSON.parse(text);
          const arr = j.results || [];
          r.result_count = arr.length;
          r.top = arr.slice(0, 5).map(x => ({ t: String(x.title || "").slice(0, 90), u: String(x.url || "").slice(0, 100), c: String(x.content || "").slice(0, 60) }));
        } catch (e) { r.err = String(e).slice(0, 80); }
      }
      out["dresden_" + d.label] = r;
    }
  }

  // --- SearXNG provider (code path) ---
  jobs.push((async () => {
    try { const res = await searchSearXNG(q, 5); return { key: "searxng_provider", value: { ok: true, count: res.length, first: res[0] && res[0].url } }; }
    catch (e) { return { key: "searxng_provider", value: { ok: false, error: String(e.message || e).slice(0, 150) } }; }
  })());

  const settled = await Promise.all(jobs);
  for (const { key, value } of settled) out[key] = value;
  return Response.json(out, { headers: S });
}
