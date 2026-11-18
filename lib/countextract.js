// v61: SAY cavabının mətndən çıxarılması.
// Səbəb: "Azərbaycanda neçə rayon var" / "Bakı metrosunda neçə stansiya var" kimi
// suallarda sistem düzgün səhifəni gətirir, AMMA rəqəmi "content" içində qoymur —
// LLM rəqəmi tapmaq üçün bütün mətni oxumalı olur. Bu modul rəqəmi tapıb ayrıca
// strukturlu nəticə kimi verir (cavab + həmin cümlə, yəni yoxlanıla bilən).
//
// Qaydalar (sayta bağlı deyil):
//  - yalnız sorğunun BAŞ İSMİ ilə eyni cümlədə olan rəqəm sayılır
//  - il (1900-2099), faiz, valyuta, ölçü vahidi olan rəqəmlər sayılmır
//  - rəqəm ismə nə qədər yaxındırsa, o qədər güclü siqnal
import { normalizeAz } from "./rank.js";

const WORD_NUM = {
  "bir": 1, "iki": 2, "uc": 3, "dord": 4, "bes": 5, "alti": 6, "yeddi": 7, "sekkiz": 8, "doqquz": 9,
  "on": 10, "iyirmi": 20, "otuz": 30, "qirx": 40, "elli": 50, "altmis": 60, "yetmis": 70,
  "seksen": 80, "doxsan": 90, "yuz": 100
};

const BAD_AFTER = /^\s*(%|faiz|manat|azn|dollar|usd|avro|eur|rubl|km|metr|m\b|sm|mm|kq|kg|ton|saat|dəq|deq|dakika|il|ildə|ilə|ci|cu|inci|uncu|-ci|-cu|dərəcə|derece)/i;

function cleanSentence(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Mətndən "neçə <isim>" cavabını çıxarır
export function extractCount(text, noun, opts = {}) {
  const t = String(text || "");
  if (!t || !noun) return null;
  const nounNorm = normalizeAz(String(noun)).replace(/[^a-z0-9]/g, "");
  if (nounNorm.length < 3) return null;
  const nounStem = nounNorm.length >= 6 ? nounNorm.slice(0, -1) : nounNorm;

  // cümlələrə böl (nöqtə, iki nöqtə, yeni sətir)
  const sentences = t.split(/(?<=[.!?;:])\s+|\n+/).map(cleanSentence).filter(s => s.length >= 15);
  const cands = [];

  for (const s of sentences) {
    const ns = normalizeAz(s).replace(/[^a-z0-9əğıöşüç\s.,%-]/g, " ");
    if (!ns.includes(nounStem)) continue;
    // rəqəmli namizədlər
    // rəqəmli namizədlər — rəqəmdən sonra 80 simvol pəncərəsində ismi axtarırıq
    const re = /\d{1,6}/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const num = Number(m[0]);
      if (!Number.isFinite(num) || num <= 0 || num > 100000) continue;
      if (num >= 1900 && num <= 2100) continue;                 // il
      const iEnd = m.index + m[0].length;
      const after = s.slice(iEnd, iEnd + 80);
      if (BAD_AFTER.test(after)) continue;                       // faiz/valyuta/vahid
      // rəqəmdən sonra isimə qədər neçə söz var?
      const words = normalizeAz(after).split(/[^a-z0-9əğıöşüç]+/).filter(Boolean);
      let dist = null;
      for (let i = 0; i < Math.min(words.length, 8); i++) {
        if (words[i].startsWith(nounStem)) { dist = i; break; }
      }
      let score;
      if (dist === 0) score = 3;
      else if (dist !== null) score = 2.9 - dist * 0.22;
      else if (ns.includes(nounStem)) score = 0.8;               // eyni cümlədə, amma uzaqda
      else score = 0;
      if (score <= 0) continue;
      cands.push({ value: num, score, sentence: s.slice(0, 220) });
    }
    // söz ilə yazılmış rəqəmlər yalnız o halda, cümlədə HEÇ BİR rəqəm yoxdursa
    // ("27 işləyən və dörd tikilən stansiya" → 27, 4 deyil)
    if (/\d/.test(s)) continue;
    for (const [w, v] of Object.entries(WORD_NUM)) {
      const re2 = new RegExp(`(?<![a-z])${w}(?:\\s+(${Object.keys(WORD_NUM).join("|")}))?(?=\\s)`, "g");
      let mm;
      while ((mm = re2.exec(ns)) !== null) {
        const joined = mm[1] ? v + (WORD_NUM[mm[1]] || 0) : v;
        const tail = ns.slice(mm.index, mm.index + 40);
        if (!tail.includes(nounStem)) continue;
        if (joined < 2) continue;
        cands.push({ value: joined, score: 1.2, sentence: s.slice(0, 220), fromWord: true });
        break;
      }
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score || a.value - b.value);
  const best = cands[0];
  const agree = cands.filter(c => c.value === best.value).length;
  return {
    value: best.value,
    sentence: best.sentence,
    score: Math.round(best.score * 100) / 100,
    agree,
    fromWord: !!best.fromWord
  };
}

// Bir neçə nəticə üzərində səsvermə: eyni rəqəm 2+ mənbədə təkrarlanırsa güvən artır
export function extractCountFromResults(results, noun) {
  const found = [];
  for (const r of results || []) {
    const text = `${r.content || ""} ${r.snippet || ""}`;
    const got = extractCount(text, noun);
    if (got) found.push({ ...got, url: r.url, title: r.title });
  }
  if (!found.length) return null;
  const votes = new Map();
  for (const f of found) votes.set(f.value, (votes.get(f.value) || 0) + 1);
  found.sort((a, b) => {
    const va = (votes.get(a.value) || 0) * 2 + a.score;
    const vb = (votes.get(b.value) || 0) * 2 + b.score;
    return vb - va;
  });
  const top = found[0];
  return { ...top, sources: found.filter(f => f.value === top.value).map(f => ({ url: f.url, title: f.title })).slice(0, 3) };
}

// Sorğudan baş ismi çıxar: "Azərbaycanda neçə rayon var" → "rayon"
const NUM_MARKERS = /(?<![\p{L}])(ne[çc][əe]|nece|say[ıi]|сколько|how\s+many|number\s+of)(?![\p{L}])/iu;
const NOUN_STOP = new Set(["var", "vardir", "varmi", "movcud", "mövcud", "movcuddur", "olan", "idi",
  "edir", "olur", "cemi", "cemi", "umumi", "ümumi", "hansi", "hansidir", "qeder", "qədər", "dene", "dənə"]);
export function countNounFromQuery(query = "") {
  const q = String(query || "").replace(/[?!.]+$/g, "");
  const m = q.match(NUM_MARKERS);
  if (!m) return null;
  const after = q.slice(m.index + m[0].length);
  const words = normalizeAz(after).split(/[^a-z0-9əğıöşüç]+/).filter(w => w.length >= 3 && !NOUN_STOP.has(w));
  if (!words.length) return null;
  // "neçə rayon var" → rayon; "neçə stansiya var" → stansiya
  return words[0];
}
