// Google Suggest - real istifadəçi sorğuları (key-siz)
// Nəticə vermir, amma query expansion üçün əla mənbədir
// v10.1 🔴4: AZ + EN PARALEL — əvvəl ardıcıl idi (az 1.5s boş gedirsə EN
// gözləyirdi: 0.8+0.8=1.6s pisi searchAll büdcəsini yeyirdi)
import { detectQueryLanguage } from "./clean.js";

export async function fetchSuggestions(query, timeoutMs = 1500) {
  const qLang = detectQueryLanguage(query);
  const primaryHl = qLang === "tr" ? "tr" : qLang === "ru" ? "ru" : qLang === "en" ? "en" : "az";
  const tryLang = async (hl) => {
    const gl = hl === "az" ? "az" : hl === "tr" ? "tr" : hl === "ru" ? "ru" : "us";
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return [];
    const j = await r.json();
    const suggestions = j[1] || [];
    return suggestions.filter(s => s.toLowerCase() !== query.toLowerCase()).slice(0, 3);
  };
  const langs = primaryHl === "en" ? ["en"] : [primaryHl, "en"];
  const settled = await Promise.allSettled(langs.map(tryLang));
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value.length) return s.value;
  }
  return [];
}
