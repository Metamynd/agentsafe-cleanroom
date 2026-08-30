// probe2 — does the 0.3.0 UNBINDABLE sentinel survive a DECOY governed field?
// defaultBindPayload returns UNBINDABLE only when NO governed field is visible at top level.
// One matching decoy field makes out non-empty -> binds only that field -> the rest rides free.
import { newAgent, sign, authorize } from './agent.mjs';
const GW='http://127.0.0.1:4401', API='http://127.0.0.1:4402';
const agent=newAgent(); await fetch(API+'/__reset');
const R=[];
async function probe(name, body, ct='application/json'){
  const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await fetch(`${GW}/book-flight`,{method:'POST',headers:{'content-type':ct,'x-magp-request':JSON.stringify(s)},body});
  let j=null; try{j=await r.json();}catch{}
  const ex=r.status===200;
  R.push({name,ex});
  console.log(`${ex?'*** BYPASS':'  blocked '}  ${name}\n            ${r.status} ${j?.reasonCode??'EXECUTED'} ${ex?JSON.stringify(j):''}`);
}
console.log('signed in every case: $250 / skyward-air\n');
await probe('Q1 decoy currency + nested {booking:{amount:5000,merchant:evil-corp}}',
  JSON.stringify({currency:'USD', booking:{amount:5000,merchant:'evil-corp'}}));
await probe('Q2 decoy merchant(match) + nested amount 5000',
  JSON.stringify({merchant:'skyward-air', booking:{amount:5000}}));
await probe('Q3 decoy currency + renamed total:5000, merchant Evil',
  JSON.stringify({currency:'USD', total:5000, Merchant:'evil-corp'}));
await probe('Q4 decoy amount(match 250) + nested real charge 5000',
  JSON.stringify({amount:250, extras:{surcharge:4750, merchant:'evil-corp'}}));
await probe('Q5 amount:null (explicit null, not undefined)',
  JSON.stringify({amount:null, currency:'USD', merchant:'skyward-air', real_amount:5000}));
await probe('Q6 JSON array WITH a top-level-ish decoy (array has no keys)',
  JSON.stringify([{amount:250},{amount:5000,merchant:'evil-corp'}]));
console.log(`\n===== ${R.filter(x=>x.ex).length} bypass(es) of ${R.length} =====`);
