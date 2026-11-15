// Valyuta məzənnəsi - Azərbaycan Mərkəzi Bankı (CBAR) tarixli XML
// Format: https://cbar.az/currencies/DD.MM.YYYY.xml
import { normalizeAz, tokenize } from "./rank.js";
import { XMLParser } from "fast-xml-parser";

const CURRENCY_KEYWORDS = ["mezenne","valyuta","dollar","avro","rubl","exchange","kurs","usd","eur","manatin","manat","dollarin"];

export function isCurrencyQuery(query) {
  const raw = new Set((normalizeAz(query).match(/[a-z0-9]+/g) || []));
  const stemmed = new Set(tokenize(query));
  const all = new Set([...raw, ...stemmed]);
  return CURRENCY_KEYWORDS.some(k => all.has(normalizeAz(k)));
}

function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export async function fetchCBAR() {
  // Bu gün, dünən, 2 gün əvvəl cəhd et (həftə sonu üçün)
  for (let i = 0; i < 4; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const url = `https://cbar.az/currencies/${fmtDate(d)}.xml`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
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

export function currencyToText(c) {
  if (!c || !c.rates) return "";
  const r = c.rates;
  const parts = [];
  if (r.USD) parts.push(`1 USD = ${r.USD} AZN`);
  if (r.EUR) parts.push(`1 EUR = ${r.EUR} AZN`);
  if (r.RUB) parts.push(`1 RUB = ${r.RUB} AZN`);
  if (r.GBP) parts.push(`1 GBP = ${r.GBP} AZN`);
  if (r.TRY) parts.push(`1 TRY = ${r.TRY} AZN`);
  if (r.XAU) parts.push(`1 qızıl (XAU) = ${r.XAU} AZN`);
  return `Azərbaycan Mərkəzi Bankı rəsmi məzənnəsi (${c.date}): ${parts.join(", ")}.`;
}
