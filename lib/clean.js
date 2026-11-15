// v12: Content hygiene — junk pattern cleaner + answer-sentence selection
// Taktika mənbələri (GitHub/MD research):
// - Wikipedia TextExtracts API (StackOverflow konsensus + Apify scraper): HTML scrape
//   əvəzinə API ilə TƏMİZ plain text al → [n]/[edit]/TOC yoxdur (wikiExtractUrl)
// - SearXNG tracker_removal plugin modeli: post-filter pipeline — URL/param təmizliyi
//   kimi məzmun da post-filter olunur (cleanContent)
// - sanenotes issue #708: snippet ~120-300 char, BEST MATCH-ın ətrafında, ilk N char DEYİL
// - QA sistemləri (TF-IDF passage→sentence): cavab = query terms-ə ən çox uyğun cümlə
import { tokenize, trigramSimilarity } from "./rank.js";

// [[wikilink|display]] → display, [[wikilink]] → wikilink
const WIKILINK_RE = /\[\[([^\|\]]*)(?:\|([^\]]+))?\]\]/g;
// [1] [12] — wiki citation markerləri
const CITATION_RE = /\[\d{1,4}\]/g;
// [edit] [citation needed] [t] [v] [s] [b] [top] [add] — wiki inline links
const WIKI_INLINE_RE = /\[(?:edit|citation needed|top|add|[vtbsb])\]/gi;

// Böyük hərflərin (latin + latn extended + kyirilik) sayı - dil-agnostik "hərf" sayı
function letterCount(s) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) ||
        (c >= 0xc0 && c <= 0x24f) || (c >= 0x400 && c <= 0x4ff) ||
        (c >= 0x100 && c <= 0x17f) || (c >= 0x180 && c <= 0x24f)) n++;
  }
  return n;
}

// Böyük hərflərin (latin + latn extended + kyirilik) sayı - dil-agnostik "hərf" sayı
const AZ_TR_BOILERPLATE = /^(Mənbələr|Mənbə|Mətnin mənbələri|İstinadlar|Bax:|Bax da|Bax\b|Görüntülər|Maraqlı faktlar|Xarici keçidlər|Kategoriyalar?|Related|References|Bibliography|See also|Further reading|External links|Notes|Table of contents|İçindəkilər|İçəridəkilər|Menu|Ana səhifə|Edit this page|Share|Reklamlar|Reklam|Cookie|Cookies)\s*:?$/i;

// Tək sətirin junk olub-olmadığına qərar
function isJunkLine(s) {
  if (!s) return true;
  const n = s.length;
  if (n < 1) return true;
  // horizontal line / pipe çirki: ------  |||---|||
  if (/^[|\-=_*]{3,}$/.test(s)) return true;
  // cədvəl sətiri: 3+ pipe (plain text-də pipe-dən başqa məzmun demək olar ki, cədvəldir)
  let pipes = 0;
  for (const ch of s) if (ch === "|") pipes++;
  if (pipes >= 3) return true;
  // tək tarix/sayı zibilliyi: 12.12.2025, 2025, 10.5, 01/02/2025
  if (n >= 3 && n <= 25 && /^[\d\s/.:;\-–—()]+$/.test(s)) return true;
  // symbol soup: 5+ char sətir, hərf payı < 20% (big.az "|||§§§" halları)
  if (n >= 5 && letterCount(s) / n < 0.2) return true;
  // boilerplate başlıqlar (tək, qısa sətir)
  if (n < 60 && AZ_TR_BOILERPLATE.test(s)) return true;
  // copyright sətirləri: © ...
  if (s.startsWith("\u00A9") || s.startsWith("(c)")) return true;
  return false;
}

/**
 * Məzmunu junk pattern-lərdən təmizləyir:
 * wiki sitatları, wikilinks, cədvəl/tarix/symbol-soup sətirləri, boilerplate başlıqlar.
 * Təmiz mətni DƏYİŞMİR (idempotent, deterministik).
 */
export function cleanContent(text = "") {
  let t = String(text || "");
  if (!t.trim()) return "";
  t = t.replace(WIKILINK_RE, (_, a, b) => (b || a || "").trim());
  t = t.replace(CITATION_RE, " ").replace(WIKI_INLINE_RE, " ");
  const kept = [];
  let prev = null;
  for (const raw of t.split("\n")) {
    const ln = raw.trim().replace(/\s{2,}/g, " ").trim();
    if (isJunkLine(ln)) continue;
    // arx-arxaya tam eyni sətir (nav/TOC təkrarı)
    if (ln === prev) continue;
    prev = ln;
    kept.push(ln);
  }
  // double-space collapse (silinmiş markerlərdən artıq boşluqlar)
  return kept.join("\n").replace(/ {2,}/g, " ").trim();
}

/**
 * Cavab cümləsi seçimi: query terms-ə ən çox uyğun cümləni qaytarır.
 * "Səhifə adı gəlir, cavab gəlmir" problemi üçün — content-ın İLK xaraktları
 * (adətən nav/TOC/cədvəl) əvəzinə həqiqi cavab cümləsi.
 * Term tapılmasa ən uzun (əlavə) cümlə qaytarılır.
 */
export function pickAnswer(text = "", query = "", maxChars = 320) {
  const t = cleanContent(text);
  if (!t) return "";
  // ƏVVƏL sətirlərə (TOC/nav blokları ayrı sətirdədir — bütöv blok "cümlə" sayılmamalı),
  // SONRA hər sətiri cümlələrə böl: . ! ? … ardınca BOŞLUQ + kapital rəqəm/hərflə
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  let sents = [];
  for (const ln of lines) {
    sents.push(...ln.split(/(?<=[.!?…])\s+(?=[A-Z0-9"«(‘'])/).map(s => s.trim()));
  }
  sents = sents.filter(s => s.length >= 20 && s.length <= 600);
  if (!sents.length) return t.slice(0, maxChars);
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length) return sents[0].slice(0, maxChars);
  let best = null, bestScore = -1;
  for (const s of sents) {
    const sTerms = new Set(tokenize(s));
    let sc = 0;
    for (const qt of qTerms) {
      if (sTerms.has(qt)) { sc += 2; continue; }
      let fb = 0;
      for (const st of sTerms) {
        const sim = trigramSimilarity(qt, st);
        if (sim > fb) fb = sim;
      }
      if (fb >= 0.7) sc += 1;
    }
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  if (!best || bestScore <= 0) {
    // heç cümlədə term yoxdur → ən uzun cümlə (ən çox məzmun ehtimalı)
    best = sents.reduce((a, b) => (a.length >= b.length ? a : b));
  }
  return best.slice(0, maxChars);
}

/**
 * Sorğunun dilini başa düşür (az/tr/en).
 * ə/Ə = AZ-ın YAXSIZ işaretidir (TR-də yoxdur) → əvvəl yoxla.
 * Sonra turk-unik xarakterlər (şğıüöçİ). Sonra ı (TR/AZ-ıq, EN-də heç vaxt).
 */
export function detectQueryLanguage(query = "") {
  const q = String(query || "");
  if (q.includes("ə") || q.includes("Ə")) return "az";
  if (/[şşğğüüööççİ]/.test(q)) return "tr";
  if (/ı/.test(q)) return "tr";
  return "en";
}

/**
 * Wikipedia /wiki/Title URL → TextExtracts API URL.
 * API (action=query&prop=extracts&exintro&explaintext) TƏMİZ intro text qaytarır:
 * heç bir [n]/[edit]/TOC/infobox yoxdur. null = bu URL wiki məqaləsi deyil
 * (File:/Category:/anasəhifə) və ya qeyri-wiki host.
 */
export function wikiExtractUrl(url) {
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z-]{2,})\.wikipedia\.org$/i);
    if (!m) return null;
    if (!u.pathname.startsWith("/wiki/") || u.pathname.length <= 6) return null;
    let title;
    try { title = decodeURIComponent(u.pathname.slice(6)).replace(/_/g, " ").trim(); } catch { return null; }
    if (!title) return null;
    // qeyri-məqalə səhifələri (extracts boş qaytarar) → null
    if (/^(File|Fayl|Wikipediya|Vikipediya|Wikipedia|Category|Kategori|Kategoriya|Help|Help:|Portal|Template|Şablon|MediaWiki|Spesial|Special|Media|File|Fayl):/i.test(title)) return null;
    const lang = m[1].toLowerCase();
    // exchars MAX 1200 (MediaWiki limiti; 8000 verdiysə API "missing" qaytarır)
    return `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&exchars=1200&titles=${encodeURIComponent(title)}`;
  } catch {
    return null;
  }
}
