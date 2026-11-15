// v12 + v15: Content hygiene — junk pattern cleaner, AZ xəbər şablon təmizləyicisi,
// təkrarlanan sətir/söz filtri, reklam linki təmizliyi (həqiqi sayt adları QORUNUR)
import { tokenize, trigramSimilarity, trigrams } from "./rank.js";

// [[wikilink|display]] → display, [[wikilink]] → wikilink
const WIKILINK_RE = /\[\[([^\|\]]*)(?:\|([^\]]+))?\]\]/g;
// [1] [12] — wiki citation markerləri
const CITATION_RE = /\[\d{1,4}\]/g;
// [edit] [citation needed] [t] [v] [s] [b] [top] [add] — wiki inline links
const WIKI_INLINE_RE = /\[(?:edit|citation needed|top|add|[vtbsb])\]/gi;

// v15 (Alim tapıntısı): reklam / izləmə / sosial kanal dəvət linkləri silinir,
// amma həqiqi məlumat linkləri və domen adları (google.com, youtube.com, nextjs.org və s.) QALIR!
const AD_PROMO_URL_RE = /https?:\/\/(?:[^\s/]*\.)?(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.[a-z.]+|bit\.ly|tinyurl\.com|cutt\.ly|clck\.ru|adf\.ly|t\.me\/(?:\+|joinchat)|wa\.me\/|chat\.whatsapp\.com)[^\s)]*/gi;
const TRACKING_QS_RE = /(https?:\/\/[^\s?#]+)\?(?:utm_[^&\s]+|fbclid=[^&\s]+|gclid=[^&\s]+|yclid=[^&\s]+)(?:&[^\s)]*)?/gi;

// v15 (Alim tapıntısı): Azərbaycan xəbər saytlarının şablon girişləri —
// "Oxu.Az xəbər verir ki, sabah..." -> "Sabah...", "Milli.Az Trend-ə istinadən xəbər verir ki, ..." -> "..."
const AZ_NEWS_LEAD_RE = /^(?:["«„]?\s*)?(?:[A-ZƏÖÜĞÇŞİa-zəöüğçşı0-9_-]+\.(?:az|com|ws|info|net|org|tv)\b[\s,:-]*)?(?:[A-ZƏÖÜĞÇŞİa-zəöüğçşı0-9."«»\s-]{2,45}?\bistinadən\s+)?(?:[A-ZƏÖÜĞÇŞİa-zəöüğçşı0-9_-]+\.(?:az|com|ws|info|net|org|tv)\s+)?(?:xəbər\s+verir\s+ki|məlumat\s+verir\s+ki|bildirir\s+ki)\s*[,:-]?\s*/iu;

// Tamamilə atılmalı promo / sosial çağırış sətirləri (məlumat daşımır)
const PROMO_LINE_RE = /(?:bizi\s+(?:telegram|instagram|facebook|tiktok|youtube|whatsapp)[-\sdaə]*\s*izləyin|telegram\s+kanalımıza\s+abunə|kanala\s+abunə\s+olun|whatsapp\s+kanalımıza\s+qoşulun|həmçinin\s+oxuyun\s*:|oxşar\s+xəbərlər\s*:|daha\s+ətraflı\s+videoda|videonu\s+تəqdim\s+edirik|reklam\s+yerləşdirmək\s+üçün)/iu;

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

const AZ_TR_BOILERPLATE = /^(Mənbələr|Mənbə|Mətnin mənbələri|İstinadlar|Bax:|Bax da|Bax\b|Görüntülər|Maraqlı faktlar|Xarici keçidlər|Kategoriyalar?|Related|References|Bibliography|See also|Further reading|External links|Notes|Table of contents|İçindəkilər|İçəridəkilər|Menu|Ana səhifə|Edit this page|Share|Reklamlar|Reklam|Cookie|Cookies|Abunə ol|Subscribe|Advertisement|Sponsored)\s*:?$/i;

// v15 (Alim tapıntısı): eyni sətirdə həddən artıq təkrarlanan söz yığını (tag cloud / nav təkrarı)
// Məs: "Bakı xəbər Bakı son xəbər Bakı xəbərlər Bakı bu gün" -> 8+ sözdə unikallıq < 38%
function isWordSaladLine(s) {
  const words = s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu);
  if (!words || words.length < 8) return false;
  const uniq = new Set(words);
  return uniq.size / words.length < 0.38;
}

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
  // promo / kanal abunə çağırışları (qısa/orta sətir)
  if (n < 160 && PROMO_LINE_RE.test(s)) return true;
  // təkrarlanan söz yığını (tag cloud / nav spam)
  if (isWordSaladLine(s)) return true;
  // copyright sətirləri: © ...
  if (s.startsWith("\u00A9") || s.startsWith("(c)")) return true;
  return false;
}

function stripNewsLeadIn(line) {
  const stripped = line.replace(AZ_NEWS_LEAD_RE, "");
  if (stripped === line) return line;
  if (stripped.length < 15) return ""; // təkcə "Oxu.Az xəbər verir ki" idisə at
  return stripped[0].toUpperCase() + stripped.slice(1);
}

/**
 * Məzmunu junk pattern-lərdən təmizləyir:
 * wiki sitatları, wikilinks, cədvəl/tarix/symbol-soup sətirləri, boilerplate başlıqlar,
 * AZ xəbər şablon girişləri ("?.az xəbər verir ki,"), reklam linkləri və təkrarlanan sətirlər.
 * Təmiz mətni və həqiqi sayt/domen adlarını DƏYİŞMİR (idempotent, deterministik).
 */
export function cleanContent(text = "") {
  let t = String(text || "");
  if (!t.trim()) return "";
  t = t.replace(WIKILINK_RE, (_, a, b) => (b || a || "").trim());
  t = t.replace(CITATION_RE, " ").replace(WIKI_INLINE_RE, " ");
  // Reklam linklərini sil, həqiqi URL-lərdəki utm/fbclid quyruğunu təmizlə (link özü qalsın!)
  t = t.replace(AD_PROMO_URL_RE, " ");
  t = t.replace(TRACKING_QS_RE, "$1");
  const kept = [];
  let prev = null;
  const seenLongLines = new Set();
  for (const raw of t.split("\n")) {
    let ln = raw.trim().replace(/\s{2,}/g, " ").trim();
    ln = stripNewsLeadIn(ln).trim();
    if (isJunkLine(ln)) continue;
    // arx-arxaya tam eyni sətir (nav/TOC təkrarı)
    if (ln === prev) continue;
    // Mətn boyunca təkrarlanan eyni uzun sətirləri sil (20+ simvol)
    if (ln.length >= 20) {
      const fp = ln.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      if (fp.length >= 15) {
        if (seenLongLines.has(fp)) continue;
        seenLongLines.add(fp);
      }
    }
    prev = ln;
    kept.push(ln);
  }
  return kept.join("\n").replace(/ {2,}/g, " ").trim();
}

/**
 * Cavab cümləsi seçimi: query terms-ə ən çox uyğun cümləni qaytarır.
 */
export function pickAnswer(text = "", query = "", maxChars = 320) {
  const t = cleanContent(text);
  if (!t) return "";
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  let sents = [];
  for (const ln of lines) {
    sents.push(...ln.split(/(?<=[.!?…])\s+(?=[A-ZƏÖÜĞÇŞİ0-9"«(‘'])/).map(s => s.trim()));
  }
  sents = sents.filter(s => s.length >= 20 && s.length <= 600);
  if (!sents.length) return t.slice(0, maxChars);
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length) return sents[0].slice(0, maxChars);
  const qGrams = new Map(qTerms.map(qt => [qt, trigrams(qt)]));
  let best = null, bestScore = -1;
  for (const s of sents) {
    const sTerms = new Set(tokenize(s));
    let sc = 0;
    for (const qt of qTerms) {
      if (sTerms.has(qt)) { sc += 2; continue; }
      let fb = 0;
      const grams = qGrams.get(qt);
      for (const st of sTerms) {
        const sim = trigramSimilarity(qt, st, grams);
        if (sim > fb) fb = sim;
      }
      if (fb >= 0.7) sc += 1;
    }
    if (sc > bestScore) { bestScore = sc; best = s; }
  }
  if (!best || bestScore <= 0) {
    best = sents.reduce((a, b) => (a.length >= b.length ? a : b));
  }
  return best.slice(0, maxChars);
}

// v15: "ə" olmayan AZ sorğularını TR/EN-dən düzgün ayırmaq üçün (məs. "Bakı haqqında", "hansılardır")
const AZ_SPECIFIC_RE = /(?:\b(?:bak[ıi]|haqq[ıi]nda|hans[ıi]\w*|üçün|ucun|manat|q[ıi]z[ıi]l|limiti|necə|nece|harada|niyə|niye)\b|[qxQX])/u;

/**
 * Sorğunun dilini başa düşür (az/tr/en).
 * ə/Ə = AZ-ın unikal işarəsidir (TR-də yoxdur) → əvvəl yoxla.
 * Sonra AZ-spesifik söz/hərflər (q, x TR əlifbasında yoxdur).
 * Sonra türk-unik xarakterlər (şğüöçİı).
 */
export function detectQueryLanguage(query = "") {
  const q = String(query || "");
  if (q.includes("\u0259") || q.includes("\u018f")) return "az";
  if (/[şğüöçİı]/u.test(q)) {
    if (AZ_SPECIFIC_RE.test(q)) return "az";
    return "tr";
  }
  if (/\b(?:bakida|baki|azerbaycan\w*|haqqinda|hansilardir|mezennesi|limiti|qiymeti|necedir|nedir)\b/i.test(q)) return "az";
  return "en";
}

/**
 * Wikipedia /wiki/Title URL → TextExtracts API URL.
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
    if (/^(File|Fayl|Wikipediya|Vikipediya|Wikipedia|Category|Kategori|Kategoriya|Help|Help:|Portal|Template|Şablon|MediaWiki|Spesial|Special|Media|File|Fayl):/i.test(title)) return null;
    const lang = m[1].toLowerCase();
    return `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
  } catch {
    return null;
  }
}

// v14 (user review #4): snippet-i SÖZ SƏRHƏDİNDƏ kəs
export function cutWord(text, max = 200) {
  const s = String(text || "");
  if (s.length <= max) return s;
  const sliced = s.slice(0, max);
  const lastSpace = sliced.lastIndexOf(" ");
  const cut = (lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced).trimEnd();
  return cut + "…";
}
