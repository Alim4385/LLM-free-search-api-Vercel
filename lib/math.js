// Riyazi hesablama intenti — LLM axtarışda "kalkulyator" kimi istifadə etsin deyə.
// TƏHLÜKƏSİZLİK: eval/Function YOX — öz rekursiv-descent parser-imiz var.
// Dəstək: + - * / ^ % ( ) , müqayisə yox; sqrt/abs/round/floor/ceil; faiz məsələləri.
// "2+2", "125*8-40", "(15+5)/4", "144-ün kvadrat kökü", "500 manatın 20 faizi",
// "50 200-ün neçə faizidir", "20% of 500"
import { normalizeAz } from "./rank.js";

const NUM = "\\d+(?:[.,]\\d+)?";

function tokenizeExpr(src) {
  const out = [];
  let i = 0;
  const s = src.replace(/\s+/g, "");
  while (i < s.length) {
    const c = s[i];
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.,]/.test(s[j])) j++;
      out.push({ t: "num", v: parseFloat(s.slice(i, j).replace(",", ".")) });
      i = j;
      continue;
    }
    if ("+-*/^%()".includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error("bad char " + c);
  }
  return out;
}

// rekursiv descent: expr → term (('+'|'-') term)* ; term → pow (('*'|'/'|'%') pow)*
function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => { if (tokens[p] && tokens[p].t === t) { p++; return true; } return false; };

  function primary() {
    const tk = peek();
    if (!tk) throw new Error("unexpected end");
    if (tk.t === "num") { p++; return tk.v; }
    if (tk.t === "-") { p++; return -primary(); }
    if (tk.t === "+") { p++; return primary(); }
    if (tk.t === "(") { p++; const v = expr(); if (!eat(")")) throw new Error("missing )"); return v; }
    throw new Error("unexpected " + tk.t);
  }
  function power() {
    const base = primary();
    if (eat("^")) return Math.pow(base, power());
    // postfix faiz: "20%" → 0.2
    if (eat("%")) return base / 100;
    return base;
  }
  function term() {
    let v = power();
    for (;;) {
      if (eat("*")) { v = v * power(); continue; }
      if (eat("/")) { v = v / power(); continue; }
      if (eat("%")) { const d = power(); v = d === 0 ? NaN : v % d; continue; }
      return v;
    }
  }
  function expr() {
    let v = term();
    for (;;) {
      if (eat("+")) { v = v + term(); continue; }
      if (eat("-")) { v = v - term(); continue; }
      return v;
    }
  }
  const val = expr();
  if (p !== tokens.length) throw new Error("trailing tokens");
  return val;
}

export function evalExpr(src) {
  return parse(tokenizeExpr(src));
}

const fmt = (n) => {
  if (!Number.isFinite(n)) return "müəyyən deyil";
  const r = Math.round(n * 1e10) / 1e10;
  return String(r).replace(".", ",");
};

// --- niyyət aşkarlama -------------------------------------------------------
// Pozisiya-əsaslı məntiq: bütün ədədləri indeksləri ilə tapırıq, sonra açar sözlərə
// olan MƏSAFƏYƏ görə hansının "baza", hansının "faiz" olduğunu müəyyən edirik.
// (Nested regex-lər "50 200-ün neçə faizi" kimi hallarda səhv qrupu tuturdu.)
function numbersWithPos(text) {
  const out = [];
  const re = /(\d+(?:[.,]\d+)?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ v: parseFloat(m[1].replace(",", ".")), start: m.index, end: m.index + m[1].length, raw: m[1] });
  }
  return out;
}
const nearestTo = (nums, kwIdx) => nums.reduce((best, x) => {
  const d = kwIdx >= x.end ? kwIdx - x.end : x.start - kwIdx;
  if (!best || d < best.d) return { x, d };
  return best;
}, null);

export function matchMath(query = "") {
  const raw = String(query || "");
  const n = normalizeAz(raw);
  const nums = numbersWithPos(n);

  // v69: sabitlər — "pi neçəyə bərabərdir" (axtarış Smithsonian məqaləsi gətirirdi)
  if (/(?<![\p{L}])pi(?![\p{L}])/iu.test(raw) && /(nec[əe]y[əe]|ne[çc][əe]y[əe]|n[əe]\s*q[əe]d[əe]r|nedir|n[əe]dir|what|equal|value|qiym[əe]t|berapa)/iu.test(raw)) {
    return { hit: true, exact: true, kind: "constant", name: "π (pi)", result: Math.PI, approx: "3,14159265358979" };
  }

  // 1) kvadrat kök: "144-ün kvadrat kökü", "kök altında 81", "sqrt 144"
  // v104: "16-nın kökü" (kvadrat sözü olmadan) və "üstü/quvvet" dərəcəsi
  const pw = n.match(/(?<![\p{L}\d])(\d+(?:[.,]\d+)?)\s*(?:ustu|uzeri|quvvet|power)\s*(\d+(?:[.,]\d+)?)(?![\p{L}\d])/u);
  if (pw) {
    const base = parseFloat(pw[1].replace(",", ".")), exp = parseFloat(pw[2].replace(",", "."));
    const result = Math.pow(base, exp);
    if (Number.isFinite(result)) return { hit: true, exact: true, kind: "expr", expr: `${base}^${exp}`, result };
  }
  const kw = n.search(/(?:kvadrat\s+kok|kok\s+altinda|sqrt|(?<![\p{L}])koku)/);
  if (kw >= 0 && nums.length) {
    const near = nearestTo(nums, kw);
    if (near && near.d <= 14) {
      const v = near.x.v;
      if (v < 0) return { hit: false, exact: false };
      return { hit: true, exact: true, kind: "sqrt", value: v, result: Math.sqrt(v) };
    }
  }

  // 2) faiz məsələləri
  const pctKw = n.search(/(?:faiz|percent|%)/);
  if (pctKw >= 0 && nums.length >= 2) {
    const question = /(?:nece\s+faiz|ne\s+qeder\s+faiz|hansi\s+faiz|what\s+percent)/.test(n);
    const [a, b] = nums;
    if (question) {
      const part = Math.min(a.v, b.v), whole = Math.max(a.v, b.v);
      if (whole !== 0) return { hit: true, exact: true, kind: "percent_of", part, whole, result: (part / whole) * 100 };
    } else {
      // "500 manatin 20 faizi" → faiz-ə ən yaxın ədəd = dərəcə, digəri = baza
      // "20% of 500"          → "%"-ə ən yaxın ədəd = dərəcə, digəri = baza
      const anchor = n.search(/(?:faiz|%|percent|of)/);
      const near = nearestTo(nums, anchor);
      if (near) {
        const rate = near.x.v;
        const base = nums.find(x => x !== near.x)?.v;
        if (base !== undefined && rate <= 100 && rate >= 0 && base !== rate) {
          return { hit: true, exact: true, kind: "percent_calc", base, rate, result: (base * rate) / 100 };
        }
      }
    }
  }

  // v104: ŞİFAHİ əməliyyat zənciri — "12 vurulsun 3", "50 plus 50", "100 bölünsün 4".
  // Rəqəmlər və əməliyyat sözləri SIRAYLA yığılır (suffix "-in/-un" rəqəmə yapışmır).
  if (nums.length >= 2) {
    const OP_MAP = [
      ["*", /(?<![\p{L}])(vurulsun|vurulur|vurun|vur|vurmaq|carpi|carp|times|multiplied|multiply)(?![\p{L}])/giu],
      ["/", /(?<![\p{L}])(bolunsun|bolunur|bolun|bol|bolmek|divided|divide|over)(?![\p{L}])/giu],
      ["+", /(?<![\p{L}])(toplansin|toplanir|topla|toplayin|ustegel|plus|added|add)(?![\p{L}])/giu],
      ["-", /(?<![\p{L}])(cixilsin|cixilir|cixin|cix|cixmaq|minus|subtract)(?![\p{L}])/giu]
    ];
    const tokens = [];
    const scan = /(\d+(?:[.,]\d+)?)|(?<![\p{L}])(vurulsun|vurulur|vurun|vur|vurmaq|carpi|carp|times|multiplied|multiply|bolunsun|bolunur|bolun|bol|bolmek|divided|divide|over|toplansin|toplanir|topla|toplayin|ustegel|plus|added|add|cixilsin|cixilir|cixin|cix|cixmaq|minus|subtract)(?![\p{L}])/giu;
    let sm;
    while ((sm = scan.exec(n)) !== null) {
      if (sm[1] !== undefined) tokens.push({ t: "n", v: parseFloat(sm[1].replace(",", ".")) });
      else {
        let op = null;
        for (const [sym, re] of OP_MAP) { re.lastIndex = 0; if (re.test(sm[2])) { op = sym; break; } }
        if (op) tokens.push({ t: "op", v: op });
      }
    }
    const ops = tokens.filter(x => x.t === "op").length;
    const nnums = tokens.filter(x => x.t === "n").length;
    if (ops >= 1 && nnums >= 2 && ops <= nnums) {
      const expr = tokens.map(x => x.v).join("");
      try {
        const result = evalExpr(expr);
        if (Number.isFinite(result)) return { hit: true, exact: true, kind: "expr", expr, result };
      } catch { /* ifadə deyil */ }
    }
  }

  // 3) təmiz arifmetik ifadə
  const cleaned = n
    .replace(/(?<![\p{L}])(hesabla|hesablayin|nece\s+olur|ne\s+qeder|necedir|nece|edir|result|calculate|what\s+is|equals?)(?![\p{L}])/gu, " ")
    .replace(/[=?]/g, " ")
    .replace(/\s+/g, "");
  if (/^[\d+\-*/^%().,]+$/.test(cleaned)) {
    const hasOp = /[+\-*/^%]/.test(cleaned);
    const digits = (cleaned.match(/\d/g) || []).length;
    if (hasOp && digits >= 1 && cleaned.length >= 3) {
      try {
        const result = evalExpr(cleaned);
        if (Number.isFinite(result) || Number.isNaN(result)) return { hit: true, exact: true, kind: "expr", expr: cleaned, result };
        if (!Number.isFinite(result)) return { hit: true, exact: true, kind: "expr", expr: cleaned, result: null }; // 1/0
      } catch { /* ifadə deyil */ }
    }
  }
  return { hit: false, exact: false };
}

export function mathToText(m) {
  if (!m || !m.hit) return "";
  if (m.kind === "expr" && m.result === null) return `${m.expr.replace(/\*/g, " × ").replace(/\//g, " ÷ ")} — sıfıra bölmə, nəticə yoxdur.`;
  if (m.kind === "constant") return `${m.name} = ${m.approx}${m.name.includes("pi") ? " (π — çevrənin çevrəsinin diametrinə nisbəti)" : ""}.`;
  if (m.kind === "sqrt") return `√${fmt(m.value)} = ${fmt(m.result)}`;
  if (m.kind === "percent_of") return `${fmt(m.part)} / ${fmt(m.whole)} = ${fmt(m.result)}% (yəni ${fmt(m.part)}, ${fmt(m.whole)}-in ${fmt(m.result)}%-idir).`;
  if (m.kind === "percent_calc") return `${fmt(m.base)}-in ${fmt(m.rate)}%-i = ${fmt(m.result)} (${fmt(m.base)} × ${fmt(m.rate)} ÷ 100).`;
  return `${m.expr.replace(/\*/g, " × ").replace(/\//g, " ÷ ")} = ${fmt(m.result)}`;
}

export function isMathQuery(query = "") { return matchMath(query).hit; }
