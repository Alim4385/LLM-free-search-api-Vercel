// Qida tərkibi intenti — USDA FoodData Central (DEMO_KEY; öz açarın: USDA_API_KEY).
// Səbəb: "südün tərkibində nə qədər kalsium var" sualına axtarış cavab vermirdi (boş nəticə).
import { normalizeAz } from "./rank.js";

const KEY = process.env.USDA_API_KEY || "DEMO_KEY";
const BASE = "https://api.nal.usda.gov/fdc/v1/foods/search";
const UA = "Mozilla/5.0 (compatible; LLMSearchAPI/1.0)";

// AZ qida adı → USDA axtarış sözü (kiçik data cədvəli)
const FOODS = {
  sud: "milk", "süd": "milk", qatiq: "yogurt", pendir: "cheese", yumurta: "egg",
  et: "beef", toyuq: "chicken", baliq: "fish", corek: "bread", duyu: "rice",
  kartof: "potato", banan: "banana", alma: "apple", portağal: "orange", portaqal: "orange",
  badam: "almond", findiq: "hazelnut", qoz: "walnut", bal: "honey", şokolad: "chocolate",
  şokoladli: "chocolate", yulaf: "oats", lobya: "beans", noxud: "chickpea", mercimek: "lentil",
  ispanaq: "spinach", pomidor: "tomato", xiyar: "cucumber", uzum: "grapes", üzüm: "grapes",
  "zeytun yagi": "olive oil", "zeytun yağı": "olive oil", "gunesaxan yagi": "sunflower oil"
};

// AZ qida maddəsi → USDA nutrient adı
const NUTRIENTS = [
  { az: "kalsium", en: "Calcium, Ca", unit: "mq" },
  { az: "demir", en: "Iron, Fe", unit: "mq" },
  { az: "maqnezium", en: "Magnesium, Mg", unit: "mq" },
  { az: "kalium", en: "Potassium, K", unit: "mq" },
  { az: "natrium", en: "Sodium, Na", unit: "mq" },
  { az: "fosfor", en: "Phosphorus, P", unit: "mq" },
  { az: "sink", en: "Zinc, Zn", unit: "mq" },
  { az: "protein", en: "Protein", unit: "q" },
  { az: "yag", en: "Total lipid (fat)", unit: "q" },
  { az: "karbohidrat", en: "Carbohydrate, by difference", unit: "q" },
  { az: "lif", en: "Fiber, total dietary", unit: "q" },
  { az: "seker", en: "Sugars, total including NLEA", unit: "q" },
  { az: "kalori", en: "Energy", unit: "kkal" },
  { az: "a vitamini", en: "Vitamin A, IU", unit: "IU" },
  { az: "c vitamini", en: "Vitamin C, total ascorbic acid", unit: "mq" },
  { az: "d vitamini", en: "Vitamin D (D2 + D3)", unit: "µq" },
  { az: "b12 vitamini", en: "Vitamin B-12", unit: "µq" }
];

const QUESTION_RE = /(?<![\p{L}])(terkibinde|terkibində|tərkibində|includes|contains|how\s+much|nece|nə\s+qədər|qeder|faiz)(?![\p{L}])/iu;

export function matchNutrition(query = "") {
  const n = normalizeAz(query);
  // "tərkibində" və ya "nə qədər ... var" forması
  const hasAmount = /(?:nece|ne\s+qeder|qeder|how\s+much|var$)/.test(n);
  if (!n.includes("terkib") && !hasAmount) return { hit: false, exact: false };
  const nut = NUTRIENTS.find(x => n.includes(x.az) || n.includes(normalizeAz(x.en)));
  if (!nut) return { hit: false, exact: false };
  // qida adı: maddə adını və sual sözlərini çıxar, qalan sözlərdən FOODS-da axtar
  const STOP = new Set(["nece", "ne", "qeder", "how", "much", "var", "terkibinde", "terkib", "is", "the", "in", "of", "de", "da", "nece", "olur"]);
  // v64: sözü burada KƏSMİRİK — resolveFood həm tam, həm şəkilçili formanı yoxlayır
  const words = n.replace(/[?!.,]/g, " ")
    .replace(new RegExp(nut.az, "g"), " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w));
  // v64: şəkilçi ilə yazılmış qida adı — "bananın" → "banan", "yumurtada" → "yumurta".
  // Əvvəl suffix regex "bananin"-dən "nin" silib "bana" edirdi, qida tapılmırdı.
  const resolveFood = (w) => {
    // v64: AZ morfologiyası — "çörəyin" → coreyin → corek (k→y), "toyuğun" → toyug → toyuq (q→g)
    const stripped = w.replace(/(?:nin|nun|in|un|da|de|te|ta|dan|den|dən|ında|ində|inda|inde|si|sı|i|ı)$/u, "");
    const vars = [w, stripped,
      stripped.replace(/y$/u, "k"), stripped.replace(/y$/u, "q"),
      stripped.replace(/g$/u, "q"), stripped.replace(/g$/u, "k"),
      w.replace(/y$/u, "k"), w.replace(/y$/u, "q"),
      w.replace(/g$/u, "q")].filter(v => v && v.length >= 3);
    for (const v of vars) if (FOODS[v]) return v;
    for (const k of Object.keys(FOODS)) {
      if (k.length < 3) continue;
      if (vars.some(v => v.startsWith(k) && v.length - k.length <= 3)) return k;
    }
    return null;
  };
  let foodAz = null, foodEn = null;
  for (const w of words) {
    const k = resolveFood(w);
    if (k) { foodAz = k; foodEn = FOODS[k]; break; }
  }
  if (!foodEn) {
    for (let i = 0; i < words.length - 1; i++) {
      const pair = `${words[i]} ${words[i + 1]}`;
      if (FOODS[pair]) { foodAz = pair; foodEn = FOODS[pair]; break; }
    }
  }
  if (!foodEn) return { hit: false, exact: false };
  return { hit: true, exact: true, nutrient: nut, foodAz, foodEn };
}

const CACHE = new Map();
let BLOCK_UNTIL = 0;

// v51.2: USDA "search" reytinqi etibarsızdır — "milk" sorğusunda "Cheese, ricotta,
// whole milk" birinci gəlirdi. Ona görə: (1) təsdiqlənmiş kanonik adla sorğu,
// (2) baş söz TAM uyğunluğu tələbi, (3) uyğunluq yoxdursa NULL — pendir/qatıq
// südün yerinə keçmir. Kanonik adlar canlı yoxlanıb (bax: tools/fdc-ids.mjs).
const CANON = {
  milk: "milk, whole, 3.25% milkfat, with added vitamin d",
  yogurt: "yogurt, plain, whole milk",
  egg: "egg, whole, raw, fresh",
  cheese: "cheese, cheddar",
  banana: "bananas, raw",
  apple: "apples, raw, with skin",
  orange: "oranges, raw, all commercial varieties",
  potato: "potatoes, raw, flesh and skin",
  rice: "rice, white, long-grain, regular, raw, unenriched",
  bread: "bread, white, commercially prepared",
  beef: "beef, ground, 85% lean meat / 15% fat, raw",
  chicken: "chicken, broilers or fryers, meat and skin, raw",
  fish: "fish, salmon, atlantic, farmed, raw",
  honey: "honey",
  tomato: "tomatoes, red, ripe, raw, year round average",
  spinach: "spinach, raw",
  carrot: "carrots, raw",
  cucumber: "cucumber, with peel, raw",
  grapes: "grapes, red or green (european type, such as thompson seedless), raw",
  almond: "nuts, almonds",
  walnut: "nuts, english walnuts",
  hazelnut: "nuts, hazelnuts or filberts",
  oats: "cereals, oats, regular and quick, unenriched, cooked with water (includes boiling and microwaving), without salt",
  lentil: "lentils, raw",
  beans: "beans, snap, green, raw",
  chickpea: "chickpeas (garbanzo beans, bengal gram), mature seeds, raw"
};

export async function fetchNutrient(m, ms = 2600) {
  if (!m || !m.hit) return null;
  const ck = `${m.foodEn}|${m.nutrient.az}`;
  const cached = CACHE.get(ck);
  if (cached && Date.now() - cached.t < 86400000) return cached.v; // qida tərkibi dəyişmir → 1 gün
  if (Date.now() < BLOCK_UNTIL) return null;
  const BAD = /(dehydrated|powder|powdered|dried|dry|crackers|baby\s*food|cereals?\s*bar|candies|snack|imitation|infant|sheep|goat|human|buffalo|coconut|almond\s*milk|soy\s*milk|dessert|frozen|chocolate|shake|condensed|evaporated|filled|sour)/i;
  const q = m.foodEn.toLowerCase();
  const pick = (foods) => {
    const list = (foods || []).filter(f => !BAD.test(String(f.description || "")));
    const scored = [];
    for (const f of list) {
      const d = String(f.description || "").toLowerCase();
      const head = d.split(",")[0].trim();
      // yalnız TAM baş söz (v64: cəm forması da qəbul — "bananas" = "banana")
      const hq = head.replace(/s$/, "");
      if (head !== q && hq !== q && head !== q.replace(/s$/, "")) continue;
      let r = 0;
      if (!/\b(raw|whole|fresh)\b/.test(d)) r += 10;
      // v64: ümumi qida sorulanda onun HİSSƏSİ (sarısı, zülalı) cavab deyil:
      // "yumurtada kalori" → "Egg, whole" olmalıdır, "Egg, yolk" deyil.
      if (/\b(yolk|albumen|white)\b/.test(d) && !/\b(yolk|albumen|white)\b/.test(q)) r += 8;
      if (/\bwhole\b/.test(d) && !/\bwhole\b/.test(q)) r -= 3;
      // v64: ümumi qida üçün kanonik növ üstündür (pendir → cheddar, blue deyil)
      const PREFER = { cheese: /cheddar/, bread: /white/, rice: /white/, milk: /whole/ };
      if (PREFER[q] && PREFER[q].test(d)) r -= 5;
      if (/\b(dry|dried|powder|powdered|condensed|evaporated)\b/.test(d)) r += 20; // süd tozu ≠ süd
      r += (d.match(/,/g) || []).length * 2;
      r += d.length / 200;
      scored.push({ f, r });
    }
    scored.sort((a, b) => a.r - b.r);
    return scored.length ? scored[0].f : null;
  };
  const queries = [];
  if (CANON[q]) queries.push(CANON[q]);
  queries.push(q);
  for (const query of queries) {
    const url = `${BASE}?api_key=${encodeURIComponent(KEY)}&query=${encodeURIComponent(query)}&pageSize=50&dataType=SR%20Legacy,Foundation`;
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
    } catch { continue; }
    if (res.status === 429) { BLOCK_UNTIL = Date.now() + 600000; throw new Error("usda 429"); }
    if (!res.ok) continue;
    const j = await res.json();
    const f = pick(j.foods);
    if (!f) continue;
    // v64: "Energy" həm kkal, həm kJ ola bilər — kalori sorulanda KCAL mütləqdir
    const nutList = (f.foodNutrients || []);
    const wantKcal = m.nutrient.az === "kalori";
    const nut = (wantKcal ? nutList.find(x => String(x.nutrientName || "").toLowerCase() === "energy" && String(x.unitName || "").toUpperCase() === "KCAL") : null)
      || nutList.find(x => String(x.nutrientName || "").toLowerCase() === m.nutrient.en.toLowerCase())
      || nutList.find(x => String(x.nutrientName || "").toLowerCase().startsWith(m.nutrient.en.toLowerCase().slice(0, 10)));
    if (nut && typeof nut.value === "number") {
      const out = {
        food: f.description || m.foodEn,
        nutrient: m.nutrient.az,
        value: nut.value,
        unit: nut.unitName === "MG" ? "mq" : nut.unitName === "G" ? "q" : nut.unitName === "KCAL" ? "kkal" : (nut.unitName || m.nutrient.unit),
        per: "100 q",
        fdcId: f.fdcId,
        source: "usda.gov",
        fetched_at: new Date().toISOString()
      };
      CACHE.set(ck, { t: Date.now(), v: out });
      return out;
    }
  }
  return null; // uyğun baza qida tapılmadı → uydurma cavab vermirik
}

export function nutrientToText(r, foodAz = "") {
  if (!r) return "";
  const v = Math.round(r.value * 100) / 100;
  return `${(foodAz || r.food)}: ${r.per} tərkibində ${r.nutrient} — ${String(v).replace(".", ",")} ${r.unit} (USDA FoodData Central, ${r.food}).`;
}

export function isNutritionQuery(query = "") { return matchNutrition(query).hit; }
