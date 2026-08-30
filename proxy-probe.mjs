import { newAgent, sign, authorize } from './agent.mjs';
const PROXY='http://127.0.0.1:4404', API='http://127.0.0.1:4402', UP='http://127.0.0.1:4403';
const agent=newAgent();
await fetch(API+'/__reset'); await fetch(UP+'/__reset',{method:'POST'});
const send=async(signed,body,ct='application/json')=>{
  const r=await fetch(`${PROXY}/book-flight`,{method:'POST',headers:{'content-type':ct,'x-magp-request':JSON.stringify(signed)},body});
  let t=await r.text(); return {status:r.status,body:t};
};
const upstreamCalls=async()=>(await (await fetch(UP+'/__calls')).json());

console.log('=== packaged reverse proxy @metamynd/agentsafe-http-gateway/server.mjs ===\n');

// 1. REPLAY — no requireAuthorization in the packaged proxy
const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
const body=JSON.stringify({amount:250,currency:'USD',merchant:'skyward-air'});
const res=[]; for(let i=0;i<5;i++) res.push((await send(s,body)).status);
let c=await upstreamCalls();
console.log(`R1 replay same signed blob x5 -> statuses ${res.join(',')}`);
console.log(`   upstream EXECUTED ${c.length} time(s)  ${c.length>1?'*** REPLAY BYPASS':'blocked'}\n`);

// 2. CUMULATIVE SPEND — issuer never consulted for a claim
await fetch(UP+'/__reset',{method:'POST'});
let n=0; for(let i=0;i<50;i++){
  const sg=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  if((await send(sg,body)).status===200) n++;
}
c=await upstreamCalls();
console.log(`R2 50 x $250 with NO authorization at all -> upstream executed ${c.length}, $${c.length*250}`);
console.log(`   mandate cap is $10,000  ${c.length*250>10000?'*** CUMULATIVE BYPASS':'blocked'}\n`);

// 3. UNMATCHED ROUTE — no denyByDefault in the packaged proxy
await fetch(UP+'/__reset',{method:'POST'});
const r3=await fetch(`${PROXY}/transfer-funds`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({amount:999999})});
c=await upstreamCalls();
console.log(`R3 UNSIGNED POST /transfer-funds (no route declared) -> ${r3.status}`);
console.log(`   upstream executed ${c.length}  ${c.length>0?'*** UNGOVERNED PASSTHROUGH':'blocked'}\n`);

// 4. OPAQUE BODY forwarded verbatim upstream
await fetch(UP+'/__reset',{method:'POST'});
const a4=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
const s4=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a4.authorizationId});
await send(s4,'amount=5000&merchant=evil-corp','application/x-www-form-urlencoded');
c=await upstreamCalls();
console.log(`R4 signed $250/skyward-air, form-encoded body $5000/evil-corp`);
console.log(`   upstream received: ${c.length?JSON.stringify(c[0].body):'nothing'}  ${c.length&&c[0].body.includes('5000')?'*** CONFUSED DEPUTY':'blocked'}`);
