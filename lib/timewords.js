// v119: anchor (ingiliscə) sorğudan zaman sözlərini çıxarır.
// Problem: "новости Москва сегодня" → anchor "news Moscow today" → "today" sözü USA TODAY brendinə uyğun gəlir
// və Bing ana səhifələri (usatoday.com, cnn.com) qaytarır. Zamanı onsuz da `freshness` (sameDayCue) idarə edir,
// ona görə tərcümədən gələn "today/tonight/right now" anchor-da lazım deyil.
// Qaydalar:
//  - yalnız ORİGİNAL sorğuda "bu gün / сегодня / bugün" kimi işarə VARSA;
//  - orijinal sorğunun özündə ingiliscə "today" yazılıbsa toxunulmur (istifadəçi USA Today axtara bilər);
//  - çıxarandan sonra ən azı 2 söz qalmalıdır ("weather today" → toxunulmur).
import { sameDayCue } from "./router.js";

// sameDayCue türkcə "bugün" (boşluqsuz) və rusca "сейчас" sözlərini tanımır — burada tamamlanır.
const EXTRA_CUE = /(?<![\p{L}])(?:bug[üu]n|şu\s+an|şuanda|сейчас)(?![\p{L}])/iu;
const EN_TIME = /(?<![\p{L}])(?:today(?:['’]s)?|tonight|right\s+now)(?![\p{L}])/giu;

export function stripAnchorTimeWords(anchor, originalQuery = "") {
  if (!anchor || typeof anchor !== "string") return anchor;
  if (!sameDayCue(originalQuery) && !EXTRA_CUE.test(String(originalQuery))) return anchor;
  if (/(?<![\p{L}])today(?![\p{L}])/iu.test(String(originalQuery))) return anchor;
  const stripped = anchor.replace(EN_TIME, " ").replace(/\s{2,}/g, " ").trim();
  if (stripped.split(/\s+/).filter(Boolean).length < 2) return anchor;
  return stripped;
}
