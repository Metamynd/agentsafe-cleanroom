// proxy-probe2 — the packaged proxy with AGENTSAFE_DENY_BY_DEFAULT=true (:4405),
// plus the decoy-field binder bypass driven all the way to a REAL upstream.
import { newAgent, sign, authorize } from './agent.mjs';
const API='http://127.0.0.1:4402', UP='http://127.0.0.1:4403';
const agent=newAgent();
await fetch(API+'/__reset'); await fetch(UP+'/__reset',{method:'POST'});
const calls=async()=>(await (await fetch(UP+'/__calls')).json());
async function send(port,path,signed,body,ct='application/json'){
  const h={'content-type':ct}; if(signed) h['x-magp-request']=JSON.stringify(signed);
  const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:h,body});
  return {status:r.status, text:await r.text()};
}
// S1 — undeclared route under deny-by-default
await fetch(UP+'/__reset',{method:'POST'});
let r=await send(4405,'/transfer-funds',null,JSON.stringify({amount:999999}));
let c=await calls();
console.log(`S1 UNSIGNED POST /transfer-funds, DENY_BY_DEFAULT=true -> ${r.status} ${r.text.slice(0,90)}`);
console.log(`   upstream executed ${c.length}  ${c.length?'*** PASSTHROUGH':'blocked'}\n`);

// S2 — nested JSON confused deputy through the proxy (should be PAYLOAD_UNBINDABLE now)
await fetch(UP+'/__reset',{method:'POST'});
let a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
let s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
r=await send(4405,'/book-flight',s,JSON.stringify({booking:{amount:5000,merchant:'evil-corp'}}));
c=await calls();
console.log(`S2 signed $250/skyward-air, NESTED body $5000/evil-corp -> ${r.status} ${r.text.slice(0,90)}`);
console.log(`   upstream received: ${c.length?JSON.stringify(c[0].body):'nothing'}  ${c.length?'*** CONFUSED DEPUTY':'blocked'}\n`);

// S3 — same attack + one matching decoy governed field
await fetch(UP+'/__reset',{method:'POST'});
a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
r=await send(4405,'/book-flight',s,JSON.stringify({currency:'USD',booking:{amount:5000,merchant:'evil-corp'}}));
c=await calls();
console.log(`S3 same, PLUS decoy top-level "currency":"USD" -> ${r.status} ${r.text.slice(0,90)}`);
console.log(`   upstream received: ${c.length?JSON.stringify(c[0].body):'nothing'}  ${c.length?'*** CONFUSED DEPUTY':'blocked'}\n`);

// S4 — replay under deny-by-default proxy (requireAuthorization default true)
await fetch(UP+'/__reset',{method:'POST'});
a=await authorize(API,agent,{action:'book-flight',amount:250,merchant:'skyward-air'});
s=sign(agent,{action:'book-flight',amount:250,merchant:'skyward-air',authorizationId:a.authorizationId});
const body=JSON.stringify({amount:250,currency:'USD',merchant:'skyward-air'});
const st=[]; for(let i=0;i<5;i++) st.push((await send(4405,'/book-flight',s,body)).status);
c=await calls();
console.log(`S4 replay x5 -> ${st.join(',')}; upstream executed ${c.length}  ${c.length>1?'*** REPLAY':'blocked'}`);

// S5 — opt OUT explicitly, confirm the old behaviour is what the env var restores
