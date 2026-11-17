// Valyuta məzənnəsi - Azərbaycan Mərkəzi Bankı (CBAR) tarixli XML
// Format: https://cbar.az/currencies/DD.MM.YYYY.xml
// v10 🔴3: intent GATING - "kurs"/"exchange" yalnız valyuta-frazalarında (dil kursu
// = language course əvvəl valyuta intentinə düşürdü!). Token match yalnız qısa sorğuda exakt.
import { normalizeAz } from "./rank.js";
import { XMLParser } from "fast-xml-parser";

// Exakt valyuta frazaları
const CURRENCY_PHRASES = [
  "valyuta mezenne","valyuta mezennesi","valyuta kursu","valyuta nece qeder","valyuta necedir",
  "dollar mezenne","dollar kursu","dollarin qiymeti","dollar qiymeti","dollar nece qeder","dollar necedir",
  "avro mezenne","avro kursu","avronun qiymeti","avro nece qeder","avro necedir",
  "rubl mezenne","rubl kursu","rublin qiymeti",
  "mezenne necedir","mezenne nece qeder","kurs necedir","kurs nece qeder","bugunku mezenne","bugun mezenne",
  "resmi mezenne","valyuta mezennele","exchange rate"
];
// Qeyri-ikimənalı tokenlər ("kurs" DƏYİL - "dil kursu" səhv triggeri idi)
const CURRENCY_TOKENS = new Set([
  "mezenne","mezennesi","valyuta","valyutalar","valyutalari",
  "dollar","dollarin","dolar","dolarin","dolari","avro","avron","avrosu","rubl","rublin",
  "usd","eur","manat","manatin","manatir","manatdir","manata","manatdan",
  // v43: lirə / funt da valyutadır
  "lire","lira","lirenin","liresi","lireler","funt","funti","funtun","pound","gbp","try","sterlinq"
]);

const NON_CURRENCY_TOPIC_RE = /\b(ne\s+vaxt|yarand\w*|yaranib\w*|tarix\w*|kim|kimdir|simvol\w*|sekil\w*|kesf|invent\w*|origin|history|milyarder\w*)\b/;
const WEAK_CURRENCY_CONTEXT_RE = /\b(cerime\w*|vergi\w*|maas\w*|qazanc\w*|kredit\w*|ipoteka\w*|budce\w*)\b/;

export function matchCurrency(query) {
  const n = normalizeAz(query);
  // v42.2: "kripto valyuta NƏDİR" — bu izahat sualıdır, məzənnə sualı DEYİL
  if (/(?<![a-z])(nedir|ne\s+demekdir|izah|what\s+is|hansi\s+valyuta)(?![a-z])/.test(n)) return { hit: false, exact: false };
  for (const p of CURRENCY_PHRASES) {
    if (n.includes(p)) return { hit: true, exact: true };
  }
  if (NON_CURRENCY_TOPIC_RE.test(n)) return { hit: false, exact: false };
  // v43: vergüllü onluq "1,5" bir söz kimi oxunsun
  const n2 = n.replace(/(\d),(\d)/g, "$1.$2");
  const raw = n2.match(/[a-z0-9]+/g) || [];
  const tokenHit = raw.some(t => CURRENCY_TOKENS.has(t));
  if (!tokenHit) return { hit: false, exact: false };
  // v43: "Çörək neçə manatdır" — yalnız MANAT varsa və "məzənnə/kurs" yoxdursa → bu QİYMƏT sualıdır
  const codeSet = new Set();
  for (const [re, code] of CURRENCY_WORDS) if (re.test(n2)) codeSet.add(code);
  if (codeSet.size === 1 && codeSet.has("AZN") && !/mezenne|kurs|valyuta/.test(n2)) return { hit: false, exact: false };
  // iki fərqli valyuta varsa ("1,5 dollar neçə manatdır") — dəqiq çevirmə sualıdır
  if (codeSet.size >= 2) return { hit: true, exact: true };
  if (WEAK_CURRENCY_CONTEXT_RE.test(n)) return { hit: true, exact: false };
  // Qısa sorğu ("dollar", "dollar məzənnəsi") - exakt; uzun sorğuda "dollar"
  // başqa kontekstdə ola bilər ("dollar bazlı iqtisadiyyat") - weak
  return { hit: true, exact: raw.length <= 4 };
}

// Mürəkkəb API üçün: hit = valyuta mövzusu var
export function isCurrencyQuery(query) {
  return matchCurrency(query).hit;
}

// v10 🟠14: Vercel process TZ=UTC, Baku=UTC+4. Baku 00:00-04:00 arasında UTC tarixi
// DÜNƏN olurdu → CBAR bu günün faylı ilə başlamalı, əks halda 1 gün geridən axtarış.
function bakuNow() {
  // 240 = Baku offset dəqiqə; getTimezoneOffset() lokal TZ düzəlişidir (UTC-də 0)
  return new Date(Date.now() + (240 + new Date().getTimezoneOffset()) * 60000);
}

function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export async function fetchCBAR() {
  // Bu gün, dünən, 2 gün əvvəl cəhd et (həftə sonu üçün) - Baku divar vaxtı ilə
  // v13 P6 (audit fix): UNIFIED 3s büdcə — əvvəl 4×4000ms = 16s pis hal idi
  // (currency exact intent düşərsə + search fallback = cəmi 21-24s, maxDuration-a
  // dəyirdi; 10s-cap planında dead). İndi: ilk cəhdlərə çox vaxt, sonrakılara qalan.
  const deadline = Date.now() + 3000;
  for (let i = 0; i < 4; i++) {
    const left = deadline - Date.now();
    if (left < 300) break;
    const d = bakuNow();
    d.setDate(d.getDate() - i);
    const url = `https://cbar.az/currencies/${fmtDate(d)}.xml`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(Math.min(2500, left)) });
      if (!r.ok) continue;
      const xml = await r.text();
      if (!xml.includes("<ValCurs")) continue;
      const parser = new XMLParser({ ignoreAttributes: false });
      const j = parser.parse(xml);
      const rates = {};
      const date = j?.ValCurs?.["@_Date"] || j?.ValCurs?.Date || null;
      const valTypes = j?.ValCurs?.ValType || [];
      const types = Array.isArray(valTypes) ? valTypes : [valTypes];
      for (const vt of types) {
        const vals = vt.Valute || [];
        const arr = Array.isArray(vals) ? vals : [vals];
        for (const v of arr) {
          const code = v["@_Code"];
          const value = parseFloat(String(v.Value).replace(",", "."));
          const nominalRaw = String(v.Nominal || "1");
          const nominal = parseFloat(nominalRaw.replace(/[^\d]/g, "") || "1");
          if (code && value) rates[code] = +(value / nominal).toFixed(4);
        }
      }
      if (Object.keys(rates).length > 5) {
        return { date, rates, source: "cbar.az", fetched_at: new Date().toISOString() };
      }
    } catch { continue; }
  }
  throw new Error("cbar all dates failed");
}

// v19: "1 manat neçə dollar", "100 dollar neçə manat" → hazır hesab (kiçik LLM 45 sətirdən seçməsin)
const CURRENCY_WORDS = [
  [/manat|azn/i, "AZN"], [/dollar|dolar|\busd\b/i, "USD"], [/avro|\beuro\b|\beur\b/i, "EUR"],
  [/rubl|\brub\b/i, "RUB"], [/lir[eə][a-z]*|\blire\b|\btry\b/i, "TRY"], [/funt|\bgbp\b/i, "GBP"]
];

export function parseConversion(query = "") {
  const q = String(query || "");
  // v43: məbləğ = valyuta sözündən ƏVVƏLKİ ən son rəqəm ("2026-cı ildə 100 dollar" → 100, 2026 DEYİL)
  const qn = q.replace(/(\d),(\d)/g, "$1.$2");
  let firstCur = Infinity;
  for (const [re] of CURRENCY_WORDS) { const m = qn.match(re); if (m && m.index < firstCur) firstCur = m.index; }
  let amount = 1;
  for (const m of qn.matchAll(/(\d+(?:\.\d+)?)/g)) {
    if (m.index < firstCur) {
      const v = parseFloat(m[1]);
      // v45: 1900–2099 yalnız İL işarəsi varsa il sayılır ("2000 dollar" = 2000 dollar!)
      const after = qn.slice(m.index + m[1].length, m.index + m[1].length + 12);
      const isYear = /^(\s*)[-–]?\s*(c[ıi]|c[iu]|ci|cü|inci|ıncı|il|ild[eə]|ilin|ill?)/i.test(after) && /^(19|20)\d\d$/.test(m[1]);
      if (Number.isFinite(v) && v > 0 && !isYear) amount = v;
    }
  }
  // mətndə hansı valyuta BİRİNCİ çəkilibsə, o "mənbə"dir ("1 manat neçə dollar" → AZN→USD)
  const hits = [];
  for (const [re, code] of CURRENCY_WORDS) {
    const m = q.match(re);
    if (m) hits.push({ code, idx: m.index });
  }
  hits.sort((a, b) => a.idx - b.idx);
  const uniq = [];
  for (const h of hits) if (!uniq.includes(h.code)) uniq.push(h.code);
  if (uniq.length < 2) return null;
  return { amount: Number.isFinite(amount) && amount > 0 ? amount : 1, from: uniq[0], to: uniq[1] };
}

function convert(c, conv) {
  if (!c || !c.rates || !conv) return null;
  const r = c.rates;
  const perAzn = (code) => (code === "AZN" ? 1 : (r[code] || null)); // 1 vahid = X AZN
  const a = perAzn(conv.from);
  const b = perAzn(conv.to);
  if (!a || !b) return null;
  const azn = conv.amount * a;         // → AZN
  const out = azn / b;                 // → hədəf valyuta
  const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(2) : n.toFixed(4)).replace(/\.?0+$/, "");
  return { azn: fmt(azn), out: fmt(out), rate: fmt(a / b) };
}

export function currencyToText(c, query = "") {
  if (!c || !c.rates) return "";
  const conv = parseConversion(query);
  const res = convert(c, conv);
  const r = c.rates;
  const parts = [];
  if (r.USD) parts.push(`1 USD = ${r.USD} AZN`);
  if (r.EUR) parts.push(`1 EUR = ${r.EUR} AZN`);
  if (r.RUB) parts.push(`1 RUB = ${r.RUB} AZN`);
  if (r.GBP) parts.push(`1 GBP = ${r.GBP} AZN`);
  if (r.TRY) parts.push(`1 TRY = ${r.TRY} AZN`);
  if (r.XAU) parts.push(`1 qızıl (XAU) = ${r.XAU} AZN`);
  const ratesLine = `Azərbaycan Mərkəzi Bankı rəsmi məzənnəsi (${c.date}): ${parts.join(", ")}.`;
  if (res && conv) {
    const names = { AZN: "manat", USD: "dollar", EUR: "avro", RUB: "rubl", TRY: "lirə", GBP: "funt" };
    return `${conv.amount} ${names[conv.from] || conv.from} = ${res.out} ${names[conv.to] || conv.to} (rəsmi məzənnə ilə hesablanmış: 1 ${conv.from} = ${res.rate} ${conv.to}). ${ratesLine}`;
  }
  return ratesLine;
}
