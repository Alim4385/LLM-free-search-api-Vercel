// v77: ÖLÇÜ cavabı — "işsizlik səviyyəsi nə qədərdir", "orta ömür uzunluğu", "dövlət borcu".
// Say (neçə) sualından fərqi: burada cavab rəqəm + VAHİDDİR (faiz, yaş, manat, milyard...).
// Qaydalar dil səviyyəlidir (qrammatika + vahid lüğəti), sayta bağlı deyil.
import { normalizeAz } from "./rank.js";
import { parseNumberToken } from "./units.js";

// v108: sualın gözlədiyi VAHİD AİLƏSİ — "neft hasilatı" → kütlə/həcm, "sahəsi" → sahə,
// "əhalisi" → say. Körpüdən gələn çoxdilli mətndə "21 metr" kimi təsadüfi rəqəmlər
// qalib gəlirdi; bu qayda onları kənarlaşdırır. Dil səviyyəli qaydadır, sayta bağlı deyil.
export function unitFamilyOfQuery(query = "") {
  const q = normalizeAz(String(query || ""));
  if (/(hektar|sah[əe]|sahe|[əe]razi|erazi|\barea\b|alan|площад)/i.test(q)) return "area";
  if (/(h[əe]cm|hecm|\bvolume\b|kub|m3|m\u00b3|qaz\s+(hasilat|istehsal)|gas\s+production)/i.test(q)) return "volume";
  if (/(istehsal|hasilat|mehsul|yigim|production|output|\u00fcretim|uretim|hasat|\u0434\u043e\u0431\u044b\u0447)/i.test(q)) return "mass";
  // v113: ŞƏKİLÇİLƏR nəzərə alınır — "hündürlüyü", "uzunluğu", "məsafəsi" formaları da ailədir
  if (/(uzunlu|h[üu]nd[üu]rl|d[əe]rinl|derinl|m[əe]saf|mesaf|length|height|depth|distance)/i.test(q)) return "length";
  // ölçü vahidi ilə verilən uzunluq sualı: "neçə kilometrdir" (amma "metro" — nəqliyyat — deyil)
  if (/(?<![\p{L}])(kilometr|santimetr|millimetr|fut|metr(?!o))/iu.test(q)) return "length";
  if (/(faiz|percent|percentage)/i.test(q)) return "percent";
  // v113: SAY ailəsi ƏN SONDA — "neçə kilometr"/"neçə faiz" ölçü sualıdır, say deyil
  if (/([əe]hali|ehal[iy]|population|n[üu]fus|sakin|ne[çc][əe]|say[ıi]|number of)/i.test(q)) return "count";
  return null;
}

export function unitFamilyOfUnit(unit = "") {
  const u = String(unit || "").toLowerCase();
  if (/faiz|%/.test(u)) return "percent";
  if (/ya[şs]/.test(u)) return "age";
  if (/^(min|mln|milyon|milyard|mlrd)\s/.test(u)) {
    const base = unitFamilyOfUnit(u.replace(/^\S+\s+/, ""));
    return base || "count";
  }
  if (/km\u00b2|kv\.?\s*km|kvadrat|hektar|ha\b|m\u00b2|kv\.?\s*m/.test(u)) return "area";
  if (/m\u00b3|kub\s*metr|kub|litr|barel|barrel/.test(u)) return "volume";
  if (/ton|kq|kg|qram|gram\b/.test(u)) return "mass";
  if (/metr|\bkm\b|kilometr|santimetr|\bsm\b|millimetr|fut|mil\b/.test(u)) return "length";
  if (/n[əe]f[əe]r|adam|ki[şs]i|sakin|manat|dollar|avro|rubl/.test(u)) return "count";
  // tək miqyas sözü ("1,1 milyon") vahid göstərmir — ölçü sualında cavab deyil
  if (/^(min|milyon|milyar|milyard|mlrd|mln)$/.test(u)) return "bare";
  return null;
}

const UNIT_RE = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:[.\s]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(min\s+)?(faiz(?:i|ə|də|dən|ə|inə)?|%|yaş(?:ında|ı|i)?|manat(?:dır|dır|a|ı)?|azn|milyard|milyon|min|nəfər|nefer|kilometr|km|kq|ton|hektar|litr|metr|santimetr)(?:[a-zəğıöşüç]{0,4})?(?![\p{L}])/giu;

// sualda ölçü nişanı varmı
// v78: "necə" (how-to) ölçü sualı DEYİL — çörək saxlama məqaləsindən "2 %" çıxarılırdı
const MEASURE_CUE = /(?<![\p{L}])(n[əe]\s*q[əe]d[əe]r(dir)?|səviyyə(si)?|faiz(i)?|həcm(i)?|uzunluğ(u)?|miqdar(ı)?|borc(u)?|gəlir(i)?|xərc(i)?|əmək\s+haqq(ı)?|pensiya(sı)?|inflyasiya|işsizlik|əhali(si)?)(?![\p{L}])/iu;
// v78: ölkə miqyası — Azərbaycan sualında "Çində işsizlik 5,3%" cavab deyil
const OTHER_COUNTRY = /(?<![\p{L}])(çin|cin|rusiya|türkiyə|turkiye|qazaxıstan|qazaxistan|abd|abş|almaniya|fransa|hindistan|iran|gürcüstan|gurcustan|ukrayna|yaponiya|koreya)(?![\p{L}])/iu;

const HIST_SENT = /(?<![\p{L}])(əvvəl|evvel|keçmişdə|keçmiş\s+illərdə|vaxtilə|o\s+dövrdə|həmin\s+illərdə|idi|olmuşdu|imiş)(?![\p{L}])/iu;
const RECENT_SENT = /(?<![\p{L}])(indi|hazırda|hal[-\s]hazırda|bu\s+gün|bu\s+il|hazırki|cari\s+il)(?![\p{L}])/iu;

// v113: NİSBİ/DELTA ifadələri ölçü cavabı DEYİL — "hündürlüyə 50 metrə qədər əlavə olunub",
// "temperatur artdıqca 10 santimetr uzanır", "6 metrlik antena əlavə edilib".
// Bu cümlələr əsas dəyəri deyil, FƏRQİ bildirir. Qayda dil səviyyəlidir (sayta bağlı deyil).
const DELTA_RE = /(?<![\p{L}])(əlavə|elave|artır|artim|artım|azald|azalır|azalir|fərq|ferq|dəyiş|deyis|uzan|yüksəld|yuksel|enir|böyü|boyu|çoxal|cokal|qonşu|qonsu|müqayisə|muqayise|nisbətən|nisbeten|üzərində|uzerinde|yuxarıda|yuxarida|aşağıda|asagida|than|compared|versus|çatacaq|qədər\s+(də|de)\s+(yox|çox)|added|increase[sd]?|increas\p{L}*|decreas\p{L}*|up\s+to|more\s+than|taller|shorter|higher\s+by|lower\s+by|grew|grows?|rising|rose|drop|dropped|expand\p{L}*|shrink\p{L}*|добав\p{L}*|увелич\p{L}*|уменьш\p{L}*|вырос\p{L}*|снизил\p{L}*)(?![\p{L}])/iu;

const STOP = new Set(["nə", "qədər", "qeder", "nece", "neçə", "necə", "var", "vardır", "azərbaycanda", "azerbaycanda", "respublikada", "ölkədə", "olkedə", "üzrə", "haqqında", "ildə", "2024", "2025", "2026"]);

// v113: ölçü sözünün ÖZÜ entitiya deyil — "Everest hündürlüyü" sorğusunda "hündürlüyü"
// sözü hər cümlədə keçdiyi üçün başqa obyektin (Eyfel, bina) rəqəmi də "uyğun" görünürdü.
const MEASURE_SHAPE_RE = /(hundurl|hündürl|uzunl|uzun|ehali|əhali|ehalis|sahe|sahə|sahesi|mesafe|məsafə|derinl|dərinl|yasi|yaş|ceki|çəki|hecm|həcm|suret|sürət|faiz|seviyye|səviyyə|borc|gelir|gəlir|xerc|xərc|emek|əmək|pensiya|miqdar|qeder|qədər|nece|neçə|sayi|sayı|height|distance|area|population|depth|weight|volume|temperature|percent|length|высот|площад|населен|расстояни|глубин|температур|продолжительност)/iu;

function queryTerms(q) {
  return normalizeAz(String(q || ""))
    .split(/[^a-z0-9əğıöşüç]+/)
    .filter(w => w.length >= 4 && !STOP.has(w))
    .map(w => (w.length >= 7 ? w.slice(0, -2) : w.length >= 6 ? w.slice(0, -1) : w));
}

// v113: ölçü sualından ENTİTİYA ifadəsi — vikipediya axtarışı üçün
// ("Eyfel qülləsinin hündürlüyü nə qədərdir" → "Eyfel qülləsinin")
const MEASURE_STOP = new Set(["nə", "ne", "qədər", "qeder", "qədərdir", "qederdir", "neçə", "nece", "necə", "var", "vardır", "varmi", "hansı", "hansi", "çox", "cox", "bu", "bir", "how", "many", "much", "is", "the", "of", "what", "kaç", "kac", "tane", "adet"]);
export function measureWikiQuery(query = "") {
  const words = String(query || "").split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  const kept = words.filter(w => !MEASURE_STOP.has(normalizeAz(w)) && !MEASURE_SHAPE_RE.test(normalizeAz(w)));
  const phrase = (kept.length ? kept : words).slice(0, 3).join(" ").trim();
  return phrase;
}

export function matchMeasureQuery(q) {
  return MEASURE_CUE.test(String(q || ""));
}

// Mətn parçalarından (title+snippet/cəmlənmiş mətn) ölçü cavabı çıxarır.
function measurePool(text, query) {
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
  // v113: entitiya terminləri (ölçü sözü çıxılmaqla) — cümlədə ən azı biri olmalıdır
  const entityTerms = terms.filter(t => !MEASURE_SHAPE_RE.test(t));
  const famQKnown = unitFamilyOfQuery(query);
  const docNorm = normalizeAz(t);
  const docHasEntity = entityTerms.length ? entityTerms.some(tm => docNorm.includes(tm)) : false;
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
    // v113: entitiya termini varsa — SƏNƏDİN özündə olmalıdır; cümlədə olmasa da
    // paraqraf davamı sayılır (bonus verilmir). Sənəddə heç yoxdursa — cümlə atılır.
    const entHits = entityTerms.length ? entityTerms.filter(tm => ns.includes(tm)).length : 0;
    if (entityTerms.length && !entHits) {
      if (!docHasEntity) continue;
    }
    const sLower = s;
    const yrs = [...s.matchAll(/(?:19|20)\d{2}/g)].map(x => Number(x[0]));
    const maxYear = yrs.length ? Math.max(...yrs) : null;
    const cy = new Date().getFullYear();
    for (const m of sLower.matchAll(UNIT_RE)) {
      const rawNum = String(m[1]);
      // v116: minlik/onluq ayırıcıları ümumi qayda ilə oxunur ("8,848.86" → 8848.86)
      const num = parseNumberToken(rawNum);
      if (!Number.isFinite(num) || num <= 0) continue;
      // v99: UNIT_RE-də "min ton" / "min hektar" iki sözlü vahid kimi tutulur (m[2]=min, m[3]=vahid)
      const unitPrefix = String(m[2] || "").trim().toLowerCase();
      const unitBase = String(m[3] || "").toLowerCase();
      const unit = (unitPrefix ? `${unitPrefix} ${unitBase}` : unitBase).trim();
      // vahid mənasız qısa söz ola bilməz
      if (unit === "min" && !/[.,]/.test(rawNum) && num > 100) continue;
      let sc = 1 + Math.min(hits, 3) * 0.8;
      if (entHits) sc += Math.min(entHits, 2) * 0.6;   // v113: entitiya uyğunluğu siqnaldır (delta sözünü üstələməsin)
      if (/faiz|%/.test(unit)) sc += 0.3;
      // v93: sual faiz soruşmursa, "%" cavab deyil (borc → "20 % azalıb" yanlış idi)
      const isPercent = /faiz|%/.test(unit);
      if (isPercent && !wantsPercent) sc -= 1.6;
      // v113: rəqəmin ±70 simvolunda nisbi/delta ifadəsi varsa — bu FƏRQ rəqəmidir
      let isDelta = false;
      {
        const win = s.slice(Math.max(0, m.index - 70), m.index + m[0].length + 70);
        if (DELTA_RE.test(win)) { sc -= 3.0; isDelta = true; }   // "artır / əlavə / böyüyüb / uzanır" → DƏYİŞ, dəyər deyil
        // "50 metrə qədər" / "up to 50 m" — təxmini/üst hədd göstəricisi
        if (/(?<![\p{L}])qədər(?![\p{L}])/iu.test(s.slice(m.index + m[0].length, m.index + m[0].length + 14))) sc -= 0.9;
        // təxminilik sözü rəqəmin yaxınlığında — dəqiq dəyər deyil
        if (/(?<![\p{L}])(təxminən|texminen|təqribən|teqriben|yaxın|yaxin|hardasa|approximately|about|around|roughly|около|приблизительно|yaklaşık|yaklasik)(?![\p{L}])/iu.test(win)) sc -= 0.6;
        // v113: cümlədə ÖLÇÜ sözü ümumiyyətlə yoxdursa (başlıqdan götürülmüş "10 santimetr"
        // kimi parçalar) — rəqəmin ölçüyə aidliyi sübutsuzdur
        if (!MEASURE_SHAPE_RE.test(ns)) sc -= 0.8;
        // ÇƏRÇİVƏ: ölçü sözü birbaşa rəqəmdən əvvəl gəlir ("hündürlüyü 300 metr")
        const pre = normalizeAz(s.slice(Math.max(0, m.index - 28), m.index));
        if (MEASURE_SHAPE_RE.test(pre.trim().split(/[^a-z0-9əğıöşüç]+/).filter(Boolean).slice(-1)[0] || "")) sc += 0.5;
      }
      // v108: vahid ailəsi — sual "hasilat" soruşursa "metr" cavab deyil
      {
        const famU = unitFamilyOfUnit(unit);
        // v113: UYĞUNSUZ AİLƏ tam atılır (əvvəl sadəcə -2.4 bal idi və "10 100 ton"
        // hündürlük cavabının təsdiqləri siyahısına düşürdü)
        // "uzunluq" ↔ "yaş" uyğundur: "orta ömür uzunluğu 75 yaş"
        const compat = famU === famQKnown || (famQKnown === "length" && famU === "age") || (famQKnown === "age" && famU === "length");
        if (famQKnown && famU && !compat) continue;
        if (famQKnown && famU) sc += 0.8;
      }
      // v99: sualın ÖLÇÜSÜ ilə vahidin uyğunluğu — "pambıq istehsalı" soruşulanda
      // "132,5 min hektar" (əkin sahəsi) deyil, "290 min ton" (istehsal) cavabdır.
      const dimension = /(istehsal|hasilat|mehsul|yigim)/i.test(normalizeAz(String(query || "")));
      if (dimension) {
        // v107: dimensiya sözləri ÇOXDİLLİ — körpü mətni türkcə/ingiliscə/rusca ola bilər
        // ("production/üretim/производство" = istehsal; "area/alan/площадь" = sahə)
        if (/(istehsal|hasilat|məhsul|mehsul|yığım|yigim|production|output|üretim|uretim|hasat|производств|өнім)/iu.test(ns)) sc += 0.9;
        else if (/(hektar|sahə|sahe|əkilib|ekilib|\barea\b|alan|hectare|площад|аян)/iu.test(ns)) sc -= 0.9;
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
        isDelta,          // v113: nisbi/dəyişmə rəqəmi (əsas dəyər deyil)
        mw: MEASURE_SHAPE_RE.test(ns),   // v113: cümlədə ölçü sözü var (uzun mətn üçün sərt şərt)
        score: sc
      });
    }
  }
  // v109: "hansı ildə açılıb / təsis olunub / başlayıb" — ən ERKƏN tarix cavabdır
  // (sonrakı illər yenidənqurma, yenilənmə, fərman tarixləridir).
  if (/(a[çc][ıi]l[ıi]b|acilib|t[əe]sis|yarad[ıi]l[ıi]b|yaradilib|ba[şs]lay[ıi]b|baslayib|qurulub|f[əe]aliyy[əe]t[əe]\s+ba[şs]lay)/iu.test(String(query || ""))) {
    const withYear = cands.filter(c => Number(c.year) > 1900);
    if (withYear.length) {
      const minYear = Math.min(...withYear.map(c => Number(c.year)));
      for (const c of cands) {
        if (Number(c.year) === minYear) c.score += 1.2;
        else if (Number(c.year) > minYear + 3) c.score -= 0.8;
      }
    }
  }
  const pool = wantsPercent ? cands : cands.filter(c => !c.isPercent);
  if (!pool.length) return null;   // v93: faiz soruşulmayıbsa "%"-cavab verməkdənsə heç nə
  pool.sort((a, b) => b.score - a.score);
  return { pool, wantsPercent };
}

export function extractMeasure(text, query) {
  const r = measurePool(text, query);
  if (!r) return null;
  const best = r.pool[0];
  const agree = r.pool.filter(c => c.value === best.value).length;
  return { ...best, score: Math.round(best.score * 100) / 100, agree };
}

// v113: BÜTÜN namizədlər — çarpaz mənbə təsdiqi üçün
export function extractMeasureCandidates(text, query) {
  const r = measurePool(text, query);
  return r ? r.pool : [];
}

// Nəticə massivindən (title + snippet/content) ölçü cavabı çıxarır
export function extractMeasureFromResults(results = [], query = "", opts = {}) {
  // v95.1: v93-də bu funksiyada `wantsPercent` təyin olunmamışdı → 500 xətası
  // ("Azərbaycanın dövlət borcu nə qədərdir"). Qayda extractMeasure ilə eynidir.
  // v113: hər nəticədən YALNIZ ən yaxşı namizəd deyil, BÜTÜN namizədlər götürülür və
  // dəyər üzrə qruplaşdırılır — çarpaz mənbə təsdiqi (confirmations/agreement) belə çıxır.
  const qStr2 = String(query || "");
  const wantsPercent = /(?<![\p{L}])(faiz|percent|%)/iu.test(qStr2) ||
    /(işsizlik|işsizliyin|inflyasiya|səviyyə|artım|göstərici|mənfəət|rentabellik)/iu.test(qStr2);
  const all = [];
  for (const r of results) {
    const text = [r.title, r.snippet, r.content].filter(Boolean).join(". ");
    for (const h of extractMeasureCandidates(text, query)) {
      all.push({ ...h, url: r.url, title: r.title });
    }
  }
  let pool = (wantsPercent ? all : all.filter(c => !c.isPercent)).filter(c => c.score > 1.2);
  // v113: uzun mətn (vikipediya) rejimində rəqəm ÖLÇÜ sözü olan cümlədə olmalıdır —
  // məqalədəki hər hansı rəqəm (yosun 6.480 metr, bilet qiyməti) cavab olmasın
  if (opts.strict) {
    const strictPool = pool.filter(c => c.mw);
    if (strictPool.length) pool = strictPool;
  }
  // v113: DƏYİŞMƏ rəqəmləri (artım/fərq) əsas dəyər deyil — düzgün dəyər varsa tam çıxarılır
  {
    const pure = pool.filter(c => !c.isDelta);
    if (pure.length) pool = pure;
  }
  if (!pool.length) return null;   // v93: faiz soruşulmayıbsa "%"-cavab verməkdənsə heç nə

  const hostOf = (u) => {
    try {
      const h = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      const parts = h.split(".");
      const SL = new Set(["gov", "com", "org", "net", "edu", "ac", "co", "mil", "int", "biz", "info"]);
      if (parts.length > 2) return (parts[parts.length - 1].length === 2 && SL.has(parts[parts.length - 2]))
        ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
      return h;
    } catch { return ""; }
  };

  const groups = new Map();
  // v113: YAXIN dəyərlər bir qrupdur — "8848" və "8848,86" eyni faktdır (≤0,5% fərq).
  // Bu olmasa çarpaz təsdiq parçalanır və tək mənbəli səhv rəqəm yuxarı qalxırdı.
  const nearKey = (v) => {
    for (const k of groups.keys()) {
      const a = Number(k), b = Number(v);
      if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(0.5, 0.005 * Math.max(a, b))) return k;
    }
    return String(v);
  };
  for (const c of pool) {
    const k = nearKey(c.value);
    if (!groups.has(k)) groups.set(k, { value: c.value, text: c.text, hosts: new Set(), urls: new Set(), best: c, sentence: c.sentence, year: c.year });
    const g = groups.get(k);
    if (c.value > g.value) { g.value = c.value; }   // daha dəqiq dəyər saxlanılır (8848,86)
    const h = hostOf(c.url);
    if (h) g.hosts.add(h);
    if (c.url) g.urls.add(c.url);
    if (c.score > g.best.score) { g.best = c; g.sentence = c.sentence; g.year = c.year; g.text = c.text; }
  }
  // dominant vahid ailəsi: ailəsi uyğun olmayan qruplar (məs. "50 metr" vs "8848 metr") kənarda qalır
  const famQ = unitFamilyOfQuery(query);
  const list = [...groups.values()].map(g => ({
    value: g.value, text: g.text, sentence: g.sentence, year: g.year, best: g.best,
    urls: [...g.urls], hosts: [...g.hosts], count: g.hosts.size, score: g.best.score,
    sentenceScore: g.best.score,
    ok: !famQ || !unitFamilyOfUnit(g.best.unit) || unitFamilyOfUnit(g.best.unit) === famQ
  }));
  const okList = list.filter(g => g.ok);
  const useList = okList.length ? okList : list;
  // çarpaz təsdiq balı: hər əlavə MÜSTƏQİL host +0.8 (ən çoxu +2.4)
  useList.forEach(g => { g.finalScore = g.score + Math.min(2.4, (g.count - 1) * 0.8); });
  useList.sort((a, b) => b.finalScore - a.finalScore || b.count - a.count);
  const top = useList[0];
  const rivals = useList.filter(g => g.value !== top.value);
  let agreement = top.count >= 3 ? "strong" : top.count === 2 ? "medium" : "weak";
  if (rivals.some(g => g.value !== top.value)) agreement = "conflict";   // v113 (#5) qaydası ölçüdə də
  const best = { ...top.best, text: top.text, sentence: top.sentence, year: top.year,
    url: top.urls[0], sources: top.urls, agree: top.count, score: Math.round(top.score * 100) / 100 };
  best.confirmations = useList.map(g => ({ value: g.value, count: g.count, hosts: g.hosts, urls: g.urls, official: g.hosts.some(h => /\.gov\.[a-z]{2}$/.test(h)), newest_date: null }));
  best.agreement = agreement;
  best.conflicts = rivals.map(g => ({ value: g.value, count: g.count, hosts: g.hosts }));
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
// v106: TR ayları — dil körpüsü ilə gələn mətn türkcədir ("26 Şubat 1992").
// normalizeAz "ş"→"s", "ı"→"i" etdiyi üçün açarlar ASCII formadadır.
const MONTHS_TR = "ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik";
const MONTHS = `${MONTHS_AZ}|${MONTHS_EN}|${MONTHS_TR}`;
const TR_TO_AZ_MONTH = {
  ocak: "yanvar", subat: "fevral", mart: "mart", nisan: "aprel", mayis: "may",
  haziran: "iyun", temmuz: "iyul", agustos: "avqust", eylul: "sentyabr",
  ekim: "oktyabr", kasim: "noyabr", aralik: "dekabr"
};
const EN_TO_AZ_MONTH = {
  january: "yanvar", february: "fevral", march: "mart", april: "aprel", may: "may", june: "iyun",
  july: "iyul", august: "avqust", september: "sentyabr", october: "oktyabr", november: "noyabr", december: "dekabr"
};
function localizeMonth(text) {
  // TR ayları — diakritikli yazılış da ("Şubat", "Mayıs", "Ağustos")
  let out = String(text || "").replace(
    /(?<![\p{L}])(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)(?![\p{L}])/giu,
    (m) => TR_TO_AZ_MONTH[m.toLowerCase()] || TR_TO_AZ_MONTH[
      m.toLowerCase().replace(/ş/g, "s").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    ] || m
  );
  out = out.replace(
    new RegExp(`\\b(${MONTHS_EN})\\b`, "giu"),
    (m) => EN_TO_AZ_MONTH[m.toLowerCase()] || m
  );
  // "avqust 7, 2025" → "7 avqust 2025" (AZ söz sırası)
  out = out.replace(new RegExp(`^(${MONTHS_AZ})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "iu"), (m, mo, d, y) => `${d} ${mo} ${y}`);
  return out;
}
// v111: "hansı ildə" (locative) ƏVVƏL UYĞUN GƏLMİRDİ — `hansı\s+il` + `(?!\p{L})` şərti
// "ildə"-nin "də" hissəsində ilişirdi və tarix sualı ümumiyyətlə işə düşmürdü
// ("Bakı metropoliteni hansı ildə açılıb" → cavab yerinə xəbər başlığı).
const DATE_CUE = /(?<![\p{L}])(n[əe]\s*vaxt|hansı\s+il[\p{L}]*|hansi\s+il[\p{L}]*|hansı\s+vaxt[\p{L}]*|hansı\s+tarixd[əe]|hansı\s+g[üu]n[\p{L}]*|hangi\s+tarih[\p{L}]*|when)(?![\p{L}])/iu;
export function matchDateQuery(q) { return DATE_CUE.test(String(q || "")); }
// v114: sualın HADİSƏ növü (doğum, ölüm, açılış, buraxılış) cümlədə də olmalıdır.
// Ölçmə: "Heydər Əliyev nə vaxt doğulub" → az.wikipedia "Heydər Əliyev ordeni" məqaləsindən
// "28 aprel 2005" (ordenin təsis tarixi) cavab kimi verilirdi.
const EVENT_CUES = [
  { q: /(do[ğg]ul|anadan\s+ol|d[üu]nyaya\s+g[əe]l|born|birth)/iu, s: /(do[ğg]ul|anadan\s+ol|d[üu]nyaya\s+g[əe]l|born|birth)/iu },
  { q: /(v[əe]fat|vefat|[öo]l[üu]b|d[üu]nyas[ıi]n[ıi]\s+d[əe]yi[şs]|died|death)/iu, s: /(v[əe]fat|vefat|[öo]l[üu]b|d[üu]nyas[ıi]n[ıi]\s+d[əe]yi[şs]|died|death)/iu },
  { q: /(a[çc][ıi]l|t[əe]sis|yarad[ıi]l|qurul|founded|established|opened)/iu, s: /(a[çc][ıi]l[ıi]b|acilib|istifad[əe]y[əe]\s+veril|istismara\s+veril|f[əe]aliyy[əe]t[əe]\s+ba[şs]la|t[əe]sis|yarad[ıi]l|qurul|opened|inaugurated|founded|established|commissioned)/iu },
  { q: /(ç[ıi]x[dt]|burax[ıi]l|t[əe]qdim|launched|released)/iu, s: /(ç[ıi]x[dt]|burax[ıi]l|t[əe]qdim|launched|released|introduced|debuted)/iu }
];
// Sualın hadisə növünə uyğun cümlə naxışı (məqalə seçimi üçün də istifadə olunur).
export function dateEventCue(query) {
  const c = EVENT_CUES.find(x => x.q.test(String(query || "")));
  return c ? c.s : null;
}

export function extractDateAnswer(text, query) {
  const t = String(text || "");
  if (!t) return null;
  const terms = queryTerms(query);
  if (!terms.length) return null;
  // v111: cümlə bölgüsü rəqəmdən sonra kəsməməlidir — "və 9,2 km istifadəyə verilmişdir"
  // "9." + "2 km ..." kimi parçalanırdı və tarixlə cue (istifadəyə verilib) ayrı düşürdü.
  // v114: cümlə bölgüsü həm də İLƏ BAŞLAYAN parçada kəsməlidir — "…yaradılır. 1967-ci il
  // noyabrın 6-da …" tək cümlə sayılırdı və yalnız BİRİNCİ tarix (1966) namizəd olurdu;
  // Bakı metrosunun açılış ili (1967) heç namizəd siyahısına düşmürdü.
  const dateSents = t.split(/(?<=[.!?;])\s+(?=[\p{Lu}“(])|(?<=[.!?;])\s+(?=\d{1,4}(?:[\s-]|$))|\n+/u).map(s => s.replace(/\s+/g, " ").trim());
  // v99: anchor ("GPT-5", "iPhone 15") cümlədə VƏ YA QONŞU cümlədədirsə tarix cavabdır
  const anchorM0 = String(query || "").match(/(?<![\p{L}\d])([\p{L}]{2,}[-\s]?\d{1,4}|\d{1,4}[-\s]?[\p{L}]{2,})(?![\p{L}\d])/u);
  const anchorKey0 = anchorM0 ? anchorM0[1].toLowerCase().replace(/[\s-]/g, "") : null;
  const anchorIdx = new Set();
  if (anchorKey0) dateSents.forEach((s, i) => { if (normalizeAz(s).replace(/[\s-]/g, "").includes(anchorKey0)) anchorIdx.add(i); });
  const foundingQuery = /(a[çc][ıi]l[ıi]b|acilib|t[əe]sis|yarad[ıi]l[ıi]b|yaradilib|ba[şs]lay[ıi]b|baslayib|qurulub|a[çc][ıi]l[ıi][şs])/iu.test(String(query || ""));
  const eventCue = dateEventCue(query);
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
      // v111: AZ rəsmi formatı — "1967-ci il noyabrın 6-da" (il → ay → gün)
      { re: new RegExp(`((?:1[89]|20)\\d{2})-?[cş]?[ıiuü]?\\s+il\\s+(${MONTHS})[\\p{L}]*\\s+(\\d{1,2})`, "giu"), bonus: 1.3, order: "yml" },
      // v111: "noyabrın 6-da" + yaxınlıqda il (ay → gün)
      { re: new RegExp(`(${MONTHS})[\\p{L}]*\\s+(\\d{1,2})-(?:d[əea]|da|de|də|i|ı|n[ıiuü]|nin|nın)`, "giu"), bonus: 0.6, order: "md" },
      { re: new RegExp(`(\\d{1,2})\\s+(${MONTHS})\\s+(\\d{4})`, "giu"), bonus: 1.2 },
      { re: new RegExp(`(${MONTHS})\\s+(\\d{1,2})[,\\s]+(\\d{4})`, "giu"), bonus: 1.0 },
      { re: new RegExp(`(\\d{1,2})[\\s-]+(${MONTHS})`, "giu"), bonus: 0.2 },
      { re: /(\d{4})\s*-?\s*c[ıiuü]\s+il[\p{L}]*/giu, bonus: 0 },
      { re: /(\d{4})/g, bonus: -0.4 }
    ];
    let bestIn = null;
    for (const p of patterns) {
      // v106: pattern NORMALLƏŞDİRİLMİŞ mətn üzərində işləyir — türkcə "Şubat"/"Mayıs"
      // kimi hərflər ASCII açarlara uyğun gəlmirdi (dil körpüsü mətni türkcədir).
      const mm = p.re.exec(ns);
      if (!mm) continue;
      // v102: anchor EYNİ cümlədədirsə güclü bonus — qonşu cümlədəki tarix (başqa hadisə)
      // anchor cümləsindəki tarixi üstələməməlidir ("GPT-5" → 12 noyabr 2025 səhvi)
      // yalnız DƏQİQ token: "GPT-5.1"/"GPT-5.2" məqaləsindəki tarix "GPT-5 nə vaxt çıxdı"-nın
      // cavabı deyil (canlı golden: "13 avqust 2026" səhvi)
      const exactAnchorRe = anchorKey0 ? new RegExp(`${anchorKey0.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![.\\d])`, "i") : null;
      const sameSentenceAnchor = exactAnchorRe && exactAnchorRe.test(ns.replace(/[\s-]/g, "")) ? 1.5 : 0;
      const score = 1 + Math.min(hits, 3) * 0.9 + p.bonus + sameSentenceAnchor;
      if (!bestIn || score > bestIn.score) {
        // orijinal mətndən götürülür (normallaşdırma "ildə"→"ilde" kimi pozur)
        const origSpan = s.slice(mm.index, mm.index + mm[0].length);
        const dt = /\d/.test(origSpan) ? origSpan : mm[0];
        let shown = dt.replace(/\s+/g, " ").trim();
        if (p.order === "yml") {
          // "1967-ci il noyabrın 6-da" → "6 noyabr 1967"
          const y = mm[1], mo = localizeMonth(mm[2]), d = mm[3];
          shown = `${d} ${mo} ${y}`;
        } else if (p.order === "md") {
          // "noyabrın 6-da" → "6 noyabr" (il sonra yaxınlıqdan əlavə olunur)
          shown = `${mm[2]} ${localizeMonth(mm[1])}`;
        }
        bestIn = { dateText: shown, score };
      }
      if (p.bonus >= 1.0) break;   // tam tarix tapıldı
    }
    if (!bestIn) continue;
    // v81: mövzu sözü (ən uzun termin) cümlədədirsə — güclü bonus
    const topic = terms.slice().sort((a, b) => b.length - a.length)[0];
    // v82: "2 mart" + yaxınlıqda il varsa → "2 mart 1992"
    if (!/\d{4}/.test(bestIn.dateText)) {
      const around = ns.slice(Math.max(0, ns.indexOf(bestIn.dateText) - 40), ns.indexOf(bestIn.dateText) + bestIn.dateText.length + 40);
      const yr = around.match(/(?:19|20)\d{2}/);
      if (yr) bestIn.dateText = `${bestIn.dateText} ${yr[0]}`;
    }
    let sc = bestIn.score;
    if (topic && ns.includes(topic)) sc += 1.2; else if (topic) sc -= 2.5;
    // v114: məqalənin GİRİŞİ (ilk cümlələr) faktı tərif edir; sonrakı bölmələrdəki tarixlər
    // kontekst hadisələrdir. Ölçmə: en.wikipedia "GPT-5" məqaləsi → girişdə "launched on
    // August 7, 2025", "== Background ==" bölməsində "On April 14, 2023, ... was not training
    // GPT-5" — anchor eyni cümədə olduğu üçün 2023 qalib gəlirdi (4.4 vs 2.9).
    if (!foundingQuery) sc += si <= 1 ? 1.6 : (si === 2 ? 0.8 : 0);
    if (eventCue) sc += eventCue.test(ns) ? 2.2 : -1.2;
    // v114: inkar/cəhdlə bağlı cümlə cavab deyil ("şirkət o vaxt GPT-5 hazırlamırdı")
    if (/(?<![\p{L}])(not|never|no\s+longer|wasn'?t|weren'?t|isn'?t|aren'?t|didn'?t|deyil|deyildi|olmayıb|olmadı|hələ\s+yox)(?![\p{L}])/iu.test(ns)) sc -= 1.8;
    // v92: ay adı olan tam tarix ("12 noyabr 1995") yalnız ildən ("1921-ci il") üstündür
    bestIn.dateText = localizeMonth(bestIn.dateText);
    const hasMonth = new RegExp(`(${MONTHS})`, "iu").test(bestIn.dateText);
    // `full` — cue yoxlamaları üçün TAM cümlə (əvvəl 240 simvolluq kəsik yoxlanılırdı və
    // cümlənin sonundaki "istifadəyə verilir" cue-su görünmürdü).
    cands.push({ dateText: bestIn.dateText, sentence: s.slice(0, 240), full: s, score: sc, hasMonth });
  }
  if (!cands.length) return null;
  // v109: "hansı ildə açılıb / təsis olunub / fəaliyyətə başlayıb" — cavab ƏN ERKƏN ildir
  // (sonrakı tarixlər yenidənqurma, fərman, yenilənmədir). Ay olmayan il də cavab sayılır.
  const foundingQ = /(a[çc][ıi]l[ıi]b|acilib|t[əe]sis|yarad[ıi]l[ıi]b|yaradilib|ba[şs]lay[ıi]b|baslayib|qurulub|a[çc][ıi]l[ıi][şs])/iu.test(String(query || ""));
  const yearOf = (c) => { const y = String(c.dateText).match(/(?:1[89]|20)\d{2}/); return y ? Number(y[0]) : null; };
  const strong = cands.filter(c => c.hasMonth);
  let pool = strong.length ? strong : cands;
  if (foundingQ) {
    const years = cands.map(yearOf).filter(Boolean);
    if (years.length) {
      pool = cands.slice();
      // açılış/təsis cue-su olan cümlə əsasdır ("1966-cı ildə tikintisinə başlanıb" ≠ açılış)
      // v114: "istismara verilir" (rəsmi AZ işlək forması) əskik idi — Bakı metrosunun açılış
      // cümləsi cue-suz qalırdı və 2014-cü il fərman tarixi cavab verilirdi.
      const OPEN_CUE = /(a[çc][ıi]l[ıi]b|acilib|istifad[əe]y[əe]\s+veril|istismara\s+veril|istismara\s+qəbul|f[əe]aliyy[əe]t[əe]\s+ba[şs]la|t[əe]sis\s+(olun|edil)|yarad[ıi]l|iş[əe]\s+başla|işə\s+salın|opened|inaugurated|founded|established|commissioned)/iu;
      const cueOf = (c) => String(c.full || c.sentence || "");
      const anyOpen = cands.some(c => OPEN_CUE.test(cueOf(c)));
      // v114: "açılıb/təsis" cue-su olan cümlələrin ən ERKƏN ili əsasdır — məqalədə daha erkən
      // PLANLAŞDIRMA ili (1949 "tikinti bazası") cavabı oğurlayırdı.
      const openYears = cands.filter(c => OPEN_CUE.test(cueOf(c))).map(yearOf).filter(Boolean);
      const minY = Math.min(...(openYears.length ? openYears : years));
      for (const c of pool) {
        const y = yearOf(c);
        const openCue = OPEN_CUE.test(cueOf(c));
        if (anyOpen) {
          if (openCue) c.score += 2.2;
          else c.score -= 0.6;
          if (openCue && y === minY) c.score += 0.8;
        } else if (y === minY) c.score += 2.0;
        else if (y && y > minY + 5) c.score -= 1.2;
      }
    }
  }
  pool.sort((a, b) => b.score - a.score);
  if (process.env.DEBUG_DATE_ANSWERS) console.log("CANDS:", pool.slice(0, 6).map(c => `${c.score.toFixed(1)} ${c.dateText} :: ${String(c.sentence).slice(0, 60)}`));
  return { ...pool[0], score: Math.round(pool[0].score * 100) / 100, agree: pool.filter(c => c.dateText === pool[0].dateText).length };
}
export function extractDateFromResults(results = [], query = "") {
  const list = [];
  for (const r of results) {
    const text = [r.title, r.snippet, r.content].filter(Boolean).join(". ");
    const hit = extractDateAnswer(text, query);
    if (!hit) continue;
    // məqalənin ÖZÜ (URL-də dəqiq anchor: /wiki/GPT-5) mövzuya daha yaxındır — kiçik bonus
    const urlHasAnchor = (() => {
      const key = String(query || "").toLowerCase().replace(/[\s-]/g, "");
      const m = key.match(/[a-zçəğıöşü]{2,}\d{2,4}/);
      if (!m) return false;
      const u = String(r.url || "").toLowerCase().replace(/[\s_-]/g, "");
      return new RegExp(`${m[0]}(?![.\d])`).test(u);
    })();
    if (urlHasAnchor) hit.score += 0.7;
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
