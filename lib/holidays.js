// v70: Azərbaycanın SABİT TARİXLİ bayram və anım günləri.
// Səbəb: "Zəfər Günü nə vaxtdır" sualına xəbər saytları (bayraq xəbəri) gəlirdi,
// "Neftçilər günü"nə isə Edmonton Oilers. Tarix statikdir → kiçik cədvəl kifayətdir.
// Mənbə: Azərbaycan Respublikasının Əmək Məcəlləsi (maddə 105) və prezident.az.
import { normalizeAz } from "./rank.js";

const DAYS = [
  { key: "yeni il", names: ["yeni il", "yeni il bayrami"], date: "1-2 yanvar", note: "bayram günləri" },
  { key: "20 yanvar", names: ["20 yanvar", "umumxalq huzn gunu", "qanli yanvar"], date: "20 yanvar", note: "Ümumxalq hüzn günü" },
  { key: "qadinlar gunu", names: ["qadinlar gunu", "8 mart"], date: "8 mart", note: "Qadınlar Günü" },
  { key: "novruz", names: ["novruz", "novruz bayrami"], date: "20-21 mart", note: "Novruz bayramı" },
  { key: "fashizm", names: ["fashizm uzerinde qelebe gunu", "9 may"], date: "9 may", note: "Faşizm üzərində qələbə günü" },
  { key: "müstəqillik günü", names: ["müstəqillik gunu", "28 may", "musteqillik gunu"], date: "28 may", note: "Müstəqillik Günü" },
  { key: "qurtulus gunu", names: ["milli qurtulus gunu", "15 iyun"], date: "15 iyun", note: "Milli Qurtuluş Günü" },
  { key: "silahli qüvvələr", names: ["silahli quvveler gunu", "ordu gunu", "26 iyun"], date: "26 iyun", note: "Silahlı Qüvvələr Günü" },
  { key: "neftciler gunu", names: ["neftciler gunu", "neftcilar gunu"], date: "20 sentyabr", note: "Neftçilər Günü (peşə bayramı)" },
  { key: "anım günü", names: ["anim gunu", "27 sentyabr"], date: "27 sentyabr", note: "Anım Günü" },
  { key: "zəfər günü", names: ["zəfər gunu", "zafer gunu", "8 noyabr", "qelebe gunu"], date: "8 noyabr", note: "Zəfər Günü" },
  { key: "bayraq gunu", names: ["bayraq gunu", "9 noyabr"], date: "9 noyabr", note: "Dövlət Bayrağı Günü" },
  { key: "konstitusiya gunu", names: ["konstitusiya gunu", "12 noyabr"], date: "12 noyabr", note: "Konstitusiya Günü" },
  { key: "dirçəliş günü", names: ["milli dircelis gunu", "17 noyabr"], date: "17 noyabr", note: "Milli Dirçəliş Günü" },
  { key: "hemreylik gunu", names: ["hemreylik gunu", "dunya azerbaycanlilarinin hemreylik gunu", "31 dekabr"], date: "31 dekabr", note: "Dünya Azərbaycanlılarının Həmrəylik Günü" },
  { key: "xocali", names: ["xocali soyqirimi", "xocali faciesi", "xocali qetliami"], date: "26 fevral", note: "Xocalı soyqırımı (Anım günü)" }
];

const WHEN_Q = /(?<![\p{L}])(ne\s+vaxt\p{L}*|n[əe]\s+vaxt\p{L}*|hans[ıi]\s+g[üu]n\p{L}*|hans[ıi]\s+tarix\p{L}*|n[əe]\s+g[üu]n\p{L}*|what\s+date|when)(?![\p{L}])/iu;

export function matchHoliday(query = "") {
  const raw = String(query || "").trim();
  const norm = normalizeAz(raw).replace(/\s+/g, " ");
  if (!WHEN_Q.test(raw)) return { hit: false };
  for (const d of DAYS) {
    for (const n of d.names) {
      const nn = normalizeAz(n);
      if (nn && norm.includes(nn)) {
        return { hit: true, exact: true, date: d.date, note: d.note, matched: n };
      }
    }
  }
  // tarixin özü sorulursa ("8 noyabr nə gündür") — ay adı + rəqəm
  const dayMonth = norm.match(/(?<!\d)(\d{1,2})\s+(yanvar|fevral|mart|aprel|may|iyun|iyul|avqust|sentyabr|oktyabr|noyabr|dekabr)(?!\p{L})/u);
  if (dayMonth) {
    const key = `${dayMonth[1]} ${dayMonth[2]}`;
    const d = DAYS.find(x => x.date.replace(/^(\d+-\d+|\d+)\s/, "").includes(dayMonth[2]) && x.date.includes(dayMonth[1]));
    if (d) return { hit: true, exact: true, date: d.date, note: d.note, matched: key };
  }
  return { hit: false };
}

export function holidayToText(h) {
  if (!h || !h.hit) return "";
  return `${h.note}: ${h.date} (hər il). Mənbə: Azərbaycan Respublikasının Əmək Məcəlləsi (maddə 105), prezident.az.`;
}
