// Azərbaycan dili üçün leksikon əsaslı kök ayırıcı (stemmer).
// Əl ilə yazılmış şəkilçi siyahısı ƏVƏZİNƏ hazır, sınaqdan keçmiş data istifadə olunur:
//   mənbə: https://github.com/aznlp-disc/stemmer — MIT lisenziya,
//   Copyright (c) 2018 AzerbaijaniNLP Research Group (bax: lib/data/AZ-STEM-LICENSE.md)
//   words.txt → 75 670 söz (normalizeAz ilə ASCII-yə salınmış), suffix.txt → 101 şəkilçi.
// Alqoritm (mənbədəki məntiqin JS versiyası): şəkilçiləri tək-tək atıb leksikonda
// olan ƏN UZUN kökü qaytarır. Bu, "gənclər"(gencler) ↔ "Gəncə"(gence) kimi
// kök toqquşmalarını avtomatik həll edir — regex/siyahı ilə "whack-a-mole" lazım deyil.
import { AZ_LEXICON_BLOB, AZ_LEX_SUFFIXES } from "./data/azlex.js";

let LEX = null;
function lex() {
  if (LEX === null) LEX = new Set(AZ_LEXICON_BLOB.split("\n"));
  return LEX;
}

const SUFFIXES = [...AZ_LEX_SUFFIXES]
  .filter(s => s && s !== "-" && s.length <= 8)
  .sort((a, b) => b.length - a.length);

const MIN_STEM = 3;

export function isLexWord(word = "") {
  const w = String(word).toLowerCase();
  return w.length >= 2 && lex().has(w);
}

// normalized (normalizeAz çıxışı) söz üçün leksikonla təsdiqlənmiş kök.
// Tapılmasa null qaytarır → çağıran tərəf köhnə qayda-əsaslı stemAz-a düşür.
export function lexStem(word = "") {
  const w = String(word || "").toLowerCase();
  if (w.length < MIN_STEM) return null;
  const L = lex();
  if (L.has(w)) return w; // söz özü lüğətdədir → kəsmirik
  const seen = new Set([w]);
  const stack = [w];
  let best = null;
  let guard = 0;
  while (stack.length && guard++ < 400) {
    const cur = stack.pop();
    for (const s of SUFFIXES) {
      if (s.length >= cur.length) continue;
      if (!cur.endsWith(s)) continue;
      const stem = cur.slice(0, -s.length);
      if (stem.length < MIN_STEM || seen.has(stem)) continue;
      seen.add(stem);
      if (L.has(stem)) {
        if (!best || stem.length > best.length) best = stem;
      } else {
        stack.push(stem);
      }
    }
  }
  return best;
}
