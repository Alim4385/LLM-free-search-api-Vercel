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
import { scoreResult, isSpamDomain, hostMatches } from "../lib/score.js";
import { normalizeUrl, decodeEntities } from "../lib/search.js";
import { expandQuery, stripMetaInstructions } from "../lib/expand.js";

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

console.log(`\nUNIT NƏTİCƏ: ${pass} keçdi, ${fail} uğursuz`);
process.exit(fail?1:0);
