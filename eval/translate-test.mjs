// eval/translate-test.mjs — TƏRCÜMƏ SİSTEMİ AYRI TEST (pipeline-dan kənar)
// Məqsəd: EN→AZ tərcümədə söz itkisi, şəkilçi korlanması, məna sürüşməsi varmı?
import { translateText, detectContentLanguage } from "../LLM-free-search-api-Vercel/lib/translate.js";

const samples = [
  ["wikipedia-ish", "Ankara is the capital of Turkey. It is located in the center of Anatolia and is the second largest city after Istanbul."],
  ["tech-doc", "useEffect lets you synchronize a component with an external system. It runs after the component is rendered and can clean up resources."],
  ["tech-sql", "A JOIN clause combines columns from one or more tables into a new table. The types are INNER, LEFT OUTER, RIGHT OUTER and FULL OUTER JOIN."],
  ["news", "The President said on Monday that the country will increase defense spending next year, according to a statement released by his office."],
  ["sport", "The team won the championship after beating its rival 2-1 in the final match played in Baku on Sunday evening."],
  ["howto", "First, boil the water. Then add two spoons of coffee and stir slowly. Finally, pour it into a cup and serve hot."],
  ["list", "The five most visited websites in Azerbaijan are Google, YouTube, Facebook, Instagram and Wikipedia according to the latest ranking."],
  ["number", "The Caspian Sea has an area of about 371,000 square kilometers and a maximum depth of 1,025 meters."],
  ["short", "Baku Metro has 27 stations and three lines."],
  ["quote", "According to the Ministry of Education, 51 higher education institutions operate in the country, 39 of which are public."]
];

let bad = 0;
for (const [label, en] of samples) {
  const t0 = Date.now();
  const az = await translateText(en, "az", "en", 4000);
  const ok = az && az.length > en.length * 0.4;
  const lang = detectContentLanguage(az || "");
  if (!ok || lang === "en") bad++;
  console.log(`\n=== ${label} (${Date.now() - t0}ms, lang=${lang}) ${ok && lang !== "en" ? "OK" : "PROBLEM"}`);
  console.log(`EN: ${en}`);
  console.log(`AZ: ${az}`);
  await new Promise(r => setTimeout(r, 400));
}
console.log(`\nNƏTİCƏ: ${samples.length - bad}/${samples.length} keçdi`);
