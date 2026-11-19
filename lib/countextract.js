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
import { parseNumberToken } from "./units.js";
import { detectQueryLanguage } from "./clean.js";

const WORD_NUM = {
  "bir": 1, "iki": 2, "uc": 3, "dord": 4, "bes": 5, "alti": 6, "yeddi": 7, "sekkiz": 8, "doqquz": 9,
  "on": 10, "iyirmi": 20, "otuz": 30, "qirx": 40, "elli": 50, "altmis": 60, "yetmis": 70,
  "seksen": 80, "doxsan": 90, "yuz": 100
};

// v63: "ən yaxşı 5 park", "top 10 restoran" — SİYAHI başlığıdır, obyektin SAYI deyil.
// Nümunə: "Bakıda Piknik Üçün Ən Yaxşı 5 Park" → 5 cavab deyil (Bakıda ~164 park var).
const LISTICLE_WORD = /^(efsanevi|əfsanəvi|meshur|məşhur|gozel|gözəl|secilmis|seçilmiş|unikal|top)$/i;
const LISTICLE_BEFORE = /(ən\s+böyük|en\s+boyuk|ən\s+kiçik|en\s+kicik|ən\s+çox|en\s+cox|ən\s+yaxşı|en\s+yaxsi|top\s*\d*|seçilmiş|secilmis|əfsanəvi|efsanevi|məşhur|meshur|gözəl|gozel|unikal|ən\s+məşhur)\s*$/i;
const BAD_AFTER = /^\.\d|^\s*(?:sayl[ıi]|sayli|n[öo]mr[əe]li|nomreli|№)|^\s*(?:-\s*(?:d[əe]|d[ae]|i|ı|u|ü|nin|nın|ci|cü|cu|inci|uncu|d[ıi]r|dir|n[əe]|n[ai]|n[ıiuü])(?![\p{L}]))|^\s*(kilometr|kilometre|düym|duym|fut|mil|hektar|yarad|yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr|bazar\w*|%|faiz|manat|azn|dollar|usd|avro|eur|rubl|km|metr|m\b|sm|mm|kq|kg|ton|saat|dəq|deq|dakika|il|ildə|ilə|ci|cu|inci|uncu|-ci|-cu|dərəcə|derece)(?![\p{L}])/iu;

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

// v113 (#3): hashtag içindəki rəqəm (#Bakı2024) və spam cümlələr say mənbəyi deyil.
const SPAM_SENT_RE = /(?<![\p{L}])(kredit|kreditl[əe]r|kredit\s+kart|casino|kazino|bonus|bonuslar|pulsuz\s+qazan|qeydiyyatdan\s+ke[çc]|sms|whatsapp|telegram\s+kanal|1xbet|mostbet|pin-?up|bet365|jackpot|endirim|kampaniya|super\s+t[əe]klif|s[ıi]fari[şs]\s+et|sifaris\s+et|reklam|sponsor|lotereya|lottery|форекс|казино|займ|кредит|скидк)(?![\p{L}])/iu;

const FUTURE_RE = /(olacaq|olacak|ediləcək|edilecek|tikiləcək|tikilecek|inşa\s+edil|insa\s+edil|inşa\s+olun|inşa\s+başlan|insa\s+baslan|planlaşdır|planlasdir|nəzərdə\s+tutul|nezerde\s+tutul|başlanılacaq|baslanilacaq|açılacaq|acilacaq|veriləcək|verilecek|will\s+be|planned|expected|планир|будет)/i;

// isim kimi görünməyən atributiv sözlər ("neçə ELMİ İNSTİTUT var" → institut)
const ATTR_STOP = new Set(["elmi", "dovlet", "dövlət", "milli", "respublika", "umumi", "ümumi", "ali", "esas", "əsas",
  "boyuk", "böyük", "kicik", "kiçik", "yeni", "resmi", "rəsmi", "daxili", "xarici", "muasir", "müasir"]);

function cleanSentence(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// Mətndən "neçə <isim>" cavabını çıxarır
// v112: namizədlərin TAM siyahısı (rədd səbəbləri ilə) — çarpaz təsdiq üçün lazımdır.
export function collectCandidates(text, noun, opts = {}) {
  let t = String(text || "");
  if (!t || !noun) return null;
  // v112: kiril (rus) isimlər də dəstəklənir — əvvəl yalnız latın hərfləri qalırdı və
  // "сколько станций" sorğusunun ismi tamamilə silinirdi.
  const nounNorm = normalizeAz(String(noun)).replace(/[^a-z0-9\u0400-\u04FF]/g, "");
  if (nounNorm.length < 3) return null;
  const nounStem = nounNorm.length >= 6 ? nounNorm.slice(0, -1) : nounNorm;
  // v62: mürəkkəb isim — "metrostansiyası" mətndə "stansiya" kimi də görünür.
  // Uzun isimlərdə son 6 hərfə görə də uyğunluq axtarırıq (söz daxilində, sayta bağlı deyil).
  const tail6 = nounNorm.length >= 12 ? nounNorm.slice(-6) : null;
  // v77: mürəkkəb isim ("milli park", "poçt şöbəsi") — söz hissələri ayrıca uyğunlaşdırılır
  const nounParts = normalizeAz(String(noun)).split(/[^a-z0-9əğıöşüç]+/).filter(pp => pp.length >= 4);
  // v79: rəsmi dildə "ali təhsil müəssisəsi" — "universitet" sorğusuna cavab verir
  const SYN_RE = /universitet/.test(nounNorm) ? /(ali\s+tehsil|ali\s+mekteb|ali\s+mues)/i : null;
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
  // v82: "2 min 166 məscid" → 2166 (sözlə yazılmış minlik)
  // v84: "1 milyon 738 min" → 1738000
  t = t.replace(/(\d{1,3})\s+milyon\s+(\d{1,3})\s+min\s*(\d{1,3})?/gi, (mm, a, b, c) => String(Number(a) * 1000000 + Number(b) * 1000 + Number(c || 0)));
  t = t.replace(/(\d{1,3})\s+min\s+(\d{1,3})(?![\d.,])/gi, (mm, a, b) => String(Number(a) * 1000 + Number(b)));
  // cümlələrə böl (nöqtə, iki nöqtə, yeni sətir)
  const sentences = t.split(/(?<=[.!?;:])\s+|\n+/).map(cleanSentence).filter(s => s.length >= 15);
  const cands = [];
  const rejected = [];
  const rej = (value, reason) => { if (rejected.length < 60) rejected.push({ value, reason, sentence: "" }); };

  for (const s of sentences) {
    const ns = normalizeAz(s).replace(/[^a-z0-9\u0400-\u04FFəğıöşüç\s.,%-]/g, " ");
    // v62: mürəkkəb isimdə söz səviyyəsində uyğunluq kifayətdir
    const nsWords = ns.split(/[^a-z0-9\u0400-\u04FFəğıöşüç]+/).filter(Boolean);
    if (!ns.includes(nounStem) && !nsWords.some(matchWord) && !(SYN_RE && SYN_RE.test(ns))) continue;
    if (SPAM_SENT_RE.test(s)) { rejected.push({ value: null, reason: "spam cümlə", sentence: s.slice(0, 120) }); continue; }
    // v112: cümlədə isim RƏQƏMƏ BİRBAŞA bağlıdırsa ("27 stansiya"), uzaqda qalan
    // rəqəmlər başqa göstəricidir ("41 vaqon") — onlar say namizədi deyil.
    const directAttach = new RegExp(`\\d+\\s+[\\p{L}]{0,6}${nounStem}`, "iu").test(ns);
    // rəqəmli namizədlər
    // rəqəmli namizədlər — rəqəmdən sonra 80 simvol pəncərəsində ismi axtarırıq
    // v74: minlik ayırıcı — "12.000 kitabxana" əvvəl 12 kimi oxunurdu
    // v116: minlik vergülü də dəstəklənir ("8,848.86") — əvvəl "848.86" kimi oxunurdu
    const re = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:[.\s]\d{3})+(?![\d])|\d+,\d+(?![\d])|\d{1,10}/g;
    // v112: indekslər `s` cümləsinə aiddir — pəncərələr də `s`-dən götürülür və
    // sonra normallaşdırılır (əvvəl `ns`-dən kəsilirdi → sürüşmə, pəncərə boş qalırdı).
    const sWin = (a, b) => normalizeAz(s.slice(Math.max(0, a), Math.min(s.length, b)));
    let m;
    while ((m = re.exec(s)) !== null) {
      const tokStr = String(m[0]);
      // v80: "2,3" → 2.3 (onluq vergül), "12.000" → 12000 (minlik nöqtə)
      const num = parseNumberToken(tokStr);
      if (!Number.isFinite(num) || num <= 0 || num > 1e10) continue;
      if (num >= 1900 && num <= 2100) continue;                 // il
      // v69: tarix formatı "2025/7/29" — buradaki 29 say deyil
      if (s[m.index - 1] === "/" || s[m.index - 1] === "." || s[m.index + m[0].length] === "/") continue;
      // v113 (#3): hashtag daxilindəki rəqəm say deyil (#Bakı27, #metro27) — indeks `s` üzrədir
      if (/#[\p{L}\d_]*$/u.test(s.slice(Math.max(0, m.index - 24), m.index)) || /^[\p{L}\d_]*#/u.test(s.slice(m.index + m[0].length, m.index + m[0].length + 24))) {
        rej(num, "hashtag"); continue;
      }
      const iEnd = m.index + m[0].length;
      // v65.1: rəqəmdən sonra yalnız HƏMİN vergüllü seqmentə baxırıq.
      // "16 dövlət, 14 qeyri-dövlət universiteti" → 16-nın seqmentində isim yoxdur,
      // 14 isə inkar işarəsinə görə rədd olunur → yanlış rəqəm verilmir.
      const rest = s.slice(iEnd, iEnd + 80);
      const segStop = rest.search(/[,;()\n]/);
      const after = segStop >= 0 ? rest.slice(0, segStop) : rest;
      // v80: miqyas — "2,3 milyon nəfər" → 2 300 000
      let scale = 1;
      const scaleM = rest.match(/^\s*(milyon|milyard|min|min\b)/i);
      // v77: "300-dən çox X" — aşağı sərhəd, vahid kimi rədd edilmir
      const atLeast = /^\s*-?\s*d[əe]n\s+(çox|artıq|yuxarı)/i.test(rest);
      // v81: "300-ə çatıb / 300-ə bərabərdir" — dativ hal sayı ləğv etmir
      const reaches = /^\s*-\s*[əea]\s+(çatıb|catib|çatır|catir|bərabərdir|beraberdir|qədər|qeder|yaxın|yaxin)/i.test(rest);
      if (!atLeast && !reaches && BAD_AFTER.test(after)) { rej(num, "vahid/valyuta/faiz"); continue; }
      // v84: artım/azalma feli — "sayı 93,7 min artıb" ümumi say DEYİL
      if (/^\s*(nefer|nəfər|eded|ədəd)?[\s\p{L}]{0,14}?(art[ıi]b|artib|art[ıi]m|azal[ıi]b|azalib|azalma|coxalib|çoxalıb|enib|enmə|enmiş)/iu.test(rest.slice(0, 40))) continue;
      // v80: sıxlıq göstəricisi — "1500 nəfər/km²" əhali sayı deyil
      if (/^\s*(nefer|nəfər)\s*\/\s*(km|kv)/i.test(rest)) continue;
      // rəqəmdən sonra isimə qədər neçə söz var?
      const words = normalizeAz(after).split(/[^a-z0-9\u0400-\u04FFəğıöşüç]+/).filter(Boolean);
      let dist = null;
      for (let i = 0; i < Math.min(words.length, 8); i++) {
        if (matchWord(words[i])) { dist = i; break; }
      }
      // v109: TARİX rəqəmi say deyil — "28 aprel 1989" (stansiyanın açılışı) sayılmamalıdır
      if (/^\s*(yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr|yanvar|fev|apr|avg|sen|okt|noy|dek)\b/iu.test(normalizeAz(after).slice(0, 14))) { rej(num, "tarix"); continue; }
      let qualifier = null;
      let score;
      if (dist === 0) score = 3;
      else if (dist !== null) score = 2.9 - dist * 0.22;
      else if (directAttach) score = 0;   // v112: cümlədə dəqiq bağlantı var → uzaq rəqəm say deyil
      else if (matchWord(nounNorm) || ns.includes(nounStem) || (tail6 && ns.includes(tail6))) score = 0.8;
      else score = 0;
      if (score <= 0) continue;
      // v62: isimdən sonra bağlayıcı gəlirsə, bu rəqəm sayılan obyektin sayı DEYİL
      if (dist !== null && COMPOUND_LINK.test(after.slice(after.toLowerCase().indexOf(words[dist]) + words[dist].length))) continue;
      // rəqəmlə isim ARASINDA siyahı sözü varsa ("12 əfsanəvi park") — say deyil
      if (dist !== null && words.slice(0, dist).some(w => LISTICLE_WORD.test(w))) continue;
      // v111: PER-UNIT quruluşu — "hər stansiya üçün 17 avtobus ayrılıb" cümləsində 17
      // stansiya sayı DEYİL. Rəqəmdən əvvəl "hər/per/each/кажд" gəlirsə, bu göstəricidir.
      {
        const beforeNum = ns.slice(Math.max(0, m.index - 34), m.index);
        if (/(?<![a-z])(h[əe]r|per|each|кажд\p{L}*)(\s+bir)?\s*[^,;]{0,22}$/iu.test(beforeNum)) { rej(num, "per-unit"); continue; }
        // rəqəmdən SONRA "hər ..." ("17 avtobus hər stansiyaya") — eyni məntiq
        if (/^\s*[\p{L}\s]{0,20}?(?<![a-z])(h[əe]r|per|each)\s/iu.test(after)) { rej(num, "per-unit"); continue; }
      }
      // v112: SIRA SAYI — "3-cü stansiya" say deyil
      if (/^\s*-?\s*(c[ıiuü]|ci|cu|cü|inci|ıncı|uncu|üncü)\b/iu.test(rest)) { rej(num, "sıra sayı (ordinal)"); continue; }
      // v112: ALT-OBJEKT — "Bənövşəyi xəttin 3-cü stansiyası", "12 stansiyadan ibarət olan xətt"
      // (bir xəttin/bölmənin sayı ümumi say deyil). Yalnız rəqəmin ±70 simvoluna baxılır.
      {
        // (a) "Bənövşəyi xəttin 3-cü stansiyası" — xətt sözü rəqəmdən ƏVVƏL, vergülsüz seqmentdə
        const segBefore = sWin(m.index - 45, m.index).split(/[,;]/).pop();
        const lineBefore = /(x[əe]tt|line|лини|branch|filial)/iu.test(segBefore);
        // (b) "12 stansiyadan ibarət olan Bənövşəyi xətt" — xətt sözü ismin ARDINCA
        const lineAfter = /stansiya[\p{L}]*\s+ibar[əe]t\s+(olan\s+)?[\p{L}\s]{0,25}(x[əe]tt|line|лини)/iu.test(sWin(m.index, m.index + m[0].length + 80));
        if (lineBefore || lineAfter) { rej(num, "alt-obyekt (xətt/mərhələ)"); continue; }
      }
      // v112: ALT-SİYAHI — "13 stansiyası ("A", "B", "C", ...)" kimi quruluş bir qrupun
      // sayıdır, ümumi say deyil (rəsmi səhifədə bir xəttin stansiyaları belə verilir).
      if (dist !== null && dist <= 1) {
        const tailTxt = s.slice(Math.min(s.length, m.index + m[0].length), Math.min(s.length, m.index + m[0].length + 160));
        const qCount = (tailTxt.slice(0, 120).match(/[“"«]/g) || []).length;
        if (/^\s*\p{L}*\s*\(/u.test(tailTxt) && qCount >= 3) { rej(num, "alt-siyahı (qrup sayı)"); continue; }
      }
      // v112: PLANLAŞDIRILAN / GƏLƏCƏK — sorğu gələcəyi soruşmursa cavab deyil
      // v112: TARİX fraqmenti ("2013-10-21", "Aug 6, 2026", "06.05.2024") say deyil
      {
        const dw = sWin(m.index - 14, m.index + m[0].length + 14);
        if (/(\d{4}\s*[-–.\/]\s*\d{1,2})|(\d{1,2}\s*[-–.\/]\s*\d{1,2}\s*[-–.\/]\s*\d{2,4})|((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b)|(\b(yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr|январ|феврал|март|апрел|май|июн|июл|август|сентябр|октябр|ноябр|декабр)[a-zə-я]*\s+\d{1,2}\b)/iu.test(dw)) { rej(num, "tarix fraqmenti"); continue; }
      }
      // v112: saat tokeni ("06:00-dan 00:00-dək") say deyil
      if (/\d{1,2}:\d{2}/.test(sWin(m.index - 3, m.index + m[0].length + 6))) { rej(num, "saat (vaxt)"); continue; }
      // v112: koda bitişik rəqəm ("B4 stansiyası", "M3 xətti") — obyekt adı, say deyil
      if (/[a-zəıöüğşç]$/i.test(s.slice(Math.max(0, m.index - 1), m.index)) && /^\s*\p{Lu}/u.test(s.slice(m.index + m[0].length, m.index + m[0].length + 3))) { rej(num, "obyekt kodu"); continue; }
      if (FUTURE_RE.test(s) && !/(olacaq|olacak|plan|2030|2027|2028|2029|gələcək|gelecek|future|будет|планир)/iu.test(String(opts.query || ""))) {
        rej(num, "planlaşdırılan/gələcək"); continue;
      }
      // v78: "hər 100 min nəfərə düşən 22 aptek" — adambaşına göstərici, ümumi say deyil
      if (/(?<![a-z])her\s+\d+\s*(min|milyon)?\s*nefere|(?<![a-z])hər\s+\d+\s*(min|milyon)?\s*nəfərə/i.test(ns)) continue;
      // v112: rəqəmdən dərhal sonra BAŞQA isim + vergül gəlirsə, rəqəm HƏMİN ismi sayır
      // ("3 xətt, 27 stansiya" → 3 xətt sayıdır, stansiya deyil)
      if (dist !== 0 && /^\s*[\p{L}]+\s*,/u.test(rest)) { rej(num, "başqa ismin sayı"); continue; }
      // v112: rəqəmlə isim ARASINDA BAŞQA rəqəm varsa, bu rəqəm həmin ismi saymır
      // ("3 xət və 27 stansiyadan ibarətdir" → 3 stansiya sayı deyil)
      if (dist !== null && dist > 1 && words.slice(1, dist).some(w => /\d/.test(w))) { rej(num, "başqa rəqəmin sayı"); continue; }
      // v111: isim cümlədə varsa da, RƏQƏMDƏN UZAQDA ola bilər — yaxınlıq tələb olunur
      // (dist === null halı: "27 stansiya var" + cümlənin başqa yerində "avtobus")
      if (dist === null) {
        const occ = ns.indexOf(nounStem);
        if (occ >= 0 && Math.abs(occ - m.index) > 70) continue;
      }
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
      // v78: yoxlama NORMALLAŞDIRILMIŞ cümlə üzərində ("acımışdı" → "acmisdi")
      // v79: sinonim ifadə ilə sayılan isim
      if (SYN_RE && SYN_RE.test(ns)) sc += 0.5;
      if (HIST_SENT.test(ns) || HIST_ASCII.test(ns)) sc -= 1.3;
      if (RECENT_SENT.test(ns) || RECENT_ASCII.test(ns)) sc += 0.7;
      if (year && year >= cy - 1) sc += 0.5;
      // v84: rəqəmlə isim arasındakı təyinedici sualda YOXDURSA — say dar alt-qrupundur
      // ("30 615 nəfər KİŞİ müəllim" — bütün müəllimlərin sayı deyil)
      if (dist !== null && dist > 0 && opts.query) {
        const qTokens = String(opts.query || "").toLowerCase();
        const unitish = /^(nefer|nəfər|eded|ədəd|dene|dənə|sayi|sayı|olan|ve|və|də|da)$/i;
        // v84: bağlayıcıdan ("və") sonrası ayrı bənddir — təyinedici sayılmır
        const stopAt = words.slice(0, dist).findIndex(w => /^(v[əe]|ve|və\s*ya|ki)$/i.test(w));
        const modScope = stopAt >= 0 ? words.slice(0, stopAt) : words.slice(0, dist);
        const extraMods = modScope.filter(w => w.length >= 3 && !unitish.test(w) && !qTokens.includes(w.slice(0, 5)));
        if (extraMods.length) sc -= Math.min(1.6, extraMods.length * 0.8);
        if (extraMods.length) {
          // orijinal yazılışla göstər ("kişi", "kisi" yox)
          const rawWords = after.split(/[^\p{L}0-9]+/u).filter(Boolean);
          qualifier = rawWords.slice(0, dist).filter(w => w.length >= 3 && !unitish.test(normalizeAz(w)));
        }
      }
      sc += scopeBias(s, opts.query || noun);

      // v77: "300-dən çox poçt şöbəsi" — aşağı sərhəd kimi işarələnir
      // v77: cümlə daxilindəki pəncərə — "50 aptek var idisə, indi ... 2900-a çatıb"
      const winBefore = s.slice(Math.max(0, m.index - 55), m.index);
      const winAfter = s.slice(iEnd, iEnd + 55);
      if (HIST_SENT.test(winBefore) || HIST_SENT.test(after.slice(0, 30))) sc -= 1.2;
      if (RECENT_SENT.test(winAfter)) sc += 0.9;
      if (scaleM && (/^\s*(milyon|milyard|min)\s*(keç[əe]n|kecen|yaxın|yaxin|təxminən|texminen|çox|cox|artıq|artiq)/i.test(rest) || dist === null || dist > 2)) {
        continue;   // v84: "50 milyonu keçən ... bayramıdır", "18,8 milyona yaxın nəşr" — say çərçivəsi deyil
      }
      if (scaleM) {
        const sc2 = scaleM[1].toLowerCase();
        scale = sc2.startsWith("milyard") ? 1e9 : sc2.startsWith("milyon") ? 1e6 : 1e3;
      }
      cands.push({ value: Math.round(num * scale), score: sc, sentence: s.slice(0, 220), future, year, atLeast, scaled: scale > 1, qualifier, order: cands.length });
    }
    // v62.4: rəqəm isimdən SONRA da gələ bilər — "İnzibati rayonların sayı: 66"
    for (const sm of ns.matchAll(/(sayi|sayisi|miqdari|eded|say)\s*:?\s*(\d{1,5})/g)) {
      const before = ns.slice(Math.max(0, sm.index - 45), sm.index);
      if (!before.includes(nounStem) && !nsWords.some(matchWord)) continue;
      const num = Number(sm[2]);
      if (!Number.isFinite(num) || num <= 0 || num > 1e10) continue;
      if (num >= 1900 && num <= 2100) continue;
      // v65: "şəhər rayonlarının sayı 14" — sayılan "şəhər" deyil. İsim "sayı"-dan
      // DƏRHAL əvvəl gələn söz olmalıdır.
      const bWords = before.split(/[^a-z0-9əğıöşüç]+/).filter(Boolean);
      const lastW = bWords[bWords.length - 1] ? bWords[bWords.length - 1].replace(/[ıi]?n[ıi]n$/u, "").replace(/[ıi]n$/u, "") : "";
      const nearMatch = bWords.length ? (matchWord(bWords[bWords.length - 1]) || (lastW && matchWord(lastW))) : false;
      // v77: "onların sayı 2900-a çatıb" — əvəzliklə işarə olunan isim cümlədə var
      const pronounRef = /(?<![\p{L}])(onlar|onun|bunlar|bunun|həmin|həmən|belə)(?:ın|in|un|ün|nın|nin|nun|nün)?\s*$/iu.test(before) && (ns.includes(nounStem) || nsWords.some(matchWord));
      const synNear = SYN_RE && SYN_RE.test(before);
      if (!nearMatch && !pronounRef && !synNear) continue;
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
        // v97.1: "64 rayon ... 12 şəhər rayonu" kimi İNZİBATİ SİYAHI cəm deyil!
        // Cəm yalnız: (a) sual cəm istəyir, (b) hər rəqəmin ÖZ təyinedicisi var və
        // təyinedicilər fərqlidir ("2 dövlət bankı və 19 kommersiya bankı").
        const asksTotal = /(?:^|[^\p{L}])(cəmi|cemi|ümumi|umumi|toplam|birlikdə|birlikde)(?![\p{L}])/iu.test(String(opts.query || ""));
        // Hissə sayı o deməkdir: cümlədə isim ƏN AZI 2 dəfə keçir və hər rəqəm öz
        // isim təkrarına bağlıdır. İnzibati siyahı sözləri (şəhər/rayon/kənd) cəmi bloklayır.
        const nounOcc = [...String(sent).matchAll(new RegExp(nounStem, "giu"))].map(m => m.index);
        const attached = vals.length >= 2 && vals.every(v => nounOcc.some(i => sent.slice(Math.max(0, i - 42), i).includes(String(v))));
        const partsLike = attached && nounOcc.length >= 2 &&
          !/(şəhər|seher|rayon|kənd|kend|tabeli|inzibati|şəhərli)/iu.test(sent);
        if (asksTotal || partsLike) {
          const hasVe = /(?:^|\s)v[əe](?=\s|$)|,|;|\bile\b/iu.test(sent);
          if (!hasVe) continue;
          const sum = vals.reduce((a, b) => a + b, 0);
          // cəm namizədi hissələrdən üstün olmalıdır
          cands.push({ value: sum, score: Math.max(...list.map(c => c.score)) + 0.4, sentence: sent, summed: true, year: list[0].year, order: Math.min(...list.map(c => c.order ?? 0)) });
        }
      }
    }
  }

  return { cands, rejected };
}

export function extractCount(text, noun, opts = {}) {
  const { cands } = collectCandidates(text, noun, opts);
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
    qualifier: best.qualifier || null,
    agree,
    fromWord: !!best.fromWord
  };
}

// Bir neçə nəticə üzərində səsvermə: eyni rəqəm 2+ mənbədə təkrarlanırsa güvən artır
export function extractCountFromResults(results, noun, query = "") {
  const found = [];
  // mövzu tokeni: say sözü və sual köməkçiləri çıxıldıqdan sonra ən uzun/böyük hərfli token
  const subjectTok = (() => {
    const toks = String(query || "").toLowerCase().replace(/[?!.]+$/g, "").split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
    const skip = /^(neç[əe]|nece|say[ıi]|ədəd|eded|var|yox|hans[ıi]|nə|ne|qədər|qeder|total|count|number|how|many|the|of|in|d[əe]|da|de)$/u;
    const nounKey0 = String(noun || "").toLowerCase().replace(/[^\p{L}]/gu, "").slice(0, 5);
    const cands = toks.filter(t => t.length >= 2 && !skip.test(t) && !(nounKey0 && t.replace(/[^\p{L}\p{N}]/gu, "").startsWith(nounKey0)));
    return cands.sort((a, b) => b.length - a.length)[0] || "";
  })();
  for (const r of results || []) {
    const text = `${r.content || ""} ${r.snippet || ""}`;
    // v65: "Client Challenge" / captcha səhifəsindən rəqəm çıxarmaq olmaz
    if (/client\s*challenge|a\s+required\s+part\s+of\s+this\s+site|captcha|enable\s+javascript/i.test(text)) continue;
    const got = extractCount(text, noun, { query });
    if (got) {
      // v111: NÜMUNƏ səhifəsi ≠ TOPLU səhifəsi. "Əhmədli metrostansiyası" bir stansiyanın
      // səhifəsidir; oradan "neçə stansiya var" sayı çıxmaz (orada "açılış tarixi: 28 aprel",
      // "platformaların sayı: 1" kimi rəqəmlər var). Toplu səhifələr (siyahı, say, statistika,
      // "Bakı metropoliteni") üstün tutulur.
      const tTitle = String(r.title || "");
      const tw = tTitle.trim().split(/\s+/).filter(Boolean);
      const lastW = (tw[tw.length - 1] || "").toLowerCase();
      const nounKey = String(noun || "").toLowerCase().replace(/[^\p{L}]/gu, "").slice(0, 6);
      const instancePage = tw.length >= 2 && nounKey && lastW.includes(nounKey) && !/siyah[ıi]|list|statistika|say[ıi]|bütün|ümumi/i.test(tTitle.toLowerCase());
      const collectionBonus = /siyah[ıi]|list|statistika|say[ıi]|rəsmi|official/i.test(tTitle.toLowerCase()) ? 0.5 : 0;
      if (instancePage) got.score -= 1.3;
      else got.score += collectionBonus;
      // v116: sualın MÖVZU tokeni cümlədə olmalıdır. Ölçmə: "NBA-də neçə komanda var" →
      // "Bu oyunlar 16 komanda arasında oynanıldı" cümləsi seçildi (16 komanda, səhv).
      // Mövzu (NBA) həmin cümlədə yoxdur; düzgün cümlədə ("NBA 30 komandadan ibarətdir") var.
      if (subjectTok) {
        const sentNorm = String(got.sentence || "").toLowerCase();
        const tx = `${sentNorm} ${String(r.title || "").toLowerCase()}`;
        if (tx.includes(subjectTok)) got.score += 0.9;
        else got.score -= 0.55;
      }
      // v109: rəsmi dövlət saytı (.gov.az) ilkin mənbədir — eyni rəqəm medianın
      // "20 vaqon" kimi yanlış göstəricisindən üstün tutulur. Ümumi qayda, sayt siyahısı deyil.
      let auth = 0;
      try { if (/\.gov\.az$/i.test(new URL(r.url).hostname)) auth = 0.6; } catch {}
      found.push({ ...got, score: got.score + auth, url: r.url, title: r.title });
    }
  }
  if (!found.length) return null;
  // v111: TƏKRAR MƏNBƏLƏR AYRI SƏS SAYILMIR. Əvvəl hər nəticə səsi artırırdı: eyni
  // nəşriyyatın iki yazısı və ya başqa sayta köçürülmüş eyni xəbər "iki təsdiq" görünürdü.
  // İndi səs = fərqli HOST + fərqli MƏTİN klasteri (eyni sitat bir dəfə sayılır).
  // v113 (#4): alt-domenlər bir host sayılır
  const hostOf = (u) => regDomain(hostOfUrl(u));
  const storyOf = (f) => String(f.sentence || "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  const seenPair = new Set();
  const hostsByValue = new Map();
  const storiesByValue = new Map();
  for (const f of found) {
    const h = hostOf(f.url) || f.url || "?";
    const st = storyOf(f) || h;
    const pair = `${f.value}|${h}|${st}`;
    if (seenPair.has(pair)) continue;   // tam eyni mənbə+cümlə → təkrar
    seenPair.add(pair);
    if (!hostsByValue.has(f.value)) hostsByValue.set(f.value, new Set());
    hostsByValue.get(f.value).add(h);
    if (!storiesByValue.has(f.value)) storiesByValue.set(f.value, new Set());
    storiesByValue.get(f.value).add(st);
  }
  // müstəqil təsdiq: fərqli mətn klasteri sayı (min. host sayı ilə eyni sərhəddə)
  const confirmations = (v) => Math.min((storiesByValue.get(v) || new Set()).size, (hostsByValue.get(v) || new Set()).size);
  found.sort((a, b) => {
    const va = confirmations(a.value) * 2 + a.score;
    const vb = confirmations(b.value) * 2 + b.score;
    return vb - va;
  });
  const top = found[0];
  const seenHosts = new Set();
  const srcs = [];
  for (const f of found) {
    if (f.value !== top.value) continue;
    const h = hostOf(f.url);
    if (seenHosts.has(h)) continue;
    seenHosts.add(h);
    srcs.push({ url: f.url, title: f.title });
    if (srcs.length >= 3) break;
  }
  return { ...top, confirmations: confirmations(top.value), sources: srcs };
}

// v74: say sualı üçün AXTARIŞ sorğusu — "neçə X var" formalı sual statistik səhifə
// gətirmir, "<X> sayı" gətirir (canlı yoxlama: xəstəxana/bank/bələdiyyə).
// v112: dil-uyğun "say" sözü. AZ/TR/RU üçün ayrı söz; EN və digər dillərdə əlavə olunmur
// (ingilis dilində "<X> number" qrammatik deyil — sorğu olduğu kimi qalır).
const COUNT_WORD_BY_LANG = { az: "sayı", tr: "sayısı", ru: "количество" };
function countWordFor(text = "") {
  const t = String(text || "");
  if (/[\u0400-\u04ff]{2,}/.test(t)) return COUNT_WORD_BY_LANG.ru;
  const qLang = detectQueryLanguage(t);
  return COUNT_WORD_BY_LANG[qLang] || "";
}

const MARKER_STRIP = /(?<![\p{L}])(ne[çc][əe]dir|ne[çc][əe]|n[əe]\s*q[əe]d[əe]r(dir)?|how\s+many|number\s+of|сколько|количество|всего|число|ka[çc](?:t[ıi]r)?|say[ıi]s[ıi]|say[ıi])(?![\p{L}])/giu;
// v113 (#2): ÖLÇÜ sualı "neçə" ilə gəlsə də "<X> sayı" axtarışı mənasızdır —
// cavab vahidlə verilir (metr, nəfər, yaş, km, faiz). Hündürlük/əhali/yaş/məsafə
// və digər ölçü isimləri siyahıdadır (dil səviyyəli lüğət, sayta bağlı deyil).
const MEASURE_NOUN_RE = /(?<![\p{L}])(h[üu]nd[üu]rl[üu]|uzunlu|d[əe]rinl|derinl|m[əe]saf|mesaf|sah[əe]|sahe|[əe]razi|erazi|[əe]hali|ehali|n[üu]fus|ya[sş]|ç[əe]ki|ceki|h[əe]cm|hecm|s[üu]r[əe]t|suret|temperatur|r[üu]tb[əe]t|faiz|qiym[əe]t|qiymet|g[əe]lir|gelir|x[əe]rc|xerc|borc|pensiya|[əe]m[əe]k|emek|height|distance|area|population|depth|weight|volume|temperature|humidity|longevity|length|высот|площад|населен|расстояни|глубин|температур|продолжительност)/iu;

// v113 (#2): ölçü sualıdır? (say blokunun da buraxması üçün ixrac olunur)
export const isMeasureQuery = (query = "") => MEASURE_NOUN_RE.test(String(query || ""));

export function countSearchQuery(query = "") {
  const q = String(query || "").trim();
  if (!hasCountMarker(q)) return null;
  if (isMeasureQuery(q)) return null;   // v113 #2: ölçü sualı — "sayı" əlavə edilmir
  let t = q.replace(MARKER_STRIP, " ")
    // v113 (#7): türk sayğacları — "kaç TANE müze" → "müze sayısı"
    .replace(/(?<![\p{L}])(tane|adet|dane)(?![\p{L}])/giu, " ")
    .replace(/(?<![\p{L}])(var|vard[ıi]r|mövcuddur|movcuddur)(?![\p{L}])/giu, " ")
    .replace(/[?!.]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!t) return null;
  // v90: "neçə manatdır" — valyuta/vahid sualıdır, "<X> sayı" axtarışı mənasızdır
  if (/(?:manat|azn|dollar|usd|avro|eur|rubl|₼)/iu.test(t)) return null;
  if (/say[ıi]/iu.test(q)) return null;            // artıq "sayı/sayısı" var
  // v112: say sözü SORĞUNUN DİLİNDƏ olmalıdır (əvvəl hər dilə "sayı" əlavə olunurdu →
  // "станций в бакинском метро sayı" kimi qarışıq sorğu). Uyğun söz yoxdursa — buraxılmır.
  const cw = countWordFor(t);
  t = cw ? `${t} ${cw}` : t;
  return t.split(/\s+/).length >= 2 ? t : null;
}

// Sorğudan baş ismi çıxar: "Azərbaycanda neçə rayon var" → "rayon"
// v90: "neçədir" / "neçəsini" kimi şəkilçili formalar da marker sayılır
// ("necədir" isə aşağıdakı yoxlamada fel kimi rədd olunur)
const NUM_MARKERS = /(?<![\p{L}])(ne[çc][əe](?:dir|dır|dur|dür)?|nece|say[ıi]|n[əe]\s*q[əe]d[əe]r(dir)?|сколько|количество|всего|число|ka[çc](?:t[ıi]r)?|how\s+many|number\s+of)(?![\p{L}])/iu;

// v77: "necə" (=how) say markeri DEYİL. Fərq qrammatikadır: "neçə" + İSİM,
// "necə" + FEL ("necə saxlamaq olar", "necə işləyir"). "ç" hərfli forma həmişə saydır.
const VERBISH = /(maq|mək|mek|maq)$|(ır|ir|ur|ür|ar|ər|acaq|əcək|malı|məli|meli|malı)$|^(etmek|elemek|eləmək|olunur|edilir|olur|edir|göstərir|isleyir|işləyir|saxlamaq|qorumaq)$/iu;
export function hasCountMarker(q = "") {
  const str = String(q || "");
  const m = str.match(NUM_MARKERS);
  if (!m) return false;
  if (!/ne[çc][əe]/i.test(m[0])) return true;          // "sayı", "nə qədər", "how many"…
  if (/neç/i.test(m[0])) return true;                  // "neçə" — həmişə say
  // "necə" / "nece": növbəti 1-3 söz felə bənzəyirsə say deyil (how-to)
  const after = str.slice(m.index + m[0].length).trim();
  const nextWords = after.split(/[^\p{L}]+/u).filter(Boolean).slice(0, 3).map(w => w.toLowerCase());
  if (!nextWords.length) return false;
  const verbRe = /(maq|mək|mek|max|maq)$|(ır|ir|ur|ür|ar|ər|acaq|əcək|malı|məli|malıdır|məlidir|malıdı|məlidi|acaqdır|əcəkdir|ıb|ib|ub|üb|ılıb|ilib|ulub|ülüb)$|^(etmek|elemek|eləmək|etmək|olunur|olunmaq|edilir|edilib|edilmək|olur|olub|olunub|edir|olmaq|göstərir|işləyir|isleyir|saxlamaq|qorumaq|təyin|teyin|yazmaq|oxumaq|yaratmaq|istifadə|istifade|qurulur|qurmaq|hazırlamaq|seçmək|secme|almaq|vermək|tapmaq|eləmək|edilib|olunub)$/iu;
  for (const w of nextWords) {
    if (/(maq|mək|mek|max|ıb|ib|ub|üb)$/iu.test(w)) return false;
    if (/(ır|ir|ur|ür|ar|ər|acaq|əcək|malı|məli|ilib|ulub|olunub|edilib)$/iu.test(w)) return false;
    if (verbRe.test(w)) return false;
    // "təyin olunur" kimi fel birləşməsi: tək "təyin" fel kimi tanınmır, amma növbəti söz fəldirsə də how-to
    if (/^(təyin|teyin|müəyyən|mueyyen|qeyd|hesab|say|tespit)$/iu.test(w) && nextWords.length > 1) {
      // növbəti söz fel olarsa, bütöv ifadə how-to
      const nxt = nextWords[1] || "";
      if (/(olunur|edilir|olur|edilir|olunan|edilen|olunacaq|edilecek)/iu.test(nxt)) return false;
    }
  }
  // əgər növbəti sözlər arasında fel yoxdursa, say markeridir (məs. "necə stansiya" nadir, amma ola bilər)
  return true;
}

// v77: köhnə məlumat cəzalandırılır, cari məlumat üstün tutulur.
const HIST_SENT = /(?<![\p{L}])(əvvəl|evvel|keçmişdə|keçmiş\s+illərdə|vaxtilə|o\s+dövrdə|həmin\s+illərdə|var\s+idisə|idi|idiki|olmuşdu|olmusdu|açmışdı|acmisdi|işləmişdi|çatmışdı|təşkil\s+edirdi|göstərmişdi)(?![\p{L}])/iu;
const RECENT_SENT = /(?<![\p{L}])(indi|hazırda|hal[-\s]hazırda|bu\s+gün|bu\s+il|hazırki|cari\s+il|cari\s+ildə)(?![\p{L}])/iu;
// v77: ölkə miqyaslı sualda şəhər miqyaslı cümlə cavab sayılmır
const CITY_TOKENS = /(?<![\p{L}])(bakı|baki|gəncə|gence|sumqayıt|sumqayit|naxçıvan|naxcivan|mingəçevir|mingecevir|şəki|seki|lənkəran|lenkeran|şirvan|sirvan|şamaxı|samaxi|quba|qusar|xankəndi|şuşa|susa|yevlax|ağdam|agdam|salyan|qəbələ|qebele)/iu;
const LOCAL_SCOPE = /[A-ZƏÖÜĞŞÇİ][\p{L}]{2,}\s+(rayonunda|rayonunun|şəhərində|seherinde|qəsəbəsində|qesebesinde|kəndində|kendinde)/u;
const VAGUE_SCOPE = /(?<![\p{L}])(bu\s+rayon|rayonun|bu\s+şəhər|bu\s+kənd|kəndin|burada|həmin\s+rayon|rayon\s+üzrə)(?![\p{L}])/iu;
const COUNTRY_SENT = /(?<![\p{L}])(azərbaycan|azerbaycan|ölkə|olke|ölkəmizdə|respublika|ümumi|umumi|cəmi|cemi)/iu;
// v78: ASCII yazılış (диакритика olmadan) üçün eyni qaydalar
const HIST_ASCII = /(?<![a-z])(evvel|kecmisde|kecmis illerde|vaxtile|o dovde|hemii illerde|var idise|idi|olmusdu|acmisdi|islemisdi|catmisdi|teskil edirdi|gostermisdi)(?![a-z])/i;
const RECENT_ASCII = /(?<![a-z])(indi|hazirda|hal-hazirda|bu gun|bu il|hazirki|cari il)(?![a-z])/i;

function scopeBias(sentence, query) {
  const q = String(query || "");
  let b = 0;
  const qCountry = /(?<![\p{L}])(azərbaycan|azerbaycan|ölkə|olke|respublika|ümumi|umumi)/iu.test(q);
  const qCity = CITY_TOKENS.test(q);
  if (qCountry && !qCity) {
    if (CITY_TOKENS.test(sentence)) b -= 1.2;
    if (LOCAL_SCOPE.test(sentence)) b -= 1.2;   // v80: "Ağdərə rayonunda 58 kənd"
    if (VAGUE_SCOPE.test(sentence)) b -= 1.2;   // v82: "Burada 140 məscid var"
    if (COUNTRY_SENT.test(sentence) && !LOCAL_SCOPE.test(sentence)) b += 0.4;
  }
  // v79: şəhər soruşulub, cümlə "bu rayon/rayonun" deyirsə — miqyas uyğun deyil
  if (qCity && !CITY_TOKENS.test(sentence) && VAGUE_SCOPE.test(sentence)) b -= 1.4;
  if (qCity && CITY_TOKENS.test(sentence)) b += 0.5;
  return b;
}
const NOUN_STOP = new Set(["tane", "adet", "dane", "var", "vardir", "varmi", "movcud", "mövcud", "movcuddur", "olan", "idi",
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
  // v112: isim marker-dən ƏVVƏL gələ bilər — "stansiyaların sayı", "universitet sayı".
  // Əvvəl bu halda null qayıdırdı və say mexanizmi heç işləmirdi.
  if (!words.length) {
    // "nə qədərdir" ÖLÇÜ sualıdır (uzunluq, sahə) — say ismi çıxarılmır, ölçü mexanizmi baxır
    if (/n[əe]\s*q[əe]d[əe]r/i.test(m[0])) return null;
    const before = q.slice(0, m.index).trim();
    const bw = before.split(/[^\p{L}0-9]+/u).filter(w => w.length >= 3)
      .map(w => ({ raw: w, norm: normalizeAz(w) }))
      .filter(o => !NOUN_STOP.has(o.norm) && !ATTR_STOP.has(o.norm) && !VERB_STOP.has(o.norm));
    if (!bw.length) return null;
    // göstəriş üçün yiyəlik/cəm şəkilçisini at: "stansiyaların" → "stansiya"
    const raw0 = bw[bw.length - 1].raw;
    const pluralStripped = raw0.replace(/(lar|ler|lər|lar)[ıi]?n[ıi]?$/iu, "").replace(/([ıiuiü]n|[ıi]|[ıi]s[ıi])$/iu, w => (w.length >= 4 && /[bcçdfgğhjklmnprsştvyxz]$/iu.test(raw0.slice(0, -w.length)) ? "" : w));
    return nounDisplay(pluralStripped.length >= 4 ? pluralStripped : raw0, bw.length >= 2);
  }
  // "neçə rayon var" → rayon; "neçə stansiya var" → stansiya
  // v62: "neçə ELMİ institut var" → "elmi" sifətdir, sayılan isim "institut"-dur
  // v63: sayılan obyekt ADƏTƏN SON isimdir — "neçə hava limanı" → "limanı", "neçə dövlət bayramı" → "bayramı"
  // v112: EN/RU söz sırası — "how many stations in baku" / "сколько станций в метро":
  // sayılan isim marker-dən DƏRHAL sonra gəlir (sondakı "metro" deyil).
  if (/(how\s+many|number\s+of|сколько|количество|всего|ka[çc])/iu.test(m[0])) {
    const first = words.find(o => !NOUN_STOP.has(o.norm) && !ATTR_STOP.has(o.norm) && !VERB_STOP.has(o.norm));
    if (first) return nounDisplay(first.raw, false);
  }
  let cand = words.slice(0, 4).filter(o => !ATTR_STOP.has(o.norm) && !VERB_STOP.has(o.norm));
  // v79: fel qalığı ümumi qayda ilə də atılır — "neçə erməni yaşayır" → "erməni"
  if (cand.length >= 2 && isVerbish(cand[cand.length - 1].norm)) cand = cand.slice(0, -1);
  // v79: yiyəlik şəkilçisi yalnız qarşısında təyinedici söz olduqda atılır
  // ("neçə TV kanalı" → kanal; "neçə erməni" → erməni toxunulmaz)
  const pick = cand.length ? cand[cand.length - 1] : words[0];
  const rawQ = q.slice(m.index + m[0].length);
  const toks = rawQ.split(/[^\p{L}0-9]+/u).filter(Boolean);
  const tokIdx = toks.findIndex(t => t.toLowerCase() === pick.raw.toLowerCase());
  const modBefore = tokIdx > 0;
  return nounDisplay(pick.raw, modBefore || cand.length >= 2);
}

// v75: sualda fel/feili sifət qalığı ("fəaliyyət göstərir", "yerləşir", "sayılır")
const isVerbish = (w = "") => /(y?[ıiuü]r|y?[ıiuü]n|acaq|ecek|acağ|malı|meli|mal[iı]|m[iı]ş|m[iı]s|maq|mek|d[iı]|d[uü])$/.test(w) && w.length >= 5;
const VERB_STOP = new Set(["gostermek","gosterir","gostərir","teskil","fealiyyet","fealiyyetde","edir","olur","var","vardir","moevcud","mövcud","moevcuddur","mövcuddur","yerlesir","yerləşir","isleyir","işləyir","sayilir","sayılır","alınır","alinir","qeyde","qeydə","daxil","olmaq","etmek","və","ve"]);

// v75: yiyəlik şəkilçisini göstəriş üçün atırıq — "38 şirkəti" → "38 şirkət",
// "21 kanalı" → "21 kanal". Yalnız samitlə bitən gövdə + uzunluq ≥ 4 olduqda.
const POSS_KEEP = new Set(["boru","qapı","qapi","kürsü","kursu","sarı","sari","ayrı","ayri","dəyirmi","deyirmi","dünya","dunya","xəta","xeta"]);
function nounDisplay(raw = "", allow = true) {
  if (!allow) return String(raw || "");
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
  // "qoruğu" → "qoruq" (sait qarşısında q→ğ dəyişməsi geri qaytarılır)
  return base.replace(/ğ$/u, "q");
}

// === v112: ÇARPAZ TƏSDİQ (cross-confirmation) ===
// Rəqəmli sualda cavab TƏK nəticədən deyil, BÜTÜN nəticələrdən çıxarılır; eyni dəyər
// MÜSTƏQİL mənbələrlə (fərqli host + fərqli mətn klasteri) təsdiqlənir.
// "12 stansiyadan ibarət Bənövşəyi xətt" kimi alt-obyekt/plan rəqəmləri rədd edilir və
// yalnız debug-da görünür.
const hostOfUrl = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

// v113 (#4): eyni nəşriyyatın alt-domenləri BİR host sayılır
// (portal.azertag.az ≡ azertag.az ≡ news.azertag.az). Qayda ümumidir: registrasiya
// domeni götürülür — `.gov.az/.com.az/...` kimi ikinci səviyyələr də nəzərə alınır.
const SECOND_LEVEL = new Set(["gov", "com", "org", "net", "edu", "ac", "co", "mil", "int", "biz", "info"]);
export function regDomain(host = "") {
  const h = String(host || "").toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!h || !h.includes(".")) return h;
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const isCc = parts[parts.length - 1].length === 2;              // az, tr, ru, uk, ...
  if (isCc && SECOND_LEVEL.has(parts[parts.length - 2])) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}
const regOfUrl = (u) => regDomain(hostOfUrl(u));
const authorityRank = (url) => {
  const h = hostOfUrl(url);
  if (!h) return 0;
  if (/\.gov\.[a-z]{2}$/.test(h) || /\.gov$/.test(h)) return 3;     // rəsmi dövlət
  if (/wikipedia\.org$/.test(h)) return 2;                          // ensiklopediya
  return 1;                                                         // xəbər/blog/digər
};
const storyKeyOf = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ")
  .split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
const YEAR_MS = 365 * 24 * 3600 * 1000;

export function extractCountCross(results = [], noun, query = "") {
  if (!noun) return null;
  const groups = new Map();
  const rejected = [];
  for (const r of results || []) {
    const text = [r.title, r.snippet, r.content].filter(Boolean).join(". ");
    if (!text) continue;
    let parsed;
    try { parsed = collectCandidates(text, noun, { query }); } catch { continue; }
    for (const x of parsed.rejected || []) rejected.push({ value: x.value, reason: x.reason, url: r.url });
    for (const c of parsed.cands || []) {
      if (!(c.score > 0)) continue;
      const key = String(Math.round(c.value * 1000) / 1000);
      if (!groups.has(key)) groups.set(key, { value: c.value, items: [] });
      groups.get(key).items.push({ ...c, url: r.url, title: r.title, date: r.published_at || r.updated_at || null });
    }
  }
  if (!groups.size) return { value: null, confirmations: [], agreement: "none", rejected };
  const list = [...groups.values()].map((g) => {
    const seen = new Set();
    const stories = new Set();
    const hosts = [];
    const urls = [];
    for (const it of g.items) {
      const h = regOfUrl(it.url);        // v113 #4: alt-domen = eyni host
      const k = `${h}|${storyKeyOf(it.sentence)}`;
      if (seen.has(k)) continue;      // eyni host + eyni cümlə = TƏKRAR, təsdiq deyil
      seen.add(k);
      stories.add(storyKeyOf(it.sentence) || h);
      if (h && !hosts.includes(h)) hosts.push(h);
      urls.push(it.url);
    }
    const officialHosts = hosts.filter(h => /\.gov\.[a-z]{2}$/.test(h));
    const best = g.items.slice().sort((a, b) => b.score - a.score)[0];
    const dates = g.items.map(i => i.date).filter(Boolean).sort();
    return {
      value: g.value,
      // təsdiq = fərqli MƏTN klasteri ∩ fərqli host (eyni cümlə 2 saytda = 1 təsdiq)
      count: Math.min(stories.size, Math.max(hosts.length, 1)),
      hosts: hosts.slice(0, 5),
      urls: urls.slice(0, 5),
      official: officialHosts.length > 0,
      official_hosts: officialHosts,
      authority: Math.max(0, ...hosts.map(h => (/\.gov\.[a-z]{2}$/.test(h) ? 3 : /wikipedia\.org$/.test(h) ? 2 : 1))),
      newest_date: dates.length ? dates[dates.length - 1] : null,
      year: best.year || null,
      score: Math.round(best.score * 100) / 100,
      sentence: best.sentence,
      summed: !!best.summed
    };
  });
  list.sort((a, b) =>
    b.count - a.count ||
    b.authority - a.authority ||
    String(b.newest_date || "").localeCompare(String(a.newest_date || "")) ||
    b.score - a.score);
  const top = list[0];
  const rivals = list.slice(1);
  const fresh = (g) => g.newest_date && (Date.now() - Date.parse(g.newest_date) < 2 * YEAR_MS);
  const stale = (g) => !g.newest_date || (Date.now() - Date.parse(g.newest_date) > 2 * YEAR_MS);
  let agreement = top.count >= 3 ? "strong" : top.count === 2 ? "medium" : "weak";
  // ÇOXLUQ ≠ HƏQİQƏT: aparıcı zəif və köhnədirsə, rəqib rəsmidirsə/təzədirsə — ziddiyyət
  // v113 (#5): FƏRQLİ RƏQƏM QRUPU varsa → agreement "conflict".
  // (v112-də yalnız rəsmi/2+ təsdiqli rəqib ziddiyyət sayılırdı; istifadəçi qərarı ilə
  // indi hər fərqli dəyər qrupu ziddiyyət kimi qaytarılır — gizlədilmir.)
  const rivalStrong = rivals.some(g => g.value !== top.value);
  if (rivalStrong) agreement = "conflict";
  return { value: top.value, agreement, confirmations: list, rejected, top };
}
