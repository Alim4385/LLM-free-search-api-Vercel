// eval/filter-test.mjs — FİLTRƏ SİSTEMİ AYRI TEST (axtarışdan kənar)
// Məqsəd: təsadüfi çirkli mətnləri filtrə sal, düzgün cavabı saxlayırmı / zibili atırmı?
import { cleanContent, dedupeSnippet } from "../LLM-free-search-api-Vercel/lib/clean.js";

const cases = [
  {
    label: "AZ xəbər boilerplate (cavabı saxlamalı, şablonu atmalı)",
    input: "APA.az xəbər verir ki, bu gün Bakıda keçirilən görüşdə 12 ölkənin nümayəndəsi iştirak edib. // Bizi Telegram kanalımızda izləyin. Həmçinin oxuyun: digər xəbərlər.",
    mustKeep: ["12 ölkənin nümayəndəsi"],
    mustDrop: ["xəbər verir ki", "Telegram", "Həmçinin oxuyun"]
  },
  {
    label: "Sayt adları/link-lər qorunmalı (siyahı sualı)",
    input: "Ən çox ziyarət edilən saytlar: 1. Google (google.com) — 84 milyard ziyarət 2. YouTube (youtube.com) — 32 milyard 3. Facebook (facebook.com) — 18 milyard 4. Instagram (instagram.com) — 9 milyard",
    mustKeep: ["google.com", "youtube.com", "facebook.com", "18 milyard"],
    mustDrop: []
  },
  {
    label: "Qırıq fonetik/menyu simvolları təmizlənir",
    input: "Bakı ⓘ [bɑˈcɯ] — paytaxt ||| ~~~ === ... Əhalisi 2,3 milyon nəfərdir.",
    mustKeep: ["2,3 milyon"],
    mustDrop: ["ⓘ", "[bɑˈcɯ]", "|||"]
  },
  {
    label: "Wikipedia IPA/transkripsiya",
    input: "Bakı ([bɑˈcɯ] ⓘ, rus. Баку) — Azərbaycanın paytaxtı və ən böyük şəhəridir. Əhalisi 2,3 milyon nəfərdir.",
    mustKeep: ["Azərbaycanın paytaxtı", "2,3 milyon"],
    mustDrop: ["bɑˈcɯ", "ⓘ"]
  },
  {
    label: "Təkrarlanan sətirlər",
    input: "Xəzər dənizi dünyanın ən böyük gölüdür.\nXəzər dənizi dünyanın ən böyük gölüdür.\nXəzər dənizi dünyanın ən böyük gölüdür.\nSahəsi 371 min km²-dir.",
    mustKeep: ["371 min km²"],
    mustDrop: []
  },
  {
    label: "Kod parçası olan texniki mətn",
    input: "const list = [3,1,2];\nlist.sort((a,b) => b - a);\nconsole.log(list); // [3,2,1]\nBu kod massivi azalan sıra ilə sıralayır.",
    mustKeep: ["azalan sıra"],
    mustDrop: []
  },
  {
    label: "Brave/Google xəbərdarlıq önlüyü",
    input: "2 həftə öncə - AI can make mistakes. Consider checking important information. Bu il Azərbaycanda 51 ali təhsil müəssisəsi fəaliyyət göstərir.",
    mustKeep: ["51 ali təhsil"],
    mustDrop: ["AI can make mistakes"]
  },
  {
    label: "Nav/menyu zibili + məqalə",
    input: "Ana səhifə\nXəbərlər\nİdman\nReklam\nMüəllif: Zeynəb Rzayeva\nÇap edildi 15 Noyabr 2026\nİran Bəhreydə yerləşən ABŞ radar stansiyasına dronlarla zərbə endirib.",
    mustKeep: ["radar stansiyasına dronlarla"],
    mustDrop: ["Ana səhifə", "Reklam"]
  }
];

let pass = 0;
for (const c of cases) {
  const out = cleanContent(c.input);
  const keepOk = c.mustKeep.every(k => out.toLowerCase().includes(k.toLowerCase()));
  const dropOk = c.mustDrop.every(d => !out.toLowerCase().includes(d.toLowerCase()));
  const ok = keepOk && dropOk;
  if (ok) pass++;
  console.log(`\n=== ${c.label} → ${ok ? "✅" : "❌"}`);
  if (!keepOk) console.log(`   İTKİ: ${c.mustKeep.filter(k => !out.toLowerCase().includes(k.toLowerCase())).join(" | ")}`);
  if (!dropOk) console.log(`   QALIq: ${c.mustDrop.filter(d => out.toLowerCase().includes(d.toLowerCase())).join(" | ")}`);
  console.log(`   ÇIXIŞ (${out.length}b): ${out.replace(/\n/g, " ⏎ ").slice(0, 300)}`);
}
// Kazino/brend spamu bal qatında (lib/score.js CASINO_SPAM_RE) tutulur — ayrı yoxlama
import { scoreResult } from "../LLM-free-search-api-Vercel/lib/score.js";
import { tokenize } from "../LLM-free-search-api-Vercel/lib/rank.js";
const casinoQ = "ən yaxşı film saytları";
const casinoScore = scoreResult(
  { title: "AZERBAYCANDA KAZİNO SAYTLARI 🎰", url: "https://casino-az.example", snippet: "ən yaxşı bonus 500 AZN qazanın! Depozit et 100% bonus al.", source: "brave" },
  tokenize(casinoQ), "az", casinoQ
);
const spamOk = casinoScore === 0;
if (spamOk) pass++;
console.log(`\n=== Kazino spamı (bal qatı) → ${spamOk ? "✅" : "❌"}  score=${casinoScore}`);
console.log(`\nFİLTR NƏTİCƏSİ: ${pass}/${cases.length + 1}`);
