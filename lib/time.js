// Saat / vaxt - API-siz, Intl ilə Asia/Baku vaxtı (ən etibarlı üsul)
import { normalizeAz, tokenize } from "./rank.js";

const TIME_KEYWORDS = ["saat","vaxt","necedi saat","saat necedi","time","current time","indi saat","bu gun saat","nece saat"];

export function isTimeQuery(query) {
  const n = normalizeAz(query);
  if (n.includes("saatliq") || n.includes("saatlik") || n.includes("hourly")) return false;
  const raw = new Set((n.match(/[a-z0-9]+/g) || []));
  return TIME_KEYWORDS.some(k => raw.has(normalizeAz(k)));
}

export async function fetchBakuTime() {
  const now = new Date();
  const fmtDate = new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" });
  const fmtTime = new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
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
