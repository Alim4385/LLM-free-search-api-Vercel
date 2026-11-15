// Open-Meteo - hava sualları üçün scraping yoxdur
// v10 🔴5: detectCity - baki default YOXDUR (tanınmayan şəhər → geocode, şəhər
// yoxdursa cancel); word-boundary match ("quba" "qubadli"-ni yerinə keçmir);
// şəhərlər normalize olunur ("lacın" → "lacin" - əvvəl unnormalized qalıb,
// "lacında hava" Baku cavabı verirdi).
import { normalizeAz } from "./rank.js";

const AZ_CITIES = [
  "baki","gence","sumqayit","mingacevir","qebele","seki","lenkeran","sirvan","naftalan","yashil",
  "agdam","agdas","agcabedi","balaken","beyleqan","berde","bilasuvar","cebrayil","celilabad","daskesen",
  "fuzuli","gedebey","goycay","goygol","hacikabul","xankendi","xacmaz","xizi","imed","kelbecer",
  "kurdemir","lacın","lerik","masalli","neftcala","oguz","qax","qazax","qobustan","quba","qubadli",
  "qusar","saatli","sabirabad","salyan","samaxi","samkir","siyezen","susa","terter","tovuz","ucard",
  "yardimli","yevlax","zengilan","zertab","zaqatala","ardabil"
];
// Normalize şəhər siyahısı (uzunluqdan qısayaya - prefix match-də uzun şəhər qazanır)
const NORM_CITIES = AZ_CITIES.map(normalizeAz).sort((a, b) => b.length - a.length);
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Exakt hava frazaları
const WEATHER_PHRASES = [
  "hava necedir","hava necedi","hava nece","hava proqnozu","hava melumati","hava duresi",
  "weather today","how is the weather","how's the weather",
  "temperatur necedir","temperatur nece","nece derece","hava kimi","hava olacaq","hava harada"
];
// v10: "kulak" typo - düzgünü "kulek" (külək)
const WEATHER_TOKENS = new Set([
  "hava","temperatur","yagis","yagmur","kulek","qar","gunes","istilik","soyuq","bulud","duman",
  "weather","temperature","rain","wind","snow","sunny","cloudy","forecast"
]);

const WEATHER_NEWS_EVENT_RE = /\b(fesad\w*|daginti\w*|qeza\w*|olum\w*|yangin\w*|sel\s+apardi|tarix\w*|ne\s+vaxt\s+yaran)\b/;

export function matchWeather(query) {
  const n = normalizeAz(query);
  // v13 P1 (audit fix): "hava limanı" (airport) / "hava yolu" (airline) hava deyil.
  if (/hava\s+(liman|yol)/.test(n)) return { hit: false, exact: false };
  for (const p of WEATHER_PHRASES) {
    if (n.includes(p)) return { hit: true, exact: true };
  }
  const raw = n.match(/[a-z0-9]+/g) || [];
  const tokenHit = raw.some(t => WEATHER_TOKENS.has(t));
  if (!tokenHit) return { hit: false, exact: false };
  if (WEATHER_NEWS_EVENT_RE.test(n)) return { hit: true, exact: false };
  return { hit: true, exact: raw.length <= 4 };
}

// Mürəkkəb API üçün: hit = hava mövzusu var
export function isWeatherQuery(query) {
  return matchWeather(query).hit;
}

export function detectCity(query) {
  const n = normalizeAz(query);
  // Prefix match + word başlanğıcı: "gencede" (Gəncədə) tapılır, "qubadli" isə
  // yalnız "qubadli" şəhərinin (uzun) - çünki uzun şəhərlər əvvəl yoxlanılır.
  for (const c of NORM_CITIES) {
    if (new RegExp(`(^|[^a-z0-9])${escapeRe(c)}`).test(n)) return c;
  }
  return null; // v10: baki default YOXDUR
}

const CITY_COORDS = {
  baki: { name: "Bakı", lat: 40.4093, lon: 49.8671 },
  gence: { name: "Gəncə", lat: 40.6828, lon: 46.5887 },
  sumqayit: { name: "Sumqayıt", lat: 40.5894, lon: 49.6387 },
  mingacevir: { name: "Mingəçevir", lat: 40.7704, lon: 47.0492 },
  qebele: { name: "Qəbələ", lat: 40.9812, lon: 47.8484 },
  seki: { name: "Şəki", lat: 41.1919, lon: 47.1705 },
  lenkeran: { name: "Lənkəran", lat: 38.7538, lon: 48.8508 },
  sirvan: { name: "Şirvan", lat: 39.9333, lon: 48.9167 },
};

export async function fetchWeather(query) {
  const cityKey = detectCity(query);
  // v10 🔴5: şəhər tapılmadısa CANCEL et (əvvəl Baku cavabı verilib - səhv şəhər)
  if (!cityKey) throw new Error("city not found");
  let coords = CITY_COORDS[cityKey];
  if (!coords) {
    // Tanınan şəhər amma koordinat siyahısında yoxdur - Open-Meteo geocoding
    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityKey)}&count=1&language=az&format=json`;
      const r = await fetch(geoUrl, { signal: AbortSignal.timeout(2000) });
      const j = await r.json();
      if (j.results && j.results[0]) {
        coords = { name: j.results[0].name, lat: j.results[0].latitude, lon: j.results[0].longitude };
      }
    } catch {}
  }
  if (!coords) throw new Error("city not found: " + cityKey);

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FBaku&forecast_days=3`;
  // Timeout 3s + 1 retry 2s (əvvəl 6s+6s=12s idi - uğursuzluqda search fallback-u gecikdirirdi)
  let r;
  try { r = await fetch(url, { signal: AbortSignal.timeout(3000) }); }
  catch { r = await fetch(url, { signal: AbortSignal.timeout(2000) }); }
  if (!r.ok) throw new Error("open-meteo failed");
  const j = await r.json();
  return {
    city: coords.name,
    current: j.current,
    daily: j.daily,
    source: "open-meteo",
    fetched_at: new Date().toISOString()
  };
}

export function weatherToText(w) {
  if (!w || !w.current) return "";
  const c = w.current;
  let s = `${w.city} hazırda: temperatur ${c.temperature_2m}°C, hiss olunan ${c.apparent_temperature}°C, rütubət ${c.relative_humidity_2m}%, külək ${c.wind_speed_10m} km/saat. Kod: ${c.weather_code}.`;
  if (w.daily && w.daily.time) {
    for (let i = 0; i < w.daily.time.length; i++) {
      const label = i === 0 ? "Bu gün" : i === 1 ? "Sabah" : w.daily.time[i];
      s += ` ${label} (${w.daily.time[i]}): max ${w.daily.temperature_2m_max[i]}°C, min ${w.daily.temperature_2m_min[i]}°C, yağış ehtimalı ${w.daily.precipitation_probability_max?.[i] ?? 0}%.`;
    }
  }
  return s;
}
