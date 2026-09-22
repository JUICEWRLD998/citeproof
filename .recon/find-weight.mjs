import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PORT=9334, profile=join(tmpdir(),`cp-find-${Date.now()}`); mkdirSync(profile,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const bin="C:/Program Files/Google/Chrome/Application/chrome.exe";
const proc=spawn(bin,["--headless=new","--disable-gpu",`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,"--window-size=1280,1700","about:blank"],{stdio:"ignore"});
let ws=null;
for(let i=0;i<80;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=l.find(t=>t.type==="page");if(p){ws=p.webSocketDebuggerUrl;break}}catch{}await sleep(250)}
const sock=new WebSocket(ws); let id=0; const pend=new Map(); const evs=new Map();
await new Promise(r=>sock.addEventListener("open",r));
sock.addEventListener("message",e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}else if(m.method&&evs.has(m.method)){for(const f of evs.get(m.method))f(m.params);evs.delete(m.method)}});
const send=(method,params={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});sock.send(JSON.stringify({id:i,method,params}))});
const once=m=>new Promise(r=>{if(!evs.has(m))evs.set(m,[]);evs.get(m).push(r)});
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"light"}]});
const l=once("Page.loadEventFired"); await send("Page.navigate",{url:"http://localhost:3100/"}); await l; await sleep(1200);
const r=await send("Runtime.evaluate",{returnByValue:true,expression:`(()=>{
  const hits=[];
  for(const el of document.querySelectorAll('*')){
    const cs=getComputedStyle(el);
    if(!/Mono/i.test(cs.fontFamily) && cs.fontWeight==='500' && el.textContent && el.textContent.trim()){
      hits.push({tag:el.tagName,cls:el.className&&el.className.baseVal!==undefined?el.className.baseVal:String(el.className||''),text:el.textContent.trim().slice(0,70),family:cs.fontFamily.slice(0,40),size:cs.fontSize,parentTag:el.parentElement?.tagName,parentCls:String(el.parentElement?.className||'').slice(0,40)});
    }
  }
  return hits;
})()`});
console.log(JSON.stringify(r.result.value,null,2));
sock.close(); proc.kill(); await sleep(200); try{rmSync(profile,{recursive:true,force:true})}catch{}
