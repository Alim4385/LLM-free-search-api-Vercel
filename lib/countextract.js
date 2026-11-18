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

const BAD_AFTER = /^\s*(yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr|bazar\w*|%|faiz|manat|azn|dollar|usd|avro|eur|rubl|km|metr|m\b|sm|mm|kq|kg|ton|saat|dəq|deq|dakika|il|ildə|ilə|ci|cu|inci|uncu|-ci|-cu|dərəcə|derece)/i;

// v62: isimdən SONRA gələn bu bağlayıcılar onu GÖSTƏRİCİ EDİR, sayılan obyekt ETMİR.
// Nümunə: "... 64 rayon, 11 respublika tabeli şəhər, 6 rayon tabeli şəhər ..."
//   "6 rayon" — rayonların sayı deyil, "rayon tabeli şəhər"in sayıdır (6).
// Yalnız dil səviyyəli bağlayıcı siyahısıdır, sayta bağlı deyil.
const COMPOUND_LINK = /^\s*(tabeli|tipli|səviyyəli|seviyyeli|mərkəzli|merkezli|aid|bağlı|bagli|əsaslı|esasli)\b/i;

// v62.2: gələcək/planlaşdırılan rəqəm "neçə VAR?" sualına cavab deyil.
// Nümunə: "Bakıda 10 yeni metro stansiyası inşa ediləcək" — hazırda 27 stansiya var,
// amma xəbər mətni 10-u birinci plana çıxarırdı.
const FUTURE_RE = /(olacaq|ediləcək|edilecek|tikiləcək|tikilecek|inşa\s+edil|insa\s+edil|inşa\s+olun|planlaşdır|planlasdir|nəzərdə\s+tutul|nezerde\s+tutul)/i;

// isim kimi görünməyən atributiv sözlər ("neçə ELMİ İNSTİTUT var" → institut)
const ATTR_STOP = new Set(["elmi", "dovlet", "dövlət", "milli", "respublika", "umumi", "ümumi", "ali", "esas", "əsas",
  "boyuk", "böyük", "kicik", "kiçik", "yeni", "resmi", "rəsmi", "daxili", "xarici", "muasir", "müasir"]);

function cleanSentence(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Mətndən "neçə <isim>" cavabını çıxarır
export function extractCount(text, noun, opts = {}) {
  let t = String(text || "");
  if (!t || !noun) return null;
  const nounNorm = normalizeAz(String(noun)).replace(/[^a-z0-9]/g, "");
  if (nounNorm.length < 3) return null;
  const nounStem = nounNorm.length >= 6 ? nounNorm.slice(0, -1) : nounNorm;
  // v62: mürəkkəb isim — "metrostansiyası" mətndə "stansiya" kimi də görünür.
  // Uzun isimlərdə son 6 hərfə görə də uyğunluq axtarırıq (söz daxilində, sayta bağlı deyil).
  const tail6 = nounNorm.length >= 12 ? nounNorm.slice(-6) : null;
  const matchWord = (w) => {
    if (!w) return false;
    if (w.startsWith(nounStem)) return true;
    // "metrostansiyasi" içində "stansiya/stansiyasi" sözü → həmin isim sayılır
    if (w.length >= 6 && nounNorm.includes(w)) return true;
    if (tail6 && w.length >= 6 && w.slice(-6) === tail6) return true;
    return false;
  };

  // v62.4: "rayonların sayı: 66" — iki nöqtə cümləni bölməsin, əvvəlcə boşluqla əvəz et
  t = t.replace(/\b(say[ıi]|say[ıi]s[ıi]|sayi|sayisi|miqdar[ıi]|miqdari|[əe]d[əe]d|eded)\s*:\s*/gi, "$1 ");
  // cümlələrə böl (nöqtə, iki nöqtə, yeni sətir)
  const sentences = t.split(/(?<=[.!?;:])\s+|\n+/).map(cleanSentence).filter(s => s.length >= 15);
  const cands = [];

  for (const s of sentences) {
    const ns = normalizeAz(s).replace(/[^a-z0-9əğıöşüç\s.,%-]/g, " ");
    // v62: mürəkkəb isimdə söz səviyyəsində uyğunluq kifayətdir
    const nsWords = ns.split(/[^a-z0-9əğıöşüç]+/).filter(Boolean);
    if (!ns.includes(nounStem) && !nsWords.some(matchWord)) continue;
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
        if (matchWord(words[i])) { dist = i; break; }
      }
      let score;
      if (dist === 0) score = 3;
      else if (dist !== null) score = 2.9 - dist * 0.22;
      else if (matchWord(nounNorm) || ns.includes(nounStem) || (tail6 && ns.includes(tail6))) score = 0.8;
      else score = 0;
      if (score <= 0) continue;
      // v62: isimdən sonra bağlayıcı gəlirsə, bu rəqəm sayılan obyektin sayı DEYİL
      if (dist !== null && COMPOUND_LINK.test(after.slice(after.toLowerCase().indexOf(words[dist]) + words[dist].length))) continue;
      const future = FUTURE_RE.test(s);
      cands.push({ value: num, score: future ? score * 0.25 : score, sentence: s.slice(0, 220), future, order: cands.length });
    }
    // v62.4: rəqəm isimdən SONRA da gələ bilər — "İnzibati rayonların sayı: 66"
    for (const sm of ns.matchAll(/(sayi|sayisi|miqdari|eded|say)\s*:?\s*(\d{1,5})/g)) {
      const before = ns.slice(Math.max(0, sm.index - 45), sm.index);
      if (!before.includes(nounStem) && !nsWords.some(matchWord)) continue;
      const num = Number(sm[2]);
      if (!Number.isFinite(num) || num <= 0 || num > 100000) continue;
      if (num >= 1900 && num <= 2100) continue;
      const matchedNoun = before.split(/[^a-z0-9əğıöşüç]+/).filter(Boolean).some(matchWord);
      if (!matchedNoun) continue;
      cands.push({ value: num, score: FUTURE_RE.test(s) ? 0.65 : 2.7, sentence: s.slice(0, 220), order: cands.length });
    }

    // söz ilə yazılmış rəqəmlər yalnız o halda, cümlədə HEÇ BİR rəqəm yoxdursa
    // ("27 işləyən və dörd tikilən stansiya" → 27, 4 deyil)
    if (/\d/.test(s)) continue;
    for (const [w, v] of Object.entries(WORD_NUM)) {
      const re2 = new RegExp(`(?<![a-z])${w}(?:\\s+(${Object.keys(WORD_NUM).join("|")}))?(?=\\s)`, "g");
      let mm;
      while ((mm = re2.exec(ns)) !== null) {
        const joined = mm[1] ? v + (WORD_NUM[mm[1]] || 0) : v;
        const tail = ns.slice(mm.index, mm.index + 24);
        if (!tail.includes(nounStem) && !(tail6 && tail.includes(tail6))) continue;
        if (joined < 2) continue;
        cands.push({ value: joined, score: FUTURE_RE.test(s) ? 0.3 : 1.2, sentence: s.slice(0, 220), fromWord: true, order: cands.length });
        break;
      }
    }
  }
  if (!cands.length) return null;
  const freq = new Map();
  for (const c of cands) freq.set(c.value, (freq.get(c.value) || 0) + 1);
  // v62.4: bərabər skorda MƏTN SIRASI qalib gəlir ("İnzibati rayonların sayı 66" → 66, "şəhər rayonları 14" deyil)
  cands.sort((a, b) => b.score - a.score || (freq.get(b.value) || 0) - (freq.get(a.value) || 0) || (a.order ?? 0) - (b.order ?? 0));
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
const NUM_MARKERS = /(?<![\p{L}])(ne[çc][əe]|nece|say[ıi]|n[əe]\s*q[əe]d[əe]r|сколько|how\s+many|number\s+of)(?![\p{L}])/iu;
const NOUN_STOP = new Set(["var", "vardir", "varmi", "movcud", "mövcud", "movcuddur", "olan", "idi",
  "edir", "olur", "cemi", "cemi", "umumi", "ümumi", "hansi", "hansidir", "qeder", "qədər", "dene", "dənə",
  "dir", "dir", "dur", "dur", "dır", "dür"]);
export function countNounFromQuery(query = "") {
  const q = String(query || "").replace(/[?!.]+$/g, "");
  const m = q.match(NUM_MARKERS);
  if (!m) return null;
  const after = q.slice(m.index + m[0].length);
  // v62: ismi ORİJİNAL yazılışda qaytarırıq ("metrostansiyası", "metrostansiyasi" yox) —
  // çıxışda "27 metrostansiyasi" kimi qəribə görünməsin.
  const words = after.split(/[^\p{L}0-9]+/u)
    .filter(w => w.length >= 3)
    .map(w => ({ raw: w, norm: normalizeAz(w) }))
    .filter(o => !NOUN_STOP.has(o.norm));
  if (!words.length) return null;
  // "neçə rayon var" → rayon; "neçə stansiya var" → stansiya
  // v62: "neçə ELMİ institut var" → "elmi" sifətdir, sayılan isim "institut"-dur
  for (const o of words.slice(0, 3)) {
    if (!ATTR_STOP.has(o.norm)) return o.raw;
  }
  return words[0].raw;
}
