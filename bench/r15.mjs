// 15-lik təsadüfi qapı: hər raundda FƏRQLİ 15 sual, keçmiş raundların sualları təkrarlanmır.
// İstifadə: node bench/r15.mjs [--round N]
// Nəticə: bench/r15-round-N.json + "ROUND N: X/15"
import fs from "node:fs";
import path from "node:path";
import { POOL } from "./r15-pool.mjs";

const API = process.env.API_BASE || "http://127.0.0.1:3999/api/search";
const USED_FILE = path.join(process.cwd(), "bench/r15-used.json");
const PACING = Number(process.env.R15_PACING || 1800);

const argRound = (() => {
  const i = process.argv.indexOf("--round");
  return i > 0 ? Number(process.argv[i + 1]) : null;
})();

const used = fs.existsSync(USED_FILE) ? JSON.parse(fs.readFileSync(USED_FILE, "utf8")) : { rounds: [] };
const roundNo = argRound || used.rounds.length + 1;
const prevUsed = new Set(used.rounds.flat());
let pool = POOL.filter((p) => !prevUsed.has(p.id));
if (pool.length < 15) {
  console.log(`POOL TÜKƏNDİ: istifadə olunmamış ${pool.length} sual qalıb (hovuz ${POOL.length}).`);
  process.exit(2);
}
// təsadüfi seçim (sabitin toxumlanması üçün R15_SEED)
let seed = Number(process.env.R15_SEED || Date.now() % 100000);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
pool = pool.slice().sort(() => rnd() - 0.5).slice(0, 15);

const allText = (res) => (res.results || [])
  .map((r) => `${r.title || ""} ${r.snippet || ""} ${r.content || ""} ${r.answer || ""}`)
  .join(" \n ");
const hosts = (res) => (res.results || []).map((r) => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } });

function check(item, res) {
  const text = allText(res).toLowerCase();
  const hs = hosts(res);
  const fails = [];
  const nMin = item.nMin ?? 2;
  // v116: nMin yalnız MƏNBƏ SAYINA aiddir. Əgər API özü ÇIXARILMIŞ CAVAB qaytarıbsa
  // (struktur/extract sətri: "… (mətndən çıxarıldı)") və açar fakt həmin cavabdadır,
  // 1 nəticə 5 zəif mənbədən yaxşıdır → nMin tələbi bu halda buraxılır (waived qeyd olunur).
  // ÇIXARILMIŞ/STRUKTUR CAVAB: mətndən çıxarılmış sətir, Wikidata faktı, rəsmi cədvəl,
  // valyuta/hava kimi struktur mənbələr — bunlar "zəif mənbə siyahısı" deyil, CAVABDIR.
  const STRUCTURED = /\(mətndən çıxarıldı\)|\(Wikidata\)|Wikidata\)|CBAR|rəsmi məzənnə|structured|\bhava\b|open-meteo|wttr\.in/i;
  const extractedAnswer = (res.results || []).some((r) => STRUCTURED.test(`${r.title || ""} ${r.source || ""}`) || r.extracted === true);
  const mustOk = (item.must || []).every((group) => group.some((alt) => text.includes(String(alt).toLowerCase())));
  // TƏK AVTORİTET MƏNBƏ: ensiklopediya/rəsmi dövlət saytı açar faktı ehtiva edirsə,
  // n=1 "zəif mənbə" deyil (məs. "Fransanın paytaxtı" → yalnız az.wikipedia "Fransa").
  const AUTH_HOST = /(^|\.)(wikipedia\.org|wikidata\.org)$|(^|\.)(gov|edu)\.[a-z]{2,}$/i;
  const singleAuthoritative = (res.results || []).length === 1 && AUTH_HOST.test((() => { try { return new URL(res.results[0].url).hostname; } catch { return ""; } })());
  const nMinWaived = mustOk && (res.results || []).length < nMin && (extractedAnswer || singleAuthoritative);
  if ((res.results || []).length < nMin && !nMinWaived) {
    fails.push(`n=${(res.results || []).length} < ${nMin}`);
  }
  for (const group of item.must || []) {
    if (!group.some((alt) => text.includes(String(alt).toLowerCase()))) fails.push(`yoxdur: ${group.join("|")}`);
  }
  if (item.pages && !hs.some((h) => item.pages.some((p) => h.endsWith(p)))) fails.push(`səhifə yoxdur: ${item.pages.join("/")}`);
  return { ok: fails.length === 0, fails, nMinWaived };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
let pass = 0;
for (const [i, item] of pool.entries()) {
  const t0 = Date.now();
  let res = { results: [], meta: {} };
  try {
    const url = `${API}?q=${encodeURIComponent(item.q)}&max_results=5&debug=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
    res = await r.json();
  } catch (e) {
    out.push({ ...item, ok: false, fails: [`sorğu xətası: ${e.message}`], ms: Date.now() - t0 });
    console.log(`✗ [${i + 1}/15] ${item.q} — sorğu xətası`);
    continue;
  }
  const { ok, fails, nMinWaived } = check(item, res);
  // əlavə (gating deyil): cavab səviyyəsi — açar fakt İLK 3 nəticənin mətnindədir?
  const top3 = (res.results || []).slice(0, 3).map((r) => `${r.title || ""} ${r.snippet || ""} ${r.content || ""}`).join(" ").toLowerCase();
  const strictOk = (item.must || []).every((g) => g.some((a) => top3.includes(String(a).toLowerCase())));
  if (ok) pass++;
  const hs = [...new Set(hosts(res))].slice(0, 4).join(", ");
  const ans = (res.results || []).map((x) => String(x.content || "")).find((c) => /mənbə cümlə|çıxarıldı/i.test(c)) || "";
  out.push({ id: item.id, cat: item.cat, q: item.q, ok, strictOk, nMinWaived, fails, ms: Date.now() - t0, n: (res.results || []).length, hosts: hosts(res), answer: ans.slice(0, 200) });
  console.log(`${ok ? "✓" : "✗"} [${i + 1}/15] ${Date.now() - t0}ms n=${(res.results || []).length} | ${item.q}${ok ? "" : "  →  " + fails.join("; ")}`);
  if (!ok) console.log(`     hostlar: ${hs}${ans ? `\n     cavab: ${ans.slice(0, 110)}` : ""}`);
  await sleep(PACING);
}

const file = path.join(process.cwd(), `bench/r15-round-${roundNo}.json`);
fs.writeFileSync(file, JSON.stringify({ round: roundNo, at: new Date().toISOString(), poolSize: POOL.length, pass, total: pool.length, items: out }, null, 1));
used.rounds.push(out.map((o) => o.id));
fs.writeFileSync(USED_FILE, JSON.stringify(used, null, 1));
const strictPass = out.filter((o) => o.strictOk).length;
console.log(`\nROUND ${roundNo}: ${pass}/${pool.length}  (ilk-3 nəticədə açar fakt: ${strictPass}/${pool.length})  (qalan sual hovuzda: ${POOL.length - used.rounds.flat().length})`);
if (pass < pool.length) {
  console.log("UĞURSUZ:", out.filter((o) => !o.ok).map((o) => `${o.id} [${o.fails.join("; ")}]`).join("\n  "));
}
process.exit(pass === pool.length ? 0 : 1);
