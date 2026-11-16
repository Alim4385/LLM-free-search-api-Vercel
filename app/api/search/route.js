import { searchAll } from "../../../lib/search.js";
import { fetchAndExtract, buildDateInfo, normalizeValidIsoDate } from "../../../lib/extract.js";
import { detectConflicts } from "../../../lib/conflict.js";
import { selectRelevantParagraphs, tokenize } from "../../../lib/rank.js";
import { matchWeather, fetchWeather, weatherToText } from "../../../lib/weather.js";
import { matchTime, fetchTime, timeToText } from "../../../lib/time.js";
import { matchCurrency, fetchCBAR, currencyToText } from "../../../lib/currency.js";
import { classifyType, officialBoost, wantsFresh } from "../../../lib/router.js";
import { scoreResult, diversifyByDomain, extractQuotedPhrases, containsPhrase, isSpamDomain, hostMatches, computeConfidence, isNewsQuery } from "../../../lib/score.js";
import { cleanContent, cutWord, dedupeSnippet, detectQueryLanguage, isBoilerplateOnly } from "../../../lib/clean.js";
import { expandQuery, isMetaQuery, stripMetaInstructions, rewriteSearchIntentAz } from "../../../lib/expand.js";
import { translateResultsToQueryLang } from "../../../lib/translate.js";
import { cacheGet, cacheSet, cacheKey } from "../../../lib/cache.js";
import { checkRateLimit, getClientIp, sanitizeQuery, RATE_LIMIT } from "../../../lib/ratelimit.js";

export const runtime = "nodejs";
export const maxDuration = 30;
const HARD_DEADLINE_MS = 8000; // v19/v26: maksimum cavab müddəti — modul səviyyəsindədir ki, TDZ xətası olmasın
const FILTER_VERSION = 64; // v19: necə/neçə bug fix, valyuta hesabı, WMO hava mətni, ölkə saat qurşağı, xəbər niyyəti, bal və confidence sərtləşdirməsi, 8s deadline; v18.1: r.jina.ai ehtiyat qatı (öz çıxarışımız boş qalanda); v18: diakritiksiz AZ yazılışın bərpası (gozel sheher → gözəl şəhər), ASCII AZ dil aşkarlaması; v17: dilə uyğun axtarış + yerli sayt ön-izləməsi (Google Tərcümə və s.), qısa söz tərcüməsi, flim/tərçemə/hansılardı/üçündü düzəlişi, kazino spam filtri, EN sorğuda en.wiki prioriteti
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
  const freshness = ["day","week","month","year"].includes(fr) ? fr : null;
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

  const intentMatches = { weather: matchWeather(query), time: matchTime(query), currency: matchCurrency(query) };
  const intentName = ["weather", "time", "currency"].find(k => intentMatches[k].hit) || null;
  const intentExact = intentName ? intentMatches[intentName].exact : false;
  let intent = intentName || "general";

  let weather = null, weatherText = "";
  let timeData = null, timeText = "";
  let currencyData = null, currencyText = "";

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
    (intentName === "currency" && currencyData)
  );
  let searchResult = { results: [], providersUsed: [], errors: {}, anchorQuery: null, translated: false };
  let results = [], providersUsed = [], errors = {};
  if (!hasStructured) {
    try {
      searchResult = await searchAllShared(searchQuery, maxResults, { freshness, excludeDomains });
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
  const qTerms = [...new Set([
    ...tokenize(query),
    ...tokenize(normQuery),
    ...(isTechQuery ? [] : tokenize(exp.expanded || "")),
    ...(isAzCount ? [] : tokenize(exp.english || "")),
    ...(isAzCount ? [] : tokenize(effAnchor || ""))
  ])];

  const rawCount = results.length;
  results = results.filter(r => !isSpamDomain(r.url));
  let scored = results.map(r => ({ ...r, score: scoreResult(r, qTerms, qLang, normQuery) }));
  scored = scored.filter(r => r.score >= 1.5 && (r.snippet || "").trim().length >= 10);

  // v39.1: həm snippet, həm title yalnız "Həmçinin bax / © Copyright" → səhifə məzmunsuzdur, at
  // (atmaq əvəzinə −3: nəticə sayını 3-dən aşağı salmayaq, sadəcə dibə düşsün)
  scored = scored.map(r => isBoilerplateOnly(r.snippet) ? { ...r, score: r.score - 3, junk_content: true } : r);

  // v39: AZ kontekstli sualda rəsmi mənbələr (e-qanun, edu.gov.az, stat.gov.az…) önə
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
  if (scored.length < 3 && Date.now() - started < 1800) {  // v39.1: vaxt büdcəsi (8s deadline)
    try {
      const core = tokenize(query).slice(0, 3).join(" ");
      if (core && core !== normQuery) {
        const retry2 = await withTimeout(searchAll(core, maxResults, { freshness, excludeDomains }), 2500, "retry2 timeout");
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
  if (qType.siteHint && !scored.some(r => officialBoost(r.url)) && Date.now() - started < 2600) {
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

  let filtered = diversifyByDomain(scored, maxResults, 1, 2);
  const filteredCount = scored.length;

  const toFetch = filtered.slice(0, maxResults);
  const searchTookMs = Date.now() - started;
  // v15: 3500ms -> 5500ms (mənbə gecikəndə tam məqalə oxunuşunu yarıda kəsməsin)
  const skipFetch = format === "simple" || searchTookMs > 5500;
  // v15/v17: həm normallaşmış sual, həm də ingilis tərcüməsi ilə abzas seçimi + saytı sorğu dilində aç!
  const extractQuery = effAnchor ? `${normQuery} ${effAnchor}` : normQuery;
  // v26: çıxarış mərhələsi ümumi deadline-a sığmalıdır — əvvəl jina fallback 5 nəticədə
  // paralel 5.5s gözləyirdi və took_ms 8s-i keçirdi. İndi qalan vaxtla RACE olunur.
  const extractBudget = Math.max(1200, HARD_DEADLINE_MS - (Date.now() - started) - 500);
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
  const finalResults = [];
  let totalChars = 0;
  const basePerSource = Math.ceil(maxChars / maxResults);

  for (let i = 0; i < toFetch.length; i++) {
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
    content = cleanContent(content);
    // v38: yalnız "Həmçinin bax / ©" qalan content faydasızdır → snippet-ə qayıt
    if (isBoilerplateOnly(content)) content = cleanContent(base.snippet || "").trim() || content;
    if (!content.trim()) content = cleanContent(base.snippet || "").trim();
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

    const clippedContent = content.slice(0, itemBudget);
    // Əgər axtarış motorunun snippet-i kəsik/xətalıdırsa ("url_to_copy Sorry!..."), saytın rəsmi yerli ön-izləməsini (meta_description) götür
    const rawSnipSource = (ex && ex.meta_description && (!base.snippet || base.snippet.length < 35 || /url_to_copy|requires a keyboard/i.test(base.snippet)))
      ? ex.meta_description
      : (base.snippet || (ex && ex.meta_description) || "");
    const rawSnippet = cutWord(cleanContent(rawSnipSource), 220);
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
      untrusted: true
    };
    finalResults.push(out);
    if (totalChars >= maxChars) break;
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
  if (timeData && timeText) structured.push({ title: `${timeData.place || "Azərbaycan"} üçün hazırkı vaxt (${timeData.timezone})`, url: "https://time.is", snippet: undefined, content: timeText, sources: ["asia-baku-time"], source: "asia-baku-time", published_at: timeData.fetched_at, updated_at: null, date_info: buildDateInfo(timeData.fetched_at, null, reqLang), untrusted: false });
  if (currencyData && currencyText) structured.push({ title: `Rəsmi valyuta məzənnəsi (CBAR)`, url: "https://www.cbar.az", snippet: undefined, content: currencyText, sources: ["cbar.az"], source: "cbar.az", published_at: currencyData.fetched_at, updated_at: null, date_info: buildDateInfo(currencyData.fetched_at, null, reqLang), untrusted: false });
  if (structured.length) {
    finalResults.unshift(...structured);
    finalResults.forEach((r, idx) => { r.id = idx + 1; });
  }

  // v15/v16 (Alim qaydası): sual hansı dildə verilibsə, cavab məzmununu da həmin dilə çevirib qaytar!
  let resultsTranslated = false;
  if (shouldTranslateResults && finalResults.length > 0 && format !== "simple" && Date.now() - started < HARD_DEADLINE_MS - 900) {
    const trBudget = Math.max(400, Math.min(2200, HARD_DEADLINE_MS - 900 - (Date.now() - started)));
    // v30 (P1): texniki/məzmunca EN olan suallarda NƏTİCƏ tərcüməsi söndürülür.
    // Səbəb: "React state management" → "dövlət idarəetməsi" təhrifi məhz buradan gəlirdi.
    // v33: STRUKTUR siqnal — sadalanmış söz regex-i yerinə nəticələrə bax:
    // top-3-ün 2-si rəsmi sənəd/kod hostudursa, tərcümə məzmunu təhrif edir → keç
    const DOCS_HOST = /(^|\.)(stackoverflow\.com|github\.com|react\.dev|mozilla\.org|python\.org|kotlinlang\.org|docker\.com|postgresql\.org|git-scm\.com|kubernetes\.io|rust-lang\.org|golang\.org|npmjs\.com)$|^docs\./i;
    const docsTop = finalResults.slice(0, 3).filter((r) => { try { return DOCS_HOST.test(new URL(r.url).hostname.replace(/^www\./, "")); } catch { return false; } }).length;
    if (isTechQuery || docsTop >= 2) {
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
  if (!finalResults.length) {
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
      : /no results/.test(v) ? "no_results"
      : /timeout|abort/i.test(v) ? "timeout"
      : "error";
  }

  // v29: rəqəm ziddiyyəti — eyni vahid üçün müxtəlif nəticələrdə fərqli dəyərlər
  // v30.1 (P2 hazır olana qədər): vahid çarpanı (min/milyon) və il ölçüsü olmadığı üçün
  // saxta ziddiyyət istehsal edir → default SÖNDÜRÜLDÜ. ENABLE_CONFLICTS=1 ilə yandırılır.
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
  const degraded = usedFallback || Object.keys(errors).length >= 3;
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
