// Google Suggest - real istifadəçi sorğuları (key-siz)
// Nəticə vermir, amma query expansion üçün əla mənbədir
// v10.1 🔴4: AZ + EN PARALEL — əvvəl ardıcıl idi (az 1.5s boş gedirsə EN
// gözləyirdi: 0.8+0.8=1.6s pisi searchAll büdcəsini yeyirdi)
export async function fetchSuggestions(query, timeoutMs = 1500) {
  const tryLang = async (hl) => {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}&hl=${hl}&gl=${hl === "az" ? "az" : "us"}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return [];
    const j = await r.json();
    const suggestions = j[1] || [];
    // Orijinal sorğunun özünü çıxar, ilk 3-ü qaytar
    return suggestions.filter(s => s.toLowerCase() !== query.toLowerCase()).slice(0, 3);
  };
  const [az, en] = await Promise.allSettled([tryLang("az"), tryLang("en")]);
  // AZ prioritetlidir (iki dilin hamısı nəticə verərsə AZ variantı üstündür)
  for (const s of [az, en]) {
    if (s.status === "fulfilled" && s.value.length) return s.value;
  }
  return [];
}
