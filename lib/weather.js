// Open-Meteo - hava sualları üçün scraping yoxdur
import { normalizeAz, tokenize } from "./rank.js";

const AZ_CITIES = [
  "baki","gence","sumqayit","mingacevir","qebele","seki","lenkeran","sirvan","naftalan","yashil",
  "agdam","agdas","agcabedi","balaken","beyleqan","berde","bilasuvar","cebrayil","celilabad","daskesen",
  "fuzuli","gedebey","goycay","goygol","hacikabul","xankendi","xacmaz","xizi","imed","kelbecer",
  "kurdemir","lacın","lerik","masalli","neftcala","oguz","qax","qazax","qobustan","quba","qubadli",
  "qusar","saatli","sabirabad","salyan","samaxi","samkir","siyezen","susa","terter","tovuz","ucard",
  "yardimli","yevlax","zengilan","zertab","zaqatala","ardabil"
];

const WEATHER_KEYWORDS = [
  "hava","temperatur","yagis","yagmur","kulak","qar","gunes","istilik","soyuq","bulud","duman",
  "weather","temperature","rain","wind","snow","sunny","cloudy","forecast","hava proqnozu","hava melumati",
  "погода","температура","дождь","снег","ветер","солнечно","облачно","прогноз"
];

export function isWeatherQuery(query) {
  const tokens = new Set(tokenize(query));
  // tokenize stopword-ləri atır, ona görə xam token da yoxla
  const raw = new Set((normalizeAz(query).match(/[a-z0-9а-яё]+/g) || []));
  const all = new Set([...tokens, ...raw]);
  return WEATHER_KEYWORDS.some(k => all.has(normalizeAz(k)));
}

export function detectCity(query) {
  const n = normalizeAz(query);
  for (const c of AZ_CITIES) {
    if (n.includes(c)) return c;
  }
  // Bakı default
  return "baki";
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
  let coords = CITY_COORDS[cityKey];

  // Əgər tanınan şəhər deyilsə, geocoding ilə axtar
  if (!coords) {
    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityKey)}&count=1&language=az&format=json`;
      const r = await fetch(geoUrl, { signal: AbortSignal.timeout(2000) });
      const j = await r.json();
      if (j.results && j.results[0]) {
        coords = { name: j.results[0].name, lat: j.results[0].latitude, lon: j.results[0].longitude };
      }
    } catch {}
  }
  if (!coords) coords = CITY_COORDS.baki;

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
