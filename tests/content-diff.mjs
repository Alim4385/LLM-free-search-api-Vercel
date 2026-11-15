import fs from "fs";
const runs=[1,2,3].map(n=>JSON.parse(fs.readFileSync(`tests/suite-run${n}.json`,"utf8")));
for(const id of [2,4,1,3,11]){
  console.log(`\n=== Test ${id} content-level diff ===`);
  const sets=runs.map(r=>new Set(r.results.find(x=>x.id===id)?.urls||[]));
  const inter=new Set([...sets[0]].filter(x=>sets[1].has(x)&&sets[2].has(x)));
  const union=new Set([...sets[0],...sets[1],...sets[2]]);
  console.log(`Run1: ${sets[0].size} URL, Run2: ${sets[1].size}, Run3: ${sets[2].size}`);
  console.log(`Kəsişmə (3 run-da da var): ${inter.size} / Union: ${union.size} -> Jaccard: ${(inter.size/union.size||0).toFixed(2)}`);
  console.log(`Ortaq URL-lər: ${[...inter].slice(0,3).join(", ")}`);
  const only1=[...sets[0]].filter(x=>!sets[1].has(x)&&!sets[2].has(x));
  if(only1.length) console.log(`Yalnız Run1-də: ${only1.slice(0,2).join(", ")}`);
}
