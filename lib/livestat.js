// v71: DƏYİŞƏN RƏSMİ RƏQƏMLƏR (minimum əmək haqqı, pensiya, yaşayış minimumu).
// Səbəb: bu sinif suallarda axtarış köhnə xəbəri (2019: 180 manat) birinci plana çıxarırdı.
// Yanaşma: sorğuya CARİ İL əlavə olunur, nəticə mətnindən "manat" + mövzu olan cümlə çıxarılır,
// ən YENİ il qeyd edən cümlə üstün tutulur. Rəqəm uydurulmur — cümlə olduğu kimi verilir.
import { normalizeAz } from "./rank.js";

const TOPICS = [
  { id: "minwage", az: /(minimum\s+(ayliq\s+)?emek\s*haqqi|minimum\s+emekhaqqi|minimum\s+wage)/i,
    label: "Minimum aylıq əmək haqqı" },
  { id: "pension", az: /(pensiya|pension|пенсия)/i,
    label: "Əmək pensiyası" },
  { id: "living", az: /(yasayis\s+minimumu|living\s+wage\s+minimum)/i,
    label: "Yaşayış minimumu" },
  { id: "avgsalary", az: /(orta\s+(ayliq\s+)?emek\s*haqqi|average\s+salary|average\s+wage)/i,
    label: "Orta aylıq əmək haqqı" }
];

export function matchLiveStat(query = "") {
  const raw = String(query || "").trim();
  const norm = normalizeAz(raw).replace(/\s+/g, " ");
  for (const t of TOPICS) {
    if (t.az.test(norm)) return { hit: true, id: t.id, label: t.label };
  }
  return { hit: false };
}

// Nəticə mətnindən mövzuya aid "N manat" cümləsini çıxarır
export function extractMoneySentence(text, topicId, currentYear = new Date().getFullYear()) {
  const t = String(text || "");
  if (!t || !topicId) return null;
  const topicRe = TOPICS.find(x => x.id === topicId)?.az;
  if (!topicRe) return null;
  const sentences = t.split(/(?<=[.!?;])\s+|\n+/).map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length >= 20);
  const out = [];
  for (const s of sentences) {
    const ns = normalizeAz(s).replace(/\s+/g, " ");
    if (!topicRe.test(ns)) continue;
    const m = s.match(/(\d[\d\s.,]{0,12})\s*(manat|₼|AZN)/i);
    if (!m) continue;
    // v83: "579.2 manat" onluqdur, "25.000 manat" isə minlikdir — qarışdırmırıq
    const rawNum = String(m[1]).trim();
    const value = /^\d{1,3}([.\s]\d{3})+([,.]\d+)?$/.test(rawNum)
      ? Number(rawNum.replace(/[.\s](?=\d{3}(?!\d))/g, "").replace(",", "."))
      : Number(rawNum.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(value) || value <= 0 || value > 1000000) continue;
    // cümlədəki ən böyük il — təzəlik siqnalı
    const years = [...s.matchAll(/(?:19|20)\d{2}/g)].map(x => Number(x[0]));
    const year = years.length ? Math.max(...years) : null;
    if (year && year < currentYear - 3) continue; // çox köhnə rəqəm cavab deyil
    out.push({ value, sentence: s.slice(0, 240), year, score: (year === currentYear ? 3 : year === currentYear - 1 ? 2 : 1) });
  }
  if (!out.length) return null;
  out.sort((a, b) => b.score - a.score);
  return out[0];
}

export function extractLiveStatFromResults(results, topicId, currentYear = new Date().getFullYear()) {
  const found = [];
  for (const r of results || []) {
    const text = `${r.content || ""} ${r.snippet || ""}`;
    if (/client\s*challenge|required part of this site|captcha|enable javascript/i.test(text)) continue;
    const got = extractMoneySentence(text, topicId, currentYear);
    if (got) found.push({ ...got, url: r.url, title: r.title, published_at: r.published_at || null });
  }
  if (!found.length) return null;
  const votes = new Map();
  for (const f of found) votes.set(f.value, (votes.get(f.value) || 0) + 1);
  found.sort((a, b) => (votes.get(b.value) || 0) - (votes.get(a.value) || 0) || b.score - a.score);
  return found[0];
}

export function liveStatToText(hit, label) {
  if (!hit) return "";
  const v = String(hit.value).replace(".", ",");
  const yearNote = hit.year ? ` (${hit.year} ili məlumatı)` : "";
  return `${label}: ${v} manat${yearNote}. Mənbə cümlə: "${hit.sentence}"`;
}
