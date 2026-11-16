// Open-Meteo - hava sualları üçün scraping yoxdur
// v10 🔴5: detectCity - baki default YOXDUR (tanınmayan şəhər → geocode, şəhər
// yoxdursa cancel); word-boundary match ("quba" "qubadli"-ni yerinə keçmir);
// şəhərlər normalize olunur ("lacın" → "lacin" - əvvəl unnormalized qalıb,
// "lacında hava" Baku cavabı verirdi).
import { normalizeAz } from "./rank.js";

const AZ_CITIES = [
  "baki","gence","sumqayit","mingecevir","mingacevir","qebele","seki","lenkeran","sirvan","naftalan",
  "agdam","agdas","agcabedi","balaken","beyleqan","berde","bilasuvar","cebrayil","celilabad","daskesen",
  "fuzuli","gedebey","goycay","goygol","haciqabul","hacikabul","xankendi","xacmaz","xizi",
  "imisli","imed","kelbecer","kurdemir","lacin","lerik","masalli","neftcala","oguz","qax","qazax",
  "qobustan","quba","qubadli","qusar","saatli","sabirabad","salyan","samaxi","samkir","siyezen",
  "susa","terter","tovuz","ucar","ucard","yardimli","yevlax","zengilan","zerdab","zertab","zaqatala",
  // v43: çatışmayan şəhərlər (Naxçıvan MR + insanların tez-tez soruşduğu yerlər)
  "naxcivan","ismayilli","astara","agsu","agstafa","goranboy","sabran","xocali","xocavend",
  "serur","ordubad","culfa","babek","qivraq","seder","kengerli","naxcivanmr","caykend",
  // xarici şəhərlər
  "istanbul","ankara","moskva","london","dubay","tbilisi","roma","madrid","paris","berlin","tokio","nyu york"
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

const WEATHER_FALSE_FRIENDS = /(?<![\p{L}])(enerji[\p{L}]*|energetika|muzey[\p{L}]*|panel[\p{L}]*|stansiya[\p{L}]*|layih[əe][\p{L}]*|otel[\p{L}]*|restoran[\p{L}]*|şahdağ|sahdag|xizək|xizek|turizm|bilet|soyuq\s+müharibə|soyuq\s+muharibe)(?![\p{L}])/iu;
export function matchWeather(query) {
  if (WEATHER_FALSE_FRIENDS.test(String(query || ""))) return { hit: false, exact: false };
  const n = normalizeAz(query);
  // v13 P1 (audit fix): "hava limanı" (airport) / "hava yolu" (airline) hava deyil.
  if (/hava\s+(liman|yol)/.test(n)) return { hit: false, exact: false };
  for (const p of WEATHER_PHRASES) {
    if (n.includes(p)) return { hit: true, exact: true };
  }
  const raw = n.match(/[a-z0-9]+/g) || [];
  const tokenHit = raw.some(t => WEATHER_TOKENS.has(t));
  if (!tokenHit) return { hit: false, exact: false };
  // v25: "günəş", "qar", "külək" kimi tək söz hava sualı demək deyil
  // ("Günəş sistemində neçə planet var" səhvən weather intent alırdı)
  const STRONG = ["hava", "temperatur", "proqnoz", "forecast", "yagis", "yagmur", "weather"];
  if (!raw.some(t => STRONG.includes(t)) && !detectCity(query)) return { hit: false, exact: false };
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

// v19: WMO hava kodları → Azərbaycanca mətn (kiçik LLM "61" rəqəmini yoza bilməz)
const WMO_TEXT = {
  0: "aydın", 1: "əsasən aydın", 2: "az buludlu", 3: "buludlu",
  45: "duman", 48: "çökmüş duman",
  51: "yüngül çiskin", 53: "orta çiskin", 55: "sıx çiskin",
  56: "yüngül donan çiskin", 57: "sıx donan çiskin",
  61: "yüngül yağış", 63: "orta yağış", 65: "güclü yağış",
  66: "yüngül donan yağış", 67: "güclü donan yağış",
  71: "yüngül qar", 73: "orta qar", 75: "güclü qar", 77: "qar dənələri",
  80: "yüngül leysan", 81: "orta leysan", 82: "güclü leysan",
  85: "yüngül qar leysanı", 86: "güclü qar leysanı",
  95: "tufan (ildırımlı yağış)", 96: "tufan + yüngül dolu", 99: "tufan + güclü dolu"
};
export function wmoToText(code) {
  const n = Number(code);
  return WMO_TEXT[n] || (Number.isFinite(n) ? `naməlum hava (kod ${n})` : "naməlum");
}

export function weatherToText(w) {
  if (!w || !w.current) return "";
  const c = w.current;
  let s = `${w.city} hazırda: ${wmoToText(c.weather_code)}, temperatur ${c.temperature_2m}°C, hiss olunan ${c.apparent_temperature}°C, rütubət ${c.relative_humidity_2m}%, külək ${c.wind_speed_10m} km/saat.`;
  if (w.daily && w.daily.time) {
    for (let i = 0; i < w.daily.time.length; i++) {
      const label = i === 0 ? "Bu gün" : i === 1 ? "Sabah" : w.daily.time[i];
      s += ` ${label} (${w.daily.time[i]}): max ${w.daily.temperature_2m_max[i]}°C, min ${w.daily.temperature_2m_min[i]}°C, yağış ehtimalı ${w.daily.precipitation_probability_max?.[i] ?? 0}%.`;
    }
  }
  return s;
}
