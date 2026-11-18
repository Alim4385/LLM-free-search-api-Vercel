# Pipeline arxitekturası (mərhələli bölgü)

Blueprint `route.js`-i 8 fayla bölməyi təklif edirdi. Bu, bir addımda ediləcək iş deyil:
`handleSearch` vəziyyət (state) daşıyır — hər mərhələ əvvəlkinin nəticəsini dəyişir. Ona görə
bölgü **ölçmə ilə** aparılır: hər çıxarılan modul öz unit testləri ilə gəlir, sonra
`npm run test:golden` ilə canlı davranış yoxlanılır.

## Hazır olan modullar

| modul | nə edir | test |
|---|---|---|
| `lib/pipeline/params.js` | giriş parametrlərinin normallaşdırılması (`max_results/count/limit`, `max_chars`, `format`, `freshness`, `exclude_domains`, `lang`, `no_cache`) | ✅ 7 assert |
| `lib/pipeline/respond.js` | cavab formatları: JSON (pretty), JSONL sətirləri (`jsonlLines`), sadə format, CORS və rate-limit başlıqları | ✅ 3 assert |
| `lib/finalize.js` | yekun mərhələ: `max_results` limiti, `freshness` filtri | ✅ 5 assert |

`app/api/search/route.js` bu üç modulu import edir; öz içində yalnız axın (flow) qalır.

## Növbəti mərhələlər (prioritet ilə)

1. **`lib/pipeline/intent.js`** — `matchWeather/matchTime/matchCurrency/matchMath/...` çağırışları
   və `structured` massivinin qurulması (təxminən 120 sətir, yan təsiri azdır).
2. **`lib/pipeline/structure.js`** — `count/measure/date/livestat` çıxarışlarının cavaba çevrilməsi.
3. **`lib/providers/*.js`** — `lib/search.js` (1304 sətir) içindəki provayderləri ayrı fayllara çıxarmaq:
   `bing.js`, `brave.js`, `ddg.js`, `wikipedia.js`, `news.js`, `mwlbb.js`, `code.js`.
   Bu, davranışı dəyişməyən mexaniki işdir — hər fayl çıxarıldıqdan sonra `npm test` + `npm run test:golden`.
4. **`lib/pipeline/retrieve.js` + `extract-stage.js`** — fan-out və səhifə oxunuşu;
   bu ikisi ən çox vəziyyət saxlayan hissədir, ən sonda.

Qayda: bir commit = bir modul. `FILTER_VERSION` hər dəyişiklikdə artırılır (keş invalidasiyası).
