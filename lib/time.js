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
const TIME_TOKENS = new Set(["saat","saati","saatim","time"]);

export function matchTime(query) {
  const n = normalizeAz(query);
  if (n.includes("saatliq") || n.includes("saatlik") || n.includes("hourly")) return { hit: false, exact: false };
  for (const p of TIME_PHRASES) {
    if (n.includes(p)) return { hit: true, exact: true };
  }
  const raw = n.match(/[a-z0-9]+/g) || [];
  const tokenHit = raw.some(t => TIME_TOKENS.has(t));
  if (!tokenHit) return { hit: false, exact: false };
  // Qısa sorğu ("saat", "saat kaçdır") - exakt. Uzun sorğuda "saat" başqa mənada ola bilər
  // ("saat 3-də ...") - weak: structure məlumat + search birləşik gedir
  return { hit: true, exact: raw.length <= 3 };
}

// Mürəkkəb API üçün: hit = vaxt mövzusu var
export function isTimeQuery(query) {
  return matchTime(query).hit;
}

export async function fetchBakuTime() {
  const now = new Date();
  const fmtDate = new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" });
  // v10 🟡: hourCycle "h23" - bəzi ICU versiylərində hour12:false gecə 12-də "24" yazır
  const fmtTime = new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const fmtWeek = new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", weekday: "long" });
  const parts = fmtDate.formatToParts(now);
  const get = t => parts.find(p => p.type === t)?.value;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = fmtTime.format(now);
  return {
    datetime: `${date}T${time}+04:00`,
    date,
    time,
    timezone: "Asia/Baku",
    utc_offset: "+04:00",
    day_of_week: fmtWeek.format(now),
    source: "intl-asia-baku",
    fetched_at: now.toISOString()
  };
}

export function timeToText(t) {
  if (!t) return "";
  return `Azərbaycanda hazırda: ${t.date} ${t.time} (${t.timezone}, UTC${t.utc_offset}). Həftənin günü: ${t.day_of_week}.`;
}
