// Conservative navigation and exact prose-repeat removal. No fuzzy word deletion.
const HOME = /^(?:ana\s+s[əe][hifəey]+|baş\s+səhifə|home(?:\s*page)?|главная(?:\s+страница)?|ana\s*sayfa)$/iu;
const MENU = /^(?:menyu|menu|haqqımızda|əlaqə|axtarış|daxil ol|qeydiyyat|about us|contact|sign in|log in|search|новости|контакты)$/iu;
const key = s => s.toLocaleLowerCase('az').replace(/\s+/g, ' ').trim();

// Whitespace-only adjacent duplicates. Hyphenated forms, numbers, quotes and
// code are outside the rewrite scope. Keep common intentional intensifiers.
const MEANINGFUL_REPEAT = new Set(['çox', 'az', 'tez', 'gec', 'yavaş', 'bir', 'tək', 'yaxşı', 'bəli', 'xeyr', 'yox', 'var', 'daha', 'very', 'had', 'that', 'bye', 'no']);
export function dedupeAdjacentWords(text = '') {
  const s = String(text);
  if (/^\s{4}|```|(?:===|=>|&&|\|\|)|^\s*\||https?:\/\//.test(s)) return s;
  // Preserve quoted prose and inline code verbatim.
  return s.split(/(`[^`]*`|"[^"\n]*"|“[^”\n]*”|«[^»\n]*»|'[^'\n]*')/gu).map((part, i) => {
    if (i % 2) return part;
    return part.replace(/(?<![\p{L}\p{N}_’'\-–—])([\p{L}][\p{L}\p{M}]{2,})(?:[ \t]+\1)+(?![\p{L}\p{N}_’'\-–—])/giu,
      (run, word) => MEANINGFUL_REPEAT.has(word.toLocaleLowerCase('az')) ? run : word);
  }).join('');
}

export function cleanNavigationAndRepeats(text = '') {
  const seenSentences = new Set();
  const seenLines = new Set();
  let fence = null;
  return String(text).split('\n').map(raw => {
    const fenceMatch = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fence === fenceMatch[1][0]) fence = null;
      return raw;
    }
    if (fence) return raw;
    let line = raw.trim();
    // Do not rewrite code, markdown tables, or indented code blocks.
    if (/^\s{4}|```|(?:===|=>|&&|\|\|)|^\s*\|/.test(raw)) return raw;
    if (HOME.test(line) || MENU.test(line)) return '';
    const crumbs = line.split(/\s*[»›→]\s*/u);
    if (crumbs.length > 1 && HOME.test(crumbs[0])) {
      while (crumbs.length && (HOME.test(crumbs[0]) || MENU.test(crumbs[0]))) crumbs.shift();
      line = crumbs.join(' » ');
    }
    // Separator-delimited lines made entirely of menu labels are not article text.
    const nav = line.split(/\s*[|»›]\s*/u);
    if (nav.length > 1 && nav.every(s => HOME.test(s) || MENU.test(s))) return '';
    if (!line) return '';
    line = dedupeAdjacentWords(line);
    // Only complete, reasonably long prose sentences are globally deduplicated.
    const sentences = line.split(/(?<=[.!?])\s+(?=[\p{Lu}0-9“«"])/u);
    line = sentences.filter(s => {
      const fp = key(s);
      if (fp.length < 45 || !/[.!?][”"»]?$/.test(s.trim())) return true;
      if (seenSentences.has(fp)) return false;
      seenSentences.add(fp);
      return true;
    }).map(s => s.trim()).join(' ');
    const fp = key(line);
    if (!fp) return '';
    if (fp.length >= 20 && seenLines.has(fp)) return '';
    if (fp.length >= 20) seenLines.add(fp);
    return line;
  }).filter(Boolean).join('\n');
}
