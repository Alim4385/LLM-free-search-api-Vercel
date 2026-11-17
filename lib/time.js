// Saat / vaxt - API-siz, Intl ilə Asia/Baku vaxtı (ən etibarlı üsul)
// v10 🔴3: intent GATING - exakt (fraza və ya qısa sorğu) yalnızca structure cavab verir;
// weak (uzun sorğuda "saat" sözü) → route search-də işlədir. Əvvəl multi-word
// TIME_KEYWORDS ("current time") HƏCMİŞ atırdı (raw token Set-ə düşmürdü) və
// tək "saat" tokeni HƏR sorğuda intent açırıb searchAll-ı atırırdı.
// "vaxt" yalnız vaxt-frazasında matcher - "nə vaxt" (when) tarixi sualları
// time-intentə DÜŞMƏMƏLİDİR: "İstiqlaliyyət nə vaxt elan olunub"
import { normalizeAz } from "./rank.js";

// Exakt vaxt frazaları (normalizeAz formatında)
const TIME_PHRASES = [
  "hazirki vaxt","indiki vaxt","hazir vaxt","vaxt necedir","vaxt necedi","saat ve vaxt",
  "what time","what is the time","current time",
  "saat necedir","saat necedi","saat nece","saat kac","saatdir",
  "kac saatdir","nece saatdir","saat neqeder"
];
// Tək söz tokenlər: "saat" = saat (clock), "nə vaxt" (when) DƏYİL
const TIME_TOKENS = new Set(["saat","saati","saatim"]);
// v41: "time" tək söz kimi TƏHLÜKƏLİDİR — "best movies of all time" saat sualı deyil.
const TIME_EN_PHRASES = ["current time","what time","time now","time in","time at","local time","time is it"];

// v19: "Türkiyədə saat neçədir" → Bakı vaxtı YOX, həmin ölkənin vaxtı!
// normalizeAz formatında açarlar (kiçik hərf, diakritiksiz)
const TIME_PLACES = {
  azerbaycan: { tz: "Asia/Baku", label: "Azərbaycan" },
  baki: { tz: "Asia/Baku", label: "Bakı" },
  naxcivan: { tz: "Asia/Baku", label: "Naxçıvan" },
  gence: { tz: "Asia/Baku", label: "Gəncə" },
  sumqayit: { tz: "Asia/Baku", label: "Sumqayıt" },
  lenkeran: { tz: "Asia/Baku", label: "Lənkəran" },
  seki: { tz: "Asia/Baku", label: "Şəki" },
  qebele: { tz: "Asia/Baku", label: "Qəbələ" },
  mingecevir: { tz: "Asia/Baku", label: "Mingəçevir" },
  sirvan: { tz: "Asia/Baku", label: "Şirvan" },
  seirvan: { tz: "Asia/Baku", label: "Şirvan" },
  turkiye: { tz: "Europe/Istanbul", label: "Türkiyə" },
  istanbul: { tz: "Europe/Istanbul", label: "İstanbul" },
  ankara: { tz: "Europe/Istanbul", label: "Ankara" },
  gurcustan: { tz: "Asia/Tbilisi", label: "Gürcüstan" },
  tbilisi: { tz: "Asia/Tbilisi", label: "Tbilisi" },
  iran: { tz: "Asia/Tehran", label: "İran" },
  tehran: { tz: "Asia/Tehran", label: "Tehran" },
  rusiya: { tz: "Europe/Moscow", label: "Rusiya" },
  moskva: { tz: "Europe/Moscow", label: "Moskva" },
  amerika: { tz: "America/New_York", label: "ABŞ (şərq vaxtı)" },
  abs: { tz: "America/New_York", label: "ABŞ (şərq vaxtı)" },
  london: { tz: "Europe/London", label: "London" },
  ingiltere: { tz: "Europe/London", label: "İngiltərə" },
  almaniya: { tz: "Europe/Berlin", label: "Almaniya" },
  berlin: { tz: "Europe/Berlin", label: "Berlin" },
  fransa: { tz: "Europe/Paris", label: "Fransa" },
  paris: { tz: "Europe/Paris", label: "Paris" },
  italiya: { tz: "Europe/Rome", label: "İtaliya" },
  ispanya: { tz: "Europe/Madrid", label: "İspaniya" },
  dubay: { tz: "Asia/Dubai", label: "Dubay" },
  bea: { tz: "Asia/Dubai", label: "BƏƏ" },
  cin: { tz: "Asia/Shanghai", label: "Çin" },
  yaponiya: { tz: "Asia/Tokyo", label: "Yaponiya" },
  koreya: { tz: "Asia/Seoul", label: "Koreya" },
  hindistan: { tz: "Asia/Kolkata", label: "Hindistan" },
  qazaxistan: { tz: "Asia/Almaty", label: "Qazaxıstan" },
  ukrayna: { tz: "Europe/Kyiv", label: "Ukrayna" },
  polsa: { tz: "Europe/Warsaw", label: "Polşa" },
  baku: { tz: "Asia/Baku", label: "Bakı" },
  azerbaijan: { tz: "Asia/Baku", label: "Azərbaycan" },
  turkey: { tz: "Europe/Istanbul", label: "Türkiyə" },
  moscow: { tz: "Europe/Moscow", label: "Moskva" },
  "newyork": { tz: "America/New_York", label: "Nyu-York" },
  "nyu york": { tz: "America/New_York", label: "Nyu-York" },
  "tokio": { tz: "Asia/Tokyo", label: "Tokio" },
  "susa": { tz: "Asia/Baku", label: "Şuşa" },
  "roma": { tz: "Europe/Rome", label: "Roma" },
  "madrid": { tz: "Europe/Madrid", label: "Madrid" },
  "seul": { tz: "Asia/Seoul", label: "Seul" },
  "delhi": { tz: "Asia/Kolkata", label: "Dehli" },
  "dehli": { tz: "Asia/Kolkata", label: "Dehli" },
  "istanbul": { tz: "Europe/Istanbul", label: "İstanbul" },
  "moskva": { tz: "Europe/Moscow", label: "Moskva" },
  "london": { tz: "Europe/London", label: "London" },
  "dubay": { tz: "Asia/Dubai", label: "Dubay" },
  "tbilisi": { tz: "Asia/Tbilisi", label: "Tbilisi" },
  york: { tz: "America/New_York", label: "ABŞ (şərq vaxtı)" },
  usa: { tz: "America/New_York", label: "ABŞ (şərq vaxtı)" },
  tokyo: { tz: "Asia/Tokyo", label: "Tokio" },
  beijing: { tz: "Asia/Shanghai", label: "Pekin" },
  germany: { tz: "Europe/Berlin", label: "Almaniya" },
  france: { tz: "Europe/Paris", label: "Fransa" },
  russia: { tz: "Europe/Moscow", label: "Rusiya" },
  iran: { tz: "Asia/Tehran", label: "İran" },
  dubai: { tz: "Asia/Dubai", label: "Dubay" }
};

export function matchTime(query) {
  const n = normalizeAz(query);
  if (n.includes("saatliq") || n.includes("saatlik") || n.includes("hourly")) return { hit: false, exact: false };
  // v43: müddət / iş qrafiki saat sualı DEYİL ("Bakıdan Gəncəyə neçə saatdır", "iş saatı neçədir")
  const DURATION = /(?<![a-z])(is\s+saat[a-z]*|saat\s+qrafik[a-z]*|ucus[a-z]*|yol\s+muddet[a-z]*|nece\s+saat\s+(cek|sur|ged)[a-z]*|nece\s+saatdir|surur|cekir|gedir)/;
  if (DURATION.test(n)) return { hit: false, exact: false };
  const raw = n.match(/[a-z0-9]+/g) || [];

  // v19: yer adı ("Türkiyədə saat neçədir" → İstanbul vaxtı, Bakı YOX!).
  // Yalnız BÖYÜK hərflə yazılmış sözlərə baxırıq (sualın əvvəlki sözü və sual sözləri istisna).
  const placeOf = (t) => {
    if (TIME_PLACES[t]) return TIME_PLACES[t];
    for (const sfx of ["larinda", "lerinde", "daki", "deki", "da", "de", "dan", "den", "in", "nin", "a", "e"]) {
      if (t.length - sfx.length >= 4 && t.endsWith(sfx)) {
        const stem = t.slice(0, t.length - sfx.length);
        if (TIME_PLACES[stem]) return TIME_PLACES[stem];
      }
    }
    return null;
  };
  const CAP_RE = /(?<![\p{L}])(\p{Lu}[\p{Ll}əöüğçşı]{2,})(?![\p{L}])/gu;
  const capWords = [...String(query || "").matchAll(CAP_RE)].map(m => m[1]);
  const IGNORE_CAP = new Set(["bu","son","indi","hazir","hazirda","bugun","dunen","sabah","nece","necedir","kac","kacdir","saat","vaxt","time","zaman","the","what","current"]);
  let place = null;
  let unknownPlace = null;
  for (const w of capWords) {
    const nw = normalizeAz(w);
    if (IGNORE_CAP.has(nw) || TIME_TOKENS.has(nw)) continue;
    const hit = placeOf(nw);
    if (hit) { place = hit; break; }
    if (!unknownPlace && nw.length >= 4) unknownPlace = nw;
  }
  // böyük hərflə yazılmayıbsa, kiçik hərfli məlum yer adını da gör ("Londonda")
  if (!place) {
    const lc = raw.find(t => placeOf(t));
    if (lc) place = placeOf(lc);
  }

  const MEDIA = /(?<![\p{L}])(film|movies?|songs?|series|serial|game|oyun|kitab|books?|album|history|tarix|all\s+time)(?![\p{L}])/iu;
  if (MEDIA.test(n) && !TIME_PHRASES.some(p => n.includes(p))) return { hit: false, exact: false };
  if (TIME_EN_PHRASES.some(p => n.includes(p))) {
    // v45: "current time in brazil" — tanınmayan yer varsa saat demirik, axtarırıq
    const asciiOnly = !/[^\x00-\x7F]/.test(n);
    const tail = asciiOnly ? n.split(/\s+/).filter(t => t.length >= 4 && !TIME_PLACES[t] &&
      !["current","time","local","what","with","is","the","now","clock","hour"].includes(t) && !TIME_PHRASES.some(ph => ph.includes(t))) : [];
    if (!place && tail.length) return { hit: false, exact: false, unknownPlace: tail[0] };
    if (!place && unknownPlace) return { hit: false, exact: false, unknownPlace };
    return { hit: true, exact: true, place: place || undefined };
  }

  // v43: kiçik hərflə yazılmış tanınmayan yer adı ("braziliyada saat neçədir") → saat demə, axtar
  const COMMON = new Set(["burada","orada","burda","orda","harada","saat","saati","saatim","saatdir","saatdi","necedir","necedi","nece","kac","kacdir","neqeder","hazirki","indiki","vaxt","zaman","indi","hazirda","bu","son","bir","hansidir","hansi","dir","mi","var","haqqinda","barada","dair","gore","melumat"]);
  // yalnız "saat" sözündən ƏVVƏL gələn və yer şəkilçisi (-da/-də/-dan/-dən) olan söz yad yer sayılır
  const timeIdx = raw.findIndex(t => TIME_TOKENS.has(t));
  const before = timeIdx > 0 ? raw.slice(0, timeIdx) : [];
  const after = timeIdx >= 0 ? raw.slice(timeIdx + 1) : [];
  const isPlaceish = (t) => t.length >= 5 && !COMMON.has(t) && !TIME_PLACES[t] && /(da|de|dan|den|ta|te|ya|ye|nda|nde|brazil|canada|kanada|braziliya|hindistan|avstraliya|yaponiya|cin|almaniya|fransa|italiya|ispaniya)$/.test(t);
  // v45: yer "saat"-dan SONRA da gələ bilər ("saat neçədir braziliyada")
  // v45: "sonra" skanı yalnız SON sözlə — "…kino haqqında məlumat ver" səhv yer sayılmasın
  const lastAfter = after.length ? after[after.length - 1] : null;
  const foreign = before.find(isPlaceish) || (lastAfter && isPlaceish(lastAfter) ? lastAfter : null);
  if (!place && foreign) return { hit: false, exact: false, unknownPlace: foreign };

  for (const p of TIME_PHRASES) {
    if (n.includes(p)) {
      if (!place && unknownPlace) return { hit: false, exact: false, unknownPlace };
      return { hit: true, exact: true, place: place || undefined };
    }
  }
  const tokenHit = raw.some(t => TIME_TOKENS.has(t));
  if (!tokenHit) return { hit: false, exact: false };
  if (!place && unknownPlace) return { hit: false, exact: false, unknownPlace };
  // Qısa sorğu ("saat", "saat kaçdır") - exakt. Uzun sorğuda "saat" başqa mənada ola bilər
  // ("saat 3-də ...") - weak: structure məlumat + search birləşik gedir
  if (place) return { hit: true, exact: true, place };
  return { hit: true, exact: raw.length <= 3 };
}

// Mürəkkəb API üçün: hit = vaxt mövzusu var
export function isTimeQuery(query) {
  return matchTime(query).hit;
}

export async function fetchTime(tz = "Asia/Baku", label = "Azərbaycan") {
  const now = new Date();
  const fmtDate = new Intl.DateTimeFormat("az-AZ", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  // v10 🟡: hourCycle "h23" - bəzi ICU versiylərində hour12:false gecə 12-də "24" yazır
  const fmtTime = new Intl.DateTimeFormat("az-AZ", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const fmtWeek = new Intl.DateTimeFormat("az-AZ", { timeZone: tz, weekday: "long" });
  const parts = fmtDate.formatToParts(now);
  const get = t => parts.find(p => p.type === t)?.value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = fmtTime.format(now);
  const offMin = -new Date(now.toLocaleString("en-US", { timeZone: tz })) .getTimezoneOffset?.() || null;
  const offset = (() => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(now);
      const v = parts.find(p => p.type === "timeZoneName")?.value || "GMT+4";
      const m = v.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
      if (!m) return "+04:00";
      const h = String(Math.abs(Number(m[1]))).padStart(2, "0");
      const mm = (m[2] || "00").padStart(2, "0");
      return `${m[1].startsWith("-") ? "-" : "+"}${h}:${mm}`;
    } catch { return "+04:00"; }
  })();
  return {
    datetime: `${date}T${time}${offset}`,
    date,
    time,
    timezone: tz,
    place: label,
    utc_offset: offset,
    day_of_week: fmtWeek.format(now),
    source: "intl-timezone",
    fetched_at: now.toISOString()
  };
}

export async function fetchBakuTime() {
  return fetchTime("Asia/Baku", "Azərbaycan");
}

export function timeToText(t) {
  if (!t) return "";
  const place = t.place || "Azərbaycan";
  return `${place} üçün hazırkı vaxt: ${t.date} ${t.time} (${t.timezone}, UTC${t.utc_offset}). Həftənin günü: ${t.day_of_week}.`;
}
