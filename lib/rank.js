// Azərbaycan dili üçün normalizasiya, stemming, stopword, BM25 + trigram

export const AZ_STOPWORDS = new Set([
  "ve","ile","ucun","bu","su","o","ne","nece","harada","kim","hansi","bir","da","de","ki","kimi",
  "sonra","evvel","cunki","amma","lakin","hem","ise","ol","oldu","edir","etdi","var","yox","cox",
  "daha","en","cemi","hamisi","her","bazi","oz","men","sen","biz","siz","onlar","menim","senin",
  "onun","bizim","sizin","onlarin","burada","orada","buraya","oraya","buradan","oradan","indi",
  "dunen","sabah","gun","bugun","gunu","gunun","zaman","vaxt","kimi","qeder","son","ilk","yeni",
  "eski","bele","ele","hec","cox","az","daha","en","cemi","hamisi","her","bazi","oz","ozune",
  "men","sen","o","biz","siz","onlar","bu","su","o","ne","nece","harada","kim","hansi","neden",
  "nereye","nerede","nereden","ne zaman","nasil","kac","kac","hansi","kim","ne","nedir","nelerdir",
  "the","a","an","and","or","of","to","in","is","are","was","were","for","with","on","at","by","from",
  "what","how","where","when","why","who","which","this","that","it","its","as","be","been","being"
]);

// Azərbaycan aqqlütinativ sonluqları - ən uzun əvvəl
const AZ_SUFFIXES = [
  "lardan","lerden","larin","lerin","nuzdan","nizden","muzdan","mizden","sindan","sinden",
  "mizdan","mizden","muzdan","muzden","nizdan","nizden","nuzdan","nuzden",
  "miz","mız","muz","müz","niz","nız","nuz","nüz","sin","sun","sın","sün",
  "dan","den","tan","ten","nin","nun","nın","nun","nin","nun","nın",
  "lar","ler","a","e","i","u","ı","ü","da","de","ta","te","m","n","k",
  "si","su","sü","sı","yi","yu","yı","yü","na","ne","nu","nü","nı","ni"
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
    .filter(Boolean);
}

export function trigrams(word) {
  const w = `  ${word} `;
  const grams = new Set();
  for (let i = 0; i < w.length - 2; i++) grams.add(w.slice(i, i + 3));
  return grams;
}

// v12.3 perf: preA — A-nın öncədən hesablanmış trigram Set-i (hər müqayisədə
// yeni Set qurmaq yerine 1 dəfə hesabla, bütün müqayisələrə ver).
export function trigramSimilarity(a, b, preA) {
  const A = preA ?? trigrams(a), B = trigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

// BM25 bənzəri skor: hər abzas üçün
// v12.3 perf: opts — { terms, titleTerms, qtGrams } öncədən hesablanmış
// strukturlar (hamısı optional; verilməyəndə köhnə yol: öz-özünə tokenizə).
export function scoreParagraph(paragraph, queryTerms, idfMap, title = "", opts = null) {
  const terms = opts && opts.terms ? opts.terms : tokenize(paragraph);
  if (!terms.length) return 0;
  const tf = {};
  for (const t of terms) tf[t] = (tf[t] || 0) + 1;
  const len = terms.length;
  const avgLen = 80; // təxmini orta uzunluq
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
      // fuzzy: trigram ilə ən yaxın sözü axtar (qt gram-ı 1 dəfə hesablanır)
      let best = 0;
      const grams = qtGrams ? qtGrams.get(qt) : null;
      for (const t of Object.keys(tf)) {
        const sim = trigramSimilarity(qt, t, grams);
        if (sim > best) best = sim;
      }
      if (best > 0.45) termScore = idf * best * 0.6;
    }
    if (titleTerms.has(qt)) termScore += 2.5; // başlıqda varsa güclü bonus
    score += termScore;
  }
  return score;
}

// v12.3 perf: paraTokens — hər abzasın ONCE tokenizə olunmuş termini
// (köhnə yol: hər query term × hər abzas = N*M tokenizə idi).
export function buildIdf(paragraphs, queryTerms, paraTokens) {
  const map = new Map();
  const N = Math.max(paragraphs.length, 1);
  const sets = (paraTokens ? paraTokens : paragraphs.map(p => tokenize(p))).map(t => new Set(t));
  for (const qt of queryTerms) {
    let df = 0;
    for (const s of sets) if (s.has(qt)) df++;
    // sadə IDF: nadir söz daha dəyərlidir
    map.set(qt, Math.log(1 + (N - df + 0.5) / (df + 0.5)) + 1);
  }
  return map;
}

export function selectRelevantParagraphs(text, query, title = "", maxChars = 1800) {
  if (!text) return "";
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length) return text.slice(0, maxChars);

  // Abzaslara böl
  const paras = text
    .split(/\n{2,}|\r?\n/)
    .map(p => p.trim())
    .filter(p => p.length > 40 && p.length < 2000);

  if (!paras.length) return text.slice(0, maxChars);

  // v12.3 perf: hər abzası 1 DEFE tokenizə et — köhnə kod buildIdf-də
  // (queryTerms × paras) və scoreParagraph-da (paras) eyni abzası yenidən
  // tokenizə edirdi: 5 term × 20 abzas = 120 tokenizə → indi 20.
  const paraTokens = paras.map(p => tokenize(p));
  const titleTerms = new Set(tokenize(title));
  const qtGrams = new Map(queryTerms.map(qt => [qt, trigrams(qt)]));
  const idf = buildIdf(paras, queryTerms, paraTokens);
  const scored = paras.map((p, idx) => ({
    p,
    score: scoreParagraph(p, queryTerms, idf, title, {
      terms: paraTokens[idx],
      titleTerms,
      qtGrams
    }) * (1 + 1 / (idx + 2)), // əvvəlki abzaslara kiçik bonus
    idx
  })).filter(x => x.score > 0.3)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    // heç nə tapılmadısa ilk 2 abzas
    return paras.slice(0, 2).join("\n\n").slice(0, maxChars);
  }

  const chosen = [];
  let total = 0;
  for (const s of scored) {
    if (total + s.p.length > maxChars) continue;
    chosen.push(s);
    total += s.p.length;
    if (chosen.length >= 5) break;
  }
  if (!chosen.length) {
    // v10 🔴4: bütün abzaslar maxChars-dan uzun olduqda `continue` hamısını atırdı
    // və chosen boş qalırdı → "" qayıdırdı (LLM-ə 0 məzmun gedirdi).
    // Həll: ən yüksək skorda olan abzasın BAŞLADIQINI götür
    return scored[0].p.slice(0, maxChars);
  }
  chosen.sort((a, b) => a.idx - b.idx); // orijinal sırayla qaytar
  return chosen.map(c => c.p).join("\n\n").slice(0, maxChars);
}
