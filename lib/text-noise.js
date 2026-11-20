// Conservative navigation and exact prose-repeat removal. No fuzzy word deletion.
const HOME = /^(?:ana\s+s[əe][hifəey]+|baş\s+səhifə|home(?:\s*page)?|главная(?:\s+страница)?|ana\s*sayfa)$/iu;
const MENU = /^(?:menyu|menu|haqqımızda|əlaqə|axtarış|daxil ol|qeydiyyat|about us|contact|sign in|log in|search|новости|контакты)$/iu;
const key = s => s.toLocaleLowerCase('az').replace(/\s+/g, ' ').trim();

export function cleanNavigationAndRepeats(text = '') {
  const seenSentences = new Set();
  const seenLines = new Set();
  return String(text).split('\n').map(raw => {
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
