const UA="lexhack-recon/0.1";
const r=await fetch("https://static.case.law/us/347/cases/0483-01.json",{headers:{"User-Agent":UA}});
const c=await r.json();
const t=c.casebody.opinions.map(o=>o.text).join("\n");
const log=[];
log.push("ocr_confidence: "+c.analysis?.ocr_confidence);
log.push("char_count: "+c.analysis?.char_count+"  text len: "+t.length);
// find the artifact and print REAL bytes
const i=t.indexOf("s finding");
log.push('\n=== raw bytes around "s finding" (idx '+i+') ===');
log.push(JSON.stringify(t.slice(i-160,i+120)));
log.push("\nchar codes:", [...t.slice(i-3,i+2)].map(ch=>ch.charCodeAt(0)+"("+JSON.stringify(ch)+")").join(" "));
// candidate reconstructions
log.push("\n=== candidate quote checks (normalised) ===");
const norm=s=>s.normalize("NFC").replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"').replace(/\s+/g," ").toLowerCase();
const N=norm(t);
for(const q of [
  "this finding is amply supported by modern authority",
  "his finding is amply supported by modern authority",
  "finding is amply supported by modern authority",
  "separate educational facilities are inherently unequal",
  "Separate educational facilities are inherently unequal",
]){
  log.push(`  ${N.includes(norm(q))?"FOUND  ":"ABSENT "} "${q}"`);
}
// raw (unnormalised) checks - the naive matcher's behaviour
log.push("\n=== naive case-sensitive RAW checks (what a careless tool does) ===");
for(const q of ["separate educational facilities are inherently unequal","Separate educational facilities are inherently unequal"]){
  log.push(`  ${t.includes(q)?"FOUND  ":"ABSENT "} "${q}"`);
}
console.log(log.join("\n"));
