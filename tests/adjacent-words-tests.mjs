import assert from 'node:assert/strict';
import {dedupeAdjacentWords as clean, cleanNavigationAndRepeats} from '../lib/text-noise.js';
import {cleanContent} from '../lib/clean.js';
const cases = [
 ['məlumat məlumat verilir.', 'məlumat verilir.'],
 ['Məlumat məlumat məlumat verilir.', 'Məlumat verilir.'],
 ['Saytda saytda yeni xəbər var.', 'Saytda yeni xəbər var.'],
 ['kitab\tkitab haqqında', 'kitab haqqında'],
 ['məlumat məlumatlar', 'məlumat məlumatlar'],
 ['məlumat verilir, başqa məlumat da var.', 'məlumat verilir, başqa məlumat da var.'],
 ['tez-tez yavaş-yavaş az-az', 'tez-tez yavaş-yavaş az-az'],
 ['söz-söz', 'söz-söz'],
 ['söz – söz', 'söz – söz'],
 ['söz — söz', 'söz — söz'],
 ['çox çox vacibdir.', 'çox çox vacibdir.'],
 ['bir bir yoxla', 'bir bir yoxla'],
 ['Bəli bəli, gəlirəm.', 'Bəli bəli, gəlirəm.'],
 ['"məlumat məlumat" yazılıb.', '"məlumat məlumat" yazılıb.'],
 ['«məlumat məlumat» yazılıb.', '«məlumat məlumat» yazılıb.'],
 ['`word word` nümunəsidir.', '`word word` nümunəsidir.'],
 ['    word word', '    word word'],
 ['if (a === a) return a;', 'if (a === a) return a;'],
 ['| söz söz | dəyər |', '| söz söz | dəyər |'],
 ['2026 2026 3.14 3.14', '2026 2026 3.14 3.14'],
 ['ha ha ha', 'ha ha ha'],
 ['had had that that', 'had had that that'],
 ['https://example.com/word word', 'https://example.com/word word'],
 ['məlumat\nməlumat', 'məlumat\nməlumat'],
 ["It's a good good day, isn't it?", "It's a good day, isn't it?"],
 ['məlumat məlumat\nhttps://example.com/word word', 'məlumat\nhttps://example.com/word word'],
];
for (const [input, expected] of cases) {
 assert.equal(clean(input), expected, input);
 assert.equal(clean(clean(input)), expected, `idempotence: ${input}`);
}
assert.equal(cleanNavigationAndRepeats('```\nməlumat məlumat\n```'), '```\nməlumat məlumat\n```');
assert.equal(cleanNavigationAndRepeats('Ana səhifə | Haqqımızda | '), '');
assert.equal(cleanContent('Saytda saytda yeni məlumat məlumat verilir.'), 'Saytda yeni məlumat verilir.');
assert.equal(cleanContent('Tez-tez yeni məlumat verilir.'), 'Tez-tez yeni məlumat verilir.');
console.log(`FV270: ${cases.length * 2 + 4} adjacent word assertions passed`);
