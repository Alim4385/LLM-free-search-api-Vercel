// Vahid çevirmə intenti (structured) — axtarış YOX, hesablama.
// "1 litr neçə mililitrdir", "5 km neçə metr", "20 düym neçə sm", "30 °C neçə °F"
// Prinsip: hər vahidin bazaya görə əmsalı var; çevirmə = dəyər × fromFaktor / toFaktor.
import { normalizeAz } from "./rank.js";

// dim → baza vahidi: uzunluq=metr, kütlə=kiloqram, həcm=litr, data=bayt, vaxt=saniyə, sahe=m2
const UNITS = [
  // UZUNLUQ (baza: metr)
  { dim: "uzunluq", id: "mm", az: "millimetr", f: 0.001, a: ["mm", "millimetr", "millimeter"] },
  { dim: "uzunluq", id: "sm", az: "santimetr", f: 0.01, a: ["sm", "cm", "santimetr", "centimeter"] },
  { dim: "uzunluq", id: "m", az: "metr", f: 1, a: ["m", "metr", "meter", "metre"] },
  { dim: "uzunluq", id: "km", az: "kilometr", f: 1000, a: ["km", "kilometr", "kilometer"] },
  { dim: "uzunluq", id: "düym", az: "düym", f: 0.0254, a: ["düym", "duym", "inç", "inc", "inch", "düymlük"] },
  { dim: "uzunluq", id: "fut", az: "fut", f: 0.3048, a: ["fut", "foot", "feet", "ft"] },
  { dim: "uzunluq", id: "mil", az: "mil", f: 1609.344, a: ["mil", "mile", "miles"] },
  // KÜTLƏ (baza: kq)
  { dim: "kutle", id: "mq", az: "milliqram", f: 1e-6, a: ["mq", "mg", "milliqram", "milligram"] },
  { dim: "kutle", id: "q", az: "qram", f: 0.001, a: ["qram", "gram", "gr", "g"] },
  { dim: "kutle", id: "kq", az: "kiloqram", f: 1, a: ["kq", "kg", "kiloqram", "kilogram", "kilo"] },
  { dim: "kutle", id: "ton", az: "ton", f: 1000, a: ["ton", "tonna", "t"] },
  { dim: "kutle", id: "funt", az: "funt", f: 0.45359237, a: ["funt", "pound", "lbs", "lb"] },
  { dim: "kutle", id: "unsiya", az: "unsiya", f: 0.028349523125, a: ["unsiya", "ounce", "oz"] },
  // HƏCM (baza: litr)
  { dim: "hecm", id: "ml", az: "millilitr", f: 0.001, a: ["ml", "millilitr", "mililitr", "milliliter"] },
  { dim: "hecm", id: "l", az: "litr", f: 1, a: ["litr", "liter", "litre", "l"] },
  { dim: "hecm", id: "m3", az: "kubmetr", f: 1000, a: ["kubmetr", "kub metr", "m3", "kubmetr"] },
  { dim: "hecm", id: "qallon", az: "qallon", f: 3.785411784, a: ["qallon", "gallon", "gal"] },
  // DATA (baza: bayt)
  { dim: "data", id: "bayt", az: "bayt", f: 1, a: ["bayt", "byte", "b"] },
  { dim: "data", id: "kb", az: "kilobayt", f: 1024, a: ["kb", "kilobayt", "kilobyte"] },
  { dim: "data", id: "mb", az: "meqabayt", f: 1048576, a: ["mb", "meqabayt", "megabayt", "megabyte"] },
  { dim: "data", id: "gb", az: "giqabayt", f: 1073741824, a: ["gb", "giqabayt", "gigabayt", "gigabyte"] },
  { dim: "data", id: "tb", az: "terabayt", f: 1099511627776, a: ["tb", "terabayt", "terabyte"] },
  // VAXT (baza: saniyə)
  { dim: "vaxt", id: "san", az: "saniyə", f: 1, a: ["saniye", "saniyə", "saniyədir", "sec", "second"] },
  { dim: "vaxt", id: "deq", az: "dəqiqə", f: 60, a: ["deqiqe", "dəqiqə", "minute", "dəq"] },
  { dim: "vaxt", id: "saat", az: "saat", f: 3600, a: ["saat", "hour"] },
  { dim: "vaxt", id: "gun", az: "gün", f: 86400, a: ["gun", "gün", "day"] },
  { dim: "vaxt", id: "hefte", az: "həftə", f: 604800, a: ["hefte", "həftə", "week"] },
  // SAHƏ (baza: m2)
  { dim: "sahe", id: "m2", az: "kvadrat metr", f: 1, a: ["kvadrat metr", "m2", "kvm"] },
  { dim: "sahe", id: "km2", az: "kvadrat kilometr", f: 1e6, a: ["kvadrat kilometr", "km2", "kv km"] },
  { dim: "sahe", id: "hektar", az: "hektar", f: 10000, a: ["hektar", "hectare", "ha"] },
  { dim: "sahe", id: "sot", az: "sot", f: 100, a: ["sot", "sotka"] },
  // v51.5: "15 kvadrat metr neçə kvadrat futdur" ümumiyyətlə tanınmırdı
  { dim: "sahe", id: "sm2", az: "kvadrat santimetr", f: 0.0001, a: ["kvadrat santimetr", "sm2", "kvs"] },
  { dim: "sahe", id: "fut2", az: "kvadrat fut", f: 0.09290304, a: ["kvadrat fut", "kv fut", "kvadrat foot", "kvadrat feet", "fut2", "sqft", "sq ft"] },
  { dim: "sahe", id: "düym2", az: "kvadrat düym", f: 0.00064516, a: ["kvadrat düym", "kvadrat duym", "kv düym", "düym2", "sqin"] },
  { dim: "sahe", id: "yard2", az: "kvadrat yard", f: 0.83612736, a: ["kvadrat yard", "kv yard", "yard2", "sqyd"] },
  { dim: "sahe", id: "akr", az: "akr", f: 4046.8564224, a: ["akr", "acre", "ekr"] }
];

const TEMP = { dim: "temp", ids: ["c", "f", "k"], aliases: {
  "c": ["c", "°c", "selsi", "celsius", "santigrad", "sentigrad"],
  "f": ["f", "°f", "farenheit", "fahrenheit", "farenheyt", "farengate", "farengeyt", "farenhayt", "farenheyd"],
  "k": ["k", "kelvin"]
} };

// "kubmetr"da hərf sərhədi problemi olmasın deyə sözləri boşluqla əhatə edirik
let LAST_DEC = "";
function prepped(q) {
  // AZ onluq vergülü: "3,5 litr" — nöqtəyə çevir və saxla (normalizeAz nöqtəni silir)
  LAST_DEC = String(q).replace(/(\d),(\d)/g, "$1.$2");
  return " " + normalizeAz(LAST_DEC).replace(/[^a-z0-9°]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}

function findNumber(q) {
  const m = q.match(/(?<![\p{L}\d])(\d+(?:[.,]\d+)?)(?![\p{L}])/u);
  if (!m) return null;
  return parseFloat(m[1].replace(",", "."));
}

function findAllUnits(q) {
  const found = [];
  for (const u of UNITS) {
    for (const al of [u.id, ...u.a]) {
      const a = normalizeAz(al);
      // uzun adlara AZ şəkilçisi bitişə bilər (mililitr+dir), qısa simvollara YOX ("m" ⊄ "manat")
      const tail = a.length >= 3 ? "[a-z]{0,3}" : "";
      const re = new RegExp(`(?<![a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${tail}(?![a-z0-9])`, "g");
      let m;
      while ((m = re.exec(q)) !== null) found.push({ unit: u, pos: m.index, len: a.length });
    }
  }
  // eyni mövqedə təkrar (id və alias üst-üstə düşür) → təmizlə, sonra ən uzun uyğunluğu saxla
  found.sort((x, y) => x.pos - y.pos || y.len - x.len);
  const out = [];
  for (const f of found) {
    if (out.length && f.pos < out[out.length - 1].pos + out[out.length - 1].len) continue;
    out.push(f);
  }
  return out;
}

function tempValue(x, from, to) {
  let c;
  if (from === "c") c = x; else if (from === "f") c = (x - 32) * 5 / 9; else c = x - 273.15;
  if (to === "c") return c;
  if (to === "f") return c * 9 / 5 + 32;
  return c + 273.15;
}

function nice(n) {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 0.001 || abs >= 1e9)) return n.toExponential(4);
  const r = Math.round(n * 1e6) / 1e6;
  return String(r).replace(".", ",");
}

export function matchUnits(query = "") {
  const q = prepped(query);
  // temperatura ayrıca
  // v54.2: "20 dərəcə selsi" — "dərəcə" sözü araya girəndə temperature tanınmırdı
  const DEG = "(?:°|derece|degrees?|gradus)?\\s*";
  const tm = q.match(new RegExp(`(?<![\\p{L}])(-?\\d+(?:[.,]\\d+)?)\\s*${DEG}(c|f|k)\\b`, "u"))
    || q.match(new RegExp(`(-?\\d+(?:[.,]\\d+)?)\\s*${DEG}(celsius|fahrenheit|kelvin|selsi|farenheit|farenheyt|farengeyt|farenhayt|sentigrad|santigrad)`, "u"));
  if (tm) {
    const val = parseFloat(tm[1].replace(",", "."));
    const f = tm[2].startsWith("c") && tm[2].length <= 1 ? "c" : tm[2].startsWith("f") || /fahrenheit|farenheit/.test(tm[2]) ? "f" : tm[2] === "k" ? "k" : "c";
    const rest = q.replace(tm[0], " ");
    let to = null;
    // hədəf vahidi şəkilçi ilə də gələ bilər: "farenheytdir"
    for (const k of TEMP.ids) if (k !== f && TEMP.aliases[k].some(al => new RegExp(`(?<![a-z])${al}[a-z]{0,3}(?![a-z])`).test(rest))) { to = k; break; }
    if (to) return { hit: true, exact: true, kind: "temp", value: val, from: f, to };
  }
  const units = findAllUnits(q);
  if (units.length < 2) return { hit: false, exact: false };
  // "neçə X" markerindən SONRAKI vahid = hədəf, ƏVVƏLKİ = mənbə
  // ("neçə saniyə 1 saat" → 1 saat = 3600 saniyə, tərsinə yox)
  const mk = q.match(/(?<![a-z])(nece|ne\s+qeder|how\s+many|how\s+much)(?![a-z])/u);
  let from, to;
  if (mk) {
    const after = units.find(u => u.pos > mk.index);
    const before = [...units].reverse().find(u => u.pos < mk.index);
    const target = after ? after.unit : before ? before.unit : null;
    const other = units.find(u => target && u.unit !== target && u.unit.dim === target.dim);
    if (target && other) { to = target; from = other.unit; }
  }
  if (!from) {
    from = units[0].unit;
    to = units.slice(1).map(x => x.unit).find(u => u.dim === from.dim && u.id !== from.id);
  }
  if (!to || from.id === to.id) return { hit: false, exact: false };
  const val = findNumber(LAST_DEC || q);
  return { hit: true, exact: val !== null, kind: "unit", value: val === null ? 1 : val, from, to };
}

export function unitsToText(m) {
  if (!m || !m.hit) return "";
  const val = m.value ?? 1;
  if (m.kind === "temp") {
    const out = tempValue(val, m.from, m.to);
    // v104: temperatur 2 onluğa yuvarlaqlaşdırılır ("37,777778 °C" → "37,78 °C")
    const niceT = (x) => String(Math.round(x * 100) / 100).replace(".", ",");
    const names = { c: "°C", f: "°F", k: "K" };
    return `${niceT(val)} ${names[m.from]} = ${niceT(out)} ${names[m.to]} (temperatur çevirməsi).`;
  }
  const res = (val * m.from.f) / m.to.f;
  // v51.5: "1 funt = 0,453592 kiloqram (1 funt = 0,453592 kiloqram)" təkrarı olmasın
  const tail = Number(val) === 1 ? "" : ` (1 ${m.from.az} = ${nice(m.from.f / m.to.f)} ${m.to.az})`;
  return `${nice(val)} ${m.from.az} = ${nice(res)} ${m.to.az}${tail}.`;
}

export function isUnitsQuery(query = "") {
  return matchUnits(query).hit;
}

// v116: LOKAL RƏQƏM FORMATI — minlik və onluq ayırıcıları düzgün oxunur.
// Ölçmə: "Everest ... 8,848.86 metr" → cavab "848.86 metr" çıxırdı (minlik vergülü
// itirdi). Qaydalar: "8,848.86" (minlik ',', onluq '.') / "8.848,86" (əksi) / "8,848" /
// "12.000" / "2,3" (onluq vergül).
export function parseNumberToken(tok) {
  const t = String(tok || "").trim().replace(/\u00a0|\u202f/g, " ");
  if (!t) return NaN;
  // 1) minlik vergül + onluq nöqtə:  8,848.86
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ""));
  // 2) minlik nöqtə/boşluq + onluq vergül:  8.848,86  /  8 848,86
  if (/^\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?$/.test(t)) return Number(t.replace(/[.\s]/g, "").replace(",", "."));
  // 3) tək vergül → onluq (AZ/TR adi hal):  2,3 → 2.3
  if (/^\d+,\d+$/.test(t)) return Number(t.replace(",", "."));
  // 4) nöqtə/boşluq minlik, onluq yox:  12.000 → 12000
  if (/^\d{1,3}(?:[.\s]\d{3})+$/.test(t)) return Number(t.replace(/[.\s]/g, ""));
  return Number(t.replace(/[\s]/g, ""));
}
