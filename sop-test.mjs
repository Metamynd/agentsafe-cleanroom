// Does the CLI's DEFAULT scaffolded SOP now catch an amount it cannot judge?
// Rules copied verbatim from create-metamynd-agent 0.7.7 harnessDefaultSop() (index.mjs ~1078),
// compared against the 0.7.6 default that authored amount-over alone.
import { moleculeFires } from './gateway/node_modules/@metamynd/agentsafe-mcp-guard/policy-core.mjs';
const perTxnMax = 250;
const cap    = { id:'cap',    name:'Per-transaction cap', combinator:'any', atoms:[{id:'a1',predicate:'amount-over',config:{limit:perTxnMax}}], decision:'block', reasonCode:'SOP_SPEND_CAP' };
const review = { id:'review', name:'High-risk review',    combinator:'any', atoms:[{id:'a2',predicate:'risk-at-or-above',config:{level:'high'}}], decision:'escalate', reasonCode:'RISK_REVIEW' };
const known  = { id:'amount-known', name:'Amount must be determinable', combinator:'any', atoms:[{id:'a0',predicate:'amount-unknown'}], decision:'block', reasonCode:'AMOUNT_NOT_DETERMINABLE' };
const v076 = [cap, review];            // what 0.7.6 scaffolded
const v077 = [known, cap, review];     // what 0.7.7 scaffolds
const ctxs = [
  ['honest $250',             {amount:250}],
  ['over cap $5000',          {amount:5000}],
  ['amount MISSING',          {merchant:'evil-corp'}],
  ['amount as string "5000"', {amount:'5000'}],
  ['amount null',             {amount:null}],
  ['amount NEGATIVE -5000',   {amount:-5000}],
  ['amount -0.01',            {amount:-0.01}],
  ['amount ZERO 0',           {amount:0}],
  ['amount NaN',              {amount:NaN}],
];
const fired = (rules,c)=>rules.filter(r=>moleculeFires(r,c)).map(r=>`${r.decision}:${r.reasonCode}`).join(',')||'(nothing fires -> allow)';
for (const [name,c] of ctxs)
  console.log(name.padEnd(26), '| 0.7.6 default:', fired(v076,c).padEnd(28), '| 0.7.7 default:', fired(v077,c));
