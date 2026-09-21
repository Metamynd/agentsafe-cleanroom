// agent.mjs — the ATTACKER-CONTROLLED side. Generates a real Ed25519 keypair, builds the
// key-in-DID, and signs canonical MAGP messages. Everything here is under the agent's control,
// which is exactly the threat model: the gateway must not trust any of it.
import crypto from 'node:crypto';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){let z=0;while(z<bytes.length&&bytes[z]===0)z++;const d=[];
  for(let i=z;i<bytes.length;i++){let c=bytes[i];for(let j=0;j<d.length;j++){c+=d[j]<<8;d[j]=c%58;c=(c/58)|0;}
    while(c>0){d.push(c%58);c=(c/58)|0;}}
  let o='';for(let k=0;k<z;k++)o+=B58[0];for(let q=d.length-1;q>=0;q--)o+=B58[d[q]];return o;}

export function newAgent(topic='0.0.9681530'){
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ type:'spki', format:'der' }).subarray(-32);   // last 32B = Ed25519 pubkey
  const did = `did:hedera:testnet:z${base58(raw)}_${topic}`;
  return { did, privateKey };
}

// 0.3.3 changed the canonical message: every field is escaped (\\ -> \\\\, | -> \\|) before the
// join, so a value containing a delimiter can no longer shift the field boundaries.
// A later release (#663/#664 in the private monorepo) added `resource` as a genuinely signed
// field, between merchant and nonce — every real request through this suite is resource-less,
// so it always canonicalizes to the same '' a caller who omits the field gets.
const escapeField = (v) => String(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
export const buildAuthMessage = (f) =>
  [f.agentDid, f.action, f.amount, f.currency, f.merchant ?? '', f.resource ?? '', f.nonce, f.issuedAt].map(escapeField).join('|');
/** The pre-0.3.3 unescaped canonicalization, kept to probe delimiter injection + version skew. */
export const buildAuthMessageLegacy = (f) =>
  `${f.agentDid}|${f.action}|${f.amount}|${f.currency}|${f.merchant ?? ''}|${f.nonce}|${f.issuedAt}`;

/** Produce a signed governance header exactly as a legitimate agent would. */
export function sign(agent, { action, amount, currency='USD', merchant, authorizationId, nonce, issuedAt, canon=buildAuthMessage }) {
  const f = {
    agentDid: agent.did, action, amount, currency, merchant,
    nonce: nonce ?? crypto.randomUUID(),
    issuedAt: issuedAt ?? new Date().toISOString(),
  };
  const signature = crypto.sign(null, Buffer.from(canon(f),'utf8'), agent.privateKey).toString('hex');
  // Since MAGP 6.3 (agentsafe-guard 0.13 / mcp-guard 0.10) a request that states NO riskLevel is escalated
  // (CONTEXT_UNVERIFIABLE) rather than read as "not risky" — an agent that omits its risk is indistinguishable from
  // one hiding it. A legitimate agent therefore states an honest one; the attack cases below are unchanged and must
  // still be refused for their own reasons.
  return { ...f, signature, itinerary: { riskLevel: 'low' }, ...(authorizationId ? { authorizationId } : {}) };
}

/** Ask the issuer for a real authorization (the honest path). */
export async function authorize(api, agent, { action, amount, currency='USD', merchant }) {
  const r = await fetch(`${api}/policy/mandate/authorize`, {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ agentDid: agent.did, action, amount, currency, merchant }),
  });
  return (await r.json()).data;
}

/** Send a governed request to the gateway. */
export async function call(gw, signed, body) {
  const r = await fetch(`${gw}/book-flight`, {
    method:'POST',
    headers:{ 'content-type':'application/json', 'x-magp-request': JSON.stringify(signed) },
    body: JSON.stringify(body),
  });
  let j=null; try{ j=await r.json(); }catch{}
  return { status:r.status, decision:r.headers.get('x-agentsafe-decision'), body:j };
}
