// v77: ÖLÇÜ cavabı — "işsizlik səviyyəsi nə qədərdir", "orta ömür uzunluğu", "dövlət borcu".
// Say (neçə) sualından fərqi: burada cavab rəqəm + VAHİDDİR (faiz, yaş, manat, milyard...).
// Qaydalar dil səviyyəlidir (qrammatika + vahid lüğəti), sayta bağlı deyil.
import { normalizeAz } from "./rank.js";

const UNIT_RE = /(\d{1,3}(?:[.\s]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(faiz(?:i|ə|də|dən|ə|inə)?|%|yaş(?:ında|ı|i)?|manat(?:dır|dır|a|ı)?|azn|milyard|milyon|min|nəfər|nefer|kilometr|km|kq|ton)(?![\p{L}])/giu;

// sualda ölçü nişanı varmı
const MEASURE_CUE = /(?<![\p{L}])(n[əe]\s*q[əe]d[əe]r(dir)?|ne[çc][əe](dir)?|səviyyə(si)?|faiz(i)?|həcm(i)?|uzunluğ(u)?|miqdar(ı)?|borc(u)?|gəlir(i)?|xərc(i)?|əmək\s+haqq(ı)?|pensiya(sı)?|inflyasiya|işsizlik|əhali(si)?)(?![\p{L}])/iu;

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
