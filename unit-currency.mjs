// The new `c.unit` check in constraintSatisfied returns FALSE on a currency mismatch. For a
// PERMISSION constraint that fails closed (all constraints must hold). For a PROHIBITION,
// the rule only fires when EVERY constraint is satisfied — so does a currency mismatch make a
// prohibition silently not fire?
import { evaluateMandate } from './gateway/node_modules/@metamynd/agentsafe-mcp-guard/policy-core.mjs';
const mandate = {
  target: 'book-flight',
  prohibition: [{ target:'book-flight', reasonCode:'BIG_SPEND_PROHIBITED',
    constraint: [{ leftOperand:'mm:payAmount', operator:'gteq', rightOperand:1000, unit:'USD' }] }],
  permission: [{ target:'book-flight',
    constraint: [{ leftOperand:'mm:merchant', operator:'isAnyOf', rightOperand:['skyward-air'] }] }],
};
const run = (amount, currency) => {
  const r = evaluateMandate(mandate, { target:'book-flight', now:new Date().toISOString(),
    values:{ 'mm:payAmount':amount, 'mm:merchant':'skyward-air', 'mm:currency':currency } });
  return `${r.decision}/${r.reasonCode}`;
};
console.log('prohibition: payAmount >= 1000 unit USD;  permission: merchant allowlist (no unit)\n');
for (const [amt,cur] of [[250,'USD'],[5000,'USD'],[5000,'EUR'],[5000,'usd'],[5000,'XXX'],[5000,undefined]])
  console.log(`  amount=${String(amt).padEnd(5)} currency=${String(cur).padEnd(9)} -> ${run(amt,cur)}`);
