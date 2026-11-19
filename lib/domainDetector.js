// Avtomatik domen aşkarlama — manual siyahı yox, sonsuz domen üçün işləyir
// Google mantığı: sorğuda keçən marka/token host-da varsa qabağa

const AZ_STOP = new Set(["nədir","nedir","nədi","nece","necə","nasıl","nasıl","nelere","kimdir","haradadır","harada","haqqında","haqqinda","haqqda","halda","məlumat","melumat","haqqında","ucun","üçün","ve","və","ile","ilə","deyil","olan","olmayan","bu","bu","bir","ne","nə","neçə","isleyir","işləyir","nece","isləyir","nasıl","calısır","works","what","how","who","is","are","the","and","or","for","with","about","info","information","site","com","az","net","org","github","vercel","deploy"]);
const TECH_STOP = new Set(["framework","frameworkler","framework-lər","web","api","yazilmis","yazılmış","yazilmış"]);

function normalize(s) {
  return String(s||"").toLowerCase()
    .replace(/['"`]/g," ")
    .replace(/[ə]/g,"e").replace(/ğ/g,"g").replace(/ı/g,"i").replace(/ş/g,"s").replace(/ö/g,"o").replace(/ü/g,"u").replace(/ç/g,"c")
    .replace(/[^a-z0-9.\s-]/g," ")
    .replace(/\s+/g," ").trim();
}

// Sorğudan domen-tokenləri çıxar
export function extractDomainTokens(query="") {
  const nq = normalize(query);
  // 1) açıq domen: github.com, openai.com
  const explicitDomains = [];
  const domainRe = /(?:[a-z0-9-]+\.)+[a-z]{2,}/g;
  let m;
  while ((m = domainRe.exec(nq)) !== null) {
    const d = m[0].replace(/^www\./,"");
    if (d.length >= 4) explicitDomains.push(d);
  }
  // 2) marka tokenləri: stopword olmayan, >=3 hərf, təkrarlanmayan
  const words = nq.split(/[\s-]+/).filter(Boolean);
  const tokens = [];
  for (let w of words) {
    w = w.replace(/\.$/,"");
    if (w.length < 3) continue;
    if (AZ_STOP.has(w)) continue;
    if (TECH_STOP.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    if (w.includes(".")) continue; // explicit domen artıq
    // github.com tokeni "github" kimi də əlavə et
    tokens.push(w);
  }
  // unique
  const uniqTokens = [...new Set(tokens)];
  // explicit domenlərdən də kök token çıxar (github.com → github)
  for (const d of explicitDomains) {
    const root = d.split(".")[0];
    if (root && root.length >=3 && !uniqTokens.includes(root)) uniqTokens.push(root);
  }
  return { explicitDomains, tokens: uniqTokens };
}

function hostTokens(host) {
  return host.toLowerCase().replace(/^www\./,"").split(/[.\-]/).filter(t=>t.length>=2 && !["com","net","org","az","co","io","ai","app","dev","gov","edu"].includes(t));
}

export function domainBoostForResult(result, queryTokens) {
  if (!result || !queryTokens) return 0;
  const { explicitDomains, tokens } = queryTokens;
  const url = String(result.url||"").toLowerCase();
  let host="";
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./,""); } catch {}
  const hTokens = hostTokens(host);
  const title = String(result.title||"").toLowerCase();
  const path = (()=>{ try { return new URL(url).pathname.toLowerCase(); } catch { return "" } })();
  let boost = 0;
  // explicit domain: tam match +3.5
  for (const d of explicitDomains) {
    if (host === d || host.endsWith("."+d) || host.includes(d.split(".")[0])) {
      boost += 4.0;
    }
  }
  // token-host match
  for (const tok of tokens) {
    const t = tok.toLowerCase();
    // host-da var? (chatgpt → chatgpt.com)
    if (hTokens.some(h=> h.includes(t) || t.includes(h))) {
      boost += 3.0;
    } else if (host.includes(t)) {
      boost += 2.5; // substring
    }
    // path-da var? (openai.com/index/chatgpt)
    if (path.includes("/"+t) || path.includes(t)) {
      boost += 1.2;
    }
    // title-da var?
    if (title.includes(t)) {
      boost += 0.8;
    }
  }
  // çox token varsa normallaşdır (birdən çox marka)
  if (tokens.length > 1) boost = boost * (1 + Math.log(tokens.length)/3);
  return boost;
}

// Semantic genişlənmə — eyni qalsın, amma domen-detektor ilə uyğun
export function semanticTerms(query="") {
  const nq = normalize(query);
  const { tokens } = extractDomainTokens(query);
  if (!tokens.length) return [];
  const hasVague = /(halda|haqqinda|melumat|info|information|^\s*\w+\s*$)/i.test(nq);
  const hasQuestion = /(nedir|nedi|nece|nasil|what|how|kimdir|harada)/i.test(nq);
  const isVeryShort = nq.split(/\s+/).filter(Boolean).length <= 2;
  const hasTechTerm = /(stemmer|framework|api|model|token|embedding|python|javascript|rust)/i.test(nq);
  if (hasTechTerm) return [];
  if ((hasVague && !hasQuestion) || (isVeryShort && !hasQuestion)) {
    return ["nədir","what is","haqqında"];
  }
  return [];
}
