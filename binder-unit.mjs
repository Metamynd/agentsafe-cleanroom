// Unit-level table on the 0.4.2 binder itself — what does defaultBindPayload(req, signed)
// require, and when does it decline to require anything at all?
import { defaultBindPayload, UNBINDABLE, boundValueMatches }
  from './gateway/node_modules/@metamynd/agentsafe-http-gateway/gateway.mjs';

const R = (v) => v === UNBINDABLE ? 'UNBINDABLE (fails closed)' : v === null ? 'null (proceeds UNBOUND)' : JSON.stringify(v);
const req = (body) => ({ rawBody: Buffer.from(body) });
const rows = [
  ['signed $250/skyward-air, body flat+matching',  {amount:250,merchant:'skyward-air'}, '{"amount":250,"currency":"USD","merchant":"skyward-air"}'],
  ['signed $250/skyward-air, body nested',         {amount:250,merchant:'skyward-air'}, '{"booking":{"amount":5000,"merchant":"evil-corp"}}'],
  ['signed $250/skyward-air, decoy currency only', {amount:250,merchant:'skyward-air'}, '{"currency":"USD","booking":{"amount":5000}}'],
  ['signed $250/skyward-air, empty body',          {amount:250,merchant:'skyward-air'}, ''],
  ['signed $250/skyward-air, form-encoded',        {amount:250,merchant:'skyward-air'}, 'amount=5000&merchant=evil-corp'],
  ['*** signed amount 0 + merchant, nested 5000',  {amount:0,merchant:'skyward-air'},   '{"merchant":"skyward-air","booking":{"amount":5000}}'],
  ['*** signed amount 0 + merchant, empty body',   {amount:0,merchant:'skyward-air'},   ''],
  ['*** signed amount 0, merchant "" (both default)', {amount:0,merchant:''},           '{"booking":{"amount":5000,"merchant":"evil-corp"}}'],
  ['*** signed amount 0, merchant absent',         {amount:0},                          'amount=5000&merchant=evil-corp'],
  ['signed amount only (no merchant), nested',     {amount:250},                        '{"booking":{"amount":5000}}'],
  ['signed merchant only (amount absent), nested', {merchant:'skyward-air'},            '{"merchant":"skyward-air","booking":{"amount":5000}}'],
  ['*** additive: required fields match, hidden extra', {amount:250,merchant:'skyward-air'}, '{"amount":250,"merchant":"skyward-air","extras":{"surcharge":4750}}'],
];
for (const [name, signed, body] of rows)
  console.log(name.padEnd(50), '->', R(defaultBindPayload(req(body), signed)));

console.log('\n--- boundValueMatches spot checks ---');
for (const [f,s,p] of [['amount',250,'250'],['amount',250,'250.00'],['amount',250,' 250'],['amount',250,'2.5e2'],['amount',250,'0xFA'],
                       ['merchant','skyward-air',['skyward-air']],['merchant','skyward-air','skyward-air'],['currency','USD','usd']])
  console.log(`  ${f} signed=${JSON.stringify(s)} payload=${JSON.stringify(p)} -> ${boundValueMatches(f,s,p)}`);
