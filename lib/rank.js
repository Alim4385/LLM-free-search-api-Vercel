// Azərbaycan dili üçün normalizasiya, stemming, stopword, BM25 + trigram

export const AZ_STOPWORDS = new Set([
  "ve","ile","ucun","ucundur","ucundu","bu","su","o","ne","nece","necedir","nedi","harada","kim","kimdir","kimdi",
  "hansi","hansidir","hansilardir","hansilardi","hansilar","nelerdir","nelerdi","kimlerdir","kimlerdi",
  "haqqinda","hakda","haqda","baresinde","melumat","bir","da","de","ki","kimi",
  "sonra","evvel","cunki","amma","lakin","hem","ise","ol","oldu","edir","etdi","var","yox","cox",
  "daha","en","cemi","hamisi","her","bazi","oz","men","sen","biz","siz","onlar","menim","senin",
  "onun","bizim","sizin","onlarin","burada","orada","buraya","oraya","buradan","oradan","indi",
  "dunen","sabah","gun","bugun","gunu","gunun","zaman","vaxt","qeder","son","ilk","yeni",
  "eski","bele","ele","hec","az","ozune",
  "neden","nereye","nerede","nereden","nasil","kac","nedir","hangisidir","hangileri","kactir","nin","nun","icin",
  "the","a","an","and","or","of","to","in","is","are","was","were","for","with","on","at","by","from",
  "what","how","where","when","why","who","which","this","that","it","its","as","be","been","being",
  "most","more","many","much","very","also","into","over","only","other","than","then","them","they",
  "their","there","have","has","had","will","would","could","should","about","information","used"
]);

// Azərbaycan aqqlütinativ sonluqları - ən uzun əvvəl
// v15: larla/lərlə, la/lə ("Azərbaycanla"->"azerbaycan"), dakı/dəki ("Bakıdakı"->"baki"),
// ları/ləri ("saytları"->"sayt"), ında/ində, lardır/lərdir, dır/dir əlavə olundu
const AZ_SUFFIXES = [
  "larindan","lerinden","larinda","lerinde","larla","lerle","lardan","lerden","larin","lerin",
  "lardir","lerdir","nuzdan","nizden","muzdan","mizden","sindan","sinden",
  "mizdan","muzdan","nizdan","nuzdan","sindaki","sindeki","indakı","indeki","indaki",
  "miz","mız","muz","müz","niz","nız","nuz","nüz","sin","sun","sın","sün",
  "lari","leri","daki","deki","inda","inde","unda","unde","inin","unun",
  "dan","den","tan","ten","nin","nun","nın","dir","dur","tir","tur",
  "lar","ler","la","le","da","de","ta","te","in","un",
  "si","su","sü","sı","yi","yu","yı","yü","na","ne","nu","nü","nı","ni",
  "a","e","i","u","ı","ü"
].sort((a,b)=>b.length-a.length);

export function normalizeAz(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/ə/g, "e")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ç/g, "c")
    .replace(/ş/g, "s")
    .replace(/I/g, "i")
    .replace(/İ/g, "i");
}

export function stemAz(word) {
  let w = normalizeAz(word);
  if (w.length <= 4) return w;
  for (const suf of AZ_SUFFIXES) {
    const s = normalizeAz(suf);
    if ((s === "dir" || s === "tir" || s === "dur" || s === "tur") && w.length <= 6) continue;
    if (w.length > s.length + 3 && w.endsWith(s)) {
      w = w.slice(0, -s.length);
      break; // tək sonluq atırıq, həddindən artıq kəsmirik
    }
  }
  return w;
}

export function tokenize(text = "") {
  const norm = normalizeAz(text);
  const raw = norm.match(/[a-z0-9]+/g) || [];
  return raw
    .filter(w => w.length > 1 && !AZ_STOPWORDS.has(w))
    .map(stemAz)
    .filter(w => w && w.length > 1 && !AZ_STOPWORDS.has(w));
}

export function trigrams(word) {
  const w = `  ${word} `;
  const grams = new Set();
  for (let i = 0; i < w.length - 2; i++) grams.add(w.slice(i, i + 3));
  return grams;
}

export function trigramSimilarity(a, b, preA) {
  const A = preA ?? trigrams(a), B = trigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

export function scoreParagraph(paragraph, queryTerms, idfMap, title = "", opts = null) {
  const terms = opts && opts.terms ? opts.terms : tokenize(paragraph);
  if (!terms.length) return 0;
  const tf = {};
  for (const t of terms) tf[t] = (tf[t] || 0) + 1;
  const len = terms.length;
  const avgLen = 80;
  const k1 = 1.5, b = 0.75;
  let score = 0;

  const titleTerms = opts && opts.titleTerms ? opts.titleTerms : new Set(tokenize(title));
  const qtGrams = opts && opts.qtGrams ? opts.qtGrams : null;

  for (const qt of queryTerms) {
    const idf = idfMap.get(qt) || 1;
    let termScore = 0;
    if (tf[qt]) {
      const f = tf[qt];
      termScore = idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len / avgLen));
    } else {
      let best = 0;
      const grams = qtGrams ? qtGrams.get(qt) : null;
      for (const t of Object.keys(tf)) {
        const sim = trigramSimilarity(qt, t, grams);
        if (sim > best) best = sim;
      }
      if (best > 0.45) termScore = idf * best * 0.6;
    }
    if (titleTerms.has(qt)) termScore += 2.5;
    score += termScore;
  }
  // v15/v16: rəqəm/fakt suallarında rəqəm daşıyan abzaslara və strukturlaşmış cədvəl bloklarına bonus
  if (opts && opts.wantsNumbers && /\d/.test(paragraph)) {
    score *= 1.18;
  }
  if (paragraph.includes(" — ") && paragraph.split("\n").length >= 4) {
    score = Math.max(score * 1.25, 3.2);
  }
  return score;
}

export function buildIdf(paragraphs, queryTerms, paraTokens) {
  const map = new Map();
  const N = Math.max(paragraphs.length, 1);
  const sets = (paraTokens ? paraTokens : paragraphs.map(p => tokenize(p))).map(t => new Set(t));
  for (const qt of queryTerms) {
    let df = 0;
    for (const s of sets) if (s.has(qt)) df++;
    map.set(qt, Math.log(1 + (N - df + 0.5) / (df + 0.5)) + 1);
  }
  return map;
}

const NUMBER_QUERY_RE = /\b(neçə|neçədir|nece|nə\s+qədər|limiti?|limit|timeout|əhali\w*|sahə\w*|qiymət\w*|məzənnə\w*|faiz|il|tarix|nə\s+vaxt|kaç|kaçtır|how\s+many|how\s+much|population|when)\b/iu;

export function selectRelevantParagraphs(text, query, title = "", maxChars = 1800) {
  if (!text) return "";
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length) return text.slice(0, maxChars);

  // v15: əvvəl 40 simvoldan qısa bütün sətirlər atılırdı — siyahı elementləri
  // ("1. Google (google.com) — 84B") və infobox faktları ("Əhalisi: 2,3 milyon") itirdi.
  // İndi: siyahı/fakt sətirləri >=18 simvoldan etibarən qorunur; ardıcıl qısa siyahı
  // sətirləri isə vahid blok kimi birləşdirilir ki, bütöv siyahı gəlsin.
  // v15/v16: cədvəl sətirlərini ("Google Search — google.com — 1...") də vahid siyahı bloku kimi saxla
  const rawBlocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const paras = [];
  for (const blk of rawBlocks) {
    const lines = blk.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const dashRows = lines.filter(l => l.includes(" — ")).length;
    if (dashRows >= 4 && blk.length > 900) {
      // Böyük Wikipedia cədvəlinin ən vacib ilk 15 sətirini vahid blok kimi saxla ki, büdcəyə yerləşsin
      paras.push(lines.slice(0, 16).join("\n"));
    } else if (blk.length <= 1800 && blk.length >= 25) {
      paras.push(blk);
    } else {
      for (const s of lines) {
        const isFactOrList = /^(?:\d+[.)]\s+|[-•*]\s+|[\p{L}\s_]{2,30}:\s+\S)/u.test(s) || s.includes(" — ");
        if ((s.length > 35 || (isFactOrList && s.length >= 16)) && s.length < 2000) {
          paras.push(s);
        }
      }
    }
  }

  if (!paras.length) return text.slice(0, maxChars);

  const wantsNumbers = NUMBER_QUERY_RE.test(query);
  const paraTokens = paras.map(p => tokenize(p));
  const titleTerms = new Set(tokenize(title));
  const qtGrams = new Map(queryTerms.map(qt => [qt, trigrams(qt)]));
  const idf = buildIdf(paras, queryTerms, paraTokens);
  const scored = paras.map((p, idx) => ({
    p,
    score: scoreParagraph(p, queryTerms, idf, title, {
      terms: paraTokens[idx],
      titleTerms,
      qtGrams,
      wantsNumbers
    }) * (1 + 1 / (idx + 2)),
    idx
  })).filter(x => x.score > 0.3)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return paras.slice(0, 2).join("\n\n").slice(0, maxChars);
  }

  const topScore = scored[0].score;
  const minRelScore = topScore >= 3.5 ? topScore * 0.42 : 0.3;
  const chosen = [];
  let total = 0;
  for (const s of scored) {
    if (chosen.length >= 1 && s.score < minRelScore) continue;
    if (total + s.p.length > maxChars) continue;
    chosen.push(s);
    total += s.p.length;
    if (chosen.length >= 5) break;
  }
  if (!chosen.length) {
    return scored[0].p.slice(0, maxChars);
  }
  chosen.sort((a, b) => a.idx - b.idx);
  return chosen.map(c => c.p).join("\n\n").slice(0, maxChars);
}
