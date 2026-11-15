import fs from "fs";
const runs=[1,2,3].map(n=>JSON.parse(fs.readFileSync(`tests/suite-run${n}.json`,"utf8")));
console.log("| Test | Run1 n/dom/score/lat | Run2 | Run3 | Sabit? |");
console.log("|---|---|---|---|---|");
for(let i=0;i<11;i++){
  const r1=runs[0].results[i], r2=runs[1].results[i], r3=runs[2].results[i];
  const fmt=r=>`${r.result_count}/${r.unique_domains}/${r.avg_score}/${r.latency_ms}ms`;
  const sameUrls = JSON.stringify(r1.urls)===JSON.stringify(r2.urls) && JSON.stringify(r2.urls)===JSON.stringify(r3.urls);
  const stable = sameUrls ? "✅ Sabit" : (r1.result_count===r2.result_count && r2.result_count===r3.result_count ? "⚠️ Say sabit, URL fərqli" : "❌ Dəyişkən");
  console.log(`| ${r1.id} ${r1.query.slice(0,30)} | ${fmt(r1)} | ${fmt(r2)} | ${fmt(r3)} | ${stable} |`);
  if(!sameUrls){
    console.log(`   Run1 URLs: ${r1.urls.slice(0,2).join(", ")}`);
    console.log(`   Run2 URLs: ${r2.urls.slice(0,2).join(", ")}`);
    console.log(`   Run3 URLs: ${r3.urls.slice(0,2).join(", ")}`);
  }
}
