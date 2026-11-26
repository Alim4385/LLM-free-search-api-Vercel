// v129: sorğu izləmə (debug trace). Məqsəd: "namizəd X niyə nəticədə yoxdur?" sualına BİR sorğuda cavab.
// Aktivləşmə: sorğunun sonuna `#debug` əlavə et (MCP alətinin sxemi dəyişməsə belə işləyir) və ya `debug=1` / body.debug.
// Debug sorğuları keşi keçir. Çıxış: meta.debug = { terms, providers, stages, candidates, dropped_total }.
//
// Metod: pipeline-ın əsas nöqtələrində `snap(stage, list, why)` — əvvəlki siyahı ilə indiki siyahının FƏRQİ düşənlər sayılır
// (kodun daxili filtrlərinə toxunmadan). `drop()` — səbəbi dəqiq bilinən yerlər (fetch dövrü). `zero()` — scoreResult-un
// 0 verdiyi dəqiq səbəb. `final()` — nəticəyə düşənləri rank ilə işarələyir, qalan "alive" olanları "unknown_cut" edir.
const round = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : null);
const keyOf = (r) => String((r && r.url) || "");

export function createTrace() {
  const cand = new Map();   // url -> record
  const stages = [];
  const zeros = new Map();  // url -> reason scoreResult returned 0
  let prev = null;          // Set of urls alive after the previous snapshot

  const rec = (r) => {
    const k = keyOf(r);
    if (!k) return null;
    let c = cand.get(k);
    if (!c) {
      c = { url: k, t: String((r && r.title) || "").replace(/\s+/g, " ").slice(0, 70) || undefined, src: (r && r.source) || null, providers: (r && Array.isArray(r.providers)) ? r.providers : undefined, status: "alive", score: null };
      cand.set(k, c);
    }
    return c;
  };

  return {
    raw(list) {
      for (const r of list || []) rec(r);
      prev = new Set((list || []).map(keyOf).filter(Boolean));
      stages.push({ stage: "raw_candidates", out: prev.size });
    },
    zero(url, why) { if (url && why) zeros.set(String(url), why); },
    scores(list) {
      for (const r of list || []) {
        const c = rec(r);
        if (!c) continue;
        c.score = round(r.score);
        const z = zeros.get(keyOf(r));
        if (z) c.zero = z; else delete c.zero;
      }
    },
    snap(stage, list, why) {
      const cur = new Set((list || []).map(keyOf).filter(Boolean));
      for (const r of list || []) rec(r);
      let dropped = 0, revived = 0;
      if (prev) {
        for (const u of prev) {
          if (cur.has(u)) continue;
          const c = cand.get(u);
          if (c && c.status === "alive") {
            c.status = "dropped"; c.stage = stage;
            c.why = c.zero ? `${why || ""}${why ? "; " : ""}zero:${c.zero}` : (why || null);
            dropped++;
          }
        }
        for (const u of cur) {
          const c = cand.get(u);
          if (c && c.status === "dropped") { c.status = "alive"; c.revived = stage; delete c.stage; delete c.why; revived++; }
        }
      }
      stages.push({ stage, in: prev ? prev.size : undefined, out: cur.size, dropped, ...(revived ? { revived } : {}) });
      prev = cur;
    },
    drop(url, stage, why) {
      const c = cand.get(String(url)) || rec({ url });
      if (!c) return;
      c.status = "dropped"; c.stage = stage; c.why = why || null;
    },
    final(list) {
      (list || []).forEach((r, i) => {
        const c = rec(r);
        if (!c) return;
        c.status = "kept"; c.rank = i + 1; c.final_score = round(r.score);
        delete c.stage; delete c.why;
      });
      for (const c of cand.values()) {
        if (c.status === "alive") { c.status = "dropped"; c.stage = "unknown_cut"; c.why = "not in final results (maxResults cut / freshness / limits)"; }
      }
    },
    toJSON(extra = {}, maxCandidates = 90) {
      const all = [...cand.values()];
      const kept = all.filter((c) => c.status === "kept").sort((a, b) => a.rank - b.rank);
      const dropped = all.filter((c) => c.status === "dropped").sort((a, b) => (b.score ?? -99) - (a.score ?? -99));
      const trim = (c) => { const o = { ...c }; if (o.url.length > 110) o.url = o.url.slice(0, 107) + "..."; return o; };
      return {
        ...extra,
        stages,
        candidates: [...kept, ...dropped].slice(0, maxCandidates).map(trim),
        dropped_total: dropped.length,
        candidates_total: all.length
      };
    }
  };
}
