// v77: ÖLÇÜ cavabı — "işsizlik səviyyəsi nə qədərdir", "orta ömür uzunluğu", "dövlət borcu".
// Say (neçə) sualından fərqi: burada cavab rəqəm + VAHİDDİR (faiz, yaş, manat, milyard...).
// Qaydalar dil səviyyəlidir (qrammatika + vahid lüğəti), sayta bağlı deyil.
import { normalizeAz } from "./rank.js";

const UNIT_RE = /(\d{1,3}(?:[.\s]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(faiz(?:i|ə|də|dən|ə|inə)?|%|yaş(?:ında|ı|i)?|manat(?:dır|dır|a|ı)?|azn|milyard|milyon|min|nəfər|nefer|kilometr|km|kq|ton)(?![\p{L}])/giu;

// sualda ölçü nişanı varmı
// v78: "necə" (how-to) ölçü sualı DEYİL — çörək saxlama məqaləsindən "2 %" çıxarılırdı
const MEASURE_CUE = /(?<![\p{L}])(n[əe]\s*q[əe]d[əe]r(dir)?|səviyyə(si)?|faiz(i)?|həcm(i)?|uzunluğ(u)?|miqdar(ı)?|borc(u)?|gəlir(i)?|xərc(i)?|əmək\s+haqq(ı)?|pensiya(sı)?|inflyasiya|işsizlik|əhali(si)?)(?![\p{L}])/iu;
// v78: ölkə miqyası — Azərbaycan sualında "Çində işsizlik 5,3%" cavab deyil
const OTHER_COUNTRY = /(?<![\p{L}])(çin|cin|rusiya|türkiyə|turkiye|qazaxıstan|qazaxistan|abd|abş|almaniya|fransa|hindistan|iran|gürcüstan|gurcustan|ukrayna|yaponiya|koreya)(?![\p{L}])/iu;

const HIST_SENT = /(?<![\p{L}])(əvvəl|evvel|keçmişdə|keçmiş\s+illərdə|vaxtilə|o\s+dövrdə|həmin\s+illərdə|idi|olmuşdu|imiş)(?![\p{L}])/iu;
const RECENT_SENT = /(?<![\p{L}])(indi|hazırda|hal[-\s]hazırda|bu\s+gün|bu\s+il|hazırki|cari\s+il)(?![\p{L}])/iu;

const STOP = new Set(["nə", "qədər", "qeder", "nece", "neçə", "necə", "var", "vardır", "azərbaycanda", "azerbaycanda", "respublikada", "ölkədə", "olkedə", "üzrə", "haqqında", "ildə", "2024", "2025", "2026"]);

function queryTerms(q) {
  return normalizeAz(String(q || ""))
    .split(/[^a-z0-9əğıöşüç]+/)
    .filter(w => w.length >= 4 && !STOP.has(w))
    .map(w => (w.length >= 7 ? w.slice(0, -2) : w.length >= 6 ? w.slice(0, -1) : w));
}

export function matchMeasureQuery(q) {
  return MEASURE_CUE.test(String(q || ""));
}

// Mətn parçalarından (title+snippet/cəmlənmiş mətn) ölçü cavabı çıxarır.
export function extractMeasure(text, query) {
  const t = String(text || "");
  if (!t) return null;
  const terms = queryTerms(query);
  if (!terms.length) return null;
  const sentences = t.split(/(?<=[.!?;])\s+|\n+/).map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length >= 12);
  const cands = [];
  for (const s of sentences) {
    const ns = normalizeAz(s);
    const hits = terms.filter(tm => ns.includes(tm)).length;
    if (!hits) continue;
    const sLower = s;
    const yrs = [...s.matchAll(/(?:19|20)\d{2}/g)].map(x => Number(x[0]));
    const maxYear = yrs.length ? Math.max(...yrs) : null;
    const cy = new Date().getFullYear();
    for (const m of sLower.matchAll(UNIT_RE)) {
      const rawNum = String(m[1]);
      const num = Number(rawNum.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
      if (!Number.isFinite(num) || num <= 0) continue;
      const unit = String(m[2] || "").toLowerCase();
      // vahid mənasız qısa söz ola bilməz
      if (unit === "min" && !/[.,]/.test(rawNum) && num > 100) continue;
      let sc = 1 + Math.min(hits, 3) * 0.8;
      if (/faiz|%/.test(unit)) sc += 0.3;
      // rəqəmdən əvvəlki ən yaxın il — hansı ilə aid olduğunu göstərir
      const before = s.slice(0, m.index);
      const byr = [...before.matchAll(/(?:19|20)\d{2}/g)].map(x => Number(x[0]));
      const nearYear = byr.length ? byr[byr.length - 1] : null;
      if (nearYear && nearYear >= cy - 1) sc += 0.7;
      else if (nearYear && nearYear <= cy - 3) sc -= 0.6;
      if (RECENT_SENT.test(before.slice(-45)) || RECENT_SENT.test(s.slice(m.index, m.index + 45))) sc += 0.5;
      if (HIST_SENT.test(before.slice(-45))) sc -= 1.0;
      // v78: coğrafi miqyas
      const qCountry = /(?<![\p{L}])(azərbaycan|azerbaycan|ölkə|olke)/iu.test(String(query || ""));
      if (qCountry) {
        if (/(?<![\p{L}])(azərbaycan|azerbaycan)/iu.test(ns)) sc += 0.8;
        else if (OTHER_COUNTRY.test(ns)) sc -= 1.6;
      }
      // v80: "49 faizdən 5 faizə endirib" — cari dəyər İKİNCİdir
      const rng = s.match(/([\d.,]+)\s*faizd[əe]n\s+([\d.,]+)\s*faiz/i);
      if (rng) {
        const n = (x) => String(x).replace(/[.,]/g, ".");
        if (n(rng[1]) === n(rawNum)) sc -= 1.4;        // köhnə/başlanğıc qiymət
        else if (n(rng[2]) === n(rawNum)) sc += 0.6;   // cari qiymət
      }
      // v77: göstəriş üçün vahid əsas formaya salınır ("5,50 faizə" → "5,50 faiz")
      const canon = unit.startsWith("faiz") ? "faiz" : unit.startsWith("yaş") ? "yaş" : unit.startsWith("manat") ? "manat" : unit;
      let disp = `${rawNum} ${canon}`.replace(/\s+/g, " ").trim();
      if (/^(milyard|milyon|min)$/.test(canon)) {
        const nxt = (s.slice(m.index + m[0].length).trim().split(/[\s,.;:]+/)[0] || "");
        if (/^(manat|azn|dollar|avro)/i.test(nxt)) disp += " " + nxt.replace(/[^\p{L}]/gu, "").slice(0, 6);
      }
      cands.push({
        value: num,
        rawNum,
        unit,
        text: disp,
        sentence: s.slice(0, 240),
        year: nearYear || maxYear,
        score: sc
      });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  const agree = cands.filter(c => c.value === best.value).length;
  return { ...best, score: Math.round(best.score * 100) / 100, agree };
}

// Nəticə massivindən (title + snippet/content) ölçü cavabı çıxarır
export function extractMeasureFromResults(results = [], query = "") {
  const cands = [];
  for (const r of results) {
    const text = [r.title, r.snippet, r.content].filter(Boolean).join(". ");
    const hit = extractMeasure(text, query);
    if (!hit) continue;
    Object.assign(hit, { url: r.url, title: r.title, sources: [r.url] });
    cands.push(hit);
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  const same = cands.filter(c => c.value === best.value);
  best.sources = [...new Set(same.map(c => c.url))];
  best.agree = same.length;
  return best;
}

export function measureToText(hit, label) {
  if (!hit) return "";
  return `${label ? label + ": " : ""}${hit.text}${hit.year ? ` (${hit.year})` : ""}. Mənbə cümlə: "${hit.sentence}"`;
}

// v80: TARİX cavabı — "Konstitusiya nə vaxt qəbul olunub", "BMT-yə nə vaxt üzv olub"
const MONTHS = "yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr";
const DATE_CUE = /(?<![\p{L}])(n[əe]\s*vaxt|hansı\s+il|hansi\s+il|hansı\s+tarixd[əe]|hangi\s+tarih|when)(?![\p{L}])/iu;
export function matchDateQuery(q) { return DATE_CUE.test(String(q || "")); }
export function extractDateAnswer(text, query) {
  const t = String(text || "");
  if (!t) return null;
  const terms = queryTerms(query);
  if (!terms.length) return null;
  const sentences = t.split(/(?<=[.!?;])\s+|\n+/).map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length >= 12);
  const cands = [];
  for (const s of sentences) {
    const ns = normalizeAz(s);
    const hits = terms.filter(tm => ns.includes(tm)).length;
    if (!hits) continue;
    // v81: ən DƏQİQ tarix üstün tutulur: gün+ay+il > ay+il > il
    const patterns = [
      { re: new RegExp(`(\\d{1,2})\\s+(${MONTHS})\\s+(\\d{4})`, "giu"), bonus: 1.2 },
      { re: new RegExp(`(${MONTHS})\\s+(\\d{1,2})[,\\s]+(\\d{4})`, "giu"), bonus: 1.0 },
      { re: new RegExp(`(\\d{1,2})[\\s-]+(${MONTHS})`, "giu"), bonus: 0.2 },
      { re: /(\d{4})\s*-?\s*c[ıiuü]\s+il\w*/giu, bonus: 0 },
      { re: /(\d{4})/g, bonus: -0.4 }
    ];
    let bestIn = null;
    for (const p of patterns) {
      const mm = p.re.exec(s);
      if (!mm) continue;
      const score = 1 + Math.min(hits, 3) * 0.9 + p.bonus;
      if (!bestIn || score > bestIn.score) bestIn = { dateText: mm[0].replace(/\s+/g, " ").trim(), score };
      if (p.bonus >= 1.0) break;   // tam tarix tapıldı
    }
    if (!bestIn) continue;
    // v81: mövzu sözü (ən uzun termin) cümlədədirsə — güclü bonus
    const topic = terms.slice().sort((a, b) => b.length - a.length)[0];
    // v82: "2 mart" + yaxınlıqda il varsa → "2 mart 1992"
    if (!/\d{4}/.test(bestIn.dateText)) {
      const around = s.slice(Math.max(0, s.indexOf(bestIn.dateText) - 40), s.indexOf(bestIn.dateText) + bestIn.dateText.length + 40);
      const yr = around.match(/(?:19|20)\d{2}/);
      if (yr) bestIn.dateText = `${bestIn.dateText} ${yr[0]}`;
    }
    let sc = bestIn.score;
    if (topic && ns.includes(topic)) sc += 1.2;
    // v92: ay adı olan tam tarix ("12 noyabr 1995") yalnız ildən ("1921-ci il") üstündür
    const hasMonth = new RegExp(`(${MONTHS})`, "iu").test(bestIn.dateText);
    cands.push({ dateText: bestIn.dateText, sentence: s.slice(0, 240), score: sc, hasMonth });
  }
  if (!cands.length) return null;
  const strong = cands.filter(c => c.hasMonth);
  const pool = strong.length ? strong : cands;
  pool.sort((a, b) => b.score - a.score);
  return { ...pool[0], score: Math.round(pool[0].score * 100) / 100, agree: pool.filter(c => c.dateText === pool[0].dateText).length };
}
export function extractDateFromResults(results = [], query = "") {
  const list = [];
  for (const r of results) {
    const text = [r.title, r.snippet, r.content].filter(Boolean).join(". ");
    const hit = extractDateAnswer(text, query);
    if (!hit) continue;
    Object.assign(hit, { url: r.url, sources: [r.url] });
    list.push(hit);
  }
  if (!list.length) return null;
  const strongList = list.filter(x => new RegExp(`(${MONTHS})`, "iu").test(x.dateText));
  const useList = strongList.length ? strongList : list;
  useList.sort((a, b) => b.score - a.score);
  const best = useList[0];
  best.agree = useList.filter(x => x.dateText === best.dateText).length;
  best.sources = [...new Set(useList.filter(x => x.dateText === best.dateText).map(x => x.url))];
  return best;
}
