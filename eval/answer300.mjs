// EXPERIMENT: 300 simvolluq "cavab" seçimi vs mövcud content seçimi.
// Heç bir API kontraktı dəyişmir — yalnız müqayisə üçün.
const API = "https://searchapi-eta.vercel.app/api/search";
const QS = process.argv.slice(2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const low = (s) => String(s || "").toLowerCase();
const fold = (s) => low(s).replace(/[əƏ]/g,"e").replace(/[ıİ]/g,"i").replace(/[öÖ]/g,"o").replace(/[üÜ]/g,"u").replace(/[şŞ]/g,"s").replace(/[çÇ]/g,"c").replace(/[ğĞ]/g,"g");

function toks(q) {
  return [...new Set(fold(q).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(t => t.length >= 4))];
}
// cümlələrə böl, hər cümləyə bal: sorğu sözü örtüyü + rəqəm + uzunluq cəzası
function sentences(text) {
  return String(text || "").split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 25);
}
function scoreSent(s, T, wantsNum) {
  const f = fold(s);
  let hit = 0; for (const t of T) if (f.includes(t.slice(0, Math.max(4, t.length - 2)))) hit++;
  let sc = hit * 2;
  if (/\d/.test(s)) sc += wantsNum ? 3 : 1;
  if (s.length > 220) sc -= 1.5;
  if (s.length < 60) sc -= 0.5;
  if (/(həmçinin bax|istinadlar|copyright|©|bütün hüquqlar)/i.test(s)) sc -= 6;
  return sc;
}
export function answer300(query, items, anchor = "") {
  const T = [...new Set([...toks(query), ...toks(anchor)])];
  // "göstərici" sözü: sahə / əmək haqqı / istehsal / əhali — cümlədə olmalıdır
  const IND = fold(query).match(/(sahə|sahe|sahəsi|əmək haqqı|emek haqqi|haqqi|əhali|ehalisi|istehsal|miqdar|qiymət|uzunluq|sayı|tarix|ildə|vaxt)/u);
  const wantsNum = /(?<![\p{L}])(neçə|sayı|nə\s+qədər|sahəsi|əhalisi|haqqı|qiymət|ne\s+qeder)(?![\p{L}])/iu.test(query);
  const pool = [];
  for (const it of items) for (const s of sentences(it.content)) {
    let sc = scoreSent(s, T, wantsNum);
    if (wantsNum && IND && !fold(s).includes(IND[1].slice(0, 6))) sc -= 3.5; // göstərici yoxdur → rəqəm etibar etibarsız
    pool.push({ s, url: it.url, title: it.title, sc });
  }
  pool.sort((a, b) => b.sc - a.sc);
  const picked = [];
  let len = 0;
  for (const p of pool) {
    if (p.sc < 2) break;
    const add = (picked.length ? " " : "") + p.s;
    if (len + add.length > 300) continue;
    picked.push(p.s); len += add.length;
    if (picked.length >= 3) break;
  }
  return picked;
}

const out = [];
for (const q of QS) {
  const r = await fetch(`${API}?q=${encodeURIComponent(q)}&max_results=3&no_cache=1`);
  const j = await r.json();
  if (j.error) { console.log(`=== ${q}\nERR ${j.error}`); continue; }
  const a = answer300(q, j.results, j.anchor_query || "");
  console.log(`\n=== ${q}  (n=${j.results.length}, ${j.meta?.took_ms}ms)`);
  j.results.forEach((x, i) => console.log(`  [${i + 1}] ${x.title.slice(0, 50)} | cari content: ${(x.content || "").slice(0, 150).replace(/\n/g, " ")}`));
  console.log(`  >>> 300-lük cavab (${a.join(" ").length} simvol): ${a.length ? a.join(" ") : "— (heç bir cümlə keçmədi)"}`);
  out.push({ q, answer: a, urls: j.results.map(x => x.url) });
  await sleep(2300);
}
console.log("\n" + JSON.stringify(out, null, 1).slice(0, 400));
