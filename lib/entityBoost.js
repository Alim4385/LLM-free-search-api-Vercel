// Entitet → rəsmi domen boost (free, no ML)
// ChatGPT yazanda openai.com/chatgpt qabağa düşsün, GitHub yazanda github.com kimi
// Məntiq: Google kimi — sorğuda бренд/entitet adı keçirsə, onun rəsmi hostuna + skor

const ENTITY_DOMAINS = {
  "chatgpt": ["openai.com", "chat.openai.com", "chatgpt.com", "help.openai.com"],
  "gpt": ["openai.com", "platform.openai.com"],
  "openai": ["openai.com"],
  "github": ["github.com"],
  "youtube": ["youtube.com", "youtu.be"],
  "wikipedia": ["wikipedia.org"],
  "google": ["google.com", "blog.google", "developers.google.com", "support.google.com"],
  "facebook": ["facebook.com"],
  "instagram": ["instagram.com"],
  "telegram": ["telegram.org", "t.me"],
  "whatsapp": ["whatsapp.com"],
  "twitter": ["twitter.com", "x.com"],
  "linkedin": ["linkedin.com"],
  "reddit": ["reddit.com"],
  "stackoverflow": ["stackoverflow.com"],
  "stack overflow": ["stackoverflow.com"],
  "vercel": ["vercel.com"],
  "nextjs": ["nextjs.org", "vercel.com"],
  "next.js": ["nextjs.org", "vercel.com"],
  "react": ["react.dev", "reactjs.org", "legacy.reactjs.org"],
  "vue": ["vuejs.org"],
  "angular": ["angular.io", "angular.dev"],
  "python": ["python.org", "docs.python.org"],
  "javascript": ["developer.mozilla.org", "javascript.info"],
  "typescript": ["typescriptlang.org"],
  "golang": ["go.dev", "pkg.go.dev"],
  "go": ["go.dev"], // kontekstdə: "Go framework" kimi — tək "go" çox ümumidir, aşağı boost
  "rust": ["rust-lang.org", "doc.rust-lang.org"],
  "docker": ["docker.com", "docs.docker.com"],
  "kubernetes": ["kubernetes.io"],
  "aws": ["aws.amazon.com", "docs.aws.amazon.com"],
  "azure": ["azure.microsoft.com", "learn.microsoft.com"],
  "apple": ["apple.com", "support.apple.com"],
  "microsoft": ["microsoft.com", "learn.microsoft.com", "support.microsoft.com"],
  "linux": ["kernel.org", "linux.org", "wiki.archlinux.org"],
  "ubuntu": ["ubuntu.com", "help.ubuntu.com"],
  "figma": ["figma.com", "help.figma.com"],
  "notion": ["notion.so", "notion.com"],
  "figma": ["figma.com"],
  "qobustan": ["qobustan.az"],
  "qarabag": ["qarabag.com", "pfl.az", "affa.az"],
  "azercell": ["azercell.com", "azercell.az"],
  "bakcell": ["bakcell.com"],
  "kapital": ["kapitalbank.az"],
  "pasha": ["pashabank.az"],
  "unibank": ["unibank.az"],
  "spotify": ["spotify.com"],
  "netflix": ["netflix.com"],
  "tiktok": ["tiktok.com"],
  "wolt": ["wolt.com"],
  "bolt": ["bolt.eu"],
  // AZ dövlət
  "e-gov": ["e-gov.az", "my.gov.az"],
  "mygov": ["my.gov.az"],
  "taxes": ["taxes.gov.az", "vergiler.az"],
  "asan": ["asan.gov.az", "asan.az"],
};

// qısa alias: "go" tək hərf olanda false positive çoxdur → yalnız "go " + tech söz varsa aktiv et
const TECH_CONTEXT = new Set(["framework", "frameworkler", "framework-lər", "web", "api", "gin", "fiber", "echo", "chi", "beego", "dil", "dili", "yazilmis", "yazılmış", "ile", "deyil", "rust", "python", "javascript"]);

function normalize(s) {
  return String(s||"").toLowerCase()
    .replace(/['"`]/g, " ")
    .replace(/[^a-z0-9əğıöşüç\s.-]/g, " ")
    .replace(/\s+/g, " ").trim();
}

export function detectEntities(query="") {
  const nq = normalize(query);
  const tokens = nq.split(/\s+/);
  const found = [];
  for (const [ent, domains] of Object.entries(ENTITY_DOMAINS)) {
    const entNorm = normalize(ent);
    // tam söz və ya multi-word
    if (nq.includes(entNorm)) {
      // "go" üçün kontekst yoxla
      if (ent === "go" && !tokens.some(t=> TECH_CONTEXT.has(t))) continue;
      // score weight: brand üçün yüksək, generic üçün aşağı
      const isShort = ent.length <= 3;
      found.push({ entity: ent, domains, weight: isShort ? 1.2 : 2.0, raw: ent });
    }
  }
  // unique by entity
  return found;
}

export function entityBoostForResult(result, entities=[]) {
  if (!entities.length || !result) return 0;
  const url = String(result.url||"").toLowerCase();
  let host = "";
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./,""); } catch {}
  const title = String(result.title||"").toLowerCase();
  const snip = String(result.snippet||result.content||"").toLowerCase().slice(0,400);
  let boost = 0;
  for (const { entity, domains, weight } of entities) {
    // host match = ən güclü
    for (const d of domains) {
      if (host === d || host.endsWith("."+d)) { boost += 3.0 * weight; break; }
    }
    // title contains entity + domain word
    if (title.includes(entity)) boost += 1.2 * weight;
    // url path contains entity slug
    if (url.includes("/"+entity.replace(/\s+/g,"-")) || url.includes("/"+entity.replace(/\s+/g,"_"))) boost += 0.8 * weight;
    // snippet strong signal (semantic yaxınlıq)
    if (snip.includes(entity)) boost += 0.5 * weight;
  }
  return boost;
}

// Google kimi semantic genişlənmə — free hevristik (ML-siz)
// "ChatGPT nədir necə işləyir" → "ChatGPT" entity üçün sorğuya gizli sinonim əlavə et (skor üçün, rewritten-ə yox)
const SEMANTIC_SYNONYMS = {
  "nədir": ["nədir", "nedir", "what is", "haqqında", "haqqinda", "hakkinda", "about", "overview"],
  "necə işləyir": ["necə işləyir", "nece isleyir", "nasıl çalışır", "how it works", "how does it work", "işləmə prinsipi"],
  "qiymət": ["qiymət", "qiymet", "price", "pricing", "neçəyə", "cost"],
  "təhlükəsiz": ["təhlükəsiz", "tehlukesiz", "safe", "güvənli", "guvenli"],
};

export function semanticTerms(query="") {
  const nq = normalize(query);
  const out = [];
  // əgər entity var və sual qısa/ümumi isə (məs: "ChatGPT məlumat") — nədir/necə işləyir mənası əlavə et
  const hasEntity = detectEntities(query).length > 0;
  if (hasEntity) {
    // qısa sorğu (<=4 söz) və sual sözü yoxdursa → definition intent gücləndir
    const isShort = nq.split(/\s+/).length <= 5;
    const hasQuestion = /(nədir|nedir|nədi|nedi|necə|nece|nasıl|nasil|what|how|kimdir|haradadır)/i.test(nq);
    if (isShort && !hasQuestion) {
      out.push("nədir", "what is");
    }
    // "halda/məlumat" kimi bulanıq AZ sözlər → "nədir" mənasına map et
    if (/(halda|haqqında|haqqinda|məlumat|melumat|info|information)/i.test(nq)) {
      out.push("nədir", "haqqında");
    }
  }
  return [...new Set(out)];
}
