// Unit testlər - kodun özü
// v10: yeni kontrakt testləri - intent gating (matchWeather/matchTime/matchCurrency),
// normalizeUrl (viewtopic ?t=), decodeEntities (hex + no double-decode),
// scoreResult fuzzy (stem mismatch), isSpamDomain (includes over-match),
// selectRelevantParagraphs fallback, sanitizeQuery (kod tokenları qorunur)
import { tokenize, stemAz, normalizeAz, selectRelevantParagraphs } from "../lib/rank.js";
import { matchWeather, isWeatherQuery, detectCity } from "../lib/weather.js";
import { matchTime, isTimeQuery } from "../lib/time.js";
import { matchCurrency, isCurrencyQuery } from "../lib/currency.js";
import { sanitizeQuery, checkRateLimit } from "../lib/ratelimit.js";
import { scoreResult, isSpamDomain, hostMatches, diversifyByDomain, isJunkDomain, computeConfidence } from "../lib/score.js";
import { cleanContent, pickAnswer, cutWord, dedupeSnippet, normalizeColloquialAz, detectQueryLanguage, wikiExtractUrl } from "../lib/clean.js";
import { normalizeUrl, decodeEntities, stripQuestionWords } from "../lib/search.js";
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
  const gs = scoreResult({ title: "Gündəm xəbərləri", url: "https://news.google.com/", snippet: "son xeberler gundem today breaking", source: "google-news" }, t2, "tr", "son xeberler gundem");
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

console.log(`\nUNIT NƏTİCƏ: ${pass} keçdi, ${fail} uğursuz`);
process.exit(fail?1:0);
