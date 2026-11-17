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
  const words = n.replace(/[?!.,]/g, " ")
    .replace(new RegExp(nut.az, "g"), " ")
    .split(/\s+/)
    .map(w => w.replace(/(?:nin|nun|in|un|in|da|de|te|ta|dan|den|dən|inda|inde)$/u, ""))
    .filter(w => w.length >= 3 && !STOP.has(w));
  let foodAz = null, foodEn = null;
  for (const w of words) {
    if (FOODS[w]) { foodAz = w; foodEn = FOODS[w]; break; }
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

export async function fetchNutrient(m, ms = 2600) {
  if (!m || !m.hit) return null;
  const ck = `${m.foodEn}|${m.nutrient.az}`;
  const cached = CACHE.get(ck);
  if (cached && Date.now() - cached.t < 86400000) return cached.v; // qida tərkibi dəyişmir → 1 gün
  if (Date.now() < BLOCK_UNTIL) return null;
  const url = `${BASE}?api_key=${encodeURIComponent(KEY)}&query=${encodeURIComponent(m.foodEn)}&pageSize=15&dataType=SR%20Legacy`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  if (res.status === 429) { BLOCK_UNTIL = Date.now() + 300000; throw new Error("usda 429"); }
  if (!res.ok) throw new Error("usda " + res.status);
  const j = await res.json();
  const BAD = /(dehydrated|powder|dried|crackers|baby\s*food|cereal\s*bar|candies|snack|imitation|infant|sheep|goat|human|buffalo|coconut|almond\s*milk|soy|dessert|frozen|chocolate|shake|condensed|evaporated|filled|sour)/i;
  const q = m.foodEn.toLowerCase();
  const rank = (desc) => {
    const d = String(desc || "").toLowerCase();
    // baş söz TAM uyğun olmalıdır: "Milk, whole" ✓ / "Milk shakes" ✗ / "Cheese, ricotta, whole milk" ✗
    const head = d.split(",")[0].trim();
    if (head !== q) return 999;
    let r = 0;
    if (!/\b(whole|raw|fresh)\b/.test(d)) r += 10; // işlənməmiş forma üstün
    r += (d.match(/,/g) || []).length * 2;          // az modalifikator = daha baza qida
    r += d.length / 200;
    return r;
  };
  let foods = (j.foods || []).filter(f => !BAD.test(String(f.description || "")))
    .sort((a, b) => rank(a.description) - rank(b.description));
  if (foods.length && rank(foods[0].description) >= 999) {
    // heç biri "Milk, ..." formasında deyil → söz kimi olanlardan ən qısa adı götür
    foods = foods.filter(f => String(f.description || "").toLowerCase().includes(q))
      .sort((a, b) => String(a.description).length - String(b.description).length);
  }
  for (const f of foods) {
    const nut = (f.foodNutrients || []).find(x => String(x.nutrientName || "").toLowerCase() === m.nutrient.en.toLowerCase())
      || (f.foodNutrients || []).find(x => String(x.nutrientName || "").toLowerCase().startsWith(m.nutrient.en.toLowerCase().slice(0, 10)));
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
  return null;
}

export function nutrientToText(r, foodAz = "") {
  if (!r) return "";
  const v = Math.round(r.value * 100) / 100;
  return `${(foodAz || r.food)}: ${r.per} tərkibində ${r.nutrient} — ${String(v).replace(".", ",")} ${r.unit} (USDA FoodData Central, ${r.food}).`;
}

export function isNutritionQuery(query = "") { return matchNutrition(query).hit; }
