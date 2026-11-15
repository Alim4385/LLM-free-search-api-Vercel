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
import { scoreResult, isSpamDomain, hostMatches, diversifyByDomain, isJunkDomain } from "../lib/score.js";
import { cleanContent, pickAnswer, detectQueryLanguage, wikiExtractUrl } from "../lib/clean.js";
import { normalizeUrl, decodeEntities } from "../lib/search.js";
import { expandQuery, expandQueryAsync, stripMetaInstructions } from "../lib/expand.js";
import { isBlockedIp, assertPublicUrl } from "../lib/extract.js";
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
assert("weather: 'hava limanı' hit verir (şəhərsiz cancel qoruyucu)", matchWeather("hava limanı harada yerləşir").hit === true);
assert("weather: 'hava limanı baki...' uzun sorğu WEAK", matchWeather("hava limanı baki harada yerləşir").exact === false);
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

console.log("\n=== V12: DIVERSITY (maxPerDomain=1) ===");
{
  const items = [
    { url: "https://a.example.com/1", title: "Birinci sayt nəticəsi", snippet: "məzmun məzmun", source: "bing", score: 10 },
    { url: "https://a.example.com/2", title: "İkinci səhifə başqa başlıq", snippet: "başqa məzmun", source: "bing", score: 9 },
    { url: "https://b.example.com/1", title: "Üçüncü sayt nəticəsi", snippet: "başqa məzmun", source: "bing", score: 8 }
  ];
  const d1 = diversifyByDomain(items, 5, 1);
  assert("diversity: maxPerDomain=1 → 3-dən 2 (Google tərzi)", d1.length === 2 && d1[1].url.includes("b.example.com"), JSON.stringify(d1.map(x => x.url)));
}

console.log(`\nUNIT NƏTİCƏ: ${pass} keçdi, ${fail} uğursuz`);
process.exit(fail?1:0);
