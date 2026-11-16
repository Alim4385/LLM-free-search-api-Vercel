// 340 sualın canlı "sweep" testi — avtomatik keyfiyyət ölçməsi.
// İstifadə: node eval/sweep.mjs <from> <to> <outfile>
import fs from "node:fs";

const API = "https://searchapi-eta.vercel.app/api/search";
const GAP = Number(process.env.MIN_GAP_MS || 2300);
const from = Number(process.argv[2] || 1);
const to = Number(process.argv[3] || 340);
const outFile = process.argv[4] || "eval/sweep.out.json";

const raw = fs.readFileSync("/home/user/uploads/axtaris_sozleri.txt", "utf8");
const items = [];
let cat = "";
for (const line of raw.split("\n")) {
  const c = line.match(/^===\s*(.+?)\s*===$/);
  if (c) { cat = c[1].trim(); continue; }
  const m = line.match(/^(\d+)\.\s+(.+)$/);
  if (m) items.push({ i: Number(m[1]), cat, q: m[2].trim() });
}

const fold = (s) => String(s || "").toLowerCase()
  .replace(/[əƏ]/g, "e").replace(/[ıİ]/g, "i").replace(/[öÖ]/g, "o")
  .replace(/[üÜ]/g, "u").replace(/[şŞ]/g, "s").replace(/[çÇ]/g, "c").replace(/[ğĞ]/g, "g");
const cyr = /[\u0400-\u04FF]/;
const STOP = new Set(["the","and","for","with","best","top","how","what","does","this","that","from","your","you","are","was","were","los","las","del","por","para","que","les","des","une","der","die","das","und","für","und","лучшие","как","для","что","son","dakika","bu","gün","ən","daha","üçün","necə","nə","və","bir","hakkında","kimi"]);
const toks = (q) => [...new Set(fold(q).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(t => t.length >= 4 && !STOP.has(t)))];
const BOIL = /(həmçinin bax|hemcinin bax|istinadlar|references|see also|copyright|©|bütün hüquqlar|arxivləşdirilib|wayback|all rights reserved)/iu;

function langOf(text) {
  const t = String(text || "");
  if (cyr.test(t)) return "ru";
  const f = " " + fold(t) + " ";
  const score = {
    az: (f.match(/\b(və|üçün|necə|deyil|olan|bir|ilə|həm|daha|ən|olan)\b/g) || []).length,
    tr: (f.match(/\b(ve|için|nasıl|değil|olan|bir|ile|en|daha)\b/g) || []).length,
    es: (f.match(/\b(el|la|los|las|de|que|para|con|una|por)\b/g) || []).length,
    fr: (f.match(/\b(les|des|une|pour|avec|dans|est|sur|pas)\b/g) || []).length,
    de: (f.match(/\b(der|die|das|und|für|mit|nicht|ist|auf)\b/g) || []).length,
    en: (f.match(/\b(the|and|of|to|in|is|for|with|that)\b/g) || []).length
  };
  return Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
}
const expLang = (q) => {
  if (cyr.test(q)) return "ru";
  if (/[əğışçöü]/i.test(q) || /(?<![a-z])(və|üçün|necə|nə|olan|ilə)(?![a-z])/i.test(q)) return "az";
  if (/(?<![a-z])(ve|için|nasıl|değil|bir|ile)(?![a-z])/i.test(q)) return "tr";
  if (/(?<![a-z])(el|los|las|para|con|una|hoy)(?![a-z])/i.test(q)) return "es";
  if (/(?<![a-z])(les|des|une|pour|dans|aujourd)(?![a-z])/i.test(q)) return "fr";
  if (/(?<![a-z])(der|die|das|und|für|heute)(?![a-z])/i.test(q)) return "de";
  return "en";
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const rows = [];
for (const it of items.filter(x => x.i >= from && x.i <= to)) {
  const t0 = Date.now();
  let j = null, err = null;
  try {
    const r = await fetch(`${API}?q=${encodeURIComponent(it.q)}&max_results=3&no_cache=1`);
    if (!r.ok) err = `http:${r.status}`;
    else { j = await r.json(); if (j.error) err = `api:${j.error}`; }
  } catch (e) { err = `net:${e.message}`; }
  const res = (j?.results) || [];
  const q = it.q;
  const T = toks(q);
  const hay = fold(res.slice(0, 3).map(x => `${x.title} ${x.snippet} ${(x.content || "").slice(0, 800)}`).join(" "));
  const cov = T.length ? T.filter(t => hay.includes(t.slice(0, Math.max(4, t.length - 2)))).length / T.length : 1;
  const boiler = res.filter(x => BOIL.test(x.content || "") || !(x.content || "").trim()).length;
  const exp = expLang(q);
  const langOk = res.length ? res.some(x => langOf(`${x.title} ${(x.content || "").slice(0, 400)}`) === exp) : false;
  const wikiTop = res.length && /wikipedia\.org/.test(res[0].url || "");
  const isNews = /xəbər|news|noticias|haberler|actualités|nachrichten|новости|headlines|son dəqiqə/i.test(q) || it.cat === "XƏBƏR";
  const newsWiki = isNews && wikiTop;
  const fresh = res.some(x => {
    const d = Date.parse(x.published_at || "");
    return !Number.isNaN(d) && Date.now() - d < 1000 * 86400 * 45;
  });
  const wantsFresh = /(today|tonight|now|2026|this (week|month|year)|bu gün|bu günə|son dəqiqə|hoy|heute|aujourd|сегодня|nə vaxt|right now)/i.test(q);
  const row = {
    i: it.i, cat: it.cat, q, n: res.length, took: Date.now() - t0,
    cov: Math.round(cov * 100), boiler, langOk, exp, newsWiki, fresh, wantsFresh,
    top: res[0] ? res[0].title.slice(0, 70) : null,
    host: res[0] ? (() => { try { return new URL(res[0].url).hostname; } catch { return "?"; } })() : null,
    deg: (j?.meta?.degraded_stages || []).join("|"), err
  };
  const flags = [];
  if (err) flags.push("ERR");
  if (res.length < 2) flags.push("AZ_NETICE");
  if (cov < 0.4) flags.push("MOVZU");
  if (boiler >= 1) flags.push("BOS_CONTENT");
  if (!langOk) flags.push("DIL");
  if (newsWiki) flags.push("XEBERDE_WIKI");
  if (wantsFresh && !fresh) flags.push("KOHNE");
  row.flags = flags;
  rows.push(row);
  console.log(`${String(it.i).padStart(3)} ${flags.length ? "✗" : "✓"} cov=${row.cov}% n=${row.n} ${flags.join(",")} | ${q.slice(0, 40)} → ${(row.top || "").slice(0, 40)}`);
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
  await sleep(GAP);
}
const bad = rows.filter(r => r.flags.length);
console.log(`\nSWEEP ${from}-${to}: ${rows.length} sual, ${rows.length - bad.length} OK, ${bad.length} PROBLEM`);
const agg = {};
for (const r of bad) for (const f of r.flags) agg[f] = (agg[f] || 0) + 1;
console.log("Fluglar:", JSON.stringify(agg));
