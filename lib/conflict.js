// v29: rəqəm ziddiyyəti aşkarlayıcı.
// Məqsəd: lokal LLM eyni suala 2 fərqli rəqəm görəndə bunu GİZLƏTMƏSİN.
// Biz cavab vermirik (top_answer YOXDUR, invariant qalır) — sadəcə ziddiyyəti göstəririk.

const UNIT_PATTERNS = [
  // pul
  { unit: "money", re: /(\d[\d\s.,]*)\s*(?:manat|azn|₼)/gi },
  { unit: "usd", re: /(\d[\d\s.,]*)\s*(?:dollar|usd|\$)/gi },
  { unit: "eur", re: /(\d[\d\s.,]*)\s*(?:avro|euro|eur|€)/gi },
  // sahə
  { unit: "km2", re: /(\d[\d\s.,]*)\s*(?:min\s+)?(?:km²|km2|kvadrat\s*kilometr)/gi },
  // əhali / say
  { unit: "people", re: /(\d[\d\s.,]*)\s*(?:milyon|milyard|min)?\s*(?:nəfər|nefər|sakin|səkin|adam)/gi },
  { unit: "tons", re: /(\d[\d\s.,]*)\s*(?:min\s+)?(?:ton)\b/gi },
  // uzunluq
  { unit: "km", re: /(\d[\d\s.,]*)\s*(?:min\s+)?(?:km|kilometr)\b/gi },
  // faiz
  { unit: "percent", re: /(\d[\d\s.,]*)\s*(?:%|faiz)/gi }
];

// "1.8731", "362,9", "10 300 000", "9.235.085" → ədəd
export function parseNum(raw = "") {
  let s = String(raw).replace(/\s/g, "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  // min/milyon/milyard çarpanı pattern-dən kənardadır — burada yalnız rəqəm forması
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 9.235.085 / 1.234,5
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ""); // 10,300,000
  else s = s.replace(/,/g, "."); // 362,9 → 362.9
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

const fold = (x) =>
  String(x || "").toLowerCase()
    .replace(/ə/g, "e").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
    .replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u");

function nearbyMentionsQuery(text, pos, qToks) {
  if (!qToks.length) return true;
  const win = fold(text.slice(Math.max(0, pos - 110), pos + 140));
  return qToks.some((t) => t.length >= 4 && win.includes(t));
}

/**
 * @param {Array<{id:number,title?:string,url?:string,content?:string,snippet?:string,source?:string}>} results
 * @param {string} query
 * @returns {Array<{unit:string, values:Array<{value:number,id:number,source:string,domain:string}>, spread:number}>}
 */
export function detectConflicts(results = [], query = "") {
  const qToks = [...new Set(
    fold(query).match(/[a-z0-9]{4,}/g) || []
  )].filter((t) => !/^(nedir|nədir|nece|neçə|nece|haqqinda|olub|olur|varmi|var)$/.test(t));

  const buckets = new Map(); // `${unit}|${valueKey}` sətri əvəzinə: unit → Map(id → Map(value → meta))

  for (const r of results) {
    const text = `${r.title || ""} ${r.snippet || ""} ${r.content || ""}`.slice(0, 4000);
    if (!text.trim()) continue;
    for (const { unit, re } of UNIT_PATTERNS) {
      re.lastIndex = 0;
      let m;
      let guard = 0;
      while ((m = re.exec(text)) !== null && guard++ < 40) {
        const val = parseNum(m[1]);
        if (val === null || val <= 0) continue;
        if (!nearbyMentionsQuery(text, m.index, qToks)) continue;
        if (!buckets.has(unit)) buckets.set(unit, new Map());
        const byValue = buckets.get(unit);
        const key = val;
        if (!byValue.has(key)) {
          let domain = "";
          try { domain = new URL(r.url || "").hostname.replace(/^www\./, ""); } catch {}
          byValue.set(key, { value: val, id: r.id, source: r.source || "", domain, count: 0 });
        }
        byValue.get(key).count++;
      }
    }
  }

  const out = [];
  for (const [unit, byValue] of buckets) {
    // yalnız FƏRQLİ NƏTİCƏLƏRDƏN olan dəyərlər (eyni nəticə daxilində təkrar sayılmır)
    const ids = new Set([...byValue.values()].map((v) => v.id));
    if (ids.size < 2) continue;
    const values = [...byValue.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map(({ value, id, source, domain }) => ({ value, id, source, domain }));
    const nums = values.map((v) => v.value).sort((a, b) => a - b);
    const lo = nums[0], hi = nums[nums.length - 1];
    if (hi === lo) continue;
    if (lo > 0 && (hi - lo) / hi < 0.01) continue; // 1%-dən az fərq — yuvarlaqlaşdırma səsi
    out.push({ unit, values, spread: Math.round(((hi - lo) / hi) * 1000) / 10 });
  }
  // ən böyük ziddiyyət əvvələ
  out.sort((a, b) => b.spread - a.spread);
  return out.slice(0, 5);
}
