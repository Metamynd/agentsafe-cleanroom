// gate.mjs — mechanical, exit-code CI check for the two NEW findings from the 2026-08-30 run
// (attack4.mjs / unit-currency.mjs), in the same style as matrix.mjs's original six.
//
// This is deliberately NOT a grep over the narrative attack*.mjs scripts' stdout: several of
// them print "*** " markers for a DELIBERATELY historical/comparative bad outcome (e.g.
// attack3.mjs's pre-0.3.3 canonicalization collision check, which is SUPPOSED to say "*** YES"
// — that's the point of showing it) rather than a live regression on the CURRENT code path. A
// gate that fails CI has to assert specific, unambiguous, CURRENT outcomes — same discipline
// matrix.mjs already uses — not pattern-match free-form exploratory output.
//
//   node gate.mjs   → exit 0 when every case below still holds; exit 1 (and a "FAILED:" line
//                      naming which one) the moment a fix regresses.
import { newAgent, sign, authorize, call } from './agent.mjs';

const GW = 'http://127.0.0.1:4401', API = 'http://127.0.0.1:4402';
const agent = newAgent();
const R = [];
const ok = (n, p, d) => { R.push({ n, p, d }); console.log(`${p ? ' PASS' : ' FAIL'}  ${n}\n        ${d}`); };

async function reset() { await fetch(`${API}/__reset`); }

// ---------- G. NEW-1 — signed amount:0 disables amount binding (attack4.mjs, HIGH) ----------
console.log('--- G. NEW-1 — signed amount:0 must not disable amount binding ---');
{
  await reset();
  const a = await authorize(API, agent, { action: 'book-flight', amount: 0, merchant: 'skyward-air' });
  const s = sign(agent, { action: 'book-flight', amount: 0, merchant: 'skyward-air', authorizationId: a.authorizationId });
  // Real amount hidden one level down — exactly the shape retest#1/attack4 exploited when
  // amount:0 dropped `amount` out of the binder's required set.
  const r = await call(GW, s, { merchant: 'skyward-air', booking: { amount: 5000 } });
  ok('G1 signed $0, real $5000 nested in the body -> still refused', r.status !== 200, `${r.status} ${r.body?.reasonCode ?? 'FORWARDED'}`);
}
{
  await reset();
  // Control: the identical nested shape signed at a real, non-zero amount was ALREADY refused
  // before this fix — if this ever starts passing (200), the binder itself broke generally,
  // which is a more basic regression than G1's specific amount:0 case.
  const a = await authorize(API, agent, { action: 'book-flight', amount: 250, merchant: 'skyward-air' });
  const s = sign(agent, { action: 'book-flight', amount: 250, merchant: 'skyward-air', authorizationId: a.authorizationId });
  const r = await call(GW, s, { merchant: 'skyward-air', booking: { amount: 5000 } });
  ok('G2 control: signed $250, real $5000 nested -> still refused', r.status !== 200, `${r.status} ${r.body?.reasonCode ?? 'FORWARDED'}`);
}
{
  await reset();
  // A genuinely honest amount:0 request (body ALSO declares amount:0) must still be allowed —
  // the fix must not have overcorrected into refusing every zero-amount call outright.
  const a = await authorize(API, agent, { action: 'book-flight', amount: 0, merchant: 'skyward-air' });
  const s = sign(agent, { action: 'book-flight', amount: 0, merchant: 'skyward-air', authorizationId: a.authorizationId });
  const r = await call(GW, s, { amount: 0, currency: 'USD', merchant: 'skyward-air' });
  ok('G3 honest amount:0 (body matches) -> still allowed', r.status === 200, `${r.status} decision=${r.decision}`);
}

// ---------- H. NEW-2 — unit-bearing PROHIBITION must not fail open on a currency mismatch
//                (unit-currency.mjs, MED, a 0.3.3 regression) ----------
console.log('\n--- H. NEW-2 — a unit-bearing PROHIBITION must still fire on a currency mismatch ---');
{
  const { evaluateMandate } = await import('./gateway/node_modules/@metamynd/agentsafe-mcp-guard/policy-core.mjs');
  const mandate = {
    target: 'book-flight',
    prohibition: [{ target: 'book-flight', reasonCode: 'BIG_SPEND_PROHIBITED',
      constraint: [{ leftOperand: 'mm:payAmount', operator: 'gteq', rightOperand: 1000, unit: 'USD' }] }],
    permission: [{ target: 'book-flight',
      constraint: [{ leftOperand: 'mm:merchant', operator: 'isAnyOf', rightOperand: ['skyward-air'] }] }],
  };
  const run = (amount, currency) => evaluateMandate(mandate, { target: 'book-flight', now: new Date().toISOString(),
    values: { 'mm:payAmount': amount, 'mm:merchant': 'skyward-air', 'mm:currency': currency } });

  const matching = run(5000, 'USD');
  ok('H1 prohibition fires for a large amount in the MATCHING currency', matching.decision === 'block', `${matching.decision}/${matching.reasonCode}`);

  const differentCase = run(5000, 'usd');
  ok('H2 prohibition still fires when the matching currency is declared in a different case', differentCase.decision === 'block', `${differentCase.decision}/${differentCase.reasonCode}`);

  const mismatched = run(5000, 'EUR');
  ok('H3 prohibition still fires for the SAME amount under a DIFFERENT currency — the reported regression', mismatched.decision === 'block', `${mismatched.decision}/${mismatched.reasonCode}`);

  const small = run(250, 'USD');
  ok('H4 control: prohibition does NOT fire for a genuinely small amount in the matching currency', small.decision !== 'block', `${small.decision}/${small.reasonCode}`);
}

const p = R.filter((x) => x.p).length;
console.log(`\n===== ${p}/${R.length} passed =====`);
R.filter((x) => !x.p).forEach((x) => console.log('FAILED:', x.n, '->', x.d));
// process.exitCode (not process.exit()) — a still-settling fetch/undici keep-alive socket
// from the calls above can make process.exit() force-close a handle mid-flight, which trips
// a libuv assertion crash on some platforms instead of a clean exit. Setting exitCode and
// letting the module finish naturally drains everything first.
process.exitCode = p === R.length ? 0 : 1;
