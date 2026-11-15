let pass=0, fail=0;
function assert(n,c,e=""){ if(c){pass++;console.log(`✅ ${n}`)} else {fail++;console.log(`❌ ${n} ${e}`)} }

console.log("=== RATE LIMIT (API) ===");
// Fərqli IP simulyasiyası üçün birbaşa çox sorğu göndər (localhost eyni IP olacaq)
let codes=[];
for(let i=0;i<35;i++){
  const r=await fetch("http://localhost:3000/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:"rate test "+i})});
  codes.push(r.status);
  await r.text();
}
const has429 = codes.includes(429);
console.log("Kodlar:", codes.slice(0,5), "...", codes.slice(-5));
assert("35 sorğudan sonra 429 gəlir", has429, codes.join(","));

console.log("\n=== BUILD / FAYL STRUKTURU ===");
import fs from "fs";
assert("package.json var", fs.existsSync("package.json"));
assert("next.config.js var", fs.existsSync("next.config.js"));
assert("app/api/search/route.js var", fs.existsSync("app/api/search/route.js"));
assert("lib/search.js var", fs.existsSync("lib/search.js"));
assert("lib/rank.js var", fs.existsSync("lib/rank.js"));
assert("lib/weather.js var", fs.existsSync("lib/weather.js"));
assert("lib/time.js var", fs.existsSync("lib/time.js"));
assert("lib/currency.js var", fs.existsSync("lib/currency.js"));
assert("lib/tool-schema.json var", fs.existsSync("lib/tool-schema.json"));
assert("README var", fs.existsSync("README.md"));
const pkg = JSON.parse(fs.readFileSync("package.json","utf8"));
assert("next dependency var", !!pkg.dependencies?.next);
assert("linkedom dependency var", !!pkg.dependencies?.linkedom);
assert("readability dependency var", !!pkg.dependencies?.["@mozilla/readability"]);
assert("build script var", !!pkg.scripts?.build);

console.log("\n=== TOOL SCHEMA ===");
const schema = JSON.parse(fs.readFileSync("lib/tool-schema.json","utf8"));
assert("tool adı qaqa_search", schema.name==="qaqa_search");
assert("tool query tələb olunur", schema.parameters.required?.includes("query"));

console.log("\n=== KODDA KEY YOXDUR (key-siz) ===");
let foundKey=false;
for(const f of ["lib/search.js","lib/weather.js","lib/currency.js","lib/time.js","app/api/search/route.js"]){
  const c=fs.readFileSync(f,"utf8");
  if(/api[_-]?key\s*[:=]\s*["'][^"']+["']/i.test(c)) { foundKey=true; console.log("Key tapıldı:",f); }
}
assert("kodda hardcoded API key yoxdur", !foundKey);

console.log(`\nEXTRA NƏTİCƏ: ${pass} keçdi, ${fail} uğursuz`);
