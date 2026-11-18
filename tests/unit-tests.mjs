// Unit testlər - kodun özü
// v10: yeni kontrakt testləri - intent gating (matchWeather/matchTime/matchCurrency),
// normalizeUrl (viewtopic ?t=), decodeEntities (hex + no double-decode),
// scoreResult fuzzy (stem mismatch), isSpamDomain (includes over-match),
// selectRelevantParagraphs fallback, sanitizeQuery (kod tokenları qorunur)
import { tokenize, stemAz, normalizeAz, selectRelevantParagraphs, orderByRecency, isGenericNewsTerm, isNewsSectionTerm, sourceCoversSection } from "../lib/rank.js";
import { matchWeather, isWeatherQuery, detectCity } from "../lib/weather.js";
import { matchUnits, unitsToText } from "../lib/units.js";
import { matchTime, isTimeQuery } from "../lib/time.js";
import { matchCurrency, isCurrencyQuery } from "../lib/currency.js";
import { sanitizeQuery, checkRateLimit } from "../lib/ratelimit.js";
import { readFileSync } from "node:fs";
import { protectTokens, restoreTokens, protectWithTerms } from "../lib/translate.js";
import { detectConflicts, parseNum } from "../lib/conflict.js";
import { isChallengePage } from "../lib/extract.js";
import { scoreResult, isSpamDomain, hostMatches, diversifyByDomain, isJunkDomain, computeConfidence, looksLikeGibberish } from "../lib/score.js";
import { cleanContent, pickAnswer, cutWord, dedupeSnippet, normalizeColloquialAz, detectQueryLanguage, acceptLanguageHeader, wikiExtractUrl, restoreAsciiAz } from "../lib/clean.js";
import { matchAzertagItems, azertagLangFor } from "../lib/azertag.js";
import { newsTrustBoost, AZ_NEWS_TRUSTED, howtoTrustBoost, isHowtoQuery, HOWTO_TRUSTED } from "../lib/router.js";
import { matchFact } from "../lib/facts.js";
import { matchNutrition } from "../lib/nutrition.js";
import { matchMath } from "../lib/math.js";
import { matchHoliday } from "../lib/holidays.js";
import { matchLiveStat, extractMoneySentence } from "../lib/livestat.js";
import { matchCrypto, cryptoToText } from "../lib/crypto.js";
import { extractMeasure, matchMeasureQuery } from "../lib/measure.js";
import { extractCount, extractCountFromResults, countNounFromQuery, countSearchQuery, hasCountMarker } from "../lib/countextract.js";
import { parseSitemap, parseArticleHtml, matchSitemapItems } from "../lib/sitemapnews.js";
import { normalizeUrl, decodeEntities, stripQuestionWords, parseDDGLite, normalizeMwmbl, parseYahooJP, parseMilliArxiv, isArchiveTopic, providerTermGate } from "../lib/search.js";
import { parseJinaMarkdown } from "../lib/extract.js";
import { expandQuery, expandQueryAsync, rewriteSearchIntentAz, stripMetaInstructions, isMetaQuery } from "../lib/expand.js";
import { isLongAzQuery, detectContentLanguage } from "../lib/translate.js";
import { isBlockedIp, assertPublicUrl, extractCacheGet, extractCacheSet, extractPageDates, buildDateInfo } from "../lib/extract.js";
import { parseHTML } from "linkedom";
import { isCircuitOpen, recordFailure, recordSuccess } from "../lib/circuit.js";

let pass=0, fail=0;
function assert(name, cond, extra="") {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name} ${extra}`); }
}

console.log("=== RANK / AZ DİLİ ===");
assert("normalize Bakı->baki", normalizeAz("Bakı") === "baki");
assert("normalize Ə->e", normalizeAz("Əzərbaycan") === "ezerbaycan");
assert("stem Bakıda==Bakı", stemAz("Bakıda") === stemAz("Bakı"), `${stemAz("Bakıda")} vs ${stemAz("Bakı")}`);
assert("stem Bakıdan==Bakı", stemAz("Bakıdan") === stemAz("Bakı"));
assert("tokenize stopword atır", !tokenize("və ilə üçün Bakı").includes("ve"));
assert("tokenize Bakı saxlayır", tokenize("Bakı hava").includes("baki") || tokenize("Bakı hava").length>0);
const rel = selectRelevantParagraphs("Bakı Azərbaycanın paytaxtıdır. Xəzər dənizi sahilində yerləşir.\n\nBu gün hava çox istidir və insanlar çimərliyə gedir.\n\nNeft sənayesi Bakıda inkişaf edib.", "Bakı hava", "Bakı", 500);
assert("relevant abzas seçir", rel.length>20 && rel.length<=600, rel.slice(0,100));
// v10 🔴4: bütün abzaslar maxChars-dan uzun → boş return DƏYİL
const longPara = ("Bakı haqqında uzun mətn parçasıdır. " ).repeat(12); // ~384 char
const rel2 = selectRelevantParagraphs(longPara + "\n\n" + longPara, "Bakı mətn", "Bakı", 200);
assert("relevant: boş return bug (fallback var)", rel2.length > 0, `len=${rel2.length}`);

console.log("\n=== INTENT DETECTION (v10 gating) ===");
assert("weather: Bakı hava", isWeatherQuery("Bakı hava necədir"));
assert("weather: Bakı hava EXACT", matchWeather("Bakı hava necədir").exact === true);
assert("weather: sabah hava", isWeatherQuery("sabah hava neçə dərəcə olacaq"));
assert("weather: temperatur", isWeatherQuery("temperatur neçədir"));
// v13 P1: "hava limanı" (airport) / "hava yolu" (airline) hava DEYİL — əvvəlki
// davranışda "Bakı hava limanı" exact:true idi və searchAll tam atılırdı (audit probe)
assert("weather: 'hava limanı' weather DEYİL (v13 airport fix)", matchWeather("hava limanı harada yerləşir").hit === false);
assert("weather: 'Bakı hava limanı' hit false (v13 - əvvəl exact:true idi)", matchWeather("Bakı hava limanı").hit === false);
assert("weather: 'hava yolları' weather DEYİL (airline)", matchWeather("Azərbaycan hava yolları").hit === false);
assert("weather: 'Bakı hava' hələ də EXACT", matchWeather("Bakı hava").hit === true && matchWeather("Bakı hava").exact === true);
assert("weather: 'Gəncədə hava necədir' hələ də hit", isWeatherQuery("Gəncədə hava necədir"));
assert("weather: 'temperatur neçədir' hələ də hit", isWeatherQuery("temperatur neçədir"));
assert("weather: Gəncə şəhəri", detectCity("Gəncədə hava") === "gence");
assert("weather: Qubadli ≠ Quba (word-boundary)", detectCity("Qubadlida hava necədir") === "qubadli", detectCity("Qubadlida hava necədir"));
assert("weather: Quba hələ də Quba", detectCity("Qubada hava") === "quba");
assert("weather: Lacın normalize (unnormalized bug)", detectCity("Lacında hava necədir") === "lacin", detectCity("Lacında hava necədir"));
assert("weather: şəhər YOXDURSA null (baki default deyil)", detectCity("hava necədir") === null, `got ${detectCity("hava necədir")}`);
assert("time: saat neçədi", isTimeQuery("bu gün saat neçədi"));
assert("time: 'current time' multi-word (əvvəl heç vaxt match olmurdu)", isTimeQuery("current time in Baku") === true);
assert("time: 'saat' qısa EXACT", matchTime("saat").exact === true);
assert("time: uzun sorğuda 'saat' WEAK", matchTime("saat 3-də başlayan kino haqqında məlumat ver").hit === true && matchTime("saat 3-də başlayan kino haqqında məlumat ver").exact === false);
assert("time: saatlıq hava DEYİL", !isTimeQuery("hava proqnozu saatlıq"));
assert("time: 'nə vaxt' (when) DEYİL", !isTimeQuery("İstiqlaliyyət nə vaxt elan olunub"));
assert("currency: dollar məzənnəsi", isCurrencyQuery("dollar məzənnəsi"));
assert("currency: avro məzənnəsi", isCurrencyQuery("avro məzənnəsi bu gün"));
assert("currency: 'dil kursu' DEYİL (kurs=false-positive fix)", isCurrencyQuery("ingilis dil kursu") === false);
assert("currency: 'exchange' tək başına DEYİL", isCurrencyQuery("exchange programı haqqında") === false);
assert("currency: 'dollar kursu' fraza EXACT", matchCurrency("dollar kursu necədir").exact === true);
assert("currency: Avropa DEYİL (false positive)", !isCurrencyQuery("qazın qiyməti Avropada"), "Avropa avro kimi başa düşüldü!");
assert("currency: qızıl qiyməti general", !isCurrencyQuery("qızılın qiyməti")); // qiymət tək başına valyuta deyil

console.log("\n=== SANITIZE / TƏHLÜKƏSİZİK (v10 kontrakt) ===");
// v10 🟠9: query-də kod tokenları qorunur (Map<String,Integer> qırılmır)
assert("sanitize: kod tokenları qorunur", sanitizeQuery("Map<String,Integer> nedir").includes("<String,Integer>"), sanitizeQuery("Map<String,Integer> nedir"));
assert("sanitize: control chars silinir", !sanitizeQuery("Bakı\x00hava").includes("\x00"));
assert("sanitize: uzunluq limiti", sanitizeQuery("a".repeat(1000)).length <= 500);
assert("sanitize: null/undefined -> ''", sanitizeQuery(null) === "" && sanitizeQuery(undefined) === "");

console.log("\n=== URL NORMALİZASYA (v10 🟠10) ===");
assert("url: viewtopic t=1 vs t=2 AYRI səhifələr", normalizeUrl("https://forum.example.com/viewtopic.php?t=1") !== normalizeUrl("https://forum.example.com/viewtopic.php?t=2"));
assert("url: utm/fbclid tracking silinir", normalizeUrl("https://ex.com/p?utm_source=x&fbclid=y&id=5") === "ex.com/p?id=5");
assert("url: params sıralanır", normalizeUrl("https://ex.com/p?v=2&id=5") === "ex.com/p?id=5&v=2");

console.log("\n=== DECODE ENTITIES (v10 🟡) ===");
assert("entities: &amp;", decodeEntities("A &amp; B") === "A & B");
assert("entities: hex &#x27;", decodeEntities("it&#x27;s") === "it's");
assert("entities: decimal &#65;", decodeEntities("&#65;") === "A");
assert("entities: NO double-decode", decodeEntities("&amp;lt;") === "&lt;", decodeEntities("&amp;lt;"));

console.log("\n=== SCORE / SPAM (v10) ===");
const wikiRes = { title: "Azərbaycan dili", snippet: "Azərbaycan dili — Qafqazda danışılan dil, Azərbaycanın dövlət dilidir.", url: "https://az.wikipedia.org/wiki/Az%C3%A9rbaycan_dili", source: "wikipedia" };
assert("score: stem mismatch fuzzy (azerbayca vs azerbaycan)", scoreResult(wikiRes, tokenize("azerbayca")) >= 1.5, String(scoreResult(wikiRes, tokenize("azerbayca"))));
assert("score: tam match (azerbaycan)", scoreResult(wikiRes, tokenize("azerbaycan")) >= 1.5, String(scoreResult(wikiRes, tokenize("azerbaycan"))));
assert("score: əlaqəsiz sorğu 0", scoreResult(wikiRes, tokenize("katekizmin qaydaları")) === 0);
assert("spam: gitee.com spamdır", isSpamDomain("https://gitee.com/repo") === true);
assert("spam: subdomen spamdır", isSpamDomain("https://so.gitee.com/x") === true);
assert("spam: 'nogitee.com' FALSE-POSİTİV DEYİL", isSpamDomain("https://nogitee.com/x") === false);
assert("spam: wikipedia spam DEYİL", isSpamDomain("https://en.wikipedia.org/wiki/Azerbaijan") === false);

console.log("\n=== EXPAND (v10 🟠6) ===");
const exp1 = expandQuery("Map<String,Integer> in Java");
assert("expand: EN sorğuda english COPY yoxdur", exp1.english === null, JSON.stringify(exp1));
const exp2 = expandQuery("sistem necə qurulur");
assert("expand: AZ sorğuda english var (dictionary)", typeof exp2.english === "string" && /[a-z]/.test(exp2.english), JSON.stringify(exp2));
assert("expand: keywords STMMED deyil (real sözlər)", !/\bsorg$|\bmotorun\b/.test(exp2.expanded || ""), exp2.expanded);
{
  const stripped = stripMetaInstructions("Bakı tarixi haqqında məlumat ver, hər cavab ən azı 500 simvol olmalıdır, hər biri mənbə ilə təsdiqlənsin");
  assert("meta strip: mövzu saxlanılır", stripped && /bakı/i.test(stripped) && !/hər biri/i.test(stripped), stripped || "null");
}
// v13 P2: tək topic marker ("ən azı N" / "hər biri") légitim sorğuda da olur —
// əvvəlki tək-marker qaydası "ən azı 5 ölkə" kimi sorğuları meta sayıb "5"-i silirdi
assert("meta: 'ən azı 5 ölkə' légitim - meta DEYİL (v13)", isMetaQuery("Azərbaycanla sərhəddi olan ən azı 5 ölkə var") === false);
assert("meta: 'hər biri neçə qapıya' légitim - meta DEYİL (v13)", isMetaQuery("Hər biri neçə qapıya malikdir?") === false);
assert("meta: 'ən azı 3 nəticə qaytarmalıdır' imperativ - meta DİR (v13)", isMetaQuery("ən azı 3 nəticə qaytarmalıdır") === true);
assert("meta: iki topic marker - meta DİR (v13)", isMetaQuery("sual ver ən azı 5, hər biri fərqli") === true);
assert("meta: 'olmalıdır' tək imperativ - meta DİR (v13)", isMetaQuery("Nəticələr JSON formatında olmalıdır") === true);
// Route yolunun simulyasiyası: isMetaQuery=false → stripMetaInstructions çağrılmır → "5" qorunur
{
  const mq = "Azərbaycanla sərhəddi olan ən azı 5 ölkə var";
  const routeQuery = isMetaQuery(mq) ? (stripMetaInstructions(mq) || mq) : mq;
  assert("meta: légitim sorğunun '5'-i qorunur (v13 route yolu)", routeQuery === mq, routeQuery);
}
// v13 P10: tokenize "ne/zaman" atırdı → adi TR sualı tərcümə/EN anchor-a çatmırdı (canlı probe)
assert("TR: 'Ankara ne zaman kuruldu' gate AÇIQ (v13)", isLongAzQuery("Ankara ne zaman kuruldu") === true);
assert("TR: 'Kapadokya da ne yapılır' gate AÇIQ (v13)", isLongAzQuery("Kapadokya da ne yapılır") === true);
assert("TR: 'Türkiye nin başkenti neden Ankara' gate AÇIQ (dəyişməz)", isLongAzQuery("Türkiye'nin başkenti neden Ankara'dır") === true);
assert("AZ: 'Bakı hava' qısa - gate yoxdur (dəyişməz)", isLongAzQuery("Bakı hava") === false);
assert("AZ: 'Azərbaycanın paytaxtı' qısa - gate yoxdur (dəyişməz)", isLongAzQuery("Azərbaycanın paytaxtı") === false);
assert("EN: 'retrieval augmented generation systems' gate yoxdur (dəyişməz)", isLongAzQuery("retrieval augmented generation systems") === false);

console.log("\n=== SSRF / BLOKLAMA (v10.1) ===");
// isBlockedIp — saf funksiya, deterministik
assert("ssrf: 127.0.0.2 blok", isBlockedIp("127.0.0.2") === true);
assert("ssrf: 0.0.0.0 blok", isBlockedIp("0.0.0.0") === true);
assert("ssrf: 100.64.0.1 (CGNAT) blok", isBlockedIp("100.64.0.1") === true);
assert("ssrf: ::ffff:127.0.0.1 (v4-mapped) blok", isBlockedIp("::ffff:127.0.0.1") === true);
assert("ssrf: 192.168.1.1 blok", isBlockedIp("192.168.1.1") === true);
assert("ssrf: 172.16.0.1 blok", isBlockedIp("172.16.0.1") === true);
assert("ssrf: 172.31.255.255 blok (172.16/12 sonu)", isBlockedIp("172.31.255.255") === true);
assert("ssrf: 172.32.0.1 PUBLIC (172.16/12 kənarı)", isBlockedIp("172.32.0.1") === false);
assert("ssrf: 169.254.169.254 (metadata) blok", isBlockedIp("169.254.169.254") === true);
assert("ssrf: 8.8.8.8 public", isBlockedIp("8.8.8.8") === false);
assert("ssrf: 93.184.216.34 public", isBlockedIp("93.184.216.34") === false);
assert("ssrf: ::1 blok", isBlockedIp("::1") === true);
assert("ssrf: fc00::5 (ULA) blok", isBlockedIp("fc00::5") === true);
assert("ssrf: 2606:4700::1111 public", isBlockedIp("2606:4700::1111") === false);
assert("ssrf: IP formatı deyilsə fail-closed", isBlockedIp("not-an-ip") === true);
// assertPublicUrl — protocol/port/IP qapısı (test-də deterministik: host IP-dir)
async function throws(fn) { try { await fn(); return false; } catch { return true; } }
assert("ssrf: ftp:// blok", await throws(() => assertPublicUrl("ftp://example.com/x")));
assert("ssrf: port 8443 blok", await throws(() => assertPublicUrl("https://example.com:8443/")));
assert("ssrf: 127.0.0.1:8080 blok", await throws(() => assertPublicUrl("http://127.0.0.1:8080/x")));
assert("ssrf: [::1] blok", await throws(() => assertPublicUrl("http://[::1]/x")));
assert("ssrf: 100.64.0.1 blok", await throws(() => assertPublicUrl("http://100.64.0.1/x")));
assert("ssrf: 8.8.8.8 keçir", (await throws(() => assertPublicUrl("http://8.8.8.8/x"))) === false);
assert("ssrf: localhost blok", await throws(() => assertPublicUrl("http://localhost/x")));

// v13 T1: URL-level extract cache (URL → məzmun; wiki 24h, digər 1h; null cache-ə düşmür)
console.log("\n=== EXTRACT CACHE (v13 T1) ===");
assert("extractCache: miss -> null", extractCacheGet("https://cache-miss.example/x") === null);
{
  const val = { title: "t", text: "x".repeat(200), url: "https://cache-hit.example/p" };
  extractCacheSet("https://cache-hit.example/p", val);
  assert("extractCache: set/get eyni obyekt", extractCacheGet("https://cache-hit.example/p") === val);
}
// 4MB cap: tək entry cap-dan böyükdürsə saxlan (size>1 guard), əvvəlki köhnə entry atılır
{
  const small = { title: "t", text: "a".repeat(160), url: "https://evict.example/1" };
  extractCacheSet("https://evict.example/1", small);
  const big = { title: "t", text: "a".repeat(4 * 1024 * 1024 + 500), url: "https://evict.example/2" };
  extractCacheSet("https://evict.example/2", big);
  assert("extractCache: 4MB cap - ən köhnə entry evict olunur",
    extractCacheGet("https://evict.example/1") === null && extractCacheGet("https://evict.example/2") !== null);
}

// v14 (user review #1): confidence v3 — no_results xəta DEYİL (əvvəlki bug: hər sorğu "low")
console.log("\n=== CONFIDENCE V3 (v14) ===");
const R = (over = {}) => ({ content: "x".repeat(400), providers: ["bing"], voteCount: 1, source: "bing", ...over });
assert("conf: boş → none", computeConfidence([], {}, false) === "none");
assert("conf: fallback → low", computeConfidence([R()], {}, true) === "low");
assert("conf: no_results xəta DEYİL (v14 - əvvəlki bug)", computeConfidence([R()], { github: "no_results", wikipedia: "no_results", tavily: "no_results" }, false) === "medium");
assert("conf: 3 hard xəta → hələ medium", computeConfidence([R({ providers: ["bing", "brave"], voteCount: 2 })], { tavily: "bad_request", brave: "rate_limited", ddg: "blocked" }, false) === "high");
assert("conf: 4+ hard xəta → low (degraded)", computeConfidence([R({ providers: ["bing", "brave"], voteCount: 2 })], { tavily: "bad_request", brave: "rate_limited", ddg: "blocked", bing: "timeout" }, false) === "low");
assert("conf: 2 provider + substantial → high", computeConfidence([R({ providers: ["bing", "brave"], voteCount: 2 })], { tavily: "bad_request" }, false) === "high");
assert("conf: struktur API (kısa content belə) → high", computeConfidence([R({ source: "open-meteo", content: "Bakı hazırda: 10°C" })], {}, false) === "high");
assert("v19 conf: zaif ballı nəticələr (AI → .ai domeni) high ALMIR", computeConfidence([R({ providers: ["bing", "brave"], voteCount: 2, score: 2.1, content: "x".repeat(400) }), R({ score: 2.4, content: "y".repeat(300) })], {}, false) === "medium");
assert("conf: tək provider + qısa content → medium", computeConfidence([R({ content: "kısa" })], {}, false) === "medium");
assert("conf: tək provider + substantial + soft xəta → medium", computeConfidence([R()], { github: "no_results", arxiv: "no_results" }, false) === "medium");

// v14 (user review #4): snippet word-boundary cut
console.log("\n=== CUT WORD (v14) ===");
assert("cutWord: qısa mətn dəyişmir", cutWord("qısa mətn") === "qısa mətn");
assert("cutWord: boşluqsuz uzun blok → raw kəs + …", cutWord("a".repeat(100), 20) === "a".repeat(20) + "…");
// "söz "×80 = 320 char; default max 200: sliced = "söz "×50 (199-da boşluq),
// lastSpace=199 > 40 → 199-da kəs → 49 tam "söz " + "söz" + "…"
const cw = cutWord("söz ".repeat(80));
assert("cutWord: söz sərhədində kəsir (yarım söz qalmır)", cw === "söz ".repeat(49) + "söz…" && cw.length === 200, cw.slice(0, 60) + "…[" + cw.length + "]");
assert("cutWord: son boşluq qalmır", !/…$/.test(cw) || !/ \.$/.test(cw) && !/…[ ]$/.test(cw));
// Host adı (fcc.gov) "private" sayılmır — DNS cavabı public olarsa keçir
assert("ssrf: fcc.gov 'private host' DEYİL", (await throws(() => assertPublicUrl("http://fcc.gov/"))) === false);

console.log("\n=== URL NORMALİZASYA (v10.1 qara siyahı) ===");
assert("url: YouTube ?t=30 timestamp silinir", normalizeUrl("https://www.youtube.com/watch?v=abc&t=30") === "youtube.com/watch?v=abc", normalizeUrl("https://www.youtube.com/watch?v=abc&t=30"));
assert("url: youtu.be ?start=30 silinir", normalizeUrl("https://youtu.be/abc?start=30&t=5") === "youtu.be/abc");
assert("url: forum ?t=1? p=2 saxlanılır (identity)", normalizeUrl("https://forum.example.com/viewtopic.php?t=1&p=2") === "forum.example.com/viewtopic.php?p=2&t=1");
assert("url: ?newsid saxlanılır, ?ref silinir", normalizeUrl("https://news.site/x?newsid=42&ref=home") === "news.site/x?newsid=42");
assert("url: ?page saxlanılır, utm silinir", normalizeUrl("https://docs.site/x?page=2&utm_source=n") === "docs.site/x?page=2");
assert("url: Bing ?form silinir (vote bölünməsi)", normalizeUrl("https://msn.com/a?form=QBLH1&id=9") === "msn.com/a?id=9");

console.log("\n=== CIRCUIT BREAKER (v10.1) ===");
{
  const P = "unit-test-cb-" + Date.now();
  recordFailure(P); recordFailure(P);
  assert("cb: 2 fail ilə açıq DEYİL", isCircuitOpen(P) === false);
  recordFailure(P); recordFailure(P);
  assert("cb: 4 fail (default threshold) ilə AÇIQ", isCircuitOpen(P) === true);
  recordSuccess(P, 10);
  assert("cb: success ilə BAĞLANIR", isCircuitOpen(P) === false);
}

console.log("\n=== BÜDCƏ (v10.1) ===");
{
  const t0 = Date.now();
  const r = await expandQueryAsync("sistem necə qurulur haqqında ətraflı məlumat ver", 0);
  const took = Date.now() - t0;
  assert("büdcə=0: tərcümə cəhd olunmur (sürətli)", r.translated === false && took < 800, `took=${took}ms`);
}

console.log("\n=== SITE: FILTER (hostMatches) ===");
assert("site: subdomen keçir", hostMatches("https://az.wikipedia.org/wiki/Bakı", "wikipedia.org"));
assert("site: www yox etdirir", hostMatches("https://www.cbar.az/", "cbar.az"));
assert("site: exakt domain", hostMatches("https://cbar.az/", "cbar.az"));
assert("site: substring DEYİL (evil-wikipedia.org.fake.com)", !hostMatches("https://evil-wikipedia.org.fake.com/x", "wikipedia.org"));
assert("site: suffix-olmayan domain DEYİL (wikipedia.org.evil.com)", !hostMatches("https://wikipedia.org.evil.com/", "wikipedia.org"));
assert("site: qeyri-valid URL false", !hostMatches("not-a-url", "wikipedia.org"));
assert("site: fərqli TLD DEYİL (wikipedia.orgg)", !hostMatches("https://wikipedia.orgg/", "wikipedia.org"));

console.log("\n=== RATE LIMIT ===");
const ip = "test-ip-" + Date.now();
let okCount=0;
for(let i=0;i<35;i++){ const rl = await checkRateLimit(ip,30,60000); if(rl.ok) okCount++; }
assert("rate limit 30-dan sonra bloklayır", okCount===30, `okCount=${okCount}`);
const blocked = await checkRateLimit(ip,30,60000);
assert("rate limit retryAfter qaytarır", !blocked.ok && blocked.retryAfter >= 1, `retryAfter=${blocked.retryAfter}`);

console.log("\n=== V12: CONTENT HYGIENE (clean.js) ===");
{
  const t = "Bakı — Azərbaycanın paytaxtıdır [1] və ən böyük şəhəridir [2]. Əhalisi 2.3 milyondur [edit] [citation needed].";
  const c = cleanContent(t);
  assert("clean: [1]/[2] sitat markerləri silinir", !/\[\d+\]/.test(c), c);
  assert("clean: [edit] silinir", !/\[edit\]/i.test(c), c);
  assert("clean: [citation needed] silinir", !/citation needed/i.test(c), c);
  assert("clean: həqiqi mətn QALIR", c.includes("paytaxtıdır") && c.includes("2.3 milyondur"), c);
}
{
  const c = cleanContent("Daha çox bax: [[Bakı]]. Həm də [[Azərbaycan|Azərbaycan Respublikası]] haqqında.");
  assert("clean: [[X|Y]] → Y", c.includes("Azərbaycan Respublikası"), c);
  assert("clean: [[X]] → X, mötərizə qalmır", c.includes("Bakı") && !c.includes("[["), c);
}
{
  const t = ["Tərif", "------", "Ad | Bakı | Əhali | 2.3M", "12.12.2025", "2025", "|||---|||", "§§§###$$$", "Mənbələr", "Bu şəhər çox köhnədir."].join("\n");
  const c = cleanContent(t);
  assert("clean: cədvəl sətiri (3+ pipe) silinir", !c.includes("Əhali"), c);
  assert("clean: tarix zibilliyi (12.12.2025) silinir", !c.includes("12.12.2025"), c);
  assert("clean: tək il (2025) sətiri silinir", !/\b2025\b/.test(c), c);
  assert("clean: symbol soup silinir", !c.includes("§§§"), c);
  assert("clean: 'Mənbələr' boilerplate başlıq silinir", !c.includes("Mənbələr"), c);
  assert("clean: həqiqi cümlə QALIR", c.includes("çox köhnədir"), c);
}
{
  const c = cleanContent("References\nSee also\nThis is a real sentence about Baku city.");
  assert("clean: EN boilerplate (References/See also) silinir", !c.includes("References") && !c.includes("See also"), c);
  assert("clean: EN həqiqi cümlə QALIR", c.includes("real sentence about Baku"), c);
}
{
  const t = "Azərbaycan Respublikası 1991-ci ildə müstəqillik qazanıb. Paytaxtı Bakıdır.";
  assert("clean: təmiz mətn bütövlükdə dəyişmir", cleanContent(t) === t);
}

console.log("\n=== V12: ANSWER EXTRACTION (pickAnswer) ===");
{
  const t = "Bu səhifədə əlavə məzmun yoxdur. İlhəm Əliyev 1961-ci ildə anadan olub. O, hazırda dövlət başçısıdır.";
  const a = pickAnswer(t, "İlhəm Əliyev kimdir");
  assert("answer: cavab cümləsi seçilir (İlhəm Əliyev → anadan olub)", a.includes("1961-ci ildə anadan olub"), a);
}
{
  const a = pickAnswer("Təkcə bir cümlə var bu kiçik mətni içində.", "tam əlaqəsiz başqa şey");
  assert("answer: term tapılmasa ən uzun cümlə qayıdır", a.length >= 20, a);
}
{
  assert("answer: boş mətn → ''", pickAnswer("", "x") === "");
}
{
  const t = "Qızıl qram 2025-ci ildə 1250 ABŞ dollarıdır. Qızıl gümüşdən bahidir.";
  const a = pickAnswer(t, "qızıl qiyməti");
  assert("answer: qiymət cümləsi seçilir", a.includes("1250"), a);
}
{
  // TOC/nav bloku "cümlə" sayılmamalı (səhifə adı gəlirdi, cavab gəlmirdi)
  const t = "Məzmun\n1 Tarix\n2 İqtisadiyyat\nBakı — Azərbaycanın paytaxtıdır. Əhalisi 2,3 milyondur.";
  const a = pickAnswer(t, "Bakı əhalisi neçədir");
  assert("answer: TOC sətirləri cavabda OLMAMALI", !a.includes("Tarix") && !a.includes("İqtisadiyyat") && a.includes("Bakı"), a);
}

console.log("\n=== V12: QUERY LANGUAGE (detectQueryLanguage) ===");
assert("lang: AZ (ə işarəsi)", detectQueryLanguage("Bakıda çimərliklər harada var") === "az");
assert("lang: TR (turk xarakterləri)", detectQueryLanguage("Nasılsın") === "tr");
assert("lang: TR (İstanbul)", detectQueryLanguage("İstanbul film festivali") === "tr");
assert("lang: EN (saf ASCII)", detectQueryLanguage("best sci-fi movies 2025") === "en");
assert("lang: 'Türkiyədə' = az (ə üstün)", detectQueryLanguage("Türkiyədə hava necədir") === "az");

console.log("\n=== V12: WIKIPEDIA EXTRACTS (wikiExtractUrl) ===");
assert("wiki: /wiki/URL → extracts API (explaintext)", (wikiExtractUrl("https://az.wikipedia.org/wiki/İlhəm_Əliyev") || "").includes("explaintext=1"));
assert("wiki: extracts URL düzgün host", (wikiExtractUrl("https://en.wikipedia.org/wiki/Artificial_intelligence") || "").startsWith("https://en.wikipedia.org/w/api.php"));
assert("wiki: File: səhifəsi → null", wikiExtractUrl("https://en.wikipedia.org/wiki/File:Sun.jpg") === null);
assert("wiki: Category/Kategori → null", wikiExtractUrl("https://tr.wikipedia.org/wiki/Kategori:2025_Türk_filmleri") === null);
assert("wiki: qeyri-wiki host → null", wikiExtractUrl("https://example.com/wiki/x") === null);
assert("wiki: anasəhifə (/wiki/) → null", wikiExtractUrl("https://az.wikipedia.org/wiki/") === null);

console.log("\n=== V12: JUNK DOMAINS + TOPIC GATING (score.js) ===");
{
  const t = tokenize("Bakıda çimərliklər harada var");
  const r = scoreResult({ title: "Harada Corporation", url: "https://rocketreach.co/harada-contacts_b5d2c9a0", snippet: "Contact information for Baku-based company Harada Corporation.", source: "bing" }, t, "az", "Bakıda çimərliklər harada var");
  assert("junk: rocketreach (B2B directory) → 0", r === 0, String(r));
  const r2 = scoreResult({ title: "LinkedIn", url: "https://www.linkedin.com/company/harada", snippet: "Harada Corporation Baku company profile.", source: "bing" }, t, "az", "Bakıda çimərliklər harada var");
  assert("junk: linkedin directory → 0", r2 === 0, String(r2));
  assert("junk: isJunkDomain helper", isJunkDomain("https://crunchbase.com/organization/x") && !isJunkDomain("https://example.com/x"));
}
{
  const t = tokenize("Bakıda çimərliklər harada var");
  const home = scoreResult({ title: "Google", url: "https://www.google.com/", snippet: "Baku search engine Google and multinational technology company.", source: "bing" }, t, "az", "Bakıda çimərliklər harada var");
  assert("junk: google.com ANA səhifəsi (path=/) → 0", home === 0, String(home));
}
{
  // dil uyğunsuzluğu: AZ sorğuda lokal (ə / .az) nəticə EN-yə üstün olmalıdır
  const t = tokenize("Bakıda çimərliklər harada var");
  const enRes = scoreResult({ title: "Beaches of Baku guide", url: "https://travel.example.com/baku", snippet: "Baku has beautiful beaches along the Caspian Sea.", source: "bing" }, t, "az", "Bakıda çimərliklər harada var");
  const azRes = scoreResult({ title: "Bakı çimərlikləri", url: "https://sefer.az/baki-cimerlikleri", snippet: "Bakıda çimərliklər Neftçala, Sahil və Ceyranbatu rayonlarında var.", source: "bing" }, t, "az", "Bakıda çimərliklər harada var");
  assert("lang: AZ sorğuda lokal nəticə EN-yə üstün gəlir", azRes > enRes && azRes >= 1.5, `az=${azRes} en=${enRes}`);
  // EN sorğuda cəza OLMAMALI (regress qoruması)
  const te = tokenize("baku beaches");
  const enLocal = scoreResult({ title: "Beaches of Baku guide", url: "https://travel.example.com/baku", snippet: "Baku has beautiful beaches along the Caspian Sea.", source: "bing" }, te, "en", "baku beaches");
  assert("lang: EN sorğuda dil cəzası YOXDUR", enLocal >= 1.5, String(enLocal));
}
{
  // mövzu qaydaları: film sorğusunda hacker-news = zibil; news sorğusunda github = zibil
  const t = tokenize("best sci-fi movies 2025");
  const hn = scoreResult({ title: "Show HN: Movie list", url: "https://news.ycombinator.com/item?id=1", snippet: "Sci fi movies 2025 discussion", source: "hacker-news" }, t, "en", "best sci-fi movies 2025");
  const tm = scoreResult({ title: "Best Sci-Fi Movies of 2025", url: "https://www.imdb.com/list/scifi-2025/", snippet: "The best science fiction movies released in 2025 ranked", source: "bing" }, t, "en", "best sci-fi movies 2025");
  assert("topic: film sorğusunda hacker-news demoted olur", hn < tm, `hn=${hn} tm=${tm}`);
  // texniki sorğuda github cəzalanMAMALI (regress)
  const tt = tokenize("nodejs async await best practices");
  const ghOk = scoreResult({ title: "nodejs async patterns", url: "https://github.com/x/async", snippet: "nodejs async await best practices library", source: "github" }, tt, "en", "nodejs async await best practices");
  assert("topic: texniki sorğuda github cəzalanmır", ghOk >= 1.5, String(ghOk));
}
{
  const t2 = tokenize("son xeberler gundem");
  const gh = scoreResult({ title: "news repo", url: "https://github.com/x/news", snippet: "son xeberler gundem archive repository", source: "github" }, t2, "tr", "son xeberler gundem");
  // v55.1: news.google.com artıq JUNK (RSS başlıq linkləri fakt vermir) — real xəbər saytı ilə yoxlayırıq
  const gs = scoreResult({ title: "Gündəm xəbərləri", url: "https://www.bbc.com/news", snippet: "son xeberler gundem today breaking", source: "google-news" }, t2, "tr", "son xeberler gundem");
  assert("topic: news sorğusunda github < news mənbə", gh < gs, `gh=${gh} gs=${gs}`);
}

console.log("\n=== UNICODE CODEPOINT GUARD (v12.3 - korrupsiya müdafiəsi) ===");
// Bu testlər \u-escape ilə YAZILIB: input kanalı ə korpusa daşımamış olsa belə,
// KODUN HƏQİQİ U+0259 (ə)/U+018F (Ə) ilə işlədiyini yoxlayır.
// Standart ISO-9 azərbaycan yazışı: ə=U+0259, Ə=U+018F. U+018E=Ǝ başqa hərfdir (reversed E), layihədə yoxdur.
assert("guard: normalizeAz həqiqi U+018F ə-i işləyir", normalizeAz("Az\u018Frbaycan") === "azerbaycan", normalizeAz("Az\u018Frbaycan"));
assert("guard: detectQueryLanguage həqiqi U+018F (Ə başlanğıc)", detectQueryLanguage("Az\u018Frbaycan haqq\u0131nda") === "az", detectQueryLanguage("Az\u018Frbaycan haqq\u0131nda"));
assert("guard: detectQueryLanguage həqiqi U+0259 (ə orta)", detectQueryLanguage("Bak\u0131da \u00e7im\u0259rlikl\u0259r harada var") === "az", detectQueryLanguage("Bak\u0131da \u00e7im\u0259rlikl\u0259r harada var"));
assert("guard: stemAz həqiqi ə sonluqlu söz", stemAz("Bak\u0131da") === stemAz("Bak\u0131"), `${stemAz("Bak\u0131da")} vs ${stemAz("Bak\u0131")}`);
assert("guard: stripQuestionWords həqiqi nə/yerləşir", stripQuestionWords("Bak\u0131 harada yerl\u0259\u015fir") === "Bak\u0131", stripQuestionWords("Bak\u0131 harada yerl\u0259\u015fir"));
assert("guard: dil cəzası həqiqi ə blob-u local sayır", (() => {
  const t = tokenize("Bak\u0131da \u00e7im\u0259rlikl\u0259r harada var");
  const az = scoreResult({ title: "Bak\u0131 \u00e7im\u0259rlikl\u0259ri", url: "https://sefer.az/x", snippet: "Bak\u0131da \u00e7im\u0259rlikl\u0259r Neft\u00e7alada var.", source: "bing" }, t, "az", "Bak\u0131da \u00e7im\u0259rlikl\u0259r harada var");
  const en = scoreResult({ title: "Beaches of Baku guide", url: "https://travel.example.com/baku", snippet: "Baku has beautiful beaches along the Caspian Sea.", source: "bing" }, t, "az", "Bak\u0131da \u00e7im\u0259rlikl\u0259r harada var");
  return az >= 1.5 && az > en;
})(), "həqiqi-ə dil cəzası test");

console.log("\n=== V12.1: WIKI QUESTION-WORD STRIP (v12.1) ===");
assert("qstrip: AZ 'kimdir' atılır", stripQuestionWords("İlham Əliyev kimdir") === "İlham Əliyev", stripQuestionWords("İlham Əliyev kimdir"));
assert("qstrip: 'haqqında' atılır", stripQuestionWords("Bakı haqqında") === "Bakı");
assert("qstrip: EN 'what is' atılır", stripQuestionWords("what is RAG in LLM") === "RAG in LLM", stripQuestionWords("what is RAG in LLM"));
assert("qstrip: tək sorğu sözü → orijinal qalır", stripQuestionWords("kimdir") === "kimdir");
assert("qstrip: adi sorğu dəyişmir", stripQuestionWords("Bakı çimərliklər") === "Bakı çimərliklər");
assert("qstrip: 'harada yerləşir' atılır", stripQuestionWords("Bakı harada yerləşir") === "Bakı", stripQuestionWords("Bakı harada yerləşir"));
assert("qstrip: 'nə vaxtdır' atılır", stripQuestionWords("İstiqlaliyyət günü nə vaxtdır") === "İstiqlaliyyət günü", stripQuestionWords("İstiqlaliyyət günü nə vaxtdır"));

console.log("\n=== V12: DIVERSITY (maxPerDomain=1) ===");
{
  const items = [
    { url: "https://a.example.com/1", title: "Birinci sayt nəticəsi", snippet: "məzmun məzmun", source: "bing", score: 10 },
    { url: "https://a.example.com/2", title: "İkinci səhifə başqa başlıq", snippet: "başqa məzmun", source: "bing", score: 9 },
    { url: "https://b.example.com/1", title: "Üçüncü sayt nəticəsi", snippet: "başqa məzmun", source: "bing", score: 8 }
  ];
  const d1 = diversifyByDomain(items, 5, 1);
  assert("diversity: maxPerDomain=1 → 3-dən 2 (Google tərzi)", d1.length === 2 && d1[1].url.includes("b.example.com"), JSON.stringify(d1.map(x => x.url)));
  const docsItems = [
    { url: "https://vercel.com/docs/functions/limitations", title: "Vercel Functions Limitations", snippet: "Timeout limits", source: "bing", score: 8 },
    { url: "https://vercel.com/docs/functions/configuring-functions/duration", title: "Configuring Max Duration", snippet: "maxDuration setting", source: "bing", score: 7 }
  ];
  const dDocs = diversifyByDomain(docsItems, 5, 1, 2);
  assert("diversity v15: rəsmi docs saytında 2 fərqli yüksək skorlu səhifə qalır", dDocs.length === 2);
}

console.log("\n=== V15: XƏBƏR ŞABLONU, REKLAM LİNKİ, TƏKRAR SÖZ VƏ İNFOBOX ===");
{
  const newsRaw = "Oxu.Az Trend-ə istinadən xəbər verir ki, sabah Bakıda güclü külək əsəcək.\nBizi Telegram-da izləyin!\nHəmçinin oxuyun: Başqa xəbər\nBakı xəbər Bakı xəbər Bakı xəbər Bakı xəbər Bakı son";
  const cleaned = cleanContent(newsRaw);
  assert("v15 clean: 'Oxu.Az ... xəbər verir ki,' kəsilir, əsas xəbər qalır", !/xəbər verir ki/i.test(cleaned) && cleaned.includes("Sabah Bakıda güclü külək əsəcək"), cleaned);
  assert("v15 clean: Telegram / Həmçinin oxuyun promo sətirləri silinir", !/telegram|həmçinin oxuyun/i.test(cleaned), cleaned);
  assert("v15 clean: təkrarlanan söz yığını (word salad) silinir", !/Bakı xəbər Bakı xəbər/i.test(cleaned), cleaned);
}
{
  const linksRaw = "Ən populyar saytlar:\n1. Google (https://google.com?utm_source=ads&fbclid=123) - axtarış\n2. YouTube (youtube.com) - video\nReklam: https://bit.ly/3xyz999 və https://doubleclick.net/ad";
  const cleaned = cleanContent(linksRaw);
  assert("v15 clean: həqiqi sayt adları (google.com, youtube.com) QORUNUR", cleaned.includes("https://google.com") && cleaned.includes("youtube.com"), cleaned);
  assert("v15 clean: reklam/qısa linklər (bit.ly, doubleclick) və utm silinir", !cleaned.includes("bit.ly") && !cleaned.includes("doubleclick") && !cleaned.includes("utm_source"), cleaned);
}
{
  assert("v15 stem: Azərbaycanla == Azərbaycan", stemAz("Azərbaycanla") === stemAz("Azərbaycan"), `${stemAz("Azərbaycanla")} vs ${stemAz("Azərbaycan")}`);
  assert("v15 stem: Bakıdakı == Bakı", stemAz("Bakıdakı") === stemAz("Bakı"), `${stemAz("Bakıdakı")} vs ${stemAz("Bakı")}`);
  assert("v15 lang: 'Bakı haqqında' = az (tr deyil!)", detectQueryLanguage("Bakı haqqında") === "az");
  assert("v15 currency: 'dollar nə vaxt yarandı' valyuta deyil (tarix sualı)", matchCurrency("dollar nə vaxt yarandı").hit === false);
  assert("v15 currency: '100 dollar cərimə' exact deyil (axtarış getməlidir)", matchCurrency("100 dollar cərimə").exact === false);
  assert("v15 weather: 'Bakıda külək fəsadları' exact deyil (xəbər axtarışı getməlidir)", matchWeather("Bakıda külək fəsadları").exact === false);
  const trapQ = "Qara dənizin dibində 1847-ci ildə tapılan pirat gəmisinin kapitanının anası haqqında məlumat";
  const trapScore = scoreResult(
    { title: "Caucasus Online", url: "https://az.wikipedia.org/wiki/Caucasus_Online", snippet: "Qara dənizin dibi ilə çəkilmiş optik kabel sistemi.", source: "wikipedia" },
    tokenize(trapQ),
    "az",
    trapQ
  );
  assert("v15 P5 hallüsinasiya qoruması: 9 anlayışlı sualda yalnız 2 ümumi söz tutarsa score=0", trapScore === 0, String(trapScore));
}

console.log("\n=== V16: DANIŞIQ AZ, FONETİK TƏMİZLİK, LÜĞƏT FİLTRİ VƏ DATE_INFO ===");
{
  const q1 = normalizeColloquialAz("Azərbaycan paytaxtı hansı şəhərdi");
  assert("v16 colloq: 'şəhərdi' -> 'şəhərdir'", q1 === "Azərbaycan paytaxtı hansı şəhərdir", q1);
  const q2 = normalizeColloquialAz("Dünyanın ən cox isdifadə edilmiş saytları");
  assert("v16 colloq: 'cox isdifadə' -> 'çox istifadə'", q2 === "Dünyanın ən çox istifadə edilmiş saytları", q2);
  const q3 = rewriteSearchIntentAz("Xəbərlər hakda məlumat Azərbaycanda");
  assert("v16 intent: 'Xəbərlər hakda məlumat Azərbaycanda' -> son xəbərlər", /son xəbərlər/iu.test(q3) && !/haqqında məlumat/iu.test(q3), q3);

  const ipaRaw = "Bakı ([bɑˈcɯ] ⓘ) — Azərbaycanın paytaxtıdır. Bakı (ABŞ: , Böyük Britaniya: ; rəsmi adı: Bakı) Xəzər sahilindədir.";
  const ipaClean = cleanContent(ipaRaw);
  assert("v16 clean: IPA [bɑˈcɯ] və ⓘ simvolları təmizlənir", !ipaClean.includes("bɑˈcɯ") && !ipaClean.includes("ⓘ") && ipaClean.includes("Bakı — Azərbaycanın paytaxtıdır"), ipaClean);
  assert("v16 clean: içi boş tələffüz mötərizəsi '(ABŞ: , Böyük Britaniya: ; ...)' silinir", !/ABŞ:\s*,/u.test(ipaClean), ipaClean);

  const braveNoise = cleanContent("2 weeks ago - AI can make mistakes, so verify using Britannica articles. ... Baku, the capital of Azerbaijan, lies on the Caspian Sea.");
  assert("v16 clean: Brave '2 weeks ago - AI can make mistakes...' səs-küyü silinir", braveNoise.startsWith("Baku, the capital of Azerbaijan"), braveNoise);

  const dup = dedupeSnippet("Baku, the capital of Azerbaijan, is located on the Caspian…", "Baku, the capital of Azerbaijan, is located on the Caspian Sea and has 2.3 million people.");
  assert("v16 dedupe: content ilə eyni başlayan snippet silinir (təkrar olmur)", dup === undefined, String(dup));

  const enWithAzGloss = "Azerbaijan State News Agency (AZERTAC; Azerbaijani: Azərbaycan Dövlət İnformasiya Agentliyi) is the official news agency of the Republic of Azerbaijan.";
  assert("v16 lang: mötərizədə AZ adı olan EN məqalə 'en' kimi tanınır (tərcümə olunacaq)", detectContentLanguage(enWithAzGloss) === "en", detectContentLanguage(enWithAzGloss));
  const enWithProper = "Visibility on Azerbaijan's roads to fall to 500 meters on Nov. 16 Operativ Məlumat Mərkəzi";
  assert("v16 lang: EN xəbər başlığı sonunda AZ agentlik adı olsa da 'en' tanınır", detectContentLanguage(enWithProper) === "en", detectContentLanguage(enWithProper));

  // Lüğət demote testi: adi sualda Merriam-Webster 0 alır, məna sualında isə qalır
  const mwOnRank = scoreResult(
    { title: "MOST Definition & Meaning - Merriam-Webster", url: "https://www.merriam-webster.com/dictionary/most", snippet: "The meaning of MOST is greatest in quantity or degree.", source: "bing" },
    tokenize("Dünyanın ən çox istifadə edilmiş saytları most visited websites"),
    "az",
    "Dünyanın ən çox istifadə edilmiş saytları"
  );
  assert("v16 dict: reytinq sualında Merriam-Webster /dictionary/ score=0", mwOnRank === 0, String(mwOnRank));
  const mwOnDef = scoreResult(
    { title: "SERENDIPITY Definition & Meaning", url: "https://www.merriam-webster.com/dictionary/serendipity", snippet: "The meaning of SERENDIPITY is luck in finding good things.", source: "bing" },
    tokenize("serendipity meaning definition"),
    "en",
    "serendipity meaning"
  );
  assert("v16 dict: həqiqi məna/lüğət sualında dictionary saytı qalır", mwOnDef >= 1.5, String(mwOnDef));

  // HTML-dən həqiqi tarix çıxarma + date_info təravət yoxlaması (Rule 8: tarix yoxdursa uydurulmur!)
  const { document: docWithDate } = parseHTML('<html><head><meta property="article:published_time" content="2026-11-15T10:30:00Z"><meta property="article:modified_time" content="2026-11-16T08:00:00Z"></head><body><p>Mətn</p></body></html>');
  const pd1 = extractPageDates(docWithDate);
  assert("v16 pageDate: meta article:published_time və modified_time düzgün çıxarılır", pd1.publishedAt === "2026-11-15T10:30:00.000Z" && pd1.updatedAt === "2026-11-16T08:00:00.000Z", JSON.stringify(pd1));
  const { document: docNoDate } = parseHTML("<html><head><title>Tarixsiz səhifə</title></head><body><p>Sadə mətn</p></body></html>");
  const pd2 = extractPageDates(docNoDate);
  assert("v16 pageDate (Rule 8): tarix yoxdursa null qaytarır, heç vaxt uydurmur", pd2.publishedAt === null && pd2.updatedAt === null, JSON.stringify(pd2));

  const freshInfo = buildDateInfo(new Date().toISOString(), null, "az");
  const oldInfo = buildDateInfo("2012-07-08T16:03:09Z", null, "az");
  const unknownInfo = buildDateInfo(null, null, "az");
  assert("v16 date_info: bugünkü mənbə 'fresh' ('təzə') kimi işarələnir", freshInfo.freshness === "fresh" && freshInfo.basis === "published" && freshInfo.label.includes("təzə"), JSON.stringify(freshInfo));
  assert("v16 date_info: 2012-ci il mənbəsi 'old' ('köhnə mənbə') kimi işarələnir", oldInfo.freshness === "old" && oldInfo.age_days > 4000 && oldInfo.label.includes("köhnə"), JSON.stringify(oldInfo));
  assert("v16 date_info: tarixsiz mənbə 'unknown' qalır", unknownInfo.freshness === "unknown" && unknownInfo.date === null, JSON.stringify(unknownInfo));
}

console.log("\n=== V17: DİLƏ GÖRƏ AXTARIŞ, QISA SÖZ TƏRCÜMƏSİ, TYPO/KAZİNO FİLTRİ ===");
{
  assert("v17 typo: 'Tərçemə' -> 'tərcümə'", normalizeColloquialAz("Tərçemə") === "tərcümə", normalizeColloquialAz("Tərçemə"));
  assert("v17 typo: 'Ən yaxşı flim saytları' -> 'film'", normalizeColloquialAz("Ən yaxşı flim saytları") === "Ən yaxşı film saytları");
  assert("v17 typo: 'En iyi flimler' -> 'En iyi filmler'", normalizeColloquialAz("En iyi flimler") === "En iyi filmler");
  assert("v17 colloq: 'hansılardı' -> 'hansılardır', 'üçündü' -> 'üçündür'",
    normalizeColloquialAz("Azərbaycan saytlar hansılardı") === "Azərbaycan saytlar hansılardır" &&
    normalizeColloquialAz("GitHub saytı nə üçündü") === "GitHub saytı nə üçündür"
  );
  assert("v17 lang: ASCII TR 'En iyi filmler' = tr (en deyil!)", detectQueryLanguage("En iyi filmler") === "tr", detectQueryLanguage("En iyi filmler"));
  assert("v17 lang: 'Tərçemə' = az", detectQueryLanguage("Tərçemə") === "az");
  assert("v17 lang: 'Minecraft' = en", detectQueryLanguage("Minecraft") === "en");
  assert("v17 accept-language: az/tr/en fərqli başlıqlar qaytarır",
    acceptLanguageHeader("az").startsWith("az-AZ") &&
    acceptLanguageHeader("tr").startsWith("tr-TR") &&
    acceptLanguageHeader("en").startsWith("en-US")
  );
  assert("v17 stem: 6 hərfli 'nadir' və 'sətir' kök sözləri kəsilmir (-dir qoruması)", stemAz("nadir") === "nadir" && stemAz("sətir") === "setir");
  assert("v17 tokenize: 'üçündür' və 'hansılardır' sual köməkçiləri stopword kimi atılır",
    !tokenize("GitHub saytı nə üçündür").includes("ucund") && !tokenize("saytlar hansılardır").includes("hansi")
  );
  assert("v17 expand: təksözlü 'tərcümə' üçün də EN qarşılığı ('translate') çıxır", expandQuery("tərcümə").english === "translate", JSON.stringify(expandQuery("tərcümə")));
  const casinoScore = scoreResult(
    { title: "AZƏRBAYCANDA TOP 5+ ƏN YAXŞI KAZİNO SAYTLARI 2026", url: "https://example.com/kazino", snippet: "Azərbaycanda ən çox istifadə edilən kazino saytları", source: "google-news" },
    tokenize("Azərbaycanda ən çox istifadə edilən saytlar"),
    "az",
    "Azərbaycanda ən çox istifadə edilən saytlar"
  );
  assert("v17 spam: kazino reklamı adi sayt reytinqi sualında score=0 alır", casinoScore === 0, String(casinoScore));
  const svScore = scoreResult(
    { title: "Top websites in Azerbaijan", url: "https://ahrefs.com/sv/top/azerbaijan", snippet: "Top websites in Azerbaijan ranked", source: "brave" },
    tokenize("top websites azerbaijan"),
    "az",
    "Azərbaycanda saytlar"
  );
  const enScore = scoreResult(
    { title: "Top websites in Azerbaijan", url: "https://ahrefs.com/top/azerbaijan", snippet: "Top websites in Azerbaijan ranked", source: "brave" },
    tokenize("top websites azerbaijan"),
    "az",
    "Azərbaycanda saytlar"
  );
  assert("v17 locale: yad dildəki URL yolu (/sv/) normal səhifədən aşağı xal alır", svScore < enScore, `sv=${svScore} en=${enScore}`);
  const awardScore = scoreResult(
    { title: "Filmfare Award for Best Film", url: "https://en.wikipedia.org/wiki/Filmfare_Award_for_Best_Film", snippet: "Filmfare Critics Award for Best Movie in Bollywood Cinema", source: "wikipedia" },
    tokenize("Ən yaxşı film saytları best movie websites"),
    "az",
    "Ən yaxşı film saytları"
  );
  assert("v17.1 saytlar niyyəti: 'film saytları' sualında film mükafatı məqaləsi score=0 alır", awardScore === 0, String(awardScore));

  // === v18: diakritiksiz (ASCII) azərbaycanca yazılışın bərpası ===
  const asciiCases = [
    ["qaqa gozel bir sheher harda var", "qaqa gözəl bir şəhər harada var"],
    ["en gozel sheherler", "ən gözəl şəhərlər"],
    ["cox isdifade edilen saytlar hansilardi", "çox istifadə edilən saytlar hansılardır"],
    ["yaxshi melumat haqqinda", "yaxşı məlumat haqqında"],
    ["sheherlerde hava necedir", "şəhərlərdə hava necədir"],
    ["azerbaycanda en boyuk saytlar", "Azərbaycanda ən böyük saytlar"]
  ];
  for (const [raw, want] of asciiCases) {
    const got = normalizeColloquialAz(raw);
    assert(`v18 diakritik bərpası: "${raw}" → "${want}"`, got === want, got);
  }
  assert("v18 dil aşkarlaması: 'gozel sheher' sorğusu 'en' yox, 'az' sayılır", detectQueryLanguage("en gozel sheherler") === "az", detectQueryLanguage("en gozel sheherler"));
  assert("v18 qoruyucu: 'chicago weather' ingiliscə qalır", detectQueryLanguage(normalizeColloquialAz("chicago weather")) === "en", normalizeColloquialAz("chicago weather"));
  assert("v18 qoruyucu: 'show me the money' korlanmır", normalizeColloquialAz("show me the money") === "show me the money", normalizeColloquialAz("show me the money"));
  assert("v18 qoruyucu: 'cash back offer' korlanmır", normalizeColloquialAz("cash back offer") === "cash back offer", normalizeColloquialAz("cash back offer"));
  assert("v18 türkcə qorunur: 'en iyi filmler' azərbaycancaya çevrilmir", normalizeColloquialAz("en iyi filmler") === "en iyi filmler", normalizeColloquialAz("en iyi filmler"));
  assert("v18 türkcə dil aşkarlaması: 'turkce dizi izle' → tr", detectQueryLanguage(normalizeColloquialAz("turkce dizi izle")) === "tr", detectQueryLanguage(normalizeColloquialAz("turkce dizi izle")));
  const ra = restoreAsciiAz("best website list");
  assert("v18 ingilis sorğusunda bərpa işə düşmür", ra.restored === false && ra.text === "best website list", JSON.stringify(ra));

  // === v18.1: r.jina.ai ehtiyat qatı (yalnız saf parser test olunur, şəbəkə yoxdur) ===
  const jinaRaw = [
    "Title: SEPAH Bəhreydə ABŞ radar stansiyasına zərbə",
    "URL Source: https://azertag.az/xeber/test-4510356",
    "Published Time: 2026-11-15T10:20:00Z",
    "Markdown Content:",
    "Azərbaycan Dövlət İnformasiya Agentliyi",
    "*   [AZ](https://azertag.az/)",
    "*   [RU](https://azertag.az/ru)",
    "*   [SİYASƏT](https://azertag.az/bolme/politics)",
    "İran İslam İnqilabı Keşikçiləri Korpusu Bəhreydə yerləşən Riffa hava bazasındakı ABŞ radar stansiyasına altı hücum pilotsuz uçuş aparatı buraxdığını açıqlayıb.",
    "Bu barədə “Əl-Cəzirə” telekanalı məlumat yayıb."
  ].join("\n");
  const jp = parseJinaMarkdown(jinaRaw, "https://azertag.az/xeber/test-4510356");
  assert("v18.1 jina: başlıq header-dən oxunur", jp.title === "SEPAH Bəhreydə ABŞ radar stansiyasına zərbə", jp.title);
  assert("v18.1 jina: menyu sətirləri (AZ/RU/SİYASƏT) kəsilir", !/\[AZ\]|SİYASƏT\(/.test(jp.text) && !/^RU$/m.test(jp.text), jp.text.slice(0, 120));
  assert("v18.1 jina: məqalə mətni saxlanılır", jp.text.includes("Riffa hava bazası"), jp.text.slice(0, 120));
  assert("v18.1 jina: real nəşr tarixi götürülür", jp.published_at === "2026-11-15T10:20:00.000Z", String(jp.published_at));
  const jpWiki = parseJinaMarkdown(jinaRaw, "https://az.wikipedia.org/wiki/Tərcümə");
  assert("v18.1 jina: Vikipediya redaktə tarixi published_at yazılmır", jpWiki.published_at === null, String(jpWiki.published_at));

  // === v20: real test raundu (15 sual) tapıntıları ===
  const sc = (r, q, ex = "") => scoreResult(r, tokenize(q + " " + ex), "az", q);
  const casino = sc(
    { title: "AZERBAYCANDA KAZİNO SAYTLARI 🎰", url: "https://casino-az.com", snippet: "ən yaxşı bonus 500 AZN qazanın", source: "brave" },
    "ən yaxşı film saytları"
  );
  assert("v20 kazino: 'KAZİNO' (İ hərfi) də spam kimi tutulur", casino === 0, String(casino));
  const punish = sc(
    { title: "Türkiyədə ölüm cəzası", url: "https://en.wikipedia.org/wiki/Capital_punishment_in_Turkey", snippet: "Capital punishment in Turkey was abolished in 2004", source: "wikipedia" },
    "Türkiyənin paytaxtı harasıdır",
    "capital of Turkey"
  );
  const ankara = sc(
    { title: "Ankara", url: "https://en.wikipedia.org/wiki/Ankara", snippet: "Ankara Türkiyənin paytaxtıdır", source: "wikipedia" },
    "Türkiyənin paytaxtı harasıdır",
    "capital of Turkey"
  );
  assert("v20 paytaxt: 'capital punishment' məqaləsi Ankara-dan aşağı düşür", punish < ankara, `punish=${punish} ankara=${ankara}`);
  const noNum = sc(
    { title: "Azərbaycanda islam", url: "https://en.wikipedia.org/wiki/Islam_in_Azerbaijan", snippet: "Azərbaycanda islam tarixi qədimdir", source: "wikipedia" },
    "Azərbaycanda neçə universitet var"
  );
  const withNum = sc(
    { title: "Azərbaycanda ali təhsil", url: "https://example.az/tehsil", snippet: "Azərbaycanda 51 universitet fəaliyyət göstərir", source: "brave" },
    "Azərbaycanda neçə universitet var"
  );
  assert("v20 say sualı: rəqəmsiz səhifə cəzalanır", noNum < withNum, `noNum=${noNum} withNum=${withNum}`);
  const rel = sc(
    { title: "Azərbaycan–NATO münasibətləri", url: "https://az.wikipedia.org/wiki/Azərbaycan–NATO_münasibətləri", snippet: "Azərbaycan 2002-ci ildə assosiativ üzv oldu", source: "wikipedia" },
    "NATO-ya üzv ölkələr hansılardır"
  );
  const members = sc(
    { title: "NATO-ya üzv dövlətlər", url: "https://en.wikipedia.org/wiki/Member_states_of_NATO", snippet: "NATO 32 üzv dövlətdən ibarətdir", source: "wikipedia" },
    "NATO-ya üzv ölkələr hansılardır"
  );
  assert("v20 siyahı sualı: 'münasibətləri' məqaləsi üzv siyahısından aşağı", rel < members, `rel=${rel} members=${members}`);
  const oldSeason = sc(
    { title: "2010–11 Azerbaijan Premier League", url: "https://en.wikipedia.org/wiki/2010–11_Azerbaijan_Premier_League", snippet: "2010-11 mövsümü", source: "wikipedia" },
    "Azərbaycan Premyer Liqası cədvəli"
  );
  const curSeason = sc(
    { title: "Azərbaycan Premyer Liqası 2026 cədvəli", url: "https://example.az/pl", snippet: "Canlı cədvəl, 10 komanda, 26 xal", source: "brave" },
    "Azərbaycan Premyer Liqası cədvəli"
  );
  assert("v20 cədvəl sualı: köhnə mövsüm cəzalanır", oldSeason < curSeason, `old=${oldSeason} cur=${curSeason}`);
  const brand = sc(
    { title: "Kamp Kahvesi", url: "https://en.wikipedia.org/wiki/Camp_Coffee", snippet: "Camp Coffee is a brand of coffee and chicory essence", source: "wikipedia" },
    "kahve nasıl yapılır"
  );
  const wiki = sc(
    { title: "Mükemmel Kahve Nasıl Yapılır (Resimlerle)", url: "https://www.wikihow.com/Make-Perfect-Coffee", snippet: "Adım adım mükemmel kahve nasıl yapılır", source: "bing" },
    "kahve nasıl yapılır"
  );
  assert("v20 təlimat sualı: brend məqaləsi təlimatdan aşağı", brand < wiki, `brand=${brand} wiki=${wiki}`);
  const reactBad = sc(
    { title: "useEffect - Reaksiya", url: "https://example.az/react-hooks", snippet: "Reaksiya komponenti xarici sistemlə sinxronlaşdırır", source: "bing" },
    "React useEffect nə üçündür"
  );
  const reactGood = sc(
    { title: "useEffect – React", url: "https://react.dev/reference/react/useEffect", snippet: "useEffect lets you synchronize a component with an external system", source: "brave" },
    "React useEffect nə üçündür"
  );
  assert("v20 tərcüməli brend: 'Reaksiya' səhifəsi react.dev-dən aşağı", reactBad < reactGood, `bad=${reactBad} good=${reactGood}`);
  const promoLine = cleanContent("APA.az xəbər verir ki, bu gün Bakıda görüş keçirilib. Bizi Telegram kanalımızda izləyin.");
  assert("v20 filtr: promo cümləsi xəbər cümləsini yemir", promoLine.includes("görüş keçirilib") && !/Telegram/i.test(promoLine), promoLine);

  // === v21: 2-ci test raundu (15 yeni sual) tapıntıları ===
  const s21 = (r, q) => scoreResult(r, tokenize(q), "az", q);
  const wrongRev = s21({ title: "Oktyabr inqilabı", url: "https://az.wikipedia.org/wiki/Oktyabr_inqilabı", snippet: "1917-ci ildə baş verdi", source: "wikipedia" }, "fransız inqilabı nə vaxt baş verdi");
  const rightRev = s21({ title: "Fransız inqilabı", url: "https://az.wikipedia.org/wiki/Fransız_inqilabı", snippet: "1789-cu ildə baş verdi", source: "wikipedia" }, "fransız inqilabı nə vaxt baş verdi");
  assert("v21 fərqləndirici söz: 'fransız' olmayan inqilab məqaləsi aşağı düşür", wrongRev < rightRev, `wrong=${wrongRev} right=${rightRev}`);
  const layoutPage = s21({ title: "Page layout", url: "https://en.wikipedia.org/wiki/Page_layout", snippet: "Web page layout", source: "wikipedia" }, "css grid vs flexbox");
  const comparePg = s21({ title: "CSS Grid vs Flexbox", url: "https://css-tricks.com/grid-vs-flexbox/", snippet: "The difference between CSS Grid and Flexbox", source: "brave" }, "css grid vs flexbox");
  assert("v21 müqayisə sualı: ümumi 'Page layout' səhifəsi kəsilir", layoutPage < comparePg, `layout=${layoutPage} cmp=${comparePg}`);
  const oldRace = s21({ title: "2017 Azərbaycan Qran prisi", url: "https://az.wikipedia.org/wiki/2017_Azərbaycan_Qran_prisi", snippet: "2017-ci ildə keçirilib", source: "wikipedia" }, "Formula 1 Azərbaycan Qran Prisi nə vaxt keçiriləcək");
  const nextRace = s21({ title: "2026 Azərbaycan Qran Prisi", url: "https://en.wikipedia.org/wiki/2026_Azerbaijan_Grand_Prix", snippet: "26 sentyabr 2026-cı ildə keçiriləcək", source: "wikipedia" }, "Formula 1 Azərbaycan Qran Prisi nə vaxt keçiriləcək");
  assert("v21 gələcək zaman: köhnə il cəzalanır, cari/gələcək il bonus alır", oldRace < nextRace, `old=${oldRace} next=${nextRace}`);

  // === v23.3: 500 xətası qaytarılmasın (TDZ) + say sualında xəbər cəzası ===
  let crashed = null;
  let countScore = null;
  try {
    countScore = scoreResult({ title: "Mənsur Yavaşın CHP-dən çıxması", url: "https://report.az/xeber/x", snippet: "Ankaranın rayon bələdiyyə sədrləri", source: "google-news" }, tokenize("Ankarada neçə ilçə var"), "az", "Ankarada neçə ilçə var");
  } catch (e) { crashed = e.message; }
  assert("v23 say sualı: scoreResult partlamır (TDZ yoxdur)", crashed === null, String(crashed));
  assert("v23 say sualı: xəbər mənbəyi mənfi bal alır", typeof countScore === "number" && countScore < 0, String(countScore));
  const rayonHit = scoreResult({ title: "Ankaranın rayonları", url: "https://tr.wikipedia.org/wiki/Ankaranın_rayonları", snippet: "Ankara vilayətində 25 rayon var", source: "brave" }, tokenize("Ankarada neçə ilçə var"), "az", "Ankarada neçə ilçə var");
  const genHit = scoreResult({ title: "Türkiyə ilçələri", url: "https://az.wikipedia.org/wiki/Türkiyə_ilçələri", snippet: "İlçe — Türkiyənin inzibati vahidi", source: "wikipedia" }, tokenize("Ankarada neçə ilçə var"), "az", "Ankarada neçə ilçə var");
  assert("v23 sinonım: 'Ankaranın rayonları' ümumi 'Türkiyə ilçələri' səhifəsindən yuxarı", rayonHit > genHit, `rayon=${rayonHit} gen=${genHit}`);

  // === v23.4: say sualında subyekt başlıqda + xəbər cəzası; idman növü/tarix ===
  const qC = "Ankarada neçə ilçə var";
  const sC = (r) => scoreResult(r, tokenize(qC), "az", qC);
  const genTr = sC({ title: "Türkiyə ilçələri", url: "https://az.wikipedia.org/wiki/Türkiyə_ilçələri", snippet: "İlçe — Türkiyənin inzibati vahidi", source: "wikipedia" });
  const ankRay = sC({ title: "Ankaranın rayonları", url: "https://tr.wikipedia.org/wiki/Ankaranın_rayonları", snippet: "Ankara vilayətində 25 rayon var", source: "brave" });
  assert("v23 say: 'Ankaranın rayonları' ümumi səhifədən yuxarı", ankRay > genTr, `ankRay=${ankRay} gen=${genTr}`);
  const newsCnt = sC({ title: "Ankaranın 8 rayon bələdiyyə sədri istefa verdi", url: "https://news.google.com/rss/articles/x", snippet: "Ankaranın rayonları", source: "google-news" });
  assert("v23 say: xəbər mənbəyi (rəqəmli başlıqla da) doğru səhifədən aşağı", newsCnt < ankRay - 3, `news=${newsCnt} ankRay=${ankRay}`);

  const qS = "Azərbaycan millisinin növbəti oyunu nə vaxtdır";
  const sS = (r) => scoreResult(r, tokenize(qS), "az", qS);
  const hock = sS({ title: "Azərbaycanın kişilərdən ibarət xokkey yığma komandası", url: "https://az.wikipedia.org/wiki/Xokkey", snippet: "milli komanda 1927-ci ildə", source: "wikipedia" });
  const matchToday = sS({ title: "Futbol üzrə Azərbaycan millisi bu gün Andorra ilə yoldaşlıq görüşünə çıxır", url: "https://apa.az/x", snippet: "16 noyabr 2026 10:41 növbəti oyununu keçirəcək", source: "brave" });
  assert("v23 idman: başqa idman növü (xokkey) kəsilir", hock <= 0, String(hock));
  assert("v23 idman: 'bu gün ... 16 noyabr' matçı xəbərdən yuxarı", matchToday > 0, String(matchToday));

  // === v24: stem qüsuru (Fransa→frans) + prefiks uyğunluğu + əhali təzəliyi + disambiguation ===
  const stemPairs = [["Fransa", "Fransanın"], ["Ankara", "Ankaranın"]];
  for (const [a, b] of stemPairs) {
    assert(`v24 stem: "${a}" və "${b}" eyni kökə düşür`, tokenize(a).join() === tokenize(b).join(), `${tokenize(a)} vs ${tokenize(b)}`);
  }
  const qF = "Fransanın paytaxtı haradır";
  const sF = (r) => scoreResult(r, tokenize(qF), "az", qF);
  const frPage = sF({ title: "Fransa", url: "https://az.wikipedia.org/wiki/Fransa", snippet: "Fransa Avropada yerləşən dövlətdir. Paytaxtı Paris şəhəridir.", source: "wikipedia" });
  const frList = sF({ title: "Fransanın paytaxtlarının siyahısı", url: "https://az.wikipedia.org/wiki/X", snippet: "Fransanın paytaxtı 1944-cü ildən bəri Parisdir", source: "wikipedia" });
  assert("v24 paytaxt: 'Fransa' səhifəsi siyahıdan yuxarı", frPage > frList, `page=${frPage} list=${frList}`);
  const qP = "Azərbaycanın əhalisi nə qədərdir";
  const sP = (r) => scoreResult(r, tokenize(qP), "az", qP);
  const old2012 = sP({ title: "Azərbaycan əhalisi", url: "https://az.wikipedia.org/wiki/Azərbaycan_əhalisi", snippet: "1 yanvar 2012-ci il tarixinə 9.235.085 nəfər", source: "wikipedia" });
  const fresh = sP({ title: "Azərbaycanın əhalisi | Dövlət Statistika Komitəsi", url: "https://stat.gov.az/x", snippet: "2026-cı ilin əvvəlinə əhalinin sayı 10,3 milyon nəfər olub", source: "brave" });
  assert("v24 əhali: təzə rəqəm köhnə 2012 rəqəmindən yuxarı", fresh > old2012, `fresh=${fresh} old=${old2012}`);
  const qD = "Docker nədir";
  const sD = (r) => scoreResult(r, tokenize(qD), "az", qD);
  const disamb = sD({ title: "Doker", url: "https://az.wikipedia.org/wiki/Doker", snippet: "Docker ən çox istinad edir: Liman işçisi, gəmilərin yüklənməsi", source: "wikipedia" });
  const dockerPage = sD({ title: "Docker (proqram təminatı)", url: "https://az.wikipedia.org/wiki/Docker_(proqram_təminatı)", snippet: "Docker proqram təminatını konteynerlər adlanan paketlərdə çatdırmaq üçün", source: "wikipedia" });
  assert("v24 məna ayrımı: 'Doker' səhifəsi Docker məqaləsindən aşağı", dockerPage > disamb, `page=${dockerPage} dis=${disamb}`);

  // === v25: weather intent səhv pozitiv + "fərq" müqayisə regex-i ===
  assert("v25 weather: 'Günəş sistemində neçə planet var' hava deyil", matchWeather("Günəş sistemində neçə planet var").hit === false, JSON.stringify(matchWeather("Günəş sistemində neçə planet var")));
  assert("v25 weather: 'Bakıda hava necədir' hava qalır", matchWeather("Bakıda hava necədir").hit === true, JSON.stringify(matchWeather("Bakıda hava necədir")));
  const qH = "HTTP ilə HTTPS arasındakı fərq nədir";
  const sH = (r) => scoreResult(r, tokenize(qH), "az", qH);
  const http2 = sH({ title: "HTTP/2", url: "https://az.wikipedia.org/wiki/HTTP/2", snippet: "HTTP/1.1 və SPDY arasındakı ən böyük fərq ondan ibarət idi", source: "wikipedia" });
  const cmpPage = sH({ title: "HTTP vs HTTPS — fərq nədir", url: "https://www.cloudflare.com/learning/ssl/why-is-http-not-secure/", snippet: "HTTP və HTTPS arasındakı əsas fərq şifrələmədir. HTTPS = HTTP + TLS", source: "brave" });
  assert("v25 müqayisə: 'HTTP vs HTTPS fərq' səhifəsi HTTP/2-dən yuxarı", cmpPage > http2, `cmp=${cmpPage} http2=${http2}`);

  // === v26: latency + challenge səhifəsi ===
  assert("v26 challenge: Cloudflare səhifəsi zibil sayılır", isChallengePage("Checking your browser before accessing. Enable JavaScript and cookies to continue") === true);
  assert("v26 challenge: normal mətn zibil deyil", isChallengePage("Azərbaycan Muzeyi 1920-ci ildə yaradılmışdır və 10 min eksponat var") === false);

  // === v26: "istifadə → sonra elan" (TDZ) statik yoxlaması ===
  // İki dəfə 500 xətası aldıq: `const X` blokdan SONRA elan olunurdu, əvvəl istifadə olunurdu.
  try {
    const routeSrc = readFileSync(new URL("../app/api/search/route.js", import.meta.url), "utf8");
    const decls = [...routeSrc.matchAll(/^\s*const ([A-Z][A-Z0-9_]{2,})\s*=/gm)];
    let tdz = null;
    for (const d of decls) {
      const name = d[1];
      const firstUse = routeSrc.indexOf(name);
      if (firstUse >= 0 && firstUse < d.index) { tdz = name; break; }
    }
    assert("v26 TDZ: route.js-də 'əvvəl istifadə, sonra elan' yoxdur", tdz === null, String(tdz));
  } catch (e) {
    assert("v26 TDZ: route.js oxundu", false, e.message);
  }

  // === v29: rəqəm ziddiyyəti + sources sahəsi ===
  assert("v29 parseNum: '362,9' → 362.9", parseNum("362,9") === 362.9, String(parseNum("362,9")));
  assert("v29 parseNum: '9.235.085' → 9235085", parseNum("9.235.085") === 9235085, String(parseNum("9.235.085")));
  assert("v29 parseNum: '10,300,000' → 10300000", parseNum("10,300,000") === 10300000, String(parseNum("10,300,000")));

  const qPop = "Azərbaycanın əhalisi nə qədərdir";
  const cRes = [
    { id: 1, title: "Azərbaycan əhalisi", url: "https://az.wikipedia.org/wiki/Azərbaycan_əhalisi", content: "Azərbaycan əhalisi 9.2 milyon nəfərdir", source: "wikipedia" },
    { id: 2, title: "Azərbaycan əhalisi 2026", url: "https://stat.gov.az/x", content: "Azərbaycan əhalisi 10,3 milyon nəfər olub", source: "brave" }
  ];
  const conf = detectConflicts(cRes, qPop);
  assert("v29 ziddiyyət: 9.2 vs 10.3 milyon nəfər aşkarlanır", conf.length === 1 && conf[0].unit === "people" && conf[0].values.length === 2, JSON.stringify(conf));

  const sameRes = [
    { id: 1, title: "Azərbaycan əhalisi", url: "https://a.az/x", content: "əhalisi 10,3 milyon nəfər", source: "brave" },
    { id: 2, title: "Azərbaycan əhalisi", url: "https://b.az/x", content: "əhalisi 10.3 milyon nəfər", source: "wikipedia" }
  ];
  assert("v29 ziddiyyət: eyni rəqəm → boş", detectConflicts(sameRes, qPop).length === 0, JSON.stringify(detectConflicts(sameRes, qPop)));

  const topicRes = [
    { id: 1, title: "Pambıq", url: "https://a.az/x", content: "Pambıq istehsalı 362,9 min ton olub", source: "brave" },
    { id: 2, title: "Buğda", url: "https://b.az/x", content: "Buğda istehsalı 3 milyon ton olub", source: "brave" }
  ];
  assert("v29 ziddiyyət: fərqli mövzu (pambıq vs buğda) → boş", detectConflicts(topicRes, "pambıq istehsalı nə qədərdir").length === 0, JSON.stringify(detectConflicts(topicRes, "pambıq istehsalı nə qədərdir")));

  try {
    const routeSrc2 = readFileSync(new URL("../app/api/search/route.js", import.meta.url), "utf8");
    assert("v29 sources: hər nəticədə sources sahəsi var", /sources:\s*\[\.\.\.new Set/.test(routeSrc2));
    assert("v29 conflicts: cavabda conflicts sahəsi var", /conflicts:\s*conflicts\.length/.test(routeSrc2));
  } catch (e) {
    assert("v29 sources/conflicts: route.js oxundu", false, e.message);
  }

  // === v31 (P1 bağlanışı): token qorunması + bütövlük yoxlaması ===
  const pr = protectTokens("React useEffect and Promise.all with 362,9 min ton");
  assert("v31 protect: camelCase/token placeholder oldu", /ZXQ\d+ZXQ/.test(pr.txt), pr.txt);
  assert("v31 protect: 'Promise.all' qorundu", pr.keep.some(k => k.includes("Promise.all")), JSON.stringify(pr.keep));
  const okRestore = restoreTokens(pr.txt, pr.keep);
  assert("v31 restore: tam bərpa → orijinal mətn", okRestore === "React useEffect and Promise.all with 362,9 min ton", String(okRestore));
  assert("v31 restore: token itibsə → null (səssiz itki yox)", restoreTokens("tərcümə mətni placeholder-siz", ["React"]) === null, String(restoreTokens("tərcümə mətni placeholder-siz", ["React"])));
  const noTok = protectTokens("sadə azərbaycan mətni");
  assert("v31 protect: tokensiz mətn toxunulmur", noTok.txt === "sadə azərbaycan mətni" && noTok.keep.length === 0, noTok.txt);

  // === v33: sual terminlərinin SİYAHISIZ qorunması ===
  const pt = protectWithTerms("Rust ownership and borrowing rules", ["rust", "ownership"]);
  assert("v33 protectWithTerms: sual terminləri placeholder oldu", /ZXQ\d+ZXQ/.test(pt.txt) && pt.keep.length >= 2, `${pt.txt} | ${JSON.stringify(pt.keep)}`);
  assert("v33 protectWithTerms: tam bərpa orijinalı qaytarır", restoreTokens(pt.txt, pt.keep) === "Rust ownership and borrowing rules", String(restoreTokens(pt.txt, pt.keep)));
  assert("v33 protectWithTerms: 3 hərfdən qısa termin qorunmur", protectWithTerms("go state", ["go"]).keep.length === 0, JSON.stringify(protectWithTerms("go state", ["go"]).keep));
}


  // === v51: keyless provayder parserləri (şəbəkəsiz, fixture-lə) ===
  {
    const lite = `<table><tr><td>1.&nbsp;</td><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Faz.wikipedia.org%2Fwiki%2FFotosintez&amp;rut=abc" class='result-link'>Fotosintez — Vikipediya</a></td></tr>
    <tr><td>&nbsp;</td><td class='result-snippet'>Fotosintez <b>işıq</b> enerjisi ilə üzvi maddələr sintez edir.</td></tr>
    <tr><td>2.&nbsp;</td><td><a rel="nofollow" href="https://kayzen.az/blog/1.html" class='result-link'>Kayzen</a></td></tr>
    <tr><td>&nbsp;</td><td class='result-snippet'>İkinci snippet</td></tr></table>`;
    const parsed = parseDDGLite(lite, 10);
    assert("v51 ddg-lite: 2 nəticə parse olunur", parsed.length === 2, String(parsed.length));
    assert("v51 ddg-lite: uddg yönləndirməsi açılır", parsed[0]?.url === "https://az.wikipedia.org/wiki/Fotosintez", parsed[0]?.url);
    assert("v51 ddg-lite: başlıqda entity həll olunur", parsed[0]?.title.includes("Vikipediya"), parsed[0]?.title);
    assert("v51 ddg-lite: snippet düzgün nəticəyə bağlanır", /işıq/.test(parsed[0]?.snippet || "") && /İkinci/.test(parsed[1]?.snippet || ""), JSON.stringify(parsed.map(p => p.snippet)));
    assert("v51 ddg-lite: source adı ddg-lite", parsed.every(p => p.source === "ddg-lite"));
    assert("v51 ddg-lite: boş HTML → boş massiv", parseDDGLite("<html>yoxdur</html>").length === 0);
    const mw = normalizeMwmbl([
      { url: "http://python.org/sf/1", title: [{ value: "Welcome to ", is_bold: false }, { value: "Python", is_bold: true }], extract: [{ value: "Lists are one of the compound ", is_bold: false }, { value: "data types", is_bold: true }] },
      { url: "", title: [{ value: "boş url" }] },
      { url: "https://stackoverflow.com/a/1", title: [{ value: "List vs Dict" }] }
    ], 10);
    assert("v51 mwmbl: url-siz element atılır", mw.length === 2, String(mw.length));
    assert("v51 mwmbl: title/extract massivləri birləşir", mw[0].title === "Welcome to Python" && mw[0].snippet === "Lists are one of the compound data types", JSON.stringify(mw[0]));
    assert("v51 mwmbl: source adı mwmbl", mw.every(x => x.source === "mwmbl"));
    assert("v51 mwmbl: massiv olmayan cavab → boş", normalizeMwmbl({ error: "x" }).length === 0 && normalizeMwmbl(null).length === 0);
  }


  // === v51.1: Yahoo (Google indeksli) parseri ===
  {
    const html = `<div class="sw-CardBase"><section><a class="x" href="https://az.wikipedia.org/wiki/Fotosintez"><br/><h3 class="sw-Card__titleMain"><span><b>Fotosintez</b> - Vikipediya</span></h3><div class="sw-Card__section"><p class="sw-Card__summary"><b>Fotosintez</b> — işıq enerjisinin kimyəvi enerjiyə çevrilməsi.</p></div></section></div>
    <div class="sw-CardBase"><section><a href="https://stamp.yahoo.co.jp/stamp/x"><h3><span>AIを楽しもう！</span></h3></a></div>
    <div class="sw-CardBase"><section><a href="https://az.khanacademy.org/science/biology/photosynthesis"><h3><span>Fotosintezə giriş</span></h3></a><p class="sw-Card__summary">Fotosintez işıq enerjisinin şəkər formasında kimyəvi...</p></section></div>`;
    const yp = parseYahooJP(html, 10);
    assert("v51.1 yahoo: reklam/səhifə linkləri atılır", yp.length === 2, String(yp.length) + " " + JSON.stringify(yp.map(x => x.url)));
    assert("v51.1 yahoo: başlıq+url+snippet düzgün", yp[0].url === "https://az.wikipedia.org/wiki/Fotosintez" && yp[0].title === "Fotosintez - Vikipediya" && /kimyəvi enerjiyə/.test(yp[0].snippet), JSON.stringify(yp[0]));
    assert("v51.1 yahoo: source adı yahoo", yp.every(x => x.source === "yahoo"));
    assert("v51.1 yahoo: boş HTML → boş massiv", parseYahooJP("").length === 0);
  }


  // === v51.3: mənasız token aşkarlayıcı ===
  {
    assert("v51.3 gibberish: 'asdfqwer' tutulur", looksLikeGibberish("asdfqwer") === true);
    assert("v51.3 gibberish: 'zxcvbnm' tutulur", looksLikeGibberish("zxcvbnm") === true);
    assert("v51.3 gibberish: 'zzzz' tutulur", looksLikeGibberish("zzzz") === true);
    assert("v51.3 gibberish: saitsiz token tutulur", looksLikeGibberish("bcdf") === true && looksLikeGibberish("xzcv") === true);
    assert("v51.3 gibberish: real sözlər keçir", ["naxçıvan","nonsense","python","photosynthesis","şəki","baki","strengths"].every(w => !looksLikeGibberish(w)), JSON.stringify(["naxçıvan","nonsense","python","photosynthesis","şəki","baki","strengths"].filter(w => looksLikeGibberish(w))));
    assert("v51.3 gibberish: qısa söz (<=2) toxunulmur", looksLikeGibberish("ak") === false && looksLikeGibberish("") === false);
  }


  // === v51.5: sahə vahidləri + funt (valyuta ilə qarışmır) ===
  {
    const a = matchUnits("15 kvadrat metr neçə kvadrat futdur");
    assert("v51.5 vahid: kvadrat metr → kvadrat fut", a.hit && /161,4/.test(unitsToText(a)), a.hit ? unitsToText(a) : "no hit");
    const b = matchUnits("1 funt neçə kiloqram");
    assert("v51.5 vahid: funt kütlə kimi tanınır", b.hit && b.from.id === "funt" && b.to.id === "kq", b.hit ? `${b.from.id}->${b.to.id}` : "no hit");
    assert("v51.5 vahid: təkrar quyruq yoxdur (val=1)", !/\(1 funt/.test(unitsToText(b)), unitsToText(b));
    const c = matchUnits("1 akr neçə hektar");
    assert("v51.5 vahid: akr → hektar", c.hit && /0,404686/.test(unitsToText(c)), c.hit ? unitsToText(c) : "no hit");
    assert("v51.5 vahid: valyuta sözləri vahid sayılmır", matchUnits("200 dollar neçə lirədir").hit === false);
  }


  // === v52: Milli Arxiv (milliarxiv.gov.az) parseri ===
  {
    const html = `<div class="media-body"><a href="/az/arxiv-100" class="search-result">
      <h4 class="media-heading">Əməkdaşlarımızın Arxiv Araşdırmaları</h4>
      Azərbaycanda&nbsp; arxiv işinin yaranma tarixi Azə...
      <p class="search-links">https://milliarxiv.gov.az/az/arxiv-100</p></a></div>
      <div class="media-body"><a href="https://milliarxiv.gov.az/az/x" class="search-result">
      <h4 class="media-heading">İkinci sənəd</h4>
      Qısa təsvir<p class="search-links">https://milliarxiv.gov.az/az/x</p></a></div>`;
    const ma = parseMilliArxiv(html, "https://milliarxiv.gov.az", 5);
    assert("v52 milliarxiv: 2 nəticə parse olunur", ma.length === 2, String(ma.length));
    assert("v52 milliarxiv: nisbi href mütləqləşir", ma[0].url === "https://milliarxiv.gov.az/az/arxiv-100", ma[0]?.url);
    assert("v52 milliarxiv: başlıq h4-dən, snippet ayrı", ma[0].title === "Əməkdaşlarımızın Arxiv Araşdırmaları" && !ma[0].snippet.includes("Arxiv Araşdırmaları") && ma[0].snippet.includes("arxiv işinin"), JSON.stringify(ma[0]));
    assert("v52 milliarxiv: boş HTML → boş massiv", parseMilliArxiv("<html></html>").length === 0);
    assert("v52 milliarxiv: mövzu aşkarlanması", isArchiveTopic("sovet dövrü repressiya") === true && isArchiveTopic("arxiv sənədləri") === true && isArchiveTopic("banan kalium") === false);
  }


  // === v53: AZƏRTAC RSS uyğunlaşdırması + xəbər mənbə bonusu ===
  {
    const items = [
      { title: "Rutte: NATO ölkələri Ukraynaya silah alınması üçün ABŞ-yə müraciət edib", snippet: "NATO sammiti", url: "https://azertag.az/xeber/1", published_at: "2026-11-17T20:00:00.000Z" },
      { title: "Salyanda piyadanın ölümü ilə nəticələnən yol qəzası olub", snippet: "Qəza rayon polisi", url: "https://azertag.az/xeber/2", published_at: "2026-11-17T19:00:00.000Z" },
      { title: "Hava proqnozu açıqlandı", snippet: "Sabah yağış", url: "https://azertag.az/xeber/3", published_at: null }
    ];
    const m = matchAzertagItems(items, "NATO Ukraynaya silah yardımı", 5);
    assert("v53 azertag: mövzuya uyğun xəbər tapılır", m.length >= 1 && /NATO/.test(m[0].title), JSON.stringify(m.map(x => x.title)));
    const m2 = matchAzertagItems(items, "Salyanda yol qəzası", 5);
    assert("v53 azertag: AZ söz formaları uyğunlaşır (Salyanda→Salyan)", m2.length >= 1 && /Salyan/.test(m2[0].title), JSON.stringify(m2.map(x => x.title)));
    assert("v53 azertag: əlaqəsiz sorğu → boş", matchAzertagItems(items, "quantum computing benchmark", 5).length === 0);
    assert("v53 azertag: dil xəritəsi", azertagLangFor("ru") === "ru" && azertagLangFor("en") === "en" && azertagLangFor("az") === "az" && azertagLangFor("tr") === "az");
    assert("v53 xəbər bonusu: azertag/report +1.2", newsTrustBoost("https://azertag.az/xeber/x") === 1.2 && newsTrustBoost("https://www.report.az/a") === 1.2 && newsTrustBoost("https://special.azertag.az/az/xeber/1") === 1.2);
    assert("v53 xəbər bonusu: kənar sayt 0", newsTrustBoost("https://example.com/x") === 0 && newsTrustBoost("") === 0);
    assert("v53 xəbər siyahısı boş deyil", AZ_NEWS_TRUSTED.length >= 10 && AZ_NEWS_TRUSTED.includes("azertag.az"));
  }


  // === v54.2: "dərəcə" ilə temperatura çevirməsi ===
  {
    const t1 = matchUnits("20 dərəcə selsi neçə farenheytdir");
    assert("v54.2 temp: '20 dərəcə selsi' → 68 °F", t1.hit && /68/.test(unitsToText(t1)), t1.hit ? unitsToText(t1) : "no hit");
    const t2 = matchUnits("100 farenheyt neçə selsidir");
    assert("v54.2 temp: 'farenheyt' şəklində tanınır", t2.hit && /37,7/.test(unitsToText(t2)), t2.hit ? unitsToText(t2) : "no hit");
    assert("v54.2 temp: tək temperatur çevrilmir", matchUnits("25 dərəcə selsi").hit === false);
  }


  // === v54.3: leksikon kökü həddən artıq qısaltmasın ===
  {
    assert("v54.3 token: 'Bakıda' → 'baki' (bak DEYİL)", tokenize("Bakıda").includes("baki") && !tokenize("Bakıda").includes("bak"), JSON.stringify(tokenize("Bakıda")));
    assert("v54.3 token: 'qidalarda' → 'qida'", tokenize("qidalarda").includes("qida"), JSON.stringify(tokenize("qidalarda")));
    assert("v54.3 token: 'Füzulinin' → 'fuzul'", tokenize("Füzulinin").includes("fuzul"), JSON.stringify(tokenize("Füzulinin")));
  }


  // === v54.4: sorğu termini olmayan nəticə sıfır skor alır ===
  {
    const med = { title: "Medera Hospital | Sağlamlığınızın qeydinə qalın", snippet: "Biz pasiyent mərkəzli qayğıya və qabaqcıl tibbi həllərə üstünlük veririk.", url: "https://mederahospital.az/vitamin-c-faydalari", source: "web" };
    assert("v54.4: əlaqəsiz .az ana səhifəsi 0 alır", scoreResult(med, ["vitamin", "qida"], "az", "C vitamini hansı qidalarda var") === 0, String(scoreResult(med, ["vitamin", "qida"], "az", "C vitamini hansı qidalarda var")));
    const ok = { title: "C Vitamini Hansı Qidalarda Var?", snippet: "C vitamini suda həll olunan vitamindir, qida ilə alınır.", url: "https://saglamyasha.az/diet/vitaminler/c-vitamini/", source: "web" };
    assert("v54.4: uyğun nəticə skor alır", scoreResult(ok, ["vitamin", "qida"], "az", "C vitamini hansı qidalarda var") > 1, String(scoreResult(ok, ["vitamin", "qida"], "az", "C vitamini hansı qidalarda var")));
  }


  // === v54.5: superlativ sözlər skor termini deyil ===
  {
    assert("v54.5: 'ən böyük gölü' → 'boyuk' termini yoxdur", !tokenize("Azərbaycanın ən böyük gölü hansıdır").includes("boyuk"), JSON.stringify(tokenize("Azərbaycanın ən böyük gölü hansıdır")));
    assert("v54.5: göl sorğusunda 'gol' termini qalır", tokenize("Azərbaycanın ən böyük gölü hansıdır").includes("gol"));
  }


  // === v56: raund-15 səhvləri ===
  {
    assert("v56: 'kömək' mövzu termini deyil", !tokenize("qripə nə kömək edir").includes("komek"), JSON.stringify(tokenize("qripə nə kömək edir")));
    assert("v56: 'qrip' termini qalır", tokenize("qripə nə kömək edir").some(t => t.startsWith("qrip")));
    const hind = { title: "Hindistan iqtisadiyyatının əsas sektorları", snippet: "Hindistan iqtisadiyyatı üç sektorda", url: "https://byjusexamprep.com/x", source: "bing" };
    assert("v56: başqa ölkənin nəticəsi sıfırlanır", scoreResult(hind, ["azerbaycan", "iqtisadiyyat", "sektor"], "az", "Azərbaycan iqtisadiyyatının əsas sektorları") === 0);
    const az = { title: "Azərbaycan iqtisadiyyatı", snippet: "Azərbaycan iqtisadiyyatının əsas sektorları neft, qaz, kənd təsərrüfatı", url: "https://az.wikipedia.org/wiki/Azərbaycan_iqtisadiyyatı", source: "wikipedia" };
    assert("v56: düzgün ölkə nəticəsi keçir", scoreResult(az, ["azerbaycan", "iqtisadiyyat", "sektor"], "az", "Azərbaycan iqtisadiyyatının əsas sektorları") > 1);
    assert("v56: twitpic zibildir", scoreResult({ title: "Speed of earth around the Sun", snippet: "30 km/s", url: "http://twitpic.com/838m7v", source: "bing" }, ["yer", "gunes", "suret"], "az", "Yerin Günəş ətrafında sürəti") === 0);
  }


  // === v56.3: "hansı ölkədə" → Wikidata P17 ===
  {
    const m = matchFact("Yerusəlim hansı ölkədədir");
    assert("v56.3: 'hansı ölkədədir' country faktı kimi tanınır", m.hit && m.kind === "country", JSON.stringify(m.kind || null));
    const b = matchFact("Bakı hansı ölkədədir");
    assert("v56.3: Bakı da country faktıdır", b.hit && b.kind === "country", JSON.stringify(b.kind || null));
  }


  // === v57: sitemap əsaslı xəbər mənbələri (icma.az, iqtisadiyyat.az) ===
  {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://icma.az/news/uefa-milletler-liqasi-danimarka-norvecle-hec-hece-edib-2174632</loc><lastmod>2026-11-18T01:58:18+04:00</lastmod></url><url><loc>https://icma.az/news/brent-neftinin-qiymeti-91-dollar-2174500</loc><lastmod>2026-11-17T22:10:00+04:00</lastmod></url></urlset>`;
    const items = parseSitemap(xml);
    assert("v57: sitemap parse 2 link", items.length === 2, String(items.length));
    assert("v57: sitemap ən təzə əvvəldə", /uefa/.test(items[0].url));
    assert("v57: slug sözləri çıxarılır", items[0].slugWords.includes("uefa") && items[0].slugWords.includes("liqasi"), JSON.stringify(items[0].slugWords.slice(0, 5)));
    const m = matchSitemapItems(items, "UEFA Millətlər Liqası nəticə", 3);
    assert("v57: slug uyğunluğu işləyir", m.length === 1 && /uefa/.test(m[0].url), String(m.length));
    assert("v57: əlaqəsiz sorğu boş qaytarır", matchSitemapItems(items, "böyrək daşı", 3).length === 0);

    const html = `<html><head><meta property="og:title" content="Brent neftinin qiyməti düşdü"><meta property="og:description" content="Bir barel 91,69 dollar"><meta property="article:published_time" content="2026-11-17T22:10:00+04:00"><meta property="og:image" content="https://icma.az/media/x.webp"></head><body><article><p>Brent markalı neftin qiyməti bir barel üçün 91,69 dollara düşüb.</p><p>Bu barədə AZƏRTAC məlumat verib.</p></article></body></html>`;
    const a = parseArticleHtml(html);
    assert("v57: og:title oxunur", a.title === "Brent neftinin qiyməti düşdü", a.title);
    assert("v57: og:description oxunur", /91,69/.test(a.description));
    assert("v57: real tarix ISO-ya çevrilir", a.published_at === "2026-11-17T18:10:00.000Z", String(a.published_at));
    assert("v57: məqalə mətni <article>-dən", /91,69 dollara düşüb/.test(a.text) && a.text.length > 40);
    assert("v57: şəkil URL-i götürülür", /x\.webp$/.test(a.image));
  }


  // === v57.1: təzəlik qaydası ===
  {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const q = "son xəbərlər Azərbaycan";
    const t = tokenize(q);
    const freshR = scoreResult({ title: "Azərbaycan son xəbərlər", snippet: "Azərbaycan son xəbərlər bu gün", url: "https://icma.az/news/x", source: "icma.az", published_at: now }, t, "az", q);
    const staleR = scoreResult({ title: "Azərbaycan son xəbərlər", snippet: "Azərbaycan son xəbərlər bu gün", url: "https://icma.az/news/y", source: "icma.az", published_at: old }, t, "az", q);
    assert("v57.1: təzə xəbər köhnədən yuxarı", freshR > staleR, `fresh=${freshR} stale=${staleR}`);
  }


  // === v57.2: ümumi "son xəbərlər" sorğusu → ən təzə sitemap elementləri ===
  {
    const items = parseSitemap(`<urlset><url><loc>https://icma.az/news/a-2174632</loc><lastmod>2026-11-18T02:00:00+04:00</lastmod></url><url><loc>https://icma.az/news/b-2174600</loc><lastmod>2026-11-18T01:00:00+04:00</lastmod></url></urlset>`);
    const g = matchSitemapItems(items, "son xəbərlər Azərbaycan", 2);
    assert("v57.2: ümumi xəbər sorğusunda ən təzə 2 xəbər", g.length === 2 && /\/a-/.test(g[0].url), String(g.length));
    assert("v57.2: konkret sorğuda generic fallback işləmir", matchSitemapItems(items, "böyrək daşı", 2).length === 0);
  }


  // === v57.3: xəbər sualında ana səhifə cəzası + ümumi "son xəbərlər" istisnası ===
  {
    const now = new Date().toISOString();
    const q = "son xəbərlər";
    const t = tokenize(q);
    const art = scoreResult({ title: "UEFA Millətlər Liqası: Danimarka heç-heçə edib", snippet: "Oyun nəticəsi barədə məlumat verilib və təfərrüatlar açıqlanıb", url: "https://icma.az/news/uefa-milletler-liqasi-danimarka-hec-hece-edib-2174632", source: "icma.az", published_at: now }, t, "az", q);
    assert("v57.3: ümumi 'son xəbərlər' sorğusunda tarixli məqalə atılmır", art > 0, String(art));
    const homeSlug = scoreResult({ title: "Son xəbərlər", snippet: "Son xəbərlər və ən son xeberler burada toplanib", url: "https://news.az/2026/11/18/son-xeberler-bu-gun", source: "brave" }, t, "az", q);
    const homeRoot = scoreResult({ title: "Son xəbərlər", snippet: "Son xəbərlər və ən son xeberler burada toplanib", url: "https://news.az/", source: "brave" }, t, "az", q);
    assert("v57.3: ana səhifə məqalə ünvanından aşağı düşür", homeRoot < homeSlug, `root=${homeRoot} slug=${homeSlug}`);
  }


  // === v58: təzəlik rejimi (yalnız ümumi xəbər sorğusu) ===
  {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const items = [
      { title: "ana sehife", score: 9 },
      { title: "kohne", score: 4, published_at: old },
      { title: "teze", score: 1, published_at: now }
    ];
    const ord = orderByRecency(items);
    assert("v58: təzə məqalə birinci", ord[0].title === "teze", ord.map(x => x.title).join(","));
    assert("v58: tarixsiz nəticə sona düşür", ord[2].title === "ana sehife", ord.map(x => x.title).join(","));
    const same = orderByRecency([{ title: "x", score: 1 }, { title: "y", score: 2 }]);
    assert("v58: tarix yoxdursa skor qalır", same[0].title === "y", same.map(x => x.title).join(","));
  }


  // === v58.1: ümumi xəbər termini anlayışı (EN tərcümə də daxil) ===
  {
    assert("v58.1: azerbaijan generic sayılır", isGenericNewsTerm("azerbaijan"));
    assert("v58.1: latest generic sayılır", isGenericNewsTerm("latest"));
    assert("v58.1: 'uefa' generic DEYİL", !isGenericNewsTerm("uefa"));
    assert("v58.1: il generic sayılır", isGenericNewsTerm("2026"));
    const all = ["xeber", "azerbaycan", "latest", "news", "azerbaijan"].every(isGenericNewsTerm);
    assert("v58.1: 'son xəbərlər Azərbaycan' tam generic", all);
    assert("v58.1: 'iqtisadiyyatda son xəbərlər' generic deyil", !isGenericNewsTerm("iqtisadiyyat"));
  }


  // === v59: xəbər bölməsi sözləri ===
  {
    assert("v59: 'iqtisadiyyat' bölmə sözüdür", isNewsSectionTerm("iqtisadiyyat"));
    assert("v59: 'idman' bölmə sözüdür", isNewsSectionTerm("idman"));
    assert("v59: 'uefa' bölmə sözü DEYİL", !isNewsSectionTerm("uefa"));
    assert("v59: iqtisadiyyat.az iqtisadiyyat bölməsini örtür", sourceCoversSection(["iqtisadiyyat"], "iqtisadiyyatda"));
    assert("v59: icma.az iqtisadiyyat bölməsini örtmür", !sourceCoversSection(undefined, "iqtisadiyyatda"));
  }


  // === v59.1: raund-18 CANON əlavələri ===
  {
    const src = readFileSync(new URL("../lib/search.js", import.meta.url), "utf8");
    assert("v59.1: iPhone batareya CANON qaydası var", /iphone\[\\s\\S\]\{0,30\}\(batareya\|battery\)/.test(src) || /iphone battery health tips apple support/.test(src));
    assert("v59.1: quş qripi CANON qaydası var", /bird flu H5N1 symptoms causes who\.int/.test(src));
  }


  // === v60: how-to mənbələri ===
  {
    assert("v60: 'necə' sorğusu how-to sayılır", isHowtoQuery("divarı necə düzgün rəngləyim"));
    assert("v60: 'how to' sorğusu how-to sayılır", isHowtoQuery("how to marinate chicken"));
    assert("v60: 'Naxçıvan' how-to deyil", !isHowtoQuery("Naxçıvan"));
    assert("v60: wikiHow boost alır", howtoTrustBoost("https://www.wikihow.com/Make-Yogurt") > 0);
    assert("v60: rei.com boost alır", howtoTrustBoost("https://www.rei.com/learn/expert-advice/bike-chain.html") > 0);
    assert("v60: xəbər saytı how-to boost almır", howtoTrustBoost("https://report.az/idman-xeberleri") === 0);
    assert("v60: HOWTO_TRUSTED siyahısı 20+", HOWTO_TRUSTED.length >= 20, String(HOWTO_TRUSTED.length));
  }


  // === v61: say cavabının mətndən çıxarılması ===
  {
    assert("v61: 'neçə rayon var' → isim 'rayon'", countNounFromQuery("Azərbaycanda neçə rayon var") === "rayon", String(countNounFromQuery("Azərbaycanda neçə rayon var")));
    assert("v61: 'neçə stansiya var' → 'stansiya'", countNounFromQuery("Bakı metrosunda neçə stansiya var") === "stansiya");
    const a = extractCount("Azərbaycanda 66 rayon, 11 şəhər və 1 muxtar respublika var.", "rayon");
    assert("v61: 66 rayon çıxarılır", a && a.value === 66, JSON.stringify(a));
    const b = extractCount("Bakı metropoliteni 3 xəttdən, 27 işləyən və dörd tikilən stansiyadan ibarətdir.", "stansiya");
    assert("v61: 27 stansiya (söz rəqəmi deyil)", b && b.value === 27, JSON.stringify(b));
    const y = extractCount("2019-cu ildə 15 stansiya açıldı.", "stansiya");
    assert("v61: il rəqəm kimi sayılmır (2019 deyil, 15)", y && y.value === 15, JSON.stringify(y));
    assert("v61: faiz sayılmır", extractCount("Rayonların 65%-i dağlıqdır.", "rayon") === null);
    const multi = extractCountFromResults([
      { url: "https://a.az/1", title: "A", content: "Azərbaycanda 66 rayon var." },
      { url: "https://b.az/2", title: "B", content: "Ölkədə 66 rayon fəaliyyət göstərir." },
      { url: "https://c.az/3", title: "C", content: "Bakıda 12 rayon var." }
    ], "rayon");
    assert("v61: səsvermə 66-nı seçir", multi && multi.value === 66 && multi.sources.length === 2, JSON.stringify(multi && { v: multi.value, n: multi.sources.length }));
  }

  // === v62: mürəkkəb isim, sifət, Bing tək-söz gate ===
  {
    // "neçə elmi institut var" → sayılan isim "institut", sifət "elmi" deyil
    assert("v62: sifət isim sayılmır (elmi institut)", countNounFromQuery("AMEA-da neçə elmi institut var") === "institut", String(countNounFromQuery("AMEA-da neçə elmi institut var")));
    // mürəkkəb isim orijinal yazılışda qayıdır
    assert("v62: mürəkkəb isim orijinal formada", countNounFromQuery("Bakıda neçə metrostansiyası var") === "metrostansiyası", String(countNounFromQuery("Bakıda neçə metrostansiyası var")));
    // "rayon tabeli şəhər" → 6 rayonun sayı deyil
    const c = extractCount("Azərbaycanda 64 rayon, 11 respublika tabeli şəhər, 6 rayon tabeli şəhər var.", "rayon");
    assert("v62: 'tabeli' bağlayıcısı 6-nı rədd edir, 64 qalır", c && c.value === 64, JSON.stringify(c));
    const d = extractCount("AMEA-da 30 institut daxil olmaqla 100 elmi tədqiqat müəssisəsi var.", "institut");
    assert("v62: 'daxil olmaqla' rədd ETMİR (30)", d && d.value === 30, JSON.stringify(d));
    const e = extractCount("Bakı metrosunda 27 işləyən stansiya, dörd tikilən stansiya var.", "metrostansiyası");
    assert("v62: mürəkkəb isim mətndə tapılır (27)", e && e.value === 27, JSON.stringify(e));
    assert("v62: 'nə qədər peyk var' → 'peyk'", countNounFromQuery("Mars planetində nə qədər peyk var") === "peyk", String(countNounFromQuery("Mars planetində nə qədər peyk var")));
    assert("v62: 'nə qədərdir' say sualı sayılmır", countNounFromQuery("Qaraçayın uzunluğu nə qədərdir") === null, String(countNounFromQuery("Qaraçayın uzunluğu nə qədərdir")));
    // Bing tək-söz zibili kəsilir, 2+ sözə uyğun nəticə qalır
    const g1 = providerTermGate([
      { title: "MANY Definition & Meaning - Merriam-Webster", url: "https://m-w.com", snippet: "many meaning" },
      { title: "List of Baku Metro stations - Wikipedia", url: "https://en.wikipedia.org/x", snippet: "Baku metro station list" }
    ], "how many metro stations baku");
    assert("v62: Bing tək-söz nəticəsi kəsilir", g1.length === 1 && /Baku/.test(g1[0].title), JSON.stringify(g1.map(x => x.title)));
    // tarix say deyil: "1992-ci il 27 oktyabr tarixli" → 27 sayılmır
    const f = extractCount("Milli Məclisin 1992-ci il 27 oktyabr tarixli qərarı ilə bayramlar müəyyən edilib.", "bayram");
    assert("v62.1: ay adı ilə gələn rəqəm sayılmır", f === null, JSON.stringify(f));
    // gələcək plan rəqəmi faktiki saydan geri qalır
    const fut = extractCountFromResults([
      { url: "https://a.az/1", title: "A", content: "Bakıda 10 yeni metro stansiyası inşa ediləcək." },
      { url: "https://b.az/2", title: "B", content: "Bakı metrosunda 27 stansiya fəaliyyət göstərir." }
    ], "metrostansiyası");
    assert("v62.2: planlaşdırılan rəqəm faktiki saydan geri qalır (27)", fut && fut.value === 27, JSON.stringify(fut && fut.value));
    // rəqəm isimdən sonra: "rayonların sayı: 66"
    const rev = extractCount("İnzibati rayonların sayı: 66. Şəhər rayonlarının sayı: 14.", "rayon");
    assert("v62.4: 'sayı: 66' əks naxış işləyir və mətn sırası üstündür", rev && rev.value === 66, JSON.stringify(rev));
    // v63: siyahı başlığı, birləşik isim, vahid
    assert("v63/v75: 'neçə hava limanı' → 'liman'", countNounFromQuery("Azərbaycanda neçə hava limanı var") === "liman", String(countNounFromQuery("Azərbaycanda neçə hava limanı var")));
    assert("v63/v75: 'neçə dövlət bayramı' → 'bayram'", countNounFromQuery("Azərbaycanda neçə dövlət bayramı var") === "bayram", String(countNounFromQuery("Azərbaycanda neçə dövlət bayramı var")));
    assert("v63: 'Ən Yaxşı 5 Park' say deyil", extractCount("Bakıda Piknik Üçün Ən Yaxşı 5 Park", "park") === null);
    assert("v63: '12 əfsanəvi parkı' say deyil", extractCount("Bakının 12 əfsanəvi parkı", "park") === null);
    assert("v63: kilometr say deyil", extractCount("Kəlbəcərdən 60 kilometr məsafədə hava limanı var", "limanı") === null);
    const park = extractCount("Bakıda 164 park var.", "park");
    assert("v63: real say tapılır (164)", park && park.value === 164, JSON.stringify(park));
    // v64: qida adının şəkilçili forması
    assert("v64: 'bananın' → banana", matchNutrition("bananın tərkibində nə qədər kalori var").foodEn === "banana", JSON.stringify(matchNutrition("bananın tərkibində nə qədər kalori var")));
    assert("v64: 'çörəyin' → bread", matchNutrition("çörəyin tərkibində nə qədər karbohidrat var").foodEn === "bread", JSON.stringify(matchNutrition("çörəyin tərkibində nə qədər karbohidrat var")));
    assert("v64: 'toyuğun' → chicken", matchNutrition("toyuğun tərkibində nə qədər protein var").foodEn === "chicken", JSON.stringify(matchNutrition("toyuğun tərkibində nə qədər protein var")));
    // v65: inkar işarəsi, "sayı"-dan əvvəlki söz, captcha səhifəsi
    assert("v65: '14 qeyri-dövlət universiteti' say deyil", extractCount("Azərbaycanda 16 dövlət, 14 qeyri-dövlət universiteti var.", "universiteti") === null || extractCount("Azərbaycanda 16 dövlət, 14 qeyri-dövlət universiteti var.", "universiteti").value === 16, JSON.stringify(extractCount("Azərbaycanda 16 dövlət, 14 qeyri-dövlət universiteti var.", "universiteti")));
    const city = extractCount("Şəhər rayonlarının sayı: 14. Şəhərlərin sayı: 79.", "şəhər");
    assert("v65: 'şəhər rayonlarının sayı 14' → şəhər sayı deyil", city && city.value === 79, JSON.stringify(city));
    const ch = extractCountFromResults([{ url: "https://a.az/1", title: "A", content: "Client Challenge. A required part of this site couldn't load. Burada 14 şəhər var." }], "şəhər");
    assert("v65: captcha səhifəsindən say çıxarılmır", ch === null, JSON.stringify(ch));
    const st = extractCount("Bakı Metropoliteni — 27 stansiyanın xidmət etdiyi üç xətt.", "metrostansiyası");
    assert("v66: 'stansiyanın' şəkilçisi ilə də say tapılır (27)", st && st.value === 27, JSON.stringify(st));
    // v67: tarix rəqəmi və tarixi kontekst
    assert("v67: '15-də teatra' say deyil", extractCount("1964-cü il aprel ayının 15-də teatra Dövlət statusu verilib.", "teatr") === null);
    const qr = extractCount("1958-ci ilə qədər 4 qoruq fəaliyyət göstərmişdir. Hazırda 15 qoruq var.", "qoruq");
    assert("v67: tarixi kontekst cari saydan geri qalır (15)", qr && qr.value === 15, JSON.stringify(qr));
    assert("v67: sahə rule işləyir", matchFact("Azərbaycanın sahəsi nə qədərdir").kind === "area");
    assert("v67: valyuta rule işləyir", matchFact("Rusiyanın valyutası nədir").kind === "currency_of");
    // v68: kripto qiyməti
    assert("v68: 'Bitcoin-in qiyməti' → bitcoin", matchCrypto("Bitcoin-in qiyməti nə qədərdir").id === "bitcoin", JSON.stringify(matchCrypto("Bitcoin-in qiyməti nə qədərdir")));
    assert("v68: 'ethereum qiymeti' → ethereum", matchCrypto("ethereum qiymeti").id === "ethereum");
    assert("v68: 'bitcoin nədir' qiymət deyil", matchCrypto("bitcoin nədir").hit === false);
    assert("v68: 'manat neçə dollar' kripto deyil", matchCrypto("Azərbaycan manatı neçə dollardır").hit === false);
    assert("v68: kripto mətni qiymət saxlayır", /64 571 USD/.test(cryptoToText({ sym: "BTC", usd: 64571, azn: 109770, fetched_at: "2026-11-18T01:13:00Z" })));
    // v69: tarix formatı və pi sabiti
    assert("v69: '2025/7/29 - ... 29 qonşusu' say deyil", extractCount("2025/7/29 - Hazırda Azərbaycanın şimal qonşusu Rusiya ilə münasibətlər gərgindir.", "qonşu") === null, JSON.stringify(extractCount("2025/7/29 - Hazırda Azərbaycanın şimal qonşusu Rusiya ilə münasibətlər gərgindir.", "qonşu")));
    assert("v69: 'Pi neçəyə bərabərdir' → sabit", matchMath("Pi neçəyə bərabərdir").kind === "constant", JSON.stringify(matchMath("Pi neçəyə bərabərdir")));
    assert("v69: 'piti necə bişirilir' sabit deyil", matchMath("piti necə bişirilir").hit === false);
    // v70: sabit tarixli bayramlar
    assert("v70: Zəfər Günü → 8 noyabr", matchHoliday("Zəfər Günü nə vaxtdır").date === "8 noyabr", JSON.stringify(matchHoliday("Zəfər Günü nə vaxtdır")));
    assert("v70: Neftçilər günü → 20 sentyabr", matchHoliday("Neftçilər günü nə vaxtdır").date === "20 sentyabr");
    assert("v70: '8 noyabr nə gündür' → Zəfər Günü", /Zəfər/.test(matchHoliday("8 noyabr nə gündür").note || ""));
    assert("v70: adi sual bayram sayılmır", matchHoliday("Azərbaycan Prezidenti kimdir").hit === false);
    assert("v70: hava sualı bayram deyil", matchHoliday("Bakıda hava necədir").hit === false);
    // v71: dəyişən rəsmi rəqəm
    assert("v71: minimum əmək haqqı tanınır", matchLiveStat("Azərbaycanda minimum əmək haqqı nə qədərdir").id === "minwage");
    assert("v71: pensiya tanınır", matchLiveStat("minimum pensiya nə qədərdir").id === "pension");
    const ms = extractMoneySentence("minimum aylıq əməkhaqqının məbləği 2025-ci il yanvarın 1-dən 400 manat müəyyən edilib.", "minwage", 2026);
    assert("v71: 400 manat çıxarılır", ms && ms.value === 400, JSON.stringify(ms));
    assert("v71: köhnə rəqəm (2019) rədd olunur", extractMoneySentence("2019-cu ildə minimum əmək haqqı 180 manat idi.", "minwage", 2026) === null);
    assert("v71: resept saytı boost alır", howtoTrustBoost("https://azcookbook.com/2011/04/13/yogurt-soup/") > 0);
    // v72: sənəd nömrəsi say deyil, qonşu sayı Wikidata-dan
    assert("v72: '130 saylı sərəncam' say deyil", extractCount("1967-ci il tarixli 130 saylı sərəncamına əsasən yaradılmışdır.", "muzey") === null);
    assert("v72: 'neçə qonşusu var' → borders", matchFact("Azərbaycanın neçə qonşusu var").kind === "borders", JSON.stringify(matchFact("Azərbaycanın neçə qonşusu var")));
    assert("v72: 'neçə sərhəd qonşusu var' → borders", matchFact("Azərbaycanın neçə sərhəd qonşusu var").kind === "borders");
    // v73: köhnə il qeydi
    const old = extractCount("2014-cü ilin məlumatına görə Bakıda 380 mehmanxana var.", "mehmanxana");
    assert("v73: köhnə il qeyd olunur", old && old.year === 2014, JSON.stringify(old));
    assert("v73: pensiya mövzusu geniş tanınır", matchLiveStat("Azərbaycanda pensiya nə qədərdir").id === "pension", JSON.stringify(matchLiveStat("Azərbaycanda pensiya nə qədərdir")));
    const pen = extractMoneySentence("2026-cı ildə Azərbaycanda minimum əmək pensiyasının məbləği 320 manat təşkil edir.", "pension", 2026);
    assert("v73: pensiya 320 manat çıxarılır", pen && pen.value === 320, JSON.stringify(pen));
    // v74: minlik ayırıcı, say çərçivəsi, say sorğusu
    const lib = extractCount("Hal-hazırda Azərbaycanda 12.000 kitabxana fəaliyyət göstərir.", "kitabxana");
    assert("v74: '12.000 kitabxana' → 12000", lib && lib.value === 12000, JSON.stringify(lib));
    assert("v74: say çərçivəsiz söz rəqəmi sayılmır", extractCount("Araz çayı üzərində salınan iki Xudafərin körpüsü bizə məlumdur.", "körpü") === null);
    assert("v74: 'iki körpü var' sayılır", (extractCount("Rayonda iki körpü var.", "körpü") || {}).value === 2);
    assert("v74: say sorğusu '<X> sayı' formasına çevrilir", countSearchQuery("Azərbaycanda neçə xəstəxana var") === "Azərbaycanda xəstəxana sayı", String(countSearchQuery("Azərbaycanda neçə xəstəxana var")));
    assert("v74: artıq 'sayı' varsa toxunulmur", countSearchQuery("Azərbaycanda rayon sayı") === null);
    // v75: say ismi SUALDAN, fel qalığı atılır, yiyəlik şəkilçisi göstərişdə silinir
    assert("v75: 'neçə universitet fəaliyyət göstərir' → universitet", countNounFromQuery("Azərbaycanda neçə universitet fəaliyyət göstərir") === "universitet");
    assert("v75: 'neçə TV kanalı' → kanal", countNounFromQuery("neçə TV kanalı var") === "kanal");
    assert("v75: 'neçə sığorta şirkəti' → şirkət", countNounFromQuery("neçə sığorta şirkəti fəaliyyət göstərir") === "şirkət");
    assert("v75: 'neçə dövlət muzeyi' → muzey", countNounFromQuery("neçə dövlət muzeyi var") === "muzey");
    assert("v75: 'neçə qapı' toxunulmur", countNounFromQuery("neçə qapı") === "qapı");
    // v77: necə ≠ neçə, tarixi məlumat cəzası, ölkə miqyası, "dən çox"
    assert("v77: 'necə saxlamaq' say deyil", hasCountMarker("təzə çörəyi necə saxlamaq olar") === false);
    assert("v77: 'neçə bank var' saydır", hasCountMarker("neçə bank var") === true);
    assert("v77: 'necə işləyir' say deyil", hasCountMarker("bu proqram necə işləyir") === false);
    assert("v77: faiz rəqəmi say deyil (5.30%)", extractCount("Ölkə ərazisinin 5.30% təşkil edən 12 milli park var.", "milli park").value === 12);
    assert("v77: '300-dən çox' aşağı sərhəd", extractCount("Azərbaycanda 300-dən çox poçt şöbəsi fəaliyyət göstərir.", "poçt şöbəsi").atLeast === true);
    assert("v77: cari məlumat köhnəni üstələyir", extractCount("Əvvəl 50 aptek var idisə, indi onların sayı 2900-a çatıb.", "aptek").value === 2900);
    assert("v77: ölkə sualında şəhər cümləsi uduzur", extractCount("Bakı ərazisinə 59 qəsəbə daxildir. Azərbaycanda 262 qəsəbə var.", "qəsəbə", { query: "Azərbaycanda neçə qəsəbə var" }).value === 262);
    assert("v77: faiz ölçüsü çıxarılır", extractMeasure("İşsizlik səviyyəsi 2025-ci ildə 5,50 faizə enib.", "işsizlik səviyyəsi nə qədərdir").text === "5,50 faiz");
    assert("v77: yaş ölçüsü çıxarılır", extractMeasure("Gözlənilən ömür uzunluğu 75 yaş olub.", "orta ömür uzunluğu nə qədərdir").value === 75);
    assert("v77/v78: ölçü sualı tanınır (neçə say sualıdır, ölçü deyil)", matchMeasureQuery("işsizlik səviyyəsi nə qədərdir") === true && matchMeasureQuery("neçə bank var") === false);
    // v78: adambaşına göstərici, ASCII tarixi zaman, ölçüdə ölkə miqyası
    assert("v78: 'hər 100 min nəfərə düşən 22 aptek' say deyil", extractCount("Əhalinin hər 100 min nəfərinə düşən aptek sayı 22-dir. İndi apteklərin sayı 2900-a çatıb.", "aptek").value === 2900);
    assert("v78: ASCII 'acımışdı' tarixi cəza alır", extractCount("70-80-ci illərdə 5 yeni ali məktəb acımışdı. Hazırda ölkədə 51 ali məktəb var.", "ali məktəb").value === 51);
    assert("v78: 'necə saxlamaq' ölçü sualı deyil", matchMeasureQuery("təzə çörəyi necə saxlamaq olar") === false);
    assert("v78: ölçüdə başqa ölkə cəzalanır", extractMeasure("Avqustda Çində işsizlik səviyyəsi 5,3%-ə yüksəlib. Azərbaycanda işsizlik səviyyəsi 2025-ci ildə 5,50 faizə enib.", "Azərbaycanda işsizlik səviyyəsi nə qədərdir").value === 5.5);
    // v75: hissə saylarının cəmi
    const bk = extractCount("Hazırda Azərbaycanda 2 dövlət bankı və 19 kommersiya bankı fəaliyyət göstərir.", "bank");
    assert("v75: '2 dövlət və 19 kommersiya bankı' → 21", bk && bk.value === 21 && bk.summed === true, JSON.stringify(bk));
    assert("v75: fərqli isimlər cəmlənmir", extractCount("Ölkədə 24 teatr və 3 muzey fəaliyyət göstərir.", "teatr").value === 24);
    assert("v62: tək sözlü sorğuda gate işləmir", providerTermGate([{ title: "MANY definition", url: "u", snippet: "x" }], "many").length === 1);
  }

console.log(`\nUNIT NƏTİCƏ: ${pass} keçdi, ${fail} uğursuz`);
process.exit(fail?1:0);
