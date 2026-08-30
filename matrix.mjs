import crypto from 'node:crypto';
import { newAgent, sign, authorize, call } from './agent.mjs';
const GW='http://127.0.0.1:4401', API='http://127.0.0.1:4402';
const R=[]; const ok=(n,p,d)=>{R.push({n,p,d});console.log(`${p?' PASS':' FAIL'}  ${n}\n        ${d}`);};
const agent = newAgent();
console.log('agent DID:', agent.did, '\n');

// ---------- A. negative paths (regression from 0.1.1 session) ----------
console.log('--- A. negative paths (regression) ---');
{ const r=await fetch(`${GW}/book-flight`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  const b=await r.json(); ok('A1 unsigned request', r.status===401, `${r.status} ${b.reasonCode}`); }
{ const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air'}); s.signature='ab'.repeat(32);
  const r=await call(GW,s,{amount:250,currency:'USD',merchant:'skyward-air'});
  ok('A2 forged signature', r.status===403&&r.body.reasonCode==='SIGNATURE_INVALID', `${r.status} ${r.body.reasonCode}`); }
{ const r=await fetch(`${GW}/refund`,{method:'POST',headers:{'content-type':'application/json','x-magp-request':'{}'},body:'{}'});
  const b=await r.json(); ok('A3 unmatched path (denyByDefault)', r.status===403&&b.reasonCode==='ROUTE_NOT_ALLOWED', `${r.status} ${b.reasonCode}`); }
{ const r=await fetch(`${GW}/book-flight`,{method:'POST',headers:{'content-type':'application/json','x-magp-request':'{}'},body:'{}'});
  const b=await r.json(); ok('A4 empty governance header', r.status===403||r.status===401, `${r.status} ${b.reasonCode}`); }
{ const r=await fetch(`${GW}/book-flight`,{method:'POST',headers:{'content-type':'application/json','x-magp-request':'not-json'},body:'{}'});
  const b=await r.json(); ok('A5 non-JSON governance header', r.status===401||r.status===403, `${r.status} ${b.reasonCode}`); }
{ const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',issuedAt:new Date(Date.now()-9e5).toISOString()});
  const r=await call(GW,s,{amount:250,currency:'USD',merchant:'skyward-air'});
  ok('A6 stale request (>5min)', r.body?.reasonCode==='REQUEST_EXPIRED', `${r.status} ${r.body?.reasonCode}`); }
{ const s=sign(agent,{action:'book-flight',amount:5000,merchant:'skyward-air'});
  const r=await call(GW,s,{amount:5000,currency:'USD',merchant:'skyward-air'});
  // Either code is a correct block: the mandate constraint (SPEND_LIMIT_EXCEEDED) or the
  // starter SOP's own cap rule (SOP_SPEND_CAP), whichever the bundle evaluates first.
  ok('A7 over per-txn cap ($5000>$250)', r.status===403&&['SPEND_LIMIT_EXCEEDED','SOP_SPEND_CAP'].includes(r.body.reasonCode), `${r.status} ${r.body.reasonCode}`); }
{ const s=sign(agent,{action:'book-flight',amount:250,merchant:'evil-corp'});
  const r=await call(GW,s,{amount:250,currency:'USD',merchant:'evil-corp'});
  ok('A8 merchant not allowlisted', r.status===403&&r.body.reasonCode==='MERCHANT_NOT_ALLOWED', `${r.status} ${r.body.reasonCode}`); }

// ---------- B. GAP 1: confused deputy / payload binding ----------
console.log('\n--- B. GAP 1 — confused deputy (sign cheap, execute expensive) ---');
{ const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await call(GW,s,{amount:5000,currency:'USD',merchant:'evil-corp'});   // signed 250/skyward, body 5000/evil
  const blocked = r.status===403 && r.body.reasonCode==='PAYLOAD_NOT_BOUND';
  ok('B1 signed $250/skyward-air, body $5000/evil-corp', blocked, `${r.status} ${r.body?.reasonCode} field=${r.body?.field} decision=${r.decision}`); }
{ const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await call(GW,s,{amount:250,currency:'USD',merchant:'skyward-air'});
  ok('B2 honest path still works (matched payload)', r.status===200, `${r.status} decision=${r.decision} pnr=${r.body?.pnr}`); }
{ const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  const r=await call(GW,s,{amount:250,currency:'EUR',merchant:'skyward-air'});
  ok('B3 currency swap USD->EUR', r.status===403&&r.body.reasonCode==='PAYLOAD_NOT_BOUND', `${r.status} ${r.body?.reasonCode} field=${r.body?.field}`); }

// ---------- C. GAP 2: replay ----------
console.log('\n--- C. GAP 2 — replay of one signed blob ---');
{ const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
  const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
  const body={amount:250,currency:'USD',merchant:'skyward-air'};
  const out=[]; for(let i=0;i<4;i++){ const r=await call(GW,s,body); out.push(`${r.status}/${r.body?.reasonCode??'allow'}`); }
  const first=out[0].startsWith('200'), rest=out.slice(1).every(x=>!x.startsWith('200'));
  ok('C1 same blob x4 — only first executes', first&&rest, out.join('  ')); }

// ---------- D. GAP 3: cumulative spend ----------
console.log('\n--- D. GAP 3 — cumulative spend past the mandate total ---');
{ let allowed=0, executed=0, stop=null;
  for(let i=0;i<60;i++){
    const a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
    if(a.decision!=='allow'){ stop=`issuer stopped at call ${i+1}: ${a.reasonCode} remaining=${a.remaining}`; break; }
    allowed++;
    const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
    const r=await call(GW,s,{amount:250,currency:'USD',merchant:'skyward-air'});
    if(r.status===200) executed++;
  }
  const spent=executed*250;
  ok('D1 spend halts at $10,000 cap', spent<=10000 && stop!==null, `executed=${executed} spent=$${spent} | ${stop}`); }

// ---------- E. forged authorizationId ----------
console.log('\n--- E. authorization forgery ---');
{ const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:'auth_deadbeef99'});
  const r=await call(GW,s,{amount:250,currency:'USD',merchant:'skyward-air'});
  ok('E1 invented authorizationId', r.status!==200, `${r.status} ${r.body?.reasonCode}`); }
{ const s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air'});   // no authorizationId at all
  const r=await call(GW,s,{amount:250,currency:'USD',merchant:'skyward-air'});
  ok('E2 no authorizationId', r.status!==200&&r.body?.reasonCode==='AUTHORIZATION_REQUIRED', `${r.status} ${r.body?.reasonCode}`); }

const p=R.filter(x=>x.p).length;
console.log(`\n===== ${p}/${R.length} passed =====`);
R.filter(x=>!x.p).forEach(x=>console.log('FAILED:', x.n, '->', x.d));
// process.exitCode (not process.exit()) — see gate.mjs for why: a still-settling fetch
// keep-alive socket can make process.exit() crash instead of exiting cleanly on some platforms.
process.exitCode = p===R.length ? 0 : 1; // CI gate: exit 0 only when every case passed
