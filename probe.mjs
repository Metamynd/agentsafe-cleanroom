import { newAgent, sign, authorize } from './agent.mjs';
const GW='http://127.0.0.1:4401', API='http://127.0.0.1:4402';
const agent=newAgent();
await fetch(API+'/__reset');
const R=[];
// raw call with arbitrary content-type + body
async function raw(signed, body, ct='application/json'){
  const r=await fetch(`${GW}/book-flight`,{method:'POST',
    headers:{'content-type':ct,'x-magp-request':JSON.stringify(signed)}, body});
  let j=null; try{j=await r.json();}catch{}
  return {status:r.status, decision:r.headers.get('x-agentsafe-decision'), body:j};
}
// each probe: sign the CHEAP allowed request, send an EXPENSIVE/forbidden payload in a shape
// the default binder cannot see. If bookFlight() runs (200 + echoed args), binding was bypassed.
async function probe(name, body, ct='application/json'){
  const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await raw(s, body, ct);
  const executed = r.status===200;
  R.push({name, executed, detail:`${r.status} ${r.body?.reasonCode??'EXECUTED'} ${executed?JSON.stringify(r.body):''}`});
  console.log(`${executed?'*** BYPASS':'  blocked '}  ${name}\n            ${R[R.length-1].detail}`);
}

console.log('signed in every case: $250 / skyward-air  (agent %s)\n', agent.did.slice(0,32)+'...');
await probe('P1 nested body {booking:{amount,merchant}}', JSON.stringify({booking:{amount:5000,currency:'USD',merchant:'evil-corp'}}));
await probe('P2 form-encoded body',                        'amount=5000&merchant=evil-corp','application/x-www-form-urlencoded');
await probe('P3 JSON array [{amount,merchant}]',           JSON.stringify([{amount:5000,merchant:'evil-corp'}]));
await probe('P4 capitalized field names',                  JSON.stringify({Amount:5000,Merchant:'evil-corp'}));
await probe('P5 amount omitted, merchant swapped',         JSON.stringify({merchant:'skyward-air',total:5000}));
await probe('P6 empty body (no payload at all)',           '');
await probe('P7 amount as string "250" (type confusion)',  JSON.stringify({amount:'250',currency:'USD',merchant:'skyward-air'}));
await probe('P8 duplicate JSON keys amount 250 then 5000', '{"amount":250,"currency":"USD","merchant":"skyward-air","amount":5000}');

console.log('\n--- authorization cross-use (claim bound to values?) ---');
{ // authorize $250/skyward-air, then sign+send a DIFFERENT but individually-legal request
  const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:100,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await raw(s, JSON.stringify({amount:100,currency:'USD',merchant:'skyward-air'}));
  const ex=r.status===200;
  console.log(`${ex?'*** BYPASS':'  blocked '}  P9 $250 authorization reused for a $100 execution\n            ${r.status} ${r.body?.reasonCode??'EXECUTED'}`);
  R.push({name:'P9 auth amount cross-use', executed:ex});
}
const b=R.filter(x=>x.executed);
console.log(`\n===== ${b.length} bypass(es) found of ${R.length} probes =====`);
b.forEach(x=>console.log('  BYPASS:', x.name));
