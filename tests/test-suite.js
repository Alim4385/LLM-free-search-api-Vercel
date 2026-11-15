// Regression test suite - DeepSeek təklifi: 11 test, hər dəfə eyni sorğular, nəticə JSON-a
const tests=[
  {id:1, q:"LLM"},
  {id:2, q:"LLM üçün axtarış motorunda nəticələrin JSON formatı necə olmalıdır"},
  {id:3, q:"LLM axtarış motoru necə qurulur?"},
  {id:4, q:"retrieval augmented generation (RAG) search API"},
  {id:5, q:"LLM search engine Azərbaycan dilində"},
  {id:6, q:'"search query format for LLM"'},
  {id:7, q:"LLM axtariş motoru"},
  {id:8, q:"zzzzzlllmsearch"},
  {id:9, q:"LLM search API JSON response format test"},
  {id:10, q:"LLM üçün axtarış motorunda nəticələr ən azı 5 olmalıdır və hər biri başlıq, URL və snippet ehtiva etməlidir"},
  {id:11, q:"LLM axtarış"},
];
const runNum = process.argv[2] || "1";
// Warmup: server soyuq başlayır, ilk sorğu uğursuz ola bilər (cold start)
// Health + dummy search (route bundle-u yükləyir, cold start-ı udur)
try { await fetch("http://localhost:3000/api/health"); } catch {}
await new Promise(r => setTimeout(r, 1500));
try {
  await fetch("http://localhost:3000/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:"warmup",max_results:1}),signal:AbortSignal.timeout(20000)});
} catch {}
await new Promise(r => setTimeout(r, 500));
const results=[];
for(const t of tests){
  const t0=Date.now();
  try{
    let r, j;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        r = await fetch("http://localhost:3000/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:t.q,max_results:5}),signal:AbortSignal.timeout(15000)});
        j = await r.json();
        break;
      } catch (e) {
        if (attempt === 1) throw e;
        await new Promise(rr => setTimeout(rr, 1000));
      }
    }
    const ms=Date.now()-t0;
    const domains=[...new Set((j.results||[]).map(x=>{try{return new URL(x.url).hostname}catch{return x.url}}))];
    const avgScore=j.results?.length?+(j.results.reduce((s,x)=>s+(x.score||0),0)/j.results.length).toFixed(1):null;
    results.push({
      id:t.id, query:t.q, status:r.status, latency_ms:ms,
      result_count:j.results?.length||0, unique_domains:domains.length, domains,
      avg_score:avgScore, intent:j.intent, reason:j.reason||null,
      providers:j.meta?.providers_used||[], provider_errors:j.meta?.provider_errors||{},
      cached:j.meta?.cached||false,
      urls:(j.results||[]).map(x=>x.url), titles:(j.results||[]).map(x=>x.title),
      scores:(j.results||[]).map(x=>x.score)
    });
    console.log(`Test ${t.id}: n=${j.results?.length||0} domains=${domains.length} avgScore=${avgScore} latency=${ms}ms providers=${(j.meta?.providers_used||[]).join(",")} cached=${j.meta?.cached}`);
  }catch(e){
    results.push({id:t.id, query:t.q, error:e.message});
    console.log(`Test ${t.id}: XƏTA ${e.message}`);
  }
  await new Promise(r=>setTimeout(r,600));
}
import fs from "fs";
fs.writeFileSync(`tests/suite-run${runNum}.json`, JSON.stringify({run:runNum, time:new Date().toISOString(), results}, null, 2));
console.log(`\nRun ${runNum} yazıldı: tests/suite-run${runNum}.json`);
