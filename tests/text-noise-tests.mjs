import assert from 'node:assert/strict';
import { cleanNavigationAndRepeats as clean } from '../lib/text-noise.js';
import { cleanContent } from '../lib/clean.js';
const sentence = 'Azərbaycan haqqında bu kifayət qədər uzun məlumat cümləsi təkrar göstərilir.';
const cases = [
 ['Ana səhifə » Ana səhifə',''],
 ['ana səyfə » ana səifə',''],
 ['Home › Home',''],
 ['Главная » Главная',''],
 ['Ana səhifə | Haqqımızda | Əlaqə',''],
 ['Ana səhifə » Elm » Tutuquşular','Elm » Tutuquşular'],
 [`${sentence} ${sentence}`,sentence],
 [`${sentence}\nDigər məlumat.\n${sentence}`,`${sentence}\nDigər məlumat.`],
 ['Pi 3.14-dür. Qiymət 12.50 manatdır.','Pi 3.14-dür. Qiymət 12.50 manatdır.'],
 ['Temperatur -5°C, faiz 2,3%, tarix 2026-11-19.','Temperatur -5°C, faiz 2,3%, tarix 2026-11-19.'],
 ['Çox, çox vacib məsələdir.','Çox, çox vacib məsələdir.'],
 ['Ana səhifə düyməsinə basın.','Ana səhifə düyməsinə basın.'],
 ['Homeostasis is a biological process.','Homeostasis is a biological process.'],
 ['if (a === b) return a;','if (a === b) return a;'],
 ['    print("Home » Home")','    print("Home » Home")'],
 ['| Name | Value |','| Name | Value |'],
 ['2024-cü ildə 350 növ. 2025-ci ildə 410 növ.','2024-cü ildə 350 növ. 2025-ci ildə 410 növ.'],
];
for (const [input, expected] of cases) {
 assert.equal(clean(input),expected,input);
 assert.equal(clean(clean(input)),expected,`idempotent: ${input}`);
}
assert.equal(cleanContent(`Ana səhifə » Ana səhifə\n${sentence} ${sentence}`),sentence);
console.log(`FV268: ${cases.length * 2 + 1} text hygiene assertions passed`);
