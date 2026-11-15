// Sayt açmaq və təmizləmək - linkedom + readability
// v10.1: SSRF hardening — redirect "manual" (hər Location yenidən yoxlanılır, max 3 hop),
// port 80/443, net.BlockList ilə düzgün CIDR qara siyahısı, content-length ön-yoxlama,
// zero-width simvol təmizi, fallback-da duplicate mətn fix
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import net from "net";
import dns from "dns/promises";
import { wikiExtractUrl } from "./clean.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
// Wikimedia API üçün deskriptiv UA (Wikimedia best practice — breuzer-UX datacenter
// IP-dən 429 verir; kontakt-li UA rate limit-dən çıxarır)
const WIKI_UA = "LLM-free-search-api/1.2 (https://github.com/Alim4385/LLM-free-search-api-Vercel) keyless-search";

// SSRF qorunması (H21x/FreeSearch taktikası): yalnız public IP-lərə fetch
// v10.1 🔴2: Node-un net.BlockList — düzgün CIDR matching. Əvvəlki
// startsWith("fc"/"fd") host ADLARINA da düşürdü: fcc.gov, fda.gov, fdic.gov,
// fcbarcelona.com "private host" sayılıb, məzmunları heç vaxt çəkilmirdi.
// Eyni zamanda 127.0.0.2, 0.0.0.0, 100.64.0.1 (CGNAT), ::ffff:127.0.0.1 (v4-mapped)
// əvvəlki siyahıdan keçirdi — indi hamısı bloklandı.
const BLOCK_LIST = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16]
]) BLOCK_LIST.addSubnet(addr, prefix, "ipv4");
BLOCK_LIST.addAddress("::", "ipv6");
BLOCK_LIST.addAddress("::1", "ipv6");
BLOCK_LIST.addSubnet("fc00::", 7, "ipv6");
BLOCK_LIST.addSubnet("fe80::", 10, "ipv6");

// Həqiqi IP yoxlaması — host adları BURAYA düşmür (onlar DNS-dən sonra gəlir).
// Test üçün export olundu.
export function isBlockedIp(ip) {
  const ver = net.isIP(ip);
  if (!ver) return true; // IP formatı deyilsə → blokla (fail-closed)
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) → IPv4 hissəsi ilə yoxla
  const mapped = String(ip).match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return BLOCK_LIST.check(mapped[1], "ipv4");
  return BLOCK_LIST.check(ip, ver === 4 ? "ipv4" : "ipv6");
}

// v10.1 🔴1: port limiti — SSRF port-scan/daemon hedeflərinə yol vermir
function isPublicPort(u) {
  return u.port === "" || u.port === "80" || u.port === "443";
}

// v12.3 perf: DNS TTL cache — fetchSafe HƏR redirect hop-da assertPublicUrl
// çağırır, hər dəfə dns.lookup (10-50ms) + fetch özü yenidən həll edirdi.
// İndi: 60s TTL ilə in-process cache (Node 20-də dns.setResultCache yoxdur).
// SSRF təhlükəsizliyi qorunur: cache-dəki adreslər isBlockedIp-dən keçir.
// v13 P3 (audit fix): TTL 60s → 10s. fetch(undici) hər çağırışda ÖZ DNS-ini taze
// həll edir — 60s cache pəncərəsi "yoxlanmış=public, fetch=yağni daxili" rebinding
// aralığını genişləndirirdi. 10s: redirect hop-larında yenidən lookup yoxdur
// (hop-lar <1s içində tamam), rebinding pəncərəsi əvvəlki taze davranışa yaxınlaşır.
const dnsCache = new Map(); // host -> { addrs, exp }
const DNS_TTL_MS = 10_000;
async function dnsLookupCached(host) {
  const hit = dnsCache.get(host);
  if (hit && Date.now() < hit.exp) return hit.addrs;
  const addrs = await dns.lookup(host, { all: true });
  dnsCache.set(host, { addrs, exp: Date.now() + DNS_TTL_MS });
  if (dnsCache.size > 500) dnsCache.delete(dnsCache.keys().next().value);
  return addrs;
}

// Test üçün export olundu: protocol + port + host/IP qapısı
export async function assertPublicUrl(url) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
  if (!isPublicPort(u)) throw new Error("bad port");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost") throw new Error("private host");
  // Host IP-dirsə birbaşa yoxla (DNS lazım deyil - testlərdə də deterministik)
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error("private ip");
    return;
  }
  // Host adı → DNS cavabının HAMMISI public olmalıdır (v12.3: TTL cache)
  try {
    const addrs = await dnsLookupCached(host);
    for (const a of addrs) {
      if (isBlockedIp(a.address)) throw new Error("private ip");
    }
  } catch (e) {
    if (e.message === "private ip" || e.message === "private host" || e.message === "bad protocol") throw e;
    // DNS uğursuz olarsa fetch-in özü uğursuz olacaq - keç (fail-open DNS, fail-closed IP)
  }
}

// v10.1 🔴1: redirect "manual" — public sayt 302 ilə 127.0.0.1-ə və ya daxili
// ünvana yönləndirə bilər; əvvəlki redirect:"follow" bunu görə bilmirdi
// (assertPublicUrl yalnız İLK URL-ə tətbiq olunurdu). İndi: hər Location
// yenidən assertPublicUrl-dən keçir, max 3 hop (redirect dövrü qorunması).
// TOTAL timeout bütün hop-lara bölünür (bir signal).
const MAX_REDIRECTS = 3;

export async function fetchSafe(url, timeoutMs = 2500, extraHeaders = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    let res;
    try {
      res = await fetch(current, {
        headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", ...extraHeaders },
        signal,
        redirect: "manual"
      });
    } catch (e) {
      throw e; // timeout/network → yuxarıda catch olunar
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      try { current = new URL(loc, current).toString(); } catch { return null; }
      continue;
    }
    return res;
  }
  return null; // redirect limiti (dövr) - fail-closed
}

const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/g;

// v13 T1 (audit): URL-level content cache — response cache (5 dəq, q+n+c açarı)
// eyni Q-ı örtür, amma EYNİ URL fərqli sorğulardan gələndə 2MB HTML + readability
// parse yenidən gedirdi (CPU + sayt yükü + 429 riski). İndi: URL → məzmun,
// wiki 24 saat, digərləri 1 saat. Null CACHE-Ə DƏŞMİR (transient failure ≠
// məzmun yoxdur).
// (Redis-shared versiyası = Upstash shared-state batch-inə qoyuldu.)
const extractCache = new Map(); // url -> { val, exp, size }
const EXTRACT_MAX_BYTES = 4 * 1024 * 1024;
let extractBytes = 0;
function extractTtlMs(url) {
  try { return /wikipedia\.org$/i.test(new URL(url).hostname) ? 24 * 3600 * 1000 : 3600 * 1000; } catch { return 3600 * 1000; }
}
// Test üçün export olundu (isBlockedIp patterni)
export function extractCacheGet(url) {
  const v = extractCache.get(url);
  if (!v) return null;
  if (Date.now() > v.exp) { extractBytes -= v.size; extractCache.delete(url); return null; }
  return v.val;
}
export function extractCacheSet(url, val) {
  const size = (val.text || "").length + (val.title || "").length;
  const old = extractCache.get(url);
  if (old) extractBytes -= old.size;
  extractCache.set(url, { val, exp: Date.now() + extractTtlMs(url), size });
  extractBytes += size;
  while (extractBytes > EXTRACT_MAX_BYTES && extractCache.size > 1) {
    const oldest = extractCache.keys().next().value;
    const ov = extractCache.get(oldest);
    extractBytes -= ov.size;
    extractCache.delete(oldest);
  }
}

export async function fetchAndExtract(url, query, timeoutMs = 3500) {
  try {
    // v10 🟠11: Google News /articles/ linkləri JS redirect səhifəsidir -
    // readability heç vaxt məzmun vermir, boş vaxt (snippet istifadə olunur)
    try {
      const gu = new URL(url);
      if (/^news\.google\./i.test(gu.hostname) && gu.pathname.includes("/articles/")) return null;
    } catch {}

    // v13 T1: URL cache — eyni URL fərqli sorğuda yenidən scrape edilmir
    const exCached = extractCacheGet(url);
    if (exCached) return exCached;

    // v12 P1: Wikipedia → TextExtracts API. HTML scrape [n]/[edit]/TOC/infobox
    // zibilini mətnə qoyurdu (diagnostic: 6/7 junk wiki idi). API (explaintext)
    // TƏMİZ intro text qaytarır — cavabın özü, səhifə adı yox.
    const wikiUrl = wikiExtractUrl(url);
    if (wikiUrl) {
      try {
        const wr = await fetchSafe(wikiUrl, timeoutMs, { "User-Agent": WIKI_UA, "Accept": "application/json" });
        if (wr && wr.ok) {
          const wj = await wr.json();
          const pages = wj?.query?.pages || {};
          const page = Object.values(pages).find(p =>
            p && !p.missing && p.extract && String(p.extract).trim().length >= 150
          );
          if (page) {
            const text = String(page.extract).replace(ZERO_WIDTH, "").trim();
            const out = {
              title: (page.title || "").slice(0, 200),
              text: text.slice(0, 12000),
              url
            };
            extractCacheSet(url, out); // v13 T1
            return out;
          }
        }
      } catch {}
      // boş/missing extract → aşağıda HTML yoluna düş (fallback)
    }

    const res = await fetchSafe(url, timeoutMs);
    if (!res || !res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    // v10.1 🟠7: content-length ÖN-yoxlama — await res.text() bütün body-yi yığır,
    // 2 MB limiti ondan SONRA gəlirdi (böyük cavab yaddaşı yerinə düşürdü)
    const cl = Number(res.headers.get("content-length") || 0);
    if (cl > 2_000_000) return null;
    const html = await res.text();
    if (!html || html.length < 500) return null;
    if (html.length > 2_000_000) return null; // çox böyükdür

    const { document } = parseHTML(html);
    // Readability üçün linkedom document-i uyğunlaşdır
    let text = "";
    let title = (document.title || "").replace(ZERO_WIDTH, "");
    try {
      const reader = new Readability(document, { charThreshold: 80 });
      const article = reader.parse();
      if (article && article.textContent && article.textContent.length > 200) {
        text = article.textContent;
        title = (article.title || title).replace(ZERO_WIDTH, "");
      }
    } catch {}

    if (!text) {
      // Fallback: script/style/nav/footer sil, p-ləri topla
      // v10.1 🟠8: article/section SELECTOR-DAN ÇIXDI — onların textContent-i
      // uşaq <p>-ləri də ehtiva edir, eyni məzmun iki dəfə düşürdü
      document.querySelectorAll("script,style,noscript,nav,footer,header,aside,form,iframe,svg").forEach(el => el.remove());
      const paras = Array.from(document.querySelectorAll("p, h1, h2, h3, h4, li, blockquote"))
        .map(el => (el.textContent || "").trim())
        .filter(t => t.length > 40);
      // təkrarları sil
      text = [...new Set(paras)].join("\n\n");
    }

    text = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    // v10.1 🟠9: zero-width simvollar (U+200B-D, U+2060, U+FEFF) — page-injection
    // / canary texnikası; LLM-ə gedən mətnə toxunulmamış formada keçməsin
    text = text.replace(ZERO_WIDTH, "");
    if (text.length < 150) return null;
    const out = { title: title.slice(0, 200), text: text.slice(0, 12000), url };
    extractCacheSet(url, out); // v13 T1
    return out;
  } catch {
    return null;
  }
}
