// USDA FoodData Central — təsdiqlənmiş fdcId cədvəlini qurur (bir dəfə işlətmək kifayətdir).
// Səbəb: /foods/search reytinqi etibarsızdır ("milk" → "Cheese, ricotta, whole milk").
// fdcId ilə /v1/food/{id} isə TAM və sabit nəticə verir.
//   node tools/fdc-ids.mjs            → çap edir
//   USDA_API_KEY=... node tools/fdc-ids.mjs   (DEMO_KEY saatda ~30 sorğu)
const KEY = process.env.USDA_API_KEY || "DEMO_KEY";
const BAD = /(dehydrated|powder|dried|crackers|baby\s*food|cereals?\s*bar|candies|snack|imitation|infant|sheep|goat|human|buffalo|coconut|almond\s*milk|soy\s*milk|dessert|frozen|chocolate|shake|condensed|evaporated|filled|sour)/i;
const FOODS = (process.argv[2] || "milk,yogurt,cheese,egg,beef,chicken,fish,bread,rice,potato,banana,apple,orange,almond,hazelnut,walnut,honey,chocolate,oats,beans,chickpea,lentil,spinach,tomato,cucumber,grapes").split(",");
const out = {};
for (const f of FOODS) {
  let found = null;
  for (const q of [`${f}, raw`, `${f}, whole`, f]) {
    try {
      const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${KEY}&query=${encodeURIComponent(q)}&pageSize=50&dataType=SR%20Legacy`, { signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { console.error(`${f}: 429 — bir saat sonra təkrar et`); break; }
      const j = await r.json();
      found = (j.foods || []).filter(x => !BAD.test(String(x.description || "")))
        .find(x => String(x.description || "").toLowerCase().split(",")[0].trim() === f);
    } catch (e) { console.error(f, e.message); }
    if (found) break;
    await new Promise(s => setTimeout(s, 1300));
  }
  out[f] = found ? { id: found.fdcId, desc: found.description } : null;
  console.log(f, "→", found ? `${found.fdcId} ${found.description}` : "YOXDUR");
  await new Promise(s => setTimeout(s, 1300));
}
console.log(JSON.stringify(out, null, 1));
