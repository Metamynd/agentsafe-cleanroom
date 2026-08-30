import { newAgent, sign, authorize } from './agent.mjs';
const GW='http://127.0.0.1:4401', API='http://127.0.0.1:4402', PROXY='http://127.0.0.1:4405', UP='http://127.0.0.1:4403';
const agent=newAgent();
const reset=async()=>{await fetch(API+'/__reset');await fetch(UP+'/__reset',{method:'POST'});};
const upCalls=async()=>(await (await fetch(UP+'/__calls')).json());
async function scaffold(signed,body,ct='application/json'){
  const r=await fetch(`${GW}/book-flight`,{method:'POST',headers:{'content-type':ct,'x-magp-request':JSON.stringify(signed)},body});
  let j=null;try{j=await r.json();}catch{} return {status:r.status,body:j};
}
async function proxy(path,signed,body,ct='application/json'){
  const h={'content-type':ct}; if(signed)h['x-magp-request']=JSON.stringify(signed);
  const r=await fetch(`${PROXY}${path}`,{method:'POST',headers:h,body});
  return {status:r.status,text:await r.text()};
}
const authed=async(over={})=>{const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  return sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId,...over});};
const line=(t)=>console.log('\n=== '+t+' ===');

// ATTACK 1 — decoy-field confused deputy, driven to a REAL upstream through the HARDENED proxy
line('ATTACK 1  decoy field defeats UNBINDABLE, real $5000 charge (proxy: deny+requireAuth ON)');
for (const [name,body] of [
  ['decoy currency + nested booking.amount 5000', {currency:'USD',booking:{amount:5000,merchant:'evil-corp'}}],
  ['decoy merchant(match) + nested amount 5000',  {merchant:'skyward-air',booking:{amount:5000}}],
  ['decoy amount(match 250) + nested surcharge',  {amount:250,extras:{surcharge:4750,merchant:'evil-corp'}}],
]){
  await reset();
  const s=await authed();
  const r=await proxy('/book-flight',s,JSON.stringify(body));
  const c=await upCalls();
  const charged=c.length && /5000|4750/.test(c[0].body);
  console.log(`${charged?'*** BYPASS':'  blocked '} ${name}\n    proxy=${r.status}  upstream got: ${c.length?c[0].body:'(nothing)'}`);
}

// ATTACK 2 — negative amount: does the per-txn cap treat a NEGATIVE charge as "within $250"?
line('ATTACK 2  negative / zero amount vs per-txn cap');
for (const amt of [-5000, 0, -0.01]){
  await reset();
  const a=await authorize(API,agent,{action:'book-flight',amount:amt,merchant:'skyward-air'});
  console.log(`  authorize amount=${amt}: issuer decision=${a.decision} ${a.reasonCode??''} authId=${a.authorizationId?'yes':'no'}`);
  if(a.authorizationId){
    const s=sign(agent,{action:'book-flight',amount:amt,merchant:'skyward-air',authorizationId:a.authorizationId});
    const r=await scaffold(s,JSON.stringify({amount:amt,currency:'USD',merchant:'skyward-air'}));
    console.log(`    scaffold execute amount=${amt}: ${r.status} ${r.body?.reasonCode??'EXECUTED'}`);
  }
}

// ATTACK 3 — freshness uses Math.abs(): a FUTURE-dated request should be rejected but isn't
line('ATTACK 3  future-dated issuedAt (pre-sign ahead of time)');
for (const skewMin of [+4, +10, -4]){
  const s=await authed({issuedAt:new Date(Date.now()+skewMin*60000).toISOString()});
  const r=await scaffold(s,JSON.stringify({amount:250,currency:'USD',merchant:'skyward-air'}));
  console.log(`  issuedAt ${skewMin>0?'+':''}${skewMin}min: ${r.status} ${r.body?.reasonCode??'EXECUTED'} ${r.status===200?'*** ACCEPTED':''}`);
}

// ATTACK 4 — amount coercion: whitespace / exponent / hex strings vs numeric 250
line('ATTACK 4  amount type-coercion at the binder (signed 250, body variants)');
for (const v of ['250','250.00',' 250','2.5e2','0xFA','250abc',250.0000001]){
  const s=await authed();
  const r=await scaffold(s,JSON.stringify({amount:v,currency:'USD',merchant:'skyward-air'}));
  console.log(`  body amount=${JSON.stringify(v)}: ${r.status} ${r.body?.reasonCode??'EXECUTED'}`);
}

// ATTACK 5 — merchant whitespace/case an upstream may normalize back to the allowed one
line('ATTACK 5  merchant near-miss (signed skyward-air)');
for (const m of ['skyward-air ','SKYWARD-AIR','skyward-air\t','skyward-air\n']){
  const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:m});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:m,authorizationId:a.authorizationId});
  const r=await scaffold(s,JSON.stringify({amount:250,currency:'USD',merchant:m}));
  console.log(`  merchant=${JSON.stringify(m)}: issuer=${a.decision}/${a.reasonCode??''} scaffold=${r.status} ${r.body?.reasonCode??'EXECUTED'}`);
}
