import { newAgent, sign, authorize } from './agent.mjs';
const API='http://127.0.0.1:4402', UP='http://127.0.0.1:4403';
const agent=newAgent(); await fetch(API+'/__reset'); await fetch(UP+'/__reset',{method:'POST'});
const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air'});   // NO authorizationId
const body=JSON.stringify({amount:250,currency:'USD',merchant:'skyward-air'});
let n=0; for(let i=0;i<50;i++){ const r=await fetch('http://127.0.0.1:4406/book-flight',{method:'POST',headers:{'content-type':'application/json','x-magp-request':JSON.stringify(s)},body}); if(r.status===200)n++; }
const c=await (await fetch(UP+'/__calls')).json();
console.log(`OPT-OUT (AGENTSAFE_REQUIRE_AUTHORIZATION=false): 50 x $250, no authorization -> upstream executed ${c.length} = $${c.length*250} against a $10,000 cap  ${c.length*250>10000?'*** CUMULATIVE BYPASS (as documented)':'blocked'}`);
