// mock-issuer.mjs — stands in for metamynd.ai/api/v1. Mirrors the STATEFUL gate semantics
// verified against the real issuer on 2026-08-29: atomic cumulative reservation + single-use
// authorization claims. Lets the full matrix run with no credentials and no KYB.
import http from 'node:http';

const PER_TXN = 250, CUMULATIVE_CAP = 10000, ALLOWED = ['skyward-air'];
export const state = { reserved: 0, auths: new Map() };

function bundle(agentDid) {
  return {
    data: {
      subject: agentDid,
      standards: [],
      // The starter SOP a freshly-provisioned 0.7.7 agent now carries (harnessDefaultSop /
      // the platform's defaultSopDocument). Serving [] here would test a bundle no real
      // provisioned agent has. Set MOCK_NO_SOP=1 to get the old empty-SOP bundle back.
      sops: process.env.MOCK_NO_SOP ? [] : [{ id: 'starter', document: { molecules: [
        { id:'amount-known', name:'Amount must be determinable', combinator:'any', atoms:[{id:'a0',predicate:'amount-unknown'}], decision:'block', reasonCode:'AMOUNT_NOT_DETERMINABLE' },
        { id:'cap',    name:'Per-transaction cap', combinator:'any', atoms:[{id:'a1',predicate:'amount-over',config:{limit:PER_TXN}}], decision:'block', reasonCode:'SOP_SPEND_CAP' },
        { id:'review', name:'High-risk review',    combinator:'any', atoms:[{id:'a2',predicate:'risk-at-or-above',config:{level:'high'}}], decision:'escalate', reasonCode:'RISK_REVIEW' },
      ] } }],
      mandates: [{
        action: 'book-flight',
        document: {
          target: 'book-flight',
          permission: [{
            target: 'book-flight',
            constraint: [
              { leftOperand: 'mm:payAmount',      operator: 'lteq',    rightOperand: PER_TXN },
              { leftOperand: 'mm:cumulativeSpend',operator: 'lteq',    rightOperand: CUMULATIVE_CAP },
              { leftOperand: 'mm:merchant',       operator: 'isAnyOf', rightOperand: ALLOWED },
            ],
          }],
        },
      }],
    },
    contained: null,
    operatingMode: { mode: 'AUTONOMOUS' },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, obj) => { res.writeHead(code, {'content-type':'application/json'}); res.end(JSON.stringify(obj)); };
  let raw = ''; for await (const c of req) raw += c;

  // policy bundle
  let m = url.pathname.match(/^\/policy\/bundle\/(.+)$/);
  if (m && req.method === 'GET') return send(200, bundle(decodeURIComponent(m[1])));

  // issue an authorization (the agent-side guard.authorize()) — atomic reservation
  if (url.pathname === '/policy/mandate/authorize' && req.method === 'POST') {
    const b = JSON.parse(raw || '{}');
    const amt = Number(b.amount || 0);
    if (amt > PER_TXN) return send(200, { data:{ decision:'block', reasonCode:'SPEND_LIMIT_EXCEEDED', remaining: CUMULATIVE_CAP-state.reserved }});
    if (!ALLOWED.includes(b.merchant)) return send(200, { data:{ decision:'block', reasonCode:'MERCHANT_NOT_ALLOWED' }});
    if (state.reserved + amt > CUMULATIVE_CAP)
      return send(200, { data:{ decision:'block', reasonCode:'SPEND_LIMIT_EXCEEDED', remaining: CUMULATIVE_CAP-state.reserved }});
    state.reserved += amt;                                  // reserve on ALLOW only
    const id = 'auth_' + Math.random().toString(36).slice(2, 12);
    state.auths.set(id, { claimed:false, agentDid:b.agentDid, amount:amt, currency:b.currency||'USD', merchant:b.merchant });
    return send(200, { data:{ decision:'allow', reasonCode:'AUTHORIZED', authorizationId:id, remaining: CUMULATIVE_CAP-state.reserved }});
  }

  // single-use claim (what requireAuthorization calls)
  m = url.pathname.match(/^\/policy\/mandate\/authorize\/(.+)\/effect\/dispatching$/);
  if (m && req.method === 'POST') {
    const a = state.auths.get(decodeURIComponent(m[1]));
    if (!a) return send(404, { message:'AUTHORIZATION_NOT_FOUND' });
    if (a.claimed) return send(409, { message:'REPLAY_DETECTED' });   // single use
    a.claimed = true;
    return send(200, { data:{ agentDid:a.agentDid, amount:a.amount, currency:a.currency, merchant:a.merchant }});
  }

  if (url.pathname === '/__reset') { state.reserved = 0; state.auths.clear(); return send(200, { reset: true }); }
  if (url.pathname === '/__state') return send(200, { reserved: state.reserved, auths: state.auths.size });
  send(404, { message:'NOT_FOUND' });
});
server.listen(4402, () => console.log('[mock-issuer] :4402  per-txn=%d cap=%d allowed=%s', PER_TXN, CUMULATIVE_CAP, ALLOWED));
