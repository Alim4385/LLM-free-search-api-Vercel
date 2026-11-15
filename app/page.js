"use client";
import { useState } from "react";

export default function Home() {
  const [q, setQ] = useState("Bakı hava bu gün necədir?");
  const [out, setOut] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true); setOut("");
    try {
      const r = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, max_results: 5 }) });
      const j = await r.json();
      setOut(JSON.stringify(j, null, 2));
    } catch (e) { setOut("Xəta: " + e.message); }
    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 20 }}>
      <h1>🔍 Qaqa Search API</h1>
      <p>Bu, LLM-in çağırıb istifadə edəcəyi axtarış API-sidir. Key lazım deyil. Vercel-də işləyir.</p>
      <div style={{ display: "flex", gap: 8, margin: "20px 0" }}>
        <input value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, padding: 12, borderRadius: 8, border: "1px solid #333", background: "#1a1d24", color: "#fff" }} placeholder="Sual yaz..." />
        <button onClick={run} disabled={loading} style={{ padding: "12px 20px", borderRadius: 8, border: 0, background: "#4f8cff", color: "#fff", cursor: "pointer" }}>{loading ? "..." : "Axtar"}</button>
      </div>
      <p style={{ color: "#999", fontSize: 13 }}>POST /api/search {"{ query: \"...\", max_results: 5, format: \"json\" }"} &nbsp;|&nbsp; GET /api/search?q=...</p>
      <p style={{ color: "#999", fontSize: 13 }}>LLM tool şeması: <code>lib/tool-schema.json</code></p>
      {out && <pre style={{ background: "#1a1d24", padding: 16, borderRadius: 8, overflow: "auto", maxHeight: 600, fontSize: 12 }}>{out}</pre>}
    </main>
  );
}
