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

// v63: "ən yaxşı 5 park", "top 10 restoran" — SİYAHI başlığıdır, obyektin SAYI deyil.
// Nümunə: "Bakıda Piknik Üçün Ən Yaxşı 5 Park" → 5 cavab deyil (Bakıda ~164 park var).
const LISTICLE_WORD = /^(efsanevi|əfsanəvi|meshur|məşhur|gozel|gözəl|secilmis|seçilmiş|unikal|top)$/i;
const LISTICLE_BEFORE = /(ən\s+yaxşı|en\s+yaxsi|top\s*\d*|seçilmiş|secilmis|əfsanəvi|efsanevi|məşhur|meshur|gözəl|gozel|unikal|ən\s+məşhur)\s*$/i;
const BAD_AFTER = /^\.\d|^\s*(?:sayl[ıi]|sayli|n[öo]mr[əe]li|nomreli|№)|^\s*(?:-\s*(?:d[əe]|d[ae]|i|ı|u|ü|nin|nın|ci|cü|cu|inci|uncu|d[ıi]r|dir)(?![\p{L}]))|^\s*(kilometr|kilometre|düym|duym|fut|mil|hektar|yarad|yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr|bazar\w*|%|faiz|manat|azn|dollar|usd|avro|eur|rubl|km|metr|m\b|sm|mm|kq|kg|ton|saat|dəq|deq|dakika|il|ildə|ilə|ci|cu|inci|uncu|-ci|-cu|dərəcə|derece)(?![\p{L}])/i;

// v62: isimdən SONRA gələn bu bağlayıcılar onu GÖSTƏRİCİ EDİR, sayılan obyekt ETMİR.
// Nümunə: "... 64 rayon, 11 respublika tabeli şəhər, 6 rayon tabeli şəhər ..."
//   "6 rayon" — rayonların sayı deyil, "rayon tabeli şəhər"in sayıdır (6).
// Yalnız dil səviyyəli bağlayıcı siyahısıdır, sayta bağlı deyil.
// v65: rəqəmlə isim arasında İNKAR/qarşıt işarəsi varsa, say həmin obyektə aid deyil:
// "14 qeyri-dövlət universiteti" → dövlət universitetlərinin sayı 14 deyil.
const NEG_MARK = /^(qeyri|qeyr|non|olmayan|deyil)$/i;
const COMPOUND_LINK = /^\s*(tabeli|tipli|səviyyəli|seviyyeli|mərkəzli|merkezli|aid|bağlı|bagli|əsaslı|esasli)\b/i;

// v62.2: gələcək/planlaşdırılan rəqəm "neçə VAR?" sualına cavab deyil.
// Nümunə: "Bakıda 10 yeni metro stansiyası inşa ediləcək" — hazırda 27 stansiya var,
// amma xəbər mətni 10-u birinci plana çıxarırdı.
// v67: TARİXİ kontekst — "1958-ci ilə qədər 4 qoruq fəaliyyət göstərmişdir" bugünkü say deyil
const PAST_RE = /(il[əe]\s+q[əe]d[əe]r|ile\s+qeder|ədək|edek|o\s+dövr|o\s+dovr|ke[çc][əe]n\s+[əe]sr|ke[çc]mi[şs]\s+[əe]sr|[əe]vv[əe]ll[əe]r|evveller)/i;

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
  // v77: mürəkkəb isim ("milli park", "poçt şöbəsi") — söz hissələri ayrıca uyğunlaşdırılır
  const nounParts = normalizeAz(String(noun)).split(/[^a-z0-9əğıöşüç]+/).filter(pp => pp.length >= 4);
  const matchWord = (w) => {
    if (!w) return false;
    if (w.startsWith(nounStem)) return true;
    // "metrostansiyasi" içində "stansiya/stansiyasi" sözü → həmin isim sayılır
    if (w.length >= 6 && nounNorm.includes(w)) return true;
    // v66: şəkilçi fərqi — mətn "stansiyanın", sorğu "metrostansiyası" → ilk 7 hərf kifayətdir
    if (w.length >= 8 && nounNorm.includes(w.slice(0, 7))) return true;
    if (tail6 && w.length >= 6 && w.slice(-6) === tail6) return true;
    if (nounParts.length > 1 && nounParts.some(pp => w.startsWith(pp))) return true;
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
    // v74: minlik ayırıcı — "12.000 kitabxana" əvvəl 12 kimi oxunurdu
    const re = /\d{1,3}(?:[.\s]\d{3})+(?![\d])|\d{1,6}/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const num = Number(String(m[0]).replace(/[.\s]/g, ""));
      if (!Number.isFinite(num) || num <= 0 || num > 100000) continue;
      if (num >= 1900 && num <= 2100) continue;                 // il
      // v69: tarix formatı "2025/7/29" — buradaki 29 say deyil
      if (s[m.index - 1] === "/" || s[m.index - 1] === "." || s[m.index + m[0].length] === "/") continue;
      const iEnd = m.index + m[0].length;
      // v65.1: rəqəmdən sonra yalnız HƏMİN vergüllü seqmentə baxırıq.
      // "16 dövlət, 14 qeyri-dövlət universiteti" → 16-nın seqmentində isim yoxdur,
      // 14 isə inkar işarəsinə görə rədd olunur → yanlış rəqəm verilmir.
      const rest = s.slice(iEnd, iEnd + 80);
      const segStop = rest.search(/[,;()\n]/);
      const after = segStop >= 0 ? rest.slice(0, segStop) : rest;
      // v77: "300-dən çox X" — aşağı sərhəd, vahid kimi rədd edilmir
      const atLeast = /^\s*-?\s*d[əe]n\s+(çox|artıq|yuxarı)/i.test(rest);
      if (!atLeast && BAD_AFTER.test(after)) continue;           // faiz/valyuta/vahid
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
      // rəqəmlə isim ARASINDA siyahı sözü varsa ("12 əfsanəvi park") — say deyil
      if (dist !== null && words.slice(0, dist).some(w => LISTICLE_WORD.test(w))) continue;
      if (dist !== null && words.slice(0, dist).some(w => NEG_MARK.test(w))) continue;
      // siyahı başlığındaki rəqəm say deyil
      if (LISTICLE_BEFORE.test(s.slice(Math.max(0, m.index - 30), m.index))) continue;
      const future = FUTURE_RE.test(s) || PAST_RE.test(s);
      // v73: cümlədəki il — köhnə məlumat (3+ il) cavab ehtimalını azaldır və çıxışda göstərilir
      const yrs = [...s.matchAll(/(?:19|20)\d{2}/g)].map(x => Number(x[0]));
      const year = yrs.length ? Math.max(...yrs) : null;
      const cy = new Date().getFullYear();
      let sc = future ? score * 0.25 : score;
      if (year && year <= cy - 3) sc *= 0.5;
      // v77
      if (HIST_SENT.test(s)) sc -= 1.3;
      if (RECENT_SENT.test(s)) sc += 0.7;
      if (year && year >= cy - 1) sc += 0.5;
      sc += scopeBias(s, opts.query || noun);
      // v77: "300-dən çox poçt şöbəsi" — aşağı sərhəd kimi işarələnir
      // v77: cümlə daxilindəki pəncərə — "50 aptek var idisə, indi ... 2900-a çatıb"
      const winBefore = s.slice(Math.max(0, m.index - 55), m.index);
      const winAfter = s.slice(iEnd, iEnd + 55);
      if (HIST_SENT.test(winBefore) || HIST_SENT.test(after.slice(0, 30))) sc -= 1.2;
      if (RECENT_SENT.test(winAfter)) sc += 0.9;
      cands.push({ value: num, score: sc, sentence: s.slice(0, 220), future, year, atLeast, order: cands.length });
    }
    // v62.4: rəqəm isimdən SONRA da gələ bilər — "İnzibati rayonların sayı: 66"
    for (const sm of ns.matchAll(/(sayi|sayisi|miqdari|eded|say)\s*:?\s*(\d{1,5})/g)) {
      const before = ns.slice(Math.max(0, sm.index - 45), sm.index);
      if (!before.includes(nounStem) && !nsWords.some(matchWord)) continue;
      const num = Number(sm[2]);
      if (!Number.isFinite(num) || num <= 0 || num > 100000) continue;
      if (num >= 1900 && num <= 2100) continue;
      // v65: "şəhər rayonlarının sayı 14" — sayılan "şəhər" deyil. İsim "sayı"-dan
      // DƏRHAL əvvəl gələn söz olmalıdır.
      const bWords = before.split(/[^a-z0-9əğıöşüç]+/).filter(Boolean);
      const lastW = bWords[bWords.length - 1] ? bWords[bWords.length - 1].replace(/[ıi]?n[ıi]n$/u, "").replace(/[ıi]n$/u, "") : "";
      const nearMatch = bWords.length ? (matchWord(bWords[bWords.length - 1]) || (lastW && matchWord(lastW))) : false;
      // v77: "onların sayı 2900-a çatıb" — əvəzliklə işarə olunan isim cümlədə var
      const pronounRef = /(?<![\p{L}])(onlar|onun|bunlar|bunun|həmin|həmən|belə)(?:ın|in|un|ün|nın|nin|nun|nün)?\s*$/iu.test(before) && (ns.includes(nounStem) || nsWords.some(matchWord));
      if (!nearMatch && !pronounRef) continue;
      cands.push({ value: num, score: (FUTURE_RE.test(s) || PAST_RE.test(s)) ? 0.65 : 2.7, sentence: s.slice(0, 220), order: cands.length });
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
        // v74: "iki Xudafərin körpüsü bizə məlumdur" — say çərçivəsi yoxdur, say deyil
        if (!/(?:var|vardir|mövcud|movcud|fəaliyyət|fealiyyet|cəmi|cemi|ümumi|umumi|təşkil edir|teskil edir)/.test(ns)) continue;
        cands.push({ value: joined, score: FUTURE_RE.test(s) ? 0.3 : 1.2, sentence: s.slice(0, 220), fromWord: true, order: cands.length });
        break;
      }
    }
  }
  // v75: bir cümlədə eyni ismin HİSSƏ sayları ("2 dövlət bankı və 19 kommersiya bankı")
  // varsa — cəmi verilir, tək hissə cavab sayılmır.
  {
    const bySentence = new Map();
    for (const c of cands) {
      if (c.score < 2) continue;
      const k = c.sentence;
      if (!bySentence.has(k)) bySentence.set(k, []);
      bySentence.get(k).push(c);
    }
    for (const [, list] of bySentence) {
      const vals = [...new Set(list.map(c => c.value))];
      if (vals.length >= 2) {
        const sent = list[0].sentence;
        // iki fərqli rəqəm "və" ilə bağlanırsa → cəm (hissə deyil, tam)
        if (/(?:^|\s)v[əe](?=\s|$)/iu.test(sent)) {
          const sum = vals.reduce((a, b) => a + b, 0);
          // cəm namizədi hissələrdən üstün olmalıdır
          cands.push({ value: sum, score: Math.max(...list.map(c => c.score)) + 0.4, sentence: sent, summed: true, year: list[0].year, order: Math.min(...list.map(c => c.order ?? 0)) });
        }
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
    year: best.year || null,
    summed: !!best.summed,
    atLeast: !!best.atLeast,
    agree,
    fromWord: !!best.fromWord
  };
}

// Bir neçə nəticə üzərində səsvermə: eyni rəqəm 2+ mənbədə təkrarlanırsa güvən artır
export function extractCountFromResults(results, noun) {
  const found = [];
  for (const r of results || []) {
    const text = `${r.content || ""} ${r.snippet || ""}`;
    // v65: "Client Challenge" / captcha səhifəsindən rəqəm çıxarmaq olmaz
    if (/client\s*challenge|a\s+required\s+part\s+of\s+this\s+site|captcha|enable\s+javascript/i.test(text)) continue;
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

// v74: say sualı üçün AXTARIŞ sorğusu — "neçə X var" formalı sual statistik səhifə
// gətirmir, "<X> sayı" gətirir (canlı yoxlama: xəstəxana/bank/bələdiyyə).
const MARKER_STRIP = /(?<![\p{L}])(ne[çc][əe]dir|ne[çc][əe]|n[əe]\s*q[əe]d[əe]r(dir)?|how\s+many|сколько|say[ıi]s[ıi]|say[ıi])(?![\p{L}])/giu;
export function countSearchQuery(query = "") {
  const q = String(query || "").trim();
  if (!hasCountMarker(q)) return null;
  let t = q.replace(MARKER_STRIP, " ")
    .replace(/(?<![\p{L}])(var|vard[ıi]r|mövcuddur|movcuddur)(?![\p{L}])/giu, " ")
    .replace(/[?!.]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!t) return null;
  if (/say[ıi]/iu.test(q)) return null;            // artıq "sayı" var
  t = `${t} sayı`;
  return t.split(/\s+/).length >= 2 ? t : null;
}

// Sorğudan baş ismi çıxar: "Azərbaycanda neçə rayon var" → "rayon"
const NUM_MARKERS = /(?<![\p{L}])(ne[çc][əe]|nece|say[ıi]|n[əe]\s*q[əe]d[əe]r|сколько|how\s+many|number\s+of)(?![\p{L}])/iu;

// v77: "necə" (=how) say markeri DEYİL. Fərq qrammatikadır: "neçə" + İSİM,
// "necə" + FEL ("necə saxlamaq olar", "necə işləyir"). "ç" hərfli forma həmişə saydır.
const VERBISH = /(maq|mək|mek|maq)$|(ır|ir|ur|ür|ar|ər|acaq|əcək|malı|məli|meli|malı)$|^(etmek|elemek|eləmək|olunur|edilir|olur|edir|göstərir|isleyir|işləyir|saxlamaq|qorumaq)$/iu;
export function hasCountMarker(q = "") {
  const str = String(q || "");
  const m = str.match(NUM_MARKERS);
  if (!m) return false;
  if (!/ne[çc][əe]/i.test(m[0])) return true;          // "sayı", "nə qədər", "how many"…
  if (/neç/i.test(m[0])) return true;                  // "neçə" — həmişə say
  // "necə" / "nece": növbəti söz felə bənzəyirsə say deyil
  const after = str.slice(m.index + m[0].length).trim();
  const w = (after.split(/[^\p{L}]+/u)[0] || "").toLowerCase();
  if (!w) return false;
  if (/(maq|mək|mek)$/u.test(w)) return false;         // "necə saxlamaq"
  if (/(ır|ir|ur|ür|acaq|əcək|malı|məli)$/u.test(w) && !/[aeəiıouöü]r$/u.test("")) return false;
  return true;
}

// v77: köhnə məlumat cəzalandırılır, cari məlumat üstün tutulur.
const HIST_SENT = /(?<![\p{L}])(əvvəl|evvel|keçmişdə|keçmiş\s+illərdə|vaxtilə|o\s+dövrdə|həmin\s+illərdə|var\s+idisə|idi|idiki|olmuşdu|olmusdu|açmışdı|acmisdi|işləmişdi|çatmışdı|təşkil\s+edirdi|göstərmişdi)(?![\p{L}])/iu;
const RECENT_SENT = /(?<![\p{L}])(indi|hazırda|hal[-\s]hazırda|bu\s+gün|bu\s+il|hazırki|cari\s+il|cari\s+ildə)(?![\p{L}])/iu;
// v77: ölkə miqyaslı sualda şəhər miqyaslı cümlə cavab sayılmır
const CITY_TOKENS = /(?<![\p{L}])(bakı|baki|gəncə|gence|sumqayıt|sumqayit|naxçıvan|naxcivan|mingəçevir|mingecevir|şəki|seki|lənkəran|lenkeran|şirvan|sirvan|şamaxı|samaxi|quba|qusar|xankəndi|şuşa|susa|yevlax|ağdam|agdam|salyan|qəbələ|qebele)/iu;
const COUNTRY_SENT = /(?<![\p{L}])(azərbaycan|azerbaycan|ölkə|olke|ölkəmizdə|respublika|ümumi|umumi|cəmi|cemi)/iu;
function scopeBias(sentence, query) {
  const q = String(query || "");
  let b = 0;
  const qCountry = /(?<![\p{L}])(azərbaycan|azerbaycan|ölkə|olke|respublika|ümumi|umumi)/iu.test(q);
  const qCity = CITY_TOKENS.test(q);
  if (qCountry && !qCity) {
    if (CITY_TOKENS.test(sentence)) b -= 1.2;
    if (COUNTRY_SENT.test(sentence)) b += 0.4;
  }
  return b;
}
const NOUN_STOP = new Set(["var", "vardir", "varmi", "movcud", "mövcud", "movcuddur", "olan", "idi",
  "edir", "olur", "cemi", "cemi", "umumi", "ümumi", "hansi", "hansidir", "qeder", "qədər", "dene", "dənə",
  "dir", "dir", "dur", "dur", "dır", "dür"]);
export function countNounFromQuery(query = "") {
  const q = String(query || "").replace(/[?!.]+$/g, "");
  if (!hasCountMarker(q)) return null;
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
  // v63: sayılan obyekt ADƏTƏN SON isimdir — "neçə hava limanı" → "limanı", "neçə dövlət bayramı" → "bayramı"
  const cand = words.slice(0, 4).filter(o => !ATTR_STOP.has(o.norm) && !VERB_STOP.has(o.norm));
  if (cand.length) return nounDisplay(cand[cand.length - 1].raw);
  return nounDisplay(words[0].raw);
}

// v75: sualda fel/feili sifət qalığı ("fəaliyyət göstərir", "yerləşir", "sayılır")
const VERB_STOP = new Set(["gostermek","gosterir","gostərir","teskil","fealiyyet","fealiyyetde","edir","olur","var","vardir","moevcud","mövcud","moevcuddur","mövcuddur","yerlesir","yerləşir","isleyir","işləyir","sayilir","sayılır","alınır","alinir","qeyde","qeydə","daxil","olmaq","etmek","və","ve"]);

// v75: yiyəlik şəkilçisini göstəriş üçün atırıq — "38 şirkəti" → "38 şirkət",
// "21 kanalı" → "21 kanal". Yalnız samitlə bitən gövdə + uzunluq ≥ 4 olduqda.
const POSS_KEEP = new Set(["boru","qapı","qapi","kürsü","kursu","sarı","sari","ayrı","ayri","dəyirmi","deyirmi","dünya","dunya","xəta","xeta"]);
function nounDisplay(raw = "") {
  const w = String(raw || "");
  if (w.length < 5 || POSS_KEEP.has(w.toLowerCase())) return w;
  const m = w.match(/^(.{4,}?)(s[ıiuiü]|[ıiuiü])$/u);
  if (!m) return w;
  const base = m[1];
  // gövdə samitlə bitməlidir
  if (!/[bcçdfgğhjklmnprsştvyxz]$/iu.test(base)) return w;
  // sait harmoniyası: son sait ilə şəkilçi saiti uyğun olmalıdır
  const vowels = base.match(/[aıoueəöiü]/giu) || [];
  const last = (vowels[vowels.length - 1] || "").toLowerCase();
  const suf = m[2].slice(-1).toLowerCase();
  const fronts = "eəöiü";
  if (fronts.includes(last) !== fronts.includes(suf)) return w;
  return base;
}
