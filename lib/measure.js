// v77: ÖLÇÜ cavabı — "işsizlik səviyyəsi nə qədərdir", "orta ömür uzunluğu", "dövlət borcu".
// Say (neçə) sualından fərqi: burada cavab rəqəm + VAHİDDİR (faiz, yaş, manat, milyard...).
// Qaydalar dil səviyyəlidir (qrammatika + vahid lüğəti), sayta bağlı deyil.
import { normalizeAz } from "./rank.js";

const UNIT_RE = /(\d{1,3}(?:[.\s]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(min\s+)?(faiz(?:i|ə|də|dən|ə|inə)?|%|yaş(?:ında|ı|i)?|manat(?:dır|dır|a|ı)?|azn|milyard|milyon|min|nəfər|nefer|kilometr|km|kq|ton|hektar|litr|metr|santimetr)(?:[a-zəğıöşüç]{0,4})?(?![\p{L}])/giu;

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
  // v93: faiz cavabı yalnız faiz/dərəcə sualında məqbuldur ("borc nə qədərdir" → məbləğ)
  const qStr = String(query || "");
  const wantsPercent = /(?<![\p{L}])(faiz|percent|%)/iu.test(qStr) ||
    /(işsizlik|işsizliyin|inflyasiya|səviyyə|artım|göstərici|mənfəət|rentabellik)/iu.test(qStr);
  const allSentences = t.split(/(?<=[.!?;])\s+|\n+/).map(s => s.replace(/\s+/g, " ").trim());
  // anchor ("GPT-5", "iPhone 15") hansı cümlələrdədir — tarix qonşu cümlədə ola bilər
  const anchorM0 = String(query || "").match(/(?<![\p{L}\d])([\p{L}]{2,}[-\s]?\d{1,4}|\d{1,4}[-\s]?[\p{L}]{2,})(?![\p{L}\d])/u);
  const anchorKey0 = anchorM0 ? anchorM0[1].toLowerCase().replace(/[\s-]/g, "") : null;
  const anchorIdx = new Set();
  if (anchorKey0) allSentences.forEach((s, i) => { if (normalizeAz(s).replace(/[\s-]/g, "").includes(anchorKey0)) anchorIdx.add(i); });
  const sentences = allSentences.filter(s => s.length >= 12);
  const cands = [];
  for (let si = 0; si < allSentences.length; si++) {
    const s = allSentences[si];
    if (s.length < 12) continue;
    const ns = normalizeAz(s);
    let hits = terms.filter(tm => ns.includes(tm)).length;
    // v99: "GPT-5 nə vaxt çıxdı" kimi suallarda açar söz qısa/defisli olur və termini
    // süzgəcdən keçmir. Anchor cümlədə və ya QONŞU cümlədədirsə tarix cavabdır.
    if (!hits && anchorKey0) {
      if (!(anchorIdx.has(si) || anchorIdx.has(si - 1) || anchorIdx.has(si + 1))) continue;
      hits = 1;
    }
    const sLower = s;
    const yrs = [...s.matchAll(/(?:19|20)\d{2}/g)].map(x => Number(x[0]));
    const maxYear = yrs.length ? Math.max(...yrs) : null;
    const cy = new Date().getFullYear();
    for (const m of sLower.matchAll(UNIT_RE)) {
      const rawNum = String(m[1]);
      const num = Number(rawNum.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
      if (!Number.isFinite(num) || num <= 0) continue;
      // v99: UNIT_RE-də "min ton" / "min hektar" iki sözlü vahid kimi tutulur (m[2]=min, m[3]=vahid)
      const unitPrefix = String(m[2] || "").trim().toLowerCase();
      const unitBase = String(m[3] || "").toLowerCase();
      const unit = (unitPrefix ? `${unitPrefix} ${unitBase}` : unitBase).trim();
      // vahid mənasız qısa söz ola bilməz
      if (unit === "min" && !/[.,]/.test(rawNum) && num > 100) continue;
      let sc = 1 + Math.min(hits, 3) * 0.8;
      if (/faiz|%/.test(unit)) sc += 0.3;
      // v93: sual faiz soruşmursa, "%" cavab deyil (borc → "20 % azalıb" yanlış idi)
      const isPercent = /faiz|%/.test(unit);
      if (isPercent && !wantsPercent) sc -= 1.6;
      // v99: sualın ÖLÇÜSÜ ilə vahidin uyğunluğu — "pambıq istehsalı" soruşulanda
      // "132,5 min hektar" (əkin sahəsi) deyil, "290 min ton" (istehsal) cavabdır.
      const dimension = /(istehsal|hasilat|mehsul|yigim)/i.test(normalizeAz(String(query || "")));
      if (dimension) {
        if (/(istehsal|hasilat|məhsul|mehsul|yığım|yigim)/iu.test(ns)) sc += 0.9;
        else if (/(hektar|sahə|sahe|əkilib|ekilib)/iu.test(ns)) sc -= 0.9;
      }
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
      const isTwoWordUnit = /^min\s+/.test(unit);
      let disp = `${rawNum} ${canon}`.replace(/\s+/g, " ").trim();
      if (!isTwoWordUnit && /^(milyard|milyon|min)$/.test(canon)) {
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
        isPercent,
        score: sc
      });
    }
  }
  const pool = wantsPercent ? cands : cands.filter(c => !c.isPercent);
  if (!pool.length) return null;   // v93: faiz soruşulmayıbsa "%"-cavab verməkdənsə heç nə
  pool.sort((a, b) => b.score - a.score);
  const best = pool[0];
  const agree = pool.filter(c => c.value === best.value).length;
  return { ...best, score: Math.round(best.score * 100) / 100, agree };
}

// Nəticə massivindən (title + snippet/content) ölçü cavabı çıxarır
export function extractMeasureFromResults(results = [], query = "") {
  // v95.1: v93-də bu funksiyada `wantsPercent` təyin olunmamışdı → 500 xətası
  // ("Azərbaycanın dövlət borcu nə qədərdir"). Qayda extractMeasure ilə eynidir.
  const qStr2 = String(query || "");
  const wantsPercent = /(?<![\p{L}])(faiz|percent|%)/iu.test(qStr2) ||
    /(işsizlik|işsizliyin|inflyasiya|səviyyə|artım|göstərici|mənfəət|rentabellik)/iu.test(qStr2);
  const cands = [];
  for (const r of results) {
    const text = [r.title, r.snippet, r.content].filter(Boolean).join(". ");
    const hit = extractMeasure(text, query);
    if (!hit) continue;
    Object.assign(hit, { url: r.url, title: r.title, sources: [r.url] });
    cands.push(hit);
  }
  const pool = wantsPercent ? cands : cands.filter(c => !c.isPercent);
  if (!pool.length) return null;   // v93: faiz soruşulmayıbsa "%"-cavab verməkdənsə heç nə
  pool.sort((a, b) => b.score - a.score);
  const best = pool[0];
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
// v99: ingilis ay adları da tanınır — AZ sualına ingiliscə mənbə cavab verəndə
// ("GPT-5 nə vaxt çıxdı" → "released on August 7, 2025") tarix tapılmırdı.
const MONTHS_AZ = "yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr";
const MONTHS_EN = "january|february|march|april|may|june|july|august|september|october|november|december";
const MONTHS = `${MONTHS_AZ}|${MONTHS_EN}`;
const EN_TO_AZ_MONTH = {
  january: "yanvar", february: "fevral", march: "mart", april: "aprel", may: "may", june: "iyun",
  july: "iyul", august: "avqust", september: "sentyabr", october: "oktyabr", november: "noyabr", december: "dekabr"
};
function localizeMonth(text) {
  let out = String(text || "").replace(
    new RegExp(`\\b(${MONTHS_EN})\\b`, "giu"),
    (m) => EN_TO_AZ_MONTH[m.toLowerCase()] || m
  );
  // "avqust 7, 2025" → "7 avqust 2025" (AZ söz sırası)
  out = out.replace(new RegExp(`^(${MONTHS_AZ})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "iu"), (m, mo, d, y) => `${d} ${mo} ${y}`);
  return out;
}
const DATE_CUE = /(?<![\p{L}])(n[əe]\s*vaxt|hansı\s+il|hansi\s+il|hansı\s+tarixd[əe]|hangi\s+tarih|when)(?![\p{L}])/iu;
export function matchDateQuery(q) { return DATE_CUE.test(String(q || "")); }
export function extractDateAnswer(text, query) {
  const t = String(text || "");
  if (!t) return null;
  const terms = queryTerms(query);
  if (!terms.length) return null;
  const dateSents = t.split(/(?<=[.!?;])\s+|\n+/).map(s => s.replace(/\s+/g, " ").trim());
  // v99: anchor ("GPT-5", "iPhone 15") cümlədə VƏ YA QONŞU cümlədədirsə tarix cavabdır
  const anchorM0 = String(query || "").match(/(?<![\p{L}\d])([\p{L}]{2,}[-\s]?\d{1,4}|\d{1,4}[-\s]?[\p{L}]{2,})(?![\p{L}\d])/u);
  const anchorKey0 = anchorM0 ? anchorM0[1].toLowerCase().replace(/[\s-]/g, "") : null;
  const anchorIdx = new Set();
  if (anchorKey0) dateSents.forEach((s, i) => { if (normalizeAz(s).replace(/[\s-]/g, "").includes(anchorKey0)) anchorIdx.add(i); });
  const cands = [];
  for (let si = 0; si < dateSents.length; si++) {
    const s = dateSents[si];
    if (s.length < 12) continue;
    const ns = normalizeAz(s);
    let hits = terms.filter(tm => ns.includes(tm)).length;
    if (!hits) {
      if (!anchorKey0) continue;
      if (!(anchorIdx.has(si) || anchorIdx.has(si - 1) || anchorIdx.has(si + 1))) continue;
      hits = 1;
    }
    // v81: ən DƏQİQ tarix üstün tutulur: gün+ay+il > ay+il > il
    const patterns = [
      { re: new RegExp(`(\\d{1,2})\\s+(${MONTHS})\\s+(\\d{4})`, "giu"), bonus: 1.2 },
      { re: new RegExp(`(${MONTHS})\\s+(\\d{1,2})[,\\s]+(\\d{4})`, "giu"), bonus: 1.0 },
      { re: new RegExp(`(\\d{1,2})[\\s-]+(${MONTHS})`, "giu"), bonus: 0.2 },
      { re: /(\d{4})\s*-?\s*c[ıiuü]\s+il[\p{L}]*/giu, bonus: 0 },
      { re: /(\d{4})/g, bonus: -0.4 }
    ];
    let bestIn = null;
    for (const p of patterns) {
      const mm = p.re.exec(s);
      if (!mm) continue;
      // v102: anchor EYNİ cümlədədirsə güclü bonus — qonşu cümlədəki tarix (başqa hadisə)
      // anchor cümləsindəki tarixi üstələməməlidir ("GPT-5" → 12 noyabr 2025 səhvi)
      const sameSentenceAnchor = anchorKey0 && ns.replace(/[\s-]/g, "").includes(anchorKey0) ? 1.5 : 0;
      const score = 1 + Math.min(hits, 3) * 0.9 + p.bonus + sameSentenceAnchor;
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
    bestIn.dateText = localizeMonth(bestIn.dateText);
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
  for (const x of list) x.dateText = localizeMonth(x.dateText);
  const strongList = list.filter(x => new RegExp(`(${MONTHS})`, "iu").test(x.dateText));
  const useList = strongList.length ? strongList : list;
  useList.sort((a, b) => b.score - a.score);
  const best = useList[0];
  best.agree = useList.filter(x => x.dateText === best.dateText).length;
  best.sources = [...new Set(useList.filter(x => x.dateText === best.dateText).map(x => x.url))];
  return best;
}
