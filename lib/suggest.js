// Google Suggest - real istifadəçi sorğuları (key-siz)
// Nəticə vermir, amma query expansion üçün əla mənbədir
export async function fetchSuggestions(query, timeoutMs = 1500) {
  // Əvvəlcə AZ, sonra EN cəhd et
  for (const hl of ["az", "en"]) {
    try {
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}&hl=${hl}&gl=${hl === "az" ? "az" : "us"}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) continue;
      const j = await r.json();
      const suggestions = j[1] || [];
      if (suggestions.length) {
        // Orijinal sorğunun özünü çıxar, ilk 3-ü qaytar
        return suggestions.filter(s => s.toLowerCase() !== query.toLowerCase()).slice(0, 3);
      }
    } catch { continue; }
  }
  return [];
}
