import { searchAll, searchMilliArxiv, isArchiveTopic, searchAzWikiHint } from "../../../lib/search.js";
import { fetchAndExtract, buildDateInfo, normalizeValidIsoDate } from "../../../lib/extract.js";
import { detectConflicts } from "../../../lib/conflict.js";
import { selectRelevantParagraphs, tokenize, orderByRecency } from "../../../lib/rank.js";
import { matchWeather, fetchWeather, weatherToText } from "../../../lib/weather.js";
import { matchTime, fetchTime, timeToText } from "../../../lib/time.js";
import { matchCurrency, fetchCBAR, currencyToText } from "../../../lib/currency.js";
import { matchUnits, unitsToText } from "../../../lib/units.js";
import { matchFact, fetchFact, factToText } from "../../../lib/facts.js";
import { matchMath, mathToText } from "../../../lib/math.js";
import { matchSports, fetchLastMatch, lastMatchToText } from "../../../lib/sports.js";
import { matchNutrition, fetchNutrient, nutrientToText } from "../../../lib/nutrition.js";
import { leadAnswerSentence } from "../../../lib/rank.js";
import { classifyType, officialBoost, wantsFresh, sameDayCue, newsTrustBoost, AZ_NEWS_TRUSTED } from "../../../lib/router.js";
import { scoreResult, diversifyByDomain, extractQuotedPhrases, containsPhrase, isSpamDomain, hostMatches, computeConfidence, isNewsQuery, looksLikeGibberish } from "../../../lib/score.js";
import { cleanContent, cutWord, dedupeSnippet, detectQueryLanguage, isBoilerplateOnly, stripBoilerplateHead } from "../../../lib/clean.js";
import { expandQuery, isMetaQuery, stripMetaInstructions, rewriteSearchIntentAz } from "../../../lib/expand.js";
import { translateResultsToQueryLang } from "../../../lib/translate.js";
import { cacheGet, cacheSet, cacheKey } from "../../../lib/cache.js";
import { checkRateLimit, getClientIp, sanitizeQuery, RATE_LIMIT } from "../../../lib/ratelimit.js";

export const runtime = "nodejs";
export const maxDuration = 30;
const HARD_DEADLINE_MS = 8000; // v19/v26: maksimum cavab müddəti — modul səviyyəsindədir ki, TDZ xətası olmasın
const FILTER_VERSION = 147; // v19: necə/neçə bug fix, valyuta hesabı, WMO hava mətni, ölkə saat qurşağı, xəbər niyyəti, bal və confidence sərtləşdirməsi, 8s deadline; v18.1: r.jina.ai ehtiyat qatı (öz çıxarışımız boş qalanda); v18: diakritiksiz AZ yazılışın bərpası (gozel sheher → gözəl şəhər), ASCII AZ dil aşkarlaması; v17: dilə uyğun axtarış + yerli sayt ön-izləməsi (Google Tərcümə və s.), qısa söz tərcüməsi, flim/tərçemə/hansılardı/üçündü düzəlişi, kazino spam filtri, EN sorğuda en.wiki prioriteti
// - anchorQuery tokenləri qTerms + selectRelevantParagraphs-a daxil edildi (tərcümə tapıntıları atılmır)
// - sual hansı dildədirsə cavablar (title/snippet/content) həmin dilə çevrilir (translateResultsToQueryLang)
// - AZ xəbər şablonları ("?.az xəbər verir ki,"), təkrarlanan sətirlər və reklam linkləri təmizlənir
// - Wikipedia tam məqalə + infobox faktları + TR wiki + WIKI_UA + qısa siyahı sətirlərinin qorunması
// - Brave 1-çağırış + Promise mutex (429 öz-özünü bloklama fix), StackOverflow rəsmi API (tech sualları)
// - Top-1/Top-2 mənbələrə daha geniş simvol payı, skipFetch 5500ms, sənəd saytlarında maxPerDomain=2,
//   valyuta/hava tarixi sual tələləri (dollar nə vaxt yarandı) düzəldildi.
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-Request-Id"
};

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS, ...extraHeaders }
  });
}

function logReq(rid, q, ms, extra) {
  try { console.log(JSON.stringify({ rid, q: String(q).slice(0, 40), ms, ...extra })); } catch {}
}

function rateLimitHeaders(rl, requestId) {
  return {
    "X-RateLimit-Limit": String(RATE_LIMIT),
    "X-RateLimit-Remaining": String(rl.remaining ?? 0),
    "X-Request-Id": requestId
  };
}

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); })
  ]).finally(() => clearTimeout(t));
}

const searchInflight = new Map();
function searchAllShared(q, n, opts) {
  const key = q.toLowerCase() + "|" + n + "|" + (opts.freshness || "") + "|" + (opts.excludeDomains || []).join(",");
  let p = searchInflight.get(key);
  if (!p) {
    p = withTimeout(searchAll(q, n, opts), 8000, "search timeout");
    p = p.finally(() => searchInflight.delete(key));
    searchInflight.set(key, p);
  }
  return p;
}

function jsonlResponse(results, meta, extraHeaders = {}) {
  const lines = [];
  lines.push(JSON.stringify({ type: "meta", ...meta }));
  for (const r of results) lines.push(JSON.stringify({ type: "result", ...r }));
  lines.push(JSON.stringify({ type: "done", count: results.length }));
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let i = 0;
      const next = () => {
        if (i < lines.length) {
          controller.enqueue(encoder.encode(lines[i++] + "\n"));
          setTimeout(next, 0);
        } else controller.close();
      };
      next();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", ...CORS_HEADERS, ...extraHeaders }
  });
}

async function handleSearch(body, req) {
  const started = Date.now();
  const degradedStages = [];
  const ip = getClientIp(req);
  const requestId = Math.random().toString(36).slice(2, 10);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "invalid_body", message: "Body JSON obyekt olmalıdır" }, 400);
  }

  const rawQuery = body.query ?? body.q ?? "";
  let rl = await checkRateLimit(ip);
  if (!rl.ok && rl.retryAfter <= 5) {
    await new Promise(r => setTimeout(r, rl.retryAfter * 1000 + 100));
    rl = await checkRateLimit(ip);
  }
  if (!rl.ok) {
    logReq(requestId, rawQuery, Date.now() - started, { status: 429 });
    return jsonResponse({ error: "rate_limited", message: "Çox tez sorğu göndərdin. Bir az gözlə.", retry_after: rl.retryAfter }, 429, { ...rateLimitHeaders(rl, requestId), "Retry-After": String(Math.min(rl.retryAfter || 60, 60)) });
  }

  if (typeof rawQuery !== "string") return jsonResponse({ error: "invalid_query_type", message: "query string olmalıdır" }, 400);
  const query = sanitizeQuery(rawQuery);
  if (!query) return jsonResponse({ error: "missing_query", message: "query sahəsi tələb olunur" }, 400);

  const maxResults = Math.min(Math.max(parseInt(body.max_results || body.maxResults || "5", 10) || 5, 1), 8);
  const NO_CACHE = /^(1|true|on)$/i.test(String(body.no_cache || body.noCache || ""));
  const maxChars = Math.min(Math.max(parseInt(body.max_chars || body.maxChars || "4000", 10) || 4000, 500), 8000);
  const fmt = (typeof body.format === "string" ? body.format : "json").toLowerCase();
  const format = ["json", "jsonl", "simple"].includes(fmt) ? fmt : "json";
  const fr = (typeof body.freshness === "string" ? body.freshness : "").toLowerCase();
  // v41.4: "bu gün / live / son dəqiqə" → provayderə avtomatik günlük təzəlik filtri
  const autoFresh = !["day","week","month","year"].includes(fr) && sameDayCue(query) ? "day" : null;
  const freshness = ["day","week","month","year"].includes(fr) ? fr : autoFresh;
  const excludeDomains = Array.isArray(body.exclude_domains) ? body.exclude_domains.filter(d => typeof d === "string").map(d => d.toLowerCase().replace(/^www\./, "")).slice(0, 20) : [];
  const qLang = detectQueryLanguage(rewriteSearchIntentAz(query) || query);
  const reqLang = typeof body.lang === "string" && ["az", "tr", "en", "ru"].includes(body.lang.toLowerCase()) ? body.lang.toLowerCase() : qLang;
  const shouldTranslateResults = body.translate_results !== false && body.translate_results !== "0" && body.translate_results !== 0;

  const cKey = cacheKey("search", { q: query.toLowerCase(), n: maxResults, c: maxChars, l: reqLang, tr: shouldTranslateResults ? 1 : 0, v: FILTER_VERSION, f: freshness || "", x: excludeDomains.join(",") });
  const cached = NO_CACHE ? null : await cacheGet(cKey);
  if (cached) {
    const obj = { ...cached, meta: { ...cached.meta, cached: true, took_ms: Date.now() - started } };
    logReq(requestId, query, obj.meta.took_ms, { status: 200, cached: true });
    if (format === "jsonl") {
      return jsonlResponse(obj.results, { query: obj.query, intent: obj.intent, providers_used: obj.meta.providers_used, took_ms: obj.meta.took_ms, cached: true }, rateLimitHeaders(rl, requestId));
    }
    if (format === "simple") {
      return jsonResponse({ query: obj.query, results: (obj.results || []).map(r => ({ title: r.title, url: r.url, snippet: (r.snippet || r.content || "").slice(0, 200) })) }, 200, rateLimitHeaders(rl, requestId));
    }
    return jsonResponse(obj, 200, rateLimitHeaders(rl, requestId));
  }

  const intentMatches = { weather: matchWeather(query), time: matchTime(query), currency: matchCurrency(query), units: matchUnits(query), fact: matchFact(query), math: matchMath(query), sports: matchSports(query), nutrition: matchNutrition(query) };
  // v47.1: "90 dəqiqə neçə saat" time intentinə düşürdü ("saat" tokeni) → units əvvəl yoxlanılır
  // v51.5: units currenc-dən ƏVVƏL — "1 funt neçə kiloqram" valyuta (GBP) kimi
  // tutulurdu. "dollar/lirə/manat" kimi sözlər vahid cədvəlində yoxdur, ona görə
  // valyuta sualları təsirlənmir.
  const INTENT_ORDER = ["weather", "units", "currency", "math", "sports", "nutrition", "fact", "time"];
  const intentName = INTENT_ORDER.find(k => intentMatches[k].hit) || null;
  const intentExact = intentName ? intentMatches[intentName].exact : false;
  let intent = intentName || "general";

  let weather = null, weatherText = "";
  let timeData = null, timeText = "";
  let currencyData = null, currencyText = "";
  let unitsData = null, unitsText = "";
  let factData = null, factText = "";
  let mathData = null, mathText = "";
  let sportsData = null, sportsText = "";
  let nutriData = null, nutriText = "";

  if (intentName === "weather") {
    try { weather = await fetchWeather(query); weatherText = weatherToText(weather); } catch { weather = null; }
  } else if (intentName === "time") {
    try {
      const pl = intentMatches.time.place || { tz: "Asia/Baku", label: "Azərbaycan" };
      timeData = await fetchTime(pl.tz, pl.label);
      timeText = timeToText(timeData);
    } catch {}
  } else if (intentName === "currency") {
    try { currencyData = await fetchCBAR(); currencyText = currencyToText(currencyData, query); } catch {}
  } else if (intentName === "math") {
    // v48: riyazi hesablama — şəbəkəsiz, daxili (LLM kalkulyator kimi istifadə edir)
    try { mathData = intentMatches.math; mathText = mathToText(mathData); } catch { mathData = null; }
  } else if (intentName === "sports") {
    // v48: son oyun nəticəsi — TheSportsDB; alınmasa adi axtarışa düşür
    try { sportsData = await fetchLastMatch(intentMatches.sports.team, 1800); sportsText = lastMatchToText(sportsData, reqLang); } catch { sportsData = null; }
    if (!sportsData) intent = "general";
  } else if (intentName === "nutrition") {
    // v50: qida tərkibi — USDA FoodData Central (DEMO_KEY / USDA_API_KEY)
    try { nutriData = await fetchNutrient(intentMatches.nutrition, 2000); nutriText = nutrientToText(nutriData, intentMatches.nutrition.foodAz); } catch { nutriData = null; }
    if (!nutriData) intent = "general";
  } else if (intentName === "fact") {
    // v47: Wikidata structured fakt (əsərlər / paytaxt / əhali) — axtarış abidə/medal gətirirdi
    try { factData = await fetchFact(intentMatches.fact, 1500); factText = factToText(factData); } catch { factData = null; }
    if (!factData) intent = "general"; // tapılmasa adi axtarışa düş
  } else if (intentName === "units") {
    // v47: vahid çevirməsi — şəbəkəsiz, daxili hesablama
    try { unitsData = intentMatches.units; unitsText = unitsToText(unitsData); } catch { unitsData = null; }
  }

  let searchQuery = query;
  if (isMetaQuery(query)) {
    const cleaned = stripMetaInstructions(query);
    if (cleaned) searchQuery = cleaned;
  }
  const normQuery = rewriteSearchIntentAz(searchQuery) || searchQuery;
  // v39: tip-üzrə router (count / date / list / howto / az-context)
  const qType = classifyType(normQuery);

  const hasStructured = intentExact && (
    (intentName === "weather" && weather) ||
    (intentName === "time" && timeData) ||
    (intentName === "currency" && currencyData) ||
    (intentName === "units" && unitsData) ||
    (intentName === "fact" && factData) ||
    (intentName === "math" && mathData) ||
    (intentName === "sports" && sportsData) ||
    (intentName === "nutrition" && nutriData)
  );
  // v51.4: sorğunun mənalı sözlərinin çoxu klaviatura zibili olsa ("asdfqwer zxcvbnm
  // nonsense", "asdkjqwe zzzz") provayderlər hər şeyi qaytarır və filtrlər zibil
  // keçirir. Belə sorğuda axtarışa HEÇ getmirik: boş cavab + fallback:true.
  const contentTokens = tokenize(normQuery).filter(t => String(t).length >= 3);
  const gibberishHits = contentTokens.filter(looksLikeGibberish).length;
  const unintelligible = !hasStructured && contentTokens.length >= 2 && gibberishHits / contentTokens.length >= 0.6;

  let searchResult = { results: [], providersUsed: [], errors: {}, anchorQuery: null, translated: false };
  let results = [], providersUsed = [], errors = {};
  if (!hasStructured && !unintelligible) {
    try {
      // v42.1: provayderlərdən DAHA ÇOX namizəd al (sonradan filtr 1-ə düşməsin)
      searchResult = await searchAllShared(searchQuery, Math.min(10, maxResults + 5), { freshness, excludeDomains });
    } catch (e) {
      if (e.message === "search timeout") {
        logReq(requestId, query, Date.now() - started, { status: 504, error: "search_timeout" });
        return jsonResponse({ error: "search_timeout", message: "Axtarış vaxtı keçdi. Bir az sonra yenidən cəhd et." }, 504, rateLimitHeaders(rl, requestId));
      }
      throw e;
    }
    ({ results, providersUsed, errors } = searchResult);
  }

  // v15: qTerms-ə searchResult.anchorQuery də əlavə olunur ki, tərcümə ilə tapılan
  // düzgün EN mənbələr ("Lake Van", "Most visited websites", "Borders of Azerbaijan")
  // skorlamada 0 alıb atılmasın!
  const exp = expandQuery(normQuery);
  const effAnchor = searchResult.anchorQuery || null;
  // v24.2: AZ say sualında ("neçə ilçə") İNGİLİSCƏ anchor terminləri zəhər kimi işləyir:
  // "districts" termini "Çankaya District" kimi səhifələri önə çıxarır, doğru TR səhifəni basdırır.
  const isAzCount = /(?<![\p{L}])(neçə|nece|sayı|sayi|nə\s+qədər|ne\s+qeder)(?![\p{L}])/iu.test(normQuery);
  // v28: texniki sualda AZ-a TƏRCÜMƏ olunmuş genişlənmə şərtləri zəhərlidir
  // ("React state idarəetməsi" → "Dövlət idarəçiliyi" məqaləsi qalib gəlirdi)
  const isTechQuery = /(?<![\p{L}])(react|javascript|python|docker|dns|api|sql|git|kotlin|java|css|html|typescript|vue|node|linux|gpt|llm|redux|useeffect|state\s+management)(?![\p{L}])/iu.test(normQuery);
  // v51.3: mənasız tokenlər uyğunluq termini sayılmır (bax: looksLikeGibberish) —
  // yoxsa "asdfqwer zxcvbnm nonsense" sorğusuna YouTube düşürdü.
  const qTerms = [...new Set([
    ...tokenize(query),
    ...tokenize(normQuery),
    ...(isTechQuery ? [] : tokenize(exp.expanded || "")),
    ...(isAzCount ? [] : tokenize(exp.english || "")),
    ...(isAzCount ? [] : tokenize(effAnchor || ""))
  ])].filter(t => !looksLikeGibberish(t));

  const rawCount = results.length;
  // v42.5: "Access Denied / Just a moment / 403 Forbidden" kimi bloklanmış səhifələr nəticə deyil
  const ERR_PAGE = /^(access\s+denied|forbidden|403\s+forbidden|404|not\s+found|just\s+a\s+moment|attention\s+required|are\s+you\s+a\s+robot|robot\s+check|blocked|Əlçatmaz|Giriş\s+qadağandır|Доступ\s+запрещ|拒绝访问)/iu;
  results = results.filter(r => !ERR_PAGE.test(String(r.title || "").trim()));
  let scored = results.map(r => ({ ...r, score: scoreResult(r, qTerms, qLang, normQuery) }));
  scored = scored.filter(r => r.score >= 1.5 && (r.snippet || "").trim().length >= 10);

  // v39.1: həm snippet, həm title yalnız "Həmçinin bax / © Copyright" → səhifə məzmunsuzdur, at
  // (atmaq əvəzinə −3: nəticə sayını 3-dən aşağı salmayaq, sadəcə dibə düşsün)
  scored = scored.map(r => isBoilerplateOnly(r.snippet) ? { ...r, score: r.score - 3, junk_content: true } : r);

  // v39: AZ kontekstli sualda rəsmi mənbələr (e-qanun, edu.gov.az, stat.gov.az…) önə
  // v44.2: hava sualında hava API-si cavab vermədikdə "hava limanı" tipli səhv uyğunluqlar aşağı düşsün
  if (intentName === "weather" && !weather) {
    scored = scored.map(r => {
      const t = String(r.title || "").toLowerCase();
      if (/(hava\s+liman|aeroport|airport|aviaşirkət)/.test(t)) return { ...r, score: r.score - 4 };
      if (/(hava\s+proqnoz|proqnoz|temperatur|weather)/.test(t)) return { ...r, score: r.score + 2 };
      return r;
    });
    degradedStages.push("weather_fallback_search");
  }

  // v41.5: Vikipediya "səhv uyğunluq"ları — başlıqda sorğunun BİR sözü də yoxdursa at
  // ("saç bakımı ipuçları" → "John Romero", "cildə qulluq" → "Şaqun Şarma")
  const laxEq = (a, b) => String(a || "").toLowerCase().includes(String(b || "").toLowerCase());
  scored = scored.filter(r => {
    if (!/wikipedia\.org/.test(r.url || "")) return true;
    const t = String(r.title || "").toLowerCase();
    const hit = qTerms.some(x => x.length >= 4 && t.includes(String(x).slice(0, Math.max(4, x.length - 3)).toLowerCase()));
    return hit;
  });

  // v41.4: tarix/nəticə sualında təzə səhifə önə ("Champions League results" → 1996-97 yox!)
  if (qType.type === "date" && wantsFresh(normQuery)) {
    scored = scored.map(r => {
      const t = Date.parse(r.published_at || "");
      if (Number.isNaN(t)) return r;
      const days = (Date.now() - t) / 86400000;
      const bonus = days <= 30 ? 1.6 : days <= 365 ? 0.8 : 0;
      return bonus ? { ...r, score: r.score + bonus } : r;
    });
  }
  if (qType.azContext) {
    const fresh = wantsFresh(normQuery);
    scored = scored.map(r => {
      let bonus = officialBoost(r.url);
      if (fresh && r.published_at) {
        const y = String(r.published_at).slice(0, 4);
        if (y === "2026" || y === "2025") bonus += 1.0;
      }
      return bonus ? { ...r, score: r.score + bonus } : r;
    });
  }

  // v53: xəbər sorğusunda tanınmış AZ mənbələri (AZƏRTAC, Report, APA, Trend...) önə.
  // Səbəb: "axtardığım xəbərdə düzgün sayt gəlmirdi" — xəbər sorğularında sayt-hədəfli
  // cəhd ümumiyyətlə yox idi (yalnız hüquq/təhsil/iqtisad üçün site: hint var idi).
  const newsQ = isNewsQuery(normQuery) || sameDayCue(normQuery);
  if (newsQ) {
    scored = scored.map(r => {
      const b = newsTrustBoost(r.url);
      return b ? { ...r, score: r.score + b, trusted_news: true } : r;
    });
  }

  let usedFallback = false;
  if (!scored.length && results.length) { usedFallback = true; }
  scored.sort((a, b) => (b.score - a.score) || ((b.voteCount || 0) - (a.voteCount || 0)) || a.url.localeCompare(b.url));

  const phrases = extractQuotedPhrases(query);
  if (phrases.length) {
    const quoted = scored.filter(r => phrases.some(ph => containsPhrase(r.title, ph) || containsPhrase(r.snippet, ph)));
    if (quoted.length) {
      scored = quoted;
    } else {
      const unquoted = query.replace(/"([^"]+)"/g, "$1");
      if (unquoted !== query) {
        try {
          const retry = await withTimeout(searchAll(unquoted, maxResults, { freshness, excludeDomains }), 3000, "retry timeout");
          const retryTerms = [...new Set([...qTerms, ...tokenize(retry.anchorQuery || "")])];
          let retryScored = retry.results.filter(r => !isSpamDomain(r.url)).map(r => ({ ...r, score: scoreResult(r, retryTerms, qLang, query) })).filter(r => r.score >= 1.5);
          retryScored.sort((a, b) => (b.score - a.score) || ((b.voteCount || 0) - (a.voteCount || 0)) || a.url.localeCompare(b.url));
          if (retryScored.length) scored = retryScored;
          else scored = quoted;
        } catch { scored = quoted; }
      } else {
        scored = quoted;
      }
    }
  }

  const siteMatch = query.match(/site:([a-z0-9.-]+\.[a-z]{2,})/i);
  if (siteMatch) {
    const domain = siteMatch[1].toLowerCase().replace(/^www\./, "");
    scored = scored.filter(r => hostMatches(r.url, domain));
  }

  // v15 (Claude #3 fix): ümumi saytlarda maxPerDomain=1, rəsmi sənəd/ensiklopediya
  // domenlərində yüksək skorlu (score>=3.5) 2 fərqli səhifəyə icazə verilir
  // v38: provayderlər düşəndə 1-2 nəticə qalır (kripto, bərpa olunan enerji) →
  // sadələşdirilmiş nüvə sorğusu ilə BİR dəfə ehtiyat axtarış
  // v47.2: structured cavab (vahid/fakt/hava/saat/valyuta) varsa ehtiyat axtarışa HEÇ getmirik
  if (!hasStructured && scored.length < 3 && Date.now() - started < 1800) {  // v39.1: vaxt büdcəsi (8s deadline)
    try {
      const core = tokenize(query).slice(0, 3).join(" ");
      if (core && core !== normQuery) {
        // v52.2: retry də ümumi deadline-a sığmalıdır (əvvəl 8195-10925 ms çıxırdı)
        const retryBudget = Math.min(2500, Math.max(600, HARD_DEADLINE_MS - 2600 - (Date.now() - started)));
        const retry2 = await withTimeout(searchAll(core, maxResults, { freshness, excludeDomains }), retryBudget, "retry2 timeout");
        const t2 = [...new Set([...qTerms, ...tokenize(retry2.anchorQuery || "")])];
        const extra = retry2.results.filter(r => !isSpamDomain(r.url))
          .map(r => ({ ...r, score: scoreResult(r, t2, qLang, core) }))
          .filter(r => r.score >= 1.5);
        if (extra.length) {
          degradedStages.push("retry_simplified");
          const seen = new Set(scored.map(r => r.url));
          for (const r of extra) if (!seen.has(r.url)) scored.push(r);
          scored.sort((a, b) => b.score - a.score);
        }
      }
    } catch {}
  }

  // v39: AZ kontekstli sualda rəsmi mənbə heç gəlməyibsə → sayt-hədəfli bir cəhd
  if (!hasStructured && qType.siteHint && !scored.some(r => officialBoost(r.url)) && Date.now() - started < 2600) {
    try {
      const coreQ = `${tokenize(normQuery).slice(0, 5).join(" ")} site:${qType.siteHint}`;
      const rs = await withTimeout(searchAll(coreQ, maxResults, { freshness, excludeDomains }), 2500, "site hint timeout");
      const tS = [...new Set([...qTerms, ...tokenize(rs.anchorQuery || "")])];
      const extraS = rs.results.filter(r => !isSpamDomain(r.url)).map(r => ({ ...r, score: scoreResult(r, tS, qLang, normQuery) })).filter(r => r.score >= 1.5);
      if (extraS.length) {
        degradedStages.push("site_hint");
        const seen2 = new Set(scored.map(r => r.url));
        for (const r of extraS) if (!seen2.has(r.url)) scored.push(r);
        scored.sort((a, b) => b.score - a.score);
      }
    } catch {}
  }

  // v53: xəbər sorğusunda tanınmış AZ mənbəsindən HEÇ NƏ gəlməyibsə → sayt-hədəfli
  // bir cəhd (AZƏRTAC + Report OR ilə). Sual "xəbər" olsa da nəticə xarici sayt olurdu.
  if (newsQ && !hasStructured && Date.now() - started < 2600 && !scored.some(r => newsTrustBoost(r.url) > 0)) {
    try {
      const coreN = tokenize(normQuery).filter(t => t.length >= 3).slice(0, 5).join(" ");
      if (coreN) {
        const doms = AZ_NEWS_TRUSTED.slice(0, 2);
        const qSite = `${coreN} (site:${doms[0]} OR site:${doms[1]})`;
        const rsN = await withTimeout(searchAll(qSite, Math.min(6, maxResults), { freshness, excludeDomains }), 1600, "news site hint timeout");
        const tN = [...new Set([...qTerms, ...tokenize(rsN.anchorQuery || "")])];
        const extraN = (rsN.results || []).filter(r => !isSpamDomain(r.url))
          .map(r => ({ ...r, score: scoreResult(r, tN, qLang, normQuery) + newsTrustBoost(r.url) }))
          .filter(r => r.score >= 1.4);
        if (extraN.length) {
          degradedStages.push("news_site_hint");
          const seenN = new Set(scored.map(r => r.url));
          for (const r of extraN.sort((a, b) => b.score - a.score)) if (!seenN.has(r.url)) scored.push(r);
          scored.sort((a, b) => b.score - a.score);
        }
      }
    } catch {}
  }

  // v54.1: AZ kontekstli tarix/say sualında az.wikipedia-da hədəfli cəhd.
  // "Azərbaycanda ilk metro nə vaxt açılıb" → Çikaqo metrosu + Subway sandviçi gəlirdi;
  // səbəb "metro" sözünün beynəlxalq qarışıqlığıdır. Azərbaycan ensiklopediyası həll edir.
  const azSuperlative = /(?<![\p{L}])(ən\s+b[öo]y[üu]k|en\s+boyuk|ən\s+uzun|en\s+uzun|ən\s+m[əe][şs]hur|ən\s+[çc]ox|ilk)(?![\p{L}])/iu.test(normQuery);
  if (!hasStructured && qType.azContext && (qType.type === "date" || qType.type === "count" || qType.type === "list" || azSuperlative) &&
      Date.now() - started < 3800 && !scored.some(r => /(^|\.)az\.wikipedia\.org$/i.test((() => { try { return new URL(r.url).hostname; } catch { return ""; } })()))) {
    try {
      const coreAz = tokenize(normQuery).filter(t => t.length >= 3).slice(0, 4).join(" ");
      if (coreAz) {
        // v54.4: "site:" operatorunu provayderlər atırdı → hint heç vaxt işə düşmürdü.
        // İndi az.wikipedia API-nin özü, 4 namizəd sorğu ilə.
        const rsW = await withTimeout(searchAzWikiHint(normQuery, qTerms, Math.min(6, maxResults)), 1200, "azwiki hint timeout");
        const rsWList = Array.isArray(rsW) ? rsW : [];
        const tW = [...new Set([...qTerms, ...tokenize(coreAz)])];
        const extraW = rsWList.filter(r => /wikipedia\.org/i.test(r.url) && !isSpamDomain(r.url))
          .map(r => {
            const sc0 = scoreResult(r, tW, qLang, normQuery);
            // v55: "Azərbaycan X" sualında X baş sözünü başlığında daşıyan məqalə önə
            // ("Azərbaycan mədəniyyəti" yox, "Bakı metrosu" — metro sualında)
            const head = tW.filter(t => t !== "azerbaycan" && t.length >= 4);
            const titleT = tokenize(r.title || "");
            const headHit = head.some(h => titleT.some(t => t.startsWith(h.slice(0, Math.max(4, h.length - 2)))));
            return { ...r, score: sc0 + (headHit ? 1.4 : 0) };
          })
          .filter(r => r.score >= 1.3);
        if (extraW.length) {
          degradedStages.push("azwiki_hint");
          const seenW = new Set(scored.map(r => r.url));
          for (const r of extraW.sort((a, b) => b.score - a.score)) if (!seenW.has(r.url)) scored.push(r);
          scored.sort((a, b) => b.score - a.score);
        }
      }
    } catch {}
  }

  // v41.5: 1 nəticə = pis siqnal — zəif namizədləri geri qat ki, seçim olsun
  if (scored.length < 3) {
    const seenU = new Set(scored.map(r => r.url));
    const siteLocked = /site:([a-z0-9.-]+\.[a-z]{2,})/i.test(query) || /"([^"]+)"/.test(query);
    // v51.2: "asdkjqwe zzzz" kimi mənasız sorğuda hər provayder zibil qaytarır
    // (YouTube, Microsoft ana səhifəsi) və 0.4 skor qapısı hamısını keçirirdi.
    // İndi gate_relaxed də ƏN AZI BİR real termin uyğunluğu tələb edir.
    const relaxTerms = [...new Set([...qTerms, ...tokenize(searchResult.anchorQuery || "")])]
      .map(t => String(t).toLowerCase()).filter(t => t.length >= 4);
    const weak = (siteLocked ? [] : results)
      .filter(r => !isSpamDomain(r.url) && !seenU.has(r.url) && !ERR_PAGE.test(String(r.title || "").trim()))
      .filter(r => {
        const blob = `${r.title || ""} ${r.snippet || ""}`.toLowerCase();
        return relaxTerms.some(t => blob.includes(t));
      })
      .filter(r => {
        if (!/wikipedia\.org/.test(r.url || "")) return true;  // v39.5 filtrini təkrarla
        const t = String(r.title || "").toLowerCase();
        return qTerms.some(x => x.length >= 4 && t.includes(String(x).slice(0, Math.max(4, x.length - 3)).toLowerCase()));
      })
      .map(r => ({ ...r, score: scoreResult(r, qTerms, qLang, normQuery) }))
      .filter(r => r.score >= 0.4)
      .sort((a, b) => b.score - a.score);
    if (weak.length) {
      degradedStages.push("gate_relaxed");
      for (const r of weak) { scored.push(r); if (scored.length >= 5) break; }
      scored.sort((a, b) => b.score - a.score);
    }
  }

  // v42.4: skor qapısı HƏR ŞEYİ atdısa (AZ-da tez-tez: "dinozavrlar haqqında faktlar"),
  // boş cavab yerine provayderin ən yaxşı 3 namizədini göstər
  if (!scored.length && results.length && !/site:([a-z0-9.-]+\.[a-z]{2,})/i.test(query) && !/"([^"]+)"/.test(query)) {
    degradedStages.push("score_gate_bypassed");
    const hitsOf = (blob, terms) => terms.reduce((n, t) => n + (blob.includes(String(t)) ? 1 : 0), 0);
    const byRaw = results
      .filter(r => !isSpamDomain(r.url) && !ERR_PAGE.test(String(r.title || "").trim()))
      // v45.3: bypass yalnız HƏQİQƏTƏN əlaqəli namizədləri göstərsin (əvvəl "Ruandanın naziri" çıxırdı)
      .filter(r => {
        const blob = `${r.title || ""} ${r.snippet || ""}`.toLowerCase();
        // v49.1: AZ sorğu ↔ EN nəticə — anchor (tərcümə) terminləri də sayılır,
        // yoxsa "südün tərkibində kalsium" kimi suallar tam boş qalırdı
        const strong = [...new Set([...qTerms, ...tokenize(searchResult.anchorQuery || "")])].filter(t => String(t).length >= 4);
        const need = strong.length >= 4 ? 2 : 1;
        return hitsOf(blob, strong) >= need;
      })
      .filter(r => {
        if (!/wikipedia\.org/.test(r.url || "")) return true;
        const t = String(r.title || "").toLowerCase();
        return qTerms.some(x => x.length >= 4 && t.includes(String(x).slice(0, Math.max(4, x.length - 3)).toLowerCase()));
      })
      .map(r => ({ ...r, score: scoreResult(r, qTerms, qLang, normQuery) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    // v49.3: genişləndirilmiş bypass zibil qaytarırdı ("Endokrin sistemi") → geri götürüldü
    if (byRaw.length) scored = byRaw;
  }

  let filtered = diversifyByDomain(scored, maxResults + 2, 1, 2); // v43: 2 ehtiyat səhifə həqiqətən saxlanılır
  const filteredCount = scored.length;

  const toFetch = filtered.slice(0, maxResults + 2); // v39.4: 2 ehtiyat namizəd (zibil səhifə düşsə əvəzlənsin)
  const searchTookMs = Date.now() - started;
  // v15: 3500ms -> 5500ms (mənbə gecikəndə tam məqalə oxunuşunu yarıda kəsməsin)
  // v52.2: 8s deadline sərt qalsın — vaxt azalıbsa səhifə oxunuşunu keç (snippet kifayətdir)
  const skipFetch = format === "simple" || searchTookMs > 4500 || (HARD_DEADLINE_MS - (Date.now() - started)) < 1600;
  // v15/v17: həm normallaşmış sual, həm də ingilis tərcüməsi ilə abzas seçimi + saytı sorğu dilində aç!
  const extractQuery = effAnchor ? `${normQuery} ${effAnchor}` : normQuery;
  // v26: çıxarış mərhələsi ümumi deadline-a sığmalıdır — əvvəl jina fallback 5 nəticədə
  // paralel 5.5s gözləyirdi və took_ms 8s-i keçirdi. İndi qalan vaxtla RACE olunur.
  const extractBudget = Math.max(700, Math.min(2000, HARD_DEADLINE_MS - (Date.now() - started) - 1200));
  const extractAll = Promise.allSettled(
    toFetch.map((r, i) => fetchAndExtract(r.url, extractQuery, Math.min(2600, extractBudget), reqLang, { jina: i < 2 }))
  );
  const extracted = skipFetch
    ? toFetch.map(() => ({ status: "fulfilled", value: null }))
    : await Promise.race([
        extractAll,
        new Promise((resolve) => setTimeout(() => { degradedStages.push("extract_timeout"); resolve(toFetch.map(() => ({ status: "fulfilled", value: null }))); }, extractBudget))
      ]);

  const currentIntent = /(?<![\p{L}])(ən\s+çox|son|bu\s+gün|bugün|hazırda|indiki|yeni|top|best|most\s+visited|most\s+popular|latest|current)(?![\p{L}])/iu.test(normQuery) && !/\b(1\d{3}|20[01]\d)\b/.test(normQuery);
  const junkPool = [];
  const finalResults = [];
  let contentOffTopic = false; // v55: mətni sorğuya aidiyyəti olmayan səhifə
  // v57.5: ümumi "son xəbərlər" sorğusunda məzmun-uyğunluq qapısı işləməməlidir —
  // UEFA xəbərində "xəbər" sözü keçmir, amma nəticə düzgündür.
  const GENERIC_QT = new Set(["xeber", "xeberler", "azerbaycan", "son", "news", "dunya", "gundem", "bugun", "yeni", "latest"]);
  const genericNewsQ = /(?<![\p{L}])(x[əe]b[əe]r|xeber|news|son|latest|headlines)(?![\p{L}])/iu.test(normQuery) &&
    qTerms.length > 0 && qTerms.every(t => GENERIC_QT.has(String(t).toLowerCase()));
  let totalChars = 0;
  const basePerSource = Math.ceil(maxChars / maxResults);

  for (let i = 0; i < toFetch.length; i++) {
    contentOffTopic = false; // v55.3: hər nəticə üçün sıfırlanmalıdır (əvvəl "yapışırdı")
    const base = toFetch[i];
    // v15: ən güclü 1-ci və 2-ci mənbəyə daha geniş həcm ayır ki, cavab yarıda kəsilməsin
    const itemBudget = i === 0
      ? Math.min(1600, Math.max(basePerSource, Math.round(maxChars * 0.36)))
      : i === 1
        ? Math.min(1200, Math.max(basePerSource, Math.round(maxChars * 0.26)))
        : basePerSource;

    const ex = extracted[i].status === "fulfilled" ? extracted[i].value : null;
    let content = "";
    let title = cleanContent(base.title || "") || base.title;
    if (ex) {
      title = cleanContent(ex.title || "") || ex.title || title;
      content = selectRelevantParagraphs(ex.text, extractQuery, title, itemBudget);
      if (!content || !content.trim()) content = base.snippet || "";
    } else {
      content = base.snippet || "";
    }
    content = stripBoilerplateHead(cleanContent(content));
    // v40: rəqəm/tarix sualında əvvələ qısa cavab cümləsi (≤300) — qalan mətn toxunulmaz qalır
    if ((qType.type === "count" || qType.type === "date") && i === 0 && content.length > 320) {
      const lead = leadAnswerSentence(content, normQuery, effAnchor || "", qType.type === "count");
      if (lead && !content.startsWith(lead)) { content = lead + " " + content; degradedStages.push("lead_answer"); }
    }
    // v38: yalnız "Həmçinin bax / ©" qalan content faydasızdır → snippet-ə qayıt
    if (isBoilerplateOnly(content)) content = cleanContent(base.snippet || "").trim() || content;
    if (!content.trim()) content = cleanContent(base.snippet || "").trim();
    if (!content.trim() && ex && ex.meta_description) content = cleanContent(ex.meta_description).trim();
    if (totalChars + content.length > maxChars && finalResults.length >= 2) {
      content = content.slice(0, Math.max(0, maxChars - totalChars));
    }
    totalChars += content.length;

    // v16: Mənbə saytın özündən çıxan həqiqi nəşr/yenilənmə tarixini əlavə et (Rule 8: Wikipedia published_at həmişə null qalır!)
    const isWiki = base.source === "wikipedia" || /\.wikipedia\.org$/i.test((() => { try { return new URL(base.url).hostname; } catch { return ""; } })());
    const pubAt = isWiki
      ? null
      : (normalizeValidIsoDate(base.published_at) || (ex && ex.published_at) || base.published_at || null);
    const updAt = normalizeValidIsoDate(base.updated_at) || (ex && ex.updated_at) || base.updated_at || null;

    let itemScore = base.score ?? null;
    // Səhifə açılandan sonra məlum olsa ki məqalə 4+ il köhnədir, müasir sorğuda xalını aşağı sal
    if (currentIntent && pubAt && itemScore !== null) {
      const pts = Date.parse(pubAt);
      if (!Number.isNaN(pts) && (Date.now() - pts) / (365.25 * 86_400_000) > 4) {
        itemScore = Math.round((itemScore - 2.5) * 100) / 100;
      }
    }

    // v42.3: abzas seçimi zibil qaytardısa (GeeksforGeeks/Commerce kimi səhifələr),
    // səhifənin təmizlənmiş mətninin başından götür — boş content qalmasın
    if (ex && ex.text && isBoilerplateOnly(content)) {
      const rawHead = stripBoilerplateHead(cleanContent(ex.text)).slice(0, Math.max(400, Math.round(itemBudget * 0.7)));
      if (rawHead && !isBoilerplateOnly(rawHead)) { content = rawHead; degradedStages.push("raw_text_fallback"); }
    }
    const clippedContent = content.slice(0, itemBudget);
    // v55: sayt açıldı, mətn gəldi — AMMA sorğu ilə heç bir əlaqəsi yoxdursa (JS ilə
    // yüklənən tibbi saytın yalnız şüarı gəlir: "Biz pasiyent mərkəzli qayğıya..."),
    // nəticə zibil hovuzuna düşür. Yalnız mətn sorğu dilindədirsə tətbiq olunur ki,
    // tərcümə olunmamış EN səhifələr təsadüfən silinməsin.
    if (!genericNewsQ && clippedContent && clippedContent.length > 200) {
      const cNorm = cleanContent(clippedContent).toLowerCase();
      const contentInQueryLang = qLang === "en" || /[əğışöüç]/.test(cNorm);
      const offTopic = contentInQueryLang && qTerms.length > 0 && !qTerms.some(t => {
        const key = String(t).toLowerCase();
        return key.length >= 3 && cNorm.includes(key.slice(0, Math.max(4, key.length - 2)));
      });
      if (offTopic) {
        contentOffTopic = true;
        degradedStages.push("content_off_topic");
      }
    }
    // Əgər axtarış motorunun snippet-i kəsik/xətalıdırsa ("url_to_copy Sorry!..."), saytın rəsmi yerli ön-izləməsini (meta_description) götür
    const rawSnipSource = (ex && ex.meta_description && (!base.snippet || base.snippet.length < 35 || /url_to_copy|requires a keyboard/i.test(base.snippet)))
      ? ex.meta_description
      : (base.snippet || (ex && ex.meta_description) || "");
    const rawSnippet = cutWord(cleanContent(rawSnipSource), 220);
    // v39.4: nə content, nə snippet məzmun daşımırsa (yalnız "© Copyright" / "Həmçinin bax")
    // → nəticəni göstərmə, ehtiyat namizədlə əvəzlə
    if (finalResults.length >= maxResults) break;
    const out = {
      id: finalResults.length + 1,
      title,
      url: base.url,
      snippet: dedupeSnippet(rawSnippet, clippedContent),
      content: clippedContent,
      source: base.source,
      provider: base.source,
      providers: base.providers || [base.source],
      sources: [...new Set([...(base.providers || []), base.source].filter(Boolean))],
      voteCount: base.voteCount || 1,
      score: itemScore,
      published_at: pubAt,
      updated_at: updAt,
      date_info: buildDateInfo(pubAt, updAt, reqLang),
      // v57: məqalədə og:image varsa göstər (bəzi saytlar cavabı şəkildə verir) —
      // mövcud sahələr dəyişmir, yalnız əlavə olunur
      ...(base.image ? { image: base.image } : {}),
      untrusted: true
    };
    // v41.2: məzmunsuz səhifə göstərilmir — amma tam boş qalmasın deyə "ehtiyat hovuz"a yığılır
    // v41.6: zibil səhifə YALNIZ 2 nəticə artıq varsa atılır — tək nəticə qalmaqdansa,
    // zəif content göstərmək yaxşıdır (n=1 problemi 15 sualda idi)
    const canSkip = finalResults.length >= 2 && (toFetch.length - i - 1) >= 1;
    // v55.1: mətni sorğuya aidiyyəti olmayan səhifə həmişə atılır (canSkip gözləmir) —
    // "C vitamini hansı qidalarda var" sualında Medera Hospital 1-ci nəticə kimi qalırdı
    if (contentOffTopic || (canSkip && isBoilerplateOnly(clippedContent) && (isBoilerplateOnly(rawSnippet) || !rawSnippet.trim()))) {
      if (!contentOffTopic) degradedStages.push("junk_page_skipped");
      junkPool.push({ ...out, content_off_topic: contentOffTopic || undefined });
      continue;
    }
    if (contentOffTopic) out.content_off_topic = true;
    finalResults.push(out);
    if (totalChars >= maxChars) break;
  }

  // v41.2: hər şey zibil çıxdısa, boş cavab vermək əvəzinə ən yaxşı 2-ni göstər
  if (!finalResults.length && junkPool.length) {
    degradedStages.push("junk_restored");
    for (const o of junkPool.slice(0, 2)) { o.id = finalResults.length + 1; finalResults.push(o); }
  }

  // v52: istifadəçi tələbi — "nəticə gəlməsə təkrar sınansın, 1 nəticədənsə bir neçə
  // fərqli nəticə olsun". Boş və ya tək nəticə qalıbsa, FƏRQLİ sorğu forması ilə
  // ikinci cəhd: EN anchor + nüvə sözlər + (mövzu uyğundursa) rəsmi Milli Arxiv.
  // v52.3: score_gate_bypassed (skor qapısı hər şeyi atdı → zəif namizədlər göstərildi)
  // halında da ikinci cəhd edilir; faydalı nəticə gəlsə, zibil namizədlər atılır.
  const bypassFilled = degradedStages.includes("score_gate_bypassed");
  if (!unintelligible && !hasStructured && (finalResults.length < 2 || bypassFilled) && (HARD_DEADLINE_MS - (Date.now() - started)) > 2400) {
    const have = new Set(finalResults.map(x => String(x.url || "").replace(/\/$/, "")));
    const rescueQs = [];
    if (effAnchor && effAnchor.trim() && effAnchor !== normQuery) rescueQs.push(effAnchor);
    const coreQ = tokenize(normQuery).slice(0, 4).join(" ");
    if (coreQ && coreQ !== normQuery) rescueQs.push(coreQ);
    const strongTerms = [...new Set([...qTerms])].map(t => String(t).toLowerCase()).filter(t => t.length >= 4);
    const addCandidate = (c) => {
      if (finalResults.length >= maxResults) return false;
      const key = String(c.url || "").replace(/\/$/, "");
      if (!key || have.has(key)) return false;
      if (isSpamDomain(c.url) || ERR_PAGE.test(String(c.title || "").trim())) return false;
      const blob = `${c.title || ""} ${c.snippet || ""}`.toLowerCase();
      if (!strongTerms.some(t => blob.includes(t))) return false;
      const sc = scoreResult(c, qTerms, qLang, normQuery);
      if (sc < 1.2) return false;
      const snip = cutWord(cleanContent(c.snippet || ""), 220);
      if (!snip.trim() || isBoilerplateOnly(snip)) return false;
      have.add(key);
      finalResults.push({
        id: finalResults.length + 1,
        title: cleanContent(c.title || "") || c.title,
        url: c.url,
        snippet: snip,
        content: snip,
        source: c.source,
        provider: c.source,
        providers: c.providers || [c.source],
        sources: [...new Set([...(c.providers || []), c.source].filter(Boolean))],
        voteCount: c.voteCount || 1,
        score: Math.round(sc * 100) / 100,
        published_at: c.published_at || null,
        updated_at: c.updated_at || null,
        date_info: buildDateInfo(c.published_at || null, c.updated_at || null, reqLang),
        untrusted: true,
        rescued: true
      });
      return true;
    };
    let added = 0;
    const rescueStop = started + HARD_DEADLINE_MS - 700; // 8s deadline-ı aşmamaq
    const leftMs = () => rescueStop - Date.now();
    for (const rq of rescueQs.slice(0, 2)) {
      if (finalResults.length >= maxResults || added >= 2) break;
      if (leftMs() < 1400) break;
      try {
        const rs = await Promise.race([
          searchAll(rq, Math.min(6, maxResults + 3), { freshness, excludeDomains }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("rescue timeout")), Math.min(2400, Math.max(600, leftMs()))))
        ]);
        if (rs && rs.results) {
          const ranked = rs.results.slice().sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0));
          for (const c of ranked) { if (addCandidate(c)) added++; if (added >= 2) break; }
        }
      } catch {}
    }
    // rəsmi mənbə: Milli Arxiv (yavaş sayt — yalnız burada, vaxt qalanda)
    if (added < 2 && isArchiveTopic(normQuery) && leftMs() > 2600) {
      try {
        const ma = await Promise.race([
          searchMilliArxiv(normQuery, 4),
          new Promise((_, rej) => setTimeout(() => rej(new Error("ma timeout")), Math.min(3000, Math.max(700, leftMs()))))
        ]);
        for (const c of (ma || [])) { if (addCandidate(c)) added++; if (added >= 2) break; }
      } catch {}
    }
    if (added) degradedStages.push("rescue_retry");
    // ikinci cəhd faydalı nəticə gətirdisə, bypass ilə gələn zəif namizədləri at
    if (added && bypassFilled) {
      const keep = finalResults.filter(x => x.rescued || (x.score ?? 0) >= 1.5);
      if (keep.length >= 1 && keep.length < finalResults.length) {
        degradedStages.push("junk_pruned_after_rescue");
        finalResults.length = 0;
        keep.forEach((x, i) => { x.id = i + 1; finalResults.push(x); });
      }
    }
  }

  // v43: istifadəçi "son 1 gün/həftə" istəyibsə, çıxarışdan sonra REAL tarixi yoxla
  if (freshness && finalResults.length > 2) {
    const days = freshness === "day" ? 2 : freshness === "week" ? 9 : freshness === "month" ? 40 : 400;
    const kept = finalResults.filter(r => {
      const t = Date.parse(r.published_at || "");
      return Number.isNaN(t) || (Date.now() - t) / 86400000 <= days;
    });
    if (kept.length >= 1 && kept.length < finalResults.length) {
      degradedStages.push("freshness_filter");
      finalResults.length = 0;
      kept.forEach((r, idx) => { r.id = idx + 1; finalResults.push(r); });
    }
  }

  // Səhifə tarixindən sonra köhnə mənbə cəzalandırılıbsa, sıralamanı yenilə və həddən aşağı düşənləri çıxar
  if (currentIntent && finalResults.length > 1) {
    finalResults.sort((a, b) => ((b.score ?? 0) - (a.score ?? 0)) || ((b.voteCount || 0) - (a.voteCount || 0)));
    const freshEnough = finalResults.filter(r => (r.score ?? 0) >= 1.5);
    if (freshEnough.length >= 1) {
      finalResults.length = 0;
      finalResults.push(...freshEnough);
      totalChars = finalResults.reduce((acc, r) => acc + (r.content ? r.content.length : 0), 0);
    }
    finalResults.forEach((r, idx) => { r.id = idx + 1; });
  }

  const structured = [];
  if (weather && weatherText) structured.push({ title: `${weather.city} - hava məlumatı (Open-Meteo)`, url: "https://open-meteo.com", snippet: undefined, content: weatherText, sources: ["open-meteo"], source: "open-meteo", published_at: weather.fetched_at, updated_at: null, date_info: buildDateInfo(weather.fetched_at, null, reqLang), untrusted: false });
  if (timeData && timeText && intentExact) structured.push({ title: `${timeData.place || "Azərbaycan"} üçün hazırkı vaxt (${timeData.timezone})`, url: "https://time.is", snippet: undefined, content: timeText, sources: ["asia-baku-time"], source: "asia-baku-time", published_at: timeData.fetched_at, updated_at: null, date_info: buildDateInfo(timeData.fetched_at, null, reqLang), untrusted: false });
  if (nutriData && nutriText) structured.push({ title: `${nutriData.food} — qida tərkibi (USDA)`, url: "https://fdc.nal.usda.gov/", snippet: undefined, content: nutriText, sources: ["usda.gov"], source: "usda", published_at: nutriData.fetched_at, updated_at: null, date_info: buildDateInfo(nutriData.fetched_at, null, reqLang), untrusted: false });
  if (mathData && mathText) structured.push({ title: `Hesablama (daxili)`, url: "https://www.wolframalpha.com/", snippet: undefined, content: mathText, sources: ["daxili-hesablama"], source: "hesablama", published_at: null, updated_at: null, date_info: buildDateInfo(null, null, reqLang), untrusted: false });
  if (sportsData && sportsText) structured.push({ title: `${sportsData.team} — son oyun (TheSportsDB)`, url: "https://www.thesportsdb.com/", snippet: undefined, content: sportsText, sources: ["thesportsdb.com"], source: "thesportsdb", published_at: sportsData.fetched_at, updated_at: null, date_info: buildDateInfo(sportsData.fetched_at, null, reqLang), untrusted: false });
  if (factData && factText) structured.push({ title: factData.kind === "works" ? `${factData.entity} — əsərləri (Wikidata)` : factData.kind === "capital" ? `${factData.entity} — paytaxtı (Wikidata)` : factData.kind === "country" ? `${factData.entity} — hansı ölkədə (Wikidata)` : `${factData.entity} — əhalisi (Wikidata)`, url: `https://www.wikidata.org/wiki/${factData.qid}`, snippet: undefined, content: factText, sources: ["wikidata.org"], source: "wikidata", published_at: factData.fetched_at, updated_at: null, date_info: buildDateInfo(factData.fetched_at, null, reqLang), untrusted: false });
  if (unitsData && unitsText && intentExact) structured.push({ title: `Vahid çevirməsi (daxili hesablama)`, url: "https://www.unitconverters.net/", snippet: undefined, content: unitsText, sources: ["daxili-hesablama"], source: "hesablama", published_at: null, updated_at: null, date_info: buildDateInfo(null, null, reqLang), untrusted: false });
  if (currencyData && currencyText && intentExact) structured.push({ title: `Rəsmi valyuta məzənnəsi (CBAR)`, url: "https://www.cbar.az", snippet: undefined, content: currencyText, sources: ["cbar.az"], source: "cbar.az", published_at: currencyData.fetched_at, updated_at: null, date_info: buildDateInfo(currencyData.fetched_at, null, reqLang), untrusted: false });
  if (structured.length) {
    finalResults.unshift(...structured);
    finalResults.forEach((r, idx) => { r.id = idx + 1; });
  }

  // v15/v16 (Alim qaydası): sual hansı dildə verilibsə, cavab məzmununu da həmin dilə çevirib qaytar!
  let resultsTranslated = false;
  if (shouldTranslateResults && finalResults.length > 0 && format !== "simple" && Date.now() - started < HARD_DEADLINE_MS - 900) {
    const trBudget = Math.max(400, Math.min(2200, HARD_DEADLINE_MS - 1200 - (Date.now() - started)));
    // v30 (P1): texniki/məzmunca EN olan suallarda NƏTİCƏ tərcüməsi söndürülür.
    // Səbəb: "React state management" → "dövlət idarəetməsi" təhrifi məhz buradan gəlirdi.
    // v33: STRUKTUR siqnal — sadalanmış söz regex-i yerinə nəticələrə bax:
    // top-3-ün 2-si rəsmi sənəd/kod hostudursa, tərcümə məzmunu təhrif edir → keç
    const DOCS_HOST = /(^|\.)(stackoverflow\.com|github\.com|react\.dev|mozilla\.org|python\.org|kotlinlang\.org|docker\.com|postgresql\.org|git-scm\.com|kubernetes\.io|rust-lang\.org|golang\.org|npmjs\.com)$|^docs\./i;
    const docsTop = finalResults.slice(0, 3).filter((r) => { try { return DOCS_HOST.test(new URL(r.url).hostname.replace(/^www\./, "")); } catch { return false; } }).length;
    // v54: 1-ci nəticə ENSİKLOPEDİYA/məqalədirsə (kod səhifəsi deyilsə) tərcümə EDİLİR.
    // "GitHub nədir" → en.wikipedia mətni AZ cavabda ingilis qalırdı.
    const PROSE_HOST = /(^|\.)(wikipedia\.org|britannica\.com|azertag\.az|report\.az|apa\.az)$/i;
    const firstIsProse = (() => {
      try { return PROSE_HOST.test(new URL(finalResults[0].url).hostname.replace(/^www\./, "")); } catch { return false; }
    })();
    if (!firstIsProse && (isTechQuery || docsTop >= 2)) {
      degradedStages.push(isTechQuery ? "translate_skipped_tech" : "translate_skipped_docs");
    } else {
      const protTerms = [...new Set((String(query).match(/[A-Za-z][A-Za-z0-9_.:-]{2,}/g) || []))].slice(0, 8);
      resultsTranslated = await translateResultsToQueryLang(finalResults, reqLang, trBudget, 1600, protTerms);
    }
    if (resultsTranslated) {
      for (const r of finalResults) {
        if (r.title) r.title = cleanContent(r.title) || r.title;
        if (r.content) r.content = cleanContent(r.content) || r.content;
        if (r.snippet) r.snippet = dedupeSnippet(cleanContent(r.snippet), r.content);
      }
      totalChars = finalResults.reduce((acc, r) => acc + (r.content ? r.content.length : 0), 0);
    }
  }

  let reason = null;
  if (!finalResults.length && unintelligible) {
    reason = "unintelligible_query";
    usedFallback = true;
    if (!degradedStages.includes("unintelligible")) degradedStages.push("unintelligible");
  } else if (!finalResults.length) {
    const allFailed = providersUsed.length === 0 && Object.keys(errors).length > 0;
    if (allFailed) reason = "blocked";
    else if (!rawCount) reason = "no_match";
    else if (!filteredCount) reason = "all_filtered";
    else reason = "no_relevant_results";
  }

  const safeErrors = {};
  for (const [k, v] of Object.entries(errors)) {
    safeErrors[k] = /circuit open/.test(v) ? "cooldown"
      : /429/.test(v) ? "rate_limited"
      : /403|401/.test(v) ? "blocked"
      : /400/.test(v) ? "bad_request"
      : /skip|unsupported/i.test(v) ? "skipped"
      : /no results|parse empty/i.test(v) ? "no_results"
      : /timeout|abort/i.test(v) ? "timeout"
      : "error";
  }

  // v55.2: başlığında sorğu termini OLMAYAN nəticə, başlığında olan nəticənin üstünə
  // qalxmamalıdır. "C vitamini hansı qidalarda var" → Medera Hospital başlığı
  // ("Sağlamlığınızın qeydinə qalın") 1-ci, "C Vitamini Hansı Qidalarda Var?" 2-ci idi.
  // v58: ümumi "son xəbərlər" sorğusunda təzəlik rejimi (yalnız bu halda!)
  if (genericNewsQ && finalResults.length > 1) {
    const ordered = orderByRecency(finalResults.slice());
    const changed = ordered.some((r, i) => r !== finalResults[i]);
    if (changed) {
      finalResults.length = 0;
      ordered.forEach((r, idx) => { r.id = idx + 1; finalResults.push(r); });
      degradedStages.push("recency_order");
    }
  }
  if (finalResults.length > 1 && qTerms.length) {
    const titleKey = (r) => {
      const tt = tokenize(String(r.title || ""));
      return qTerms.some(t => {
        const k = String(t);
        if (k.length < 4) return false;
        const stem = k.slice(0, Math.max(4, k.length - 2));
        return tt.some(x => x.startsWith(stem));
      }) ? 1 : 0;
    };
    const dec = finalResults.map((r, i) => ({ r, i, k: titleKey(r) }));
    if (dec.some(d => d.k === 1) && dec.some(d => d.k === 0)) {
      dec.sort((a, b) => (b.k - a.k) || ((b.r.score || 0) - (a.r.score || 0)) || (a.i - b.i));
      finalResults.length = 0;
      dec.forEach((d, idx) => { d.r.id = idx + 1; finalResults.push(d.r); });
      degradedStages.push("title_relevance_order");
    }
  }

  // v29: rəqəm ziddiyyəti — eyni vahid üçün müxtəlif nəticələrdə fərqli dəyərlər
  // v30.1 (P2 hazır olana qədər): vahid çarpanı (min/milyon) və il ölçüsü olmadığı üçün
  // saxta ziddiyyət istehsal edir → default SÖNDÜRÜLDÜ. ENABLE_CONFLICTS=1 ilə yandırılır.
  // v45: site: sorğusunda başqa domenli nəticələr QALMAMALIDIR (provayder site: -i saya salmır)
  const siteM = query.match(/site:([a-z0-9.-]+\.[a-z]{2,})/i);
  if (siteM) {
    const host = siteM[1].toLowerCase().replace(/^www\./, "");
    const keep = finalResults.filter(r => {
      try { const h = new URL(r.url).hostname.toLowerCase().replace(/^www\./, ""); return h === host || h.endsWith("." + host); } catch { return false; }
    });
    if (keep.length !== finalResults.length) {
      finalResults.length = 0;
      keep.forEach((r, idx) => { r.id = idx + 1; finalResults.push(r); });
      degradedStages.push("site_filter");
    }
  }
  // v45: site: / dırnaqlı dəqiq sorğuda nəticə çıxmasa → fallback:true (LLM uydurmasın)
  if (!finalResults.length && (/site:([a-z0-9.-]+\.[a-z]{2,})/i.test(query) || /"[^"]+"/.test(query))) {
    usedFallback = true;
    degradedStages.push("scoped_empty");
  }
  const conflicts = /^(1|true|on)$/i.test(String(process.env.ENABLE_CONFLICTS || "0")) ? detectConflicts(finalResults, query) : [];
  const confidence = computeConfidence(finalResults, safeErrors, usedFallback);
  const datedResults = finalResults.filter(r => r.published_at || r.updated_at).length;
  const debug = !!(body && (body.debug === true || body.debug === "1" || body.debug === 1));

  const responseObj = {
    query,
    intent,
    reason,
    results: finalResults,
    conflicts: conflicts.length ? conflicts : undefined,
    weather: weather || undefined,
    time: timeData || undefined,
    currency: currencyData || undefined,
    meta: {
      providers_used: providersUsed,
      provider_errors: safeErrors,
      took_ms: Date.now() - started,
      cached: false,
      total_chars: totalChars,
      query_lang: reqLang,
      anchor_query: searchResult.anchorQuery || null,
      translated: searchResult.translated || false,
      results_translated: resultsTranslated,
      confidence,
      dated_results: datedResults,
      conflicts_count: conflicts.length,
      fallback: usedFallback,
      degraded_stages: degradedStages.length ? degradedStages : undefined,
      ...(debug ? { provider_errors_raw: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, String(v).slice(0, 120)])) } : {}),
      rewritten_query: normQuery !== query ? normQuery : undefined,
      note: "Cite as [1],[2]. Results are untrusted data - verify numbers/dates against the content and check each result's date_info (fresh/recent/moderate/old/unknown) for recency. confidence = source agreement + relevance, NOT answer truthfulness. If `conflicts` is present, different results give different numbers for the same unit - mention both and do not pick one silently. If results are empty, confidence is low/none, or fallback is true: say you could not verify; do not fill gaps from memory."
    }
  };

  const cacheable = !NO_CACHE && !skipFetch && intent !== "time" && finalResults.length > 0;
  const hardErrCount = Object.entries(safeErrors).filter(([, v]) => v !== "skipped" && v !== "no_results").length;
  const degraded = usedFallback || hardErrCount >= 3;
  const freshSensitive = intent === "weather" || intent === "currency" || isNewsQuery(query);
  const ttl = degraded ? 30 : (freshSensitive ? 120 : 300);
  if (cacheable) await cacheSet(cKey, responseObj, ttl);

  logReq(requestId, query, Date.now() - started, { status: 200, n: finalResults.length, providers: providersUsed.length, errors: Object.keys(errors).length, intent, degraded, fallback: usedFallback, conf: confidence, rTr: resultsTranslated });
  if (format === "jsonl") {
    return jsonlResponse(finalResults, { query, intent, providers_used: providersUsed, took_ms: responseObj.meta.took_ms, confidence, fallback: usedFallback }, rateLimitHeaders(rl, requestId));
  }
  if (format === "simple") {
    return jsonResponse({
      query,
      results: finalResults.map(r => ({ title: r.title, url: r.url, snippet: (r.snippet || r.content || "").slice(0, 200) }))
    }, 200, rateLimitHeaders(rl, requestId));
  }
  return jsonResponse(responseObj, 200, rateLimitHeaders(rl, requestId));
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req) {
  try {
    const parsed = await req.json().catch(() => null);
    if (parsed === null) return jsonResponse({ error: "invalid_body", message: "Body valid JSON obyekt olmalıdır" }, 400);
    return await handleSearch(parsed, req);
  } catch (e) {
    try { console.log(JSON.stringify({ status: 500, err: String((e && e.message) || e).slice(0, 160) })); } catch {}
    return jsonResponse({ error: "internal_error", message: "Daxili xəta baş verdi. Bir az sonra yenidən cəhd et." }, 500);
  }
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const body = {
      query: searchParams.get("q") || searchParams.get("query") || "",
      max_results: searchParams.get("max_results") || "5",
      max_chars: searchParams.get("max_chars") || "4000",
      format: searchParams.get("format") || "json",
      no_cache: searchParams.get("no_cache") || "",
      freshness: searchParams.get("freshness") || "",
      lang: searchParams.get("lang") || "",
      translate_results: searchParams.get("translate_results") !== "0",
      exclude_domains: searchParams.get("exclude_domains") ? searchParams.get("exclude_domains").split(",") : [],
      debug: searchParams.get("debug") === "1"
    };
    return await handleSearch(body, req);
  } catch (e) {
    try { console.log(JSON.stringify({ status: 500, err: String((e && e.message) || e).slice(0, 160) })); } catch {}
    return jsonResponse({ error: "internal_error", message: "Daxili xəta baş verdi. Bir az sonra yenidən cəhd et." }, 500);
  }
}
