// Does a route-level bind() actually close the nested-body confused deputy?
import { createHttpGateway } from './gateway/node_modules/@metamynd/agentsafe-http-gateway/gateway.mjs';
let executed=null;
const guard={ verifyRequest: async()=>({decision:'allow',reasonCode:'AUTHORIZED'}) };
const forward=async(req)=>{ executed=JSON.parse(req.rawBody); return {status:200,body:{ok:true}}; };
const signed={agentDid:'did:x',action:'book-flight',amount:250,currency:'USD',merchant:'skyward-air',nonce:'n',issuedAt:new Date().toISOString(),signature:'s'};
const mk=(routes)=>createHttpGateway({guard,routes,forward,denyByDefault:true});
const req=(body)=>({method:'POST',path:'/book-flight',headers:{'x-magp-request':JSON.stringify(signed)},rawBody:Buffer.from(body)});
const nested=JSON.stringify({booking:{amount:5000,currency:'USD',merchant:'evil-corp'}});

executed=null;
let r=await mk([{method:'POST',path:'/book-flight',action:'book-flight'}])(req(nested));
console.log(`default binder      -> ${r.status} ${r.body?.reasonCode??'FORWARDED'}  tool ran with: ${JSON.stringify(executed)}`);

executed=null;
r=await mk([{method:'POST',path:'/book-flight',action:'book-flight',
  bind:(q)=>{const b=JSON.parse(q.rawBody).booking??{};return {amount:b.amount,currency:b.currency,merchant:b.merchant};}}])(req(nested));
console.log(`route-level bind()  -> ${r.status} ${r.body?.reasonCode??'FORWARDED'} field=${r.body?.field}  tool ran with: ${JSON.stringify(executed)}`);
