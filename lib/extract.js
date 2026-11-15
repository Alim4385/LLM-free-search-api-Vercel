// Sayt açmaq və təmizləmək - linkedom + readability
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// SSRF qorunması (H21x/FreeSearch taktikası): yalnız public IP-lərə fetch
// Axtarış nəticələri xarici saytlardır, amma redirect daxili şəbəkəyə apara bilər
import dns from "dns/promises";

function isPrivateIp(ip) {
  if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return true;
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true; // IPv6 private/link-local
  return false;
}

async function assertPublicUrl(url) {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isPrivateIp(host) || host === "localhost") throw new Error("private host");
  // DNS lookup - bütün ünvanlar public olmalıdır
  try {
    const addrs = await dns.lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateIp(a.address)) throw new Error("private ip");
    }
  } catch (e) {
    if (e.message === "private ip" || e.message === "private host" || e.message === "bad protocol") throw e;
    // DNS uğursuz olarsa fetch-in özü uğursuz olacaq - keç (fail-open DNS, fail-closed IP)
  }
}

export async function fetchAndExtract(url, query, timeoutMs = 3500) {
  try {
    await assertPublicUrl(url);
    // v10 🟠11: Google News /articles/ linkləri JS redirect səhifəsidir -
    // readability heç vaxt məzmun vermir, 0.7s boş yandır (snippet istifadə olunur)
    try {
      const gu = new URL(url);
      if (/^news\.google\./i.test(gu.hostname) && gu.pathname.includes("/articles/")) return null;
    } catch {}
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow"
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    const html = await res.text();
    if (!html || html.length < 500) return null;
    if (html.length > 2_000_000) return null; // çox böyükdür

    const { document } = parseHTML(html);
    // Readability üçün linkedom document-i uyğunlaşdır
    // Readability linkedom ilə işləyir əgər document düzgün verilsə
    let text = "";
    let title = document.title || "";
    try {
      const reader = new Readability(document, { charThreshold: 80 });
      const article = reader.parse();
      if (article && article.textContent && article.textContent.length > 200) {
        text = article.textContent;
        title = article.title || title;
      }
    } catch {}

    if (!text) {
      // Fallback: script/style/nav/footer sil, p-ləri topla
      document.querySelectorAll("script,style,noscript,nav,footer,header,aside,form,iframe,svg").forEach(el => el.remove());
      const paras = Array.from(document.querySelectorAll("p, h1, h2, h3, li, article, section"))
        .map(el => (el.textContent || "").trim())
        .filter(t => t.length > 40);
      // təkrarları sil
      text = [...new Set(paras)].join("\n\n");
    }

    text = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 150) return null;
    return { title: title.slice(0, 200), text: text.slice(0, 12000), url };
  } catch {
    return null;
  }
}
