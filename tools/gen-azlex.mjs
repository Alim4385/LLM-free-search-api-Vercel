import { readFileSync, writeFileSync } from "node:fs";
import { normalizeAz } from "/home/user/LLM-free-search-api-Vercel/lib/rank.js";
const words = readFileSync("/tmp/azstem/words.txt","utf8").split(/\r?\n/).map(w=>w.trim()).filter(Boolean);
const norm = new Set();
for (const w of words) { const n = normalizeAz(w); if (n.length>=2) norm.add(n); }
const sufs = readFileSync("/home/user/LLM-free-search-api-Vercel/lib/data/az-suffixes.txt","utf8")
  .split(/\r?\n/).map(s=>s.trim()).filter(s=>s && s!=="-");
const out = `// AVTOMATİK YARADILIB — əl ilə redaktə etmə.
// Mənbə: https://github.com/aznlp-disc/stemmer (MIT, Copyright (c) 2018 AzerbaijaniNLP Research Group)
// words.txt (75 670 söz) → normalizeAz ilə ASCII forması; suffix.txt (102 şəkilçi).
// Generator: tools/gen-azlex.mjs
export const AZ_LEXICON_BLOB = ${JSON.stringify([...norm].join("\n"))};
export const AZ_LEX_SUFFIXES = ${JSON.stringify(sufs)};
`;
writeFileSync("/home/user/LLM-free-search-api-Vercel/lib/data/azlex.js", out);
console.log("words",words.length,"normalized",norm.size,"suffixes",sufs.length,"bytes",out.length);
