#!/usr/bin/env node
// gateway/server.mjs — the REAL enforcement boundary for this agent's tool(s).
//
// This is a SEPARATE process from the agent. It holds the tool's real credentials (the agent
// process never does), and it independently re-verifies every request against this agent's OWN
// published policy bundle — it does not trust the agent's own guard.guardTool() check. A
// compromised or dishonest agent calling its own local function gets nothing here, because
// there is no local function: the tool only runs in this process.
import http from 'node:http';
import { createMcpGuard } from '@metamynd/agentsafe-mcp-guard';
import { createHttpGateway } from '@metamynd/agentsafe-http-gateway';

const PORT = Number(process.env.PORT || 4401);
const MAGP_API = process.env.MAGP_API || 'http://127.0.0.1:4402';

// --- Your real tool. Real credentials (an airline API key, a payment key, ...) belong ONLY
// --- here, read from process.env (see .env.example) — never in the agent process.
async function bookFlight(args) {
  return { pnr: 'PNR-DEMO', ...args };
}

// One protected route: only a request signed by this agent, for exactly this action, and
// re-verified against this agent's own mandate/SOP, reaches bookFlight() below.
const routes = [{ method: 'POST', path: '/book-flight', action: 'book-flight' }];

// No serviceKey: this minimal gateway only calls verifyRequest() (re-check a signed request),
// not the mutual-handshake methods, which are the only thing that needs it.
//
// requireAuthorization: true is what closes replay and cumulative spend, not just per-request
// policy — it requires the agent's authorizationId (from a REAL guard.authorize() call) to
// atomically claim single-use execution against the issuer before this gateway runs the tool.
const guard = createMcpGuard({ serviceDid: 'did:local:book-flight-gateway', issuerApi: MAGP_API, requireAuthorization: true });

const gateway = createHttpGateway({
  guard,
  routes,
  forward: async (req) => {
    let args = {};
    try { args = JSON.parse(req.rawBody?.toString('utf8') || '{}'); } catch { /* empty body */ }
    const result = await bookFlight(args);
    return { status: 200, body: result };
  },
  // This gateway IS the tool, not a proxy in front of one — an unmatched path has nothing to
  // pass through TO. Without this, any path a route doesn't match falls through ungoverned
  // straight to forward() above, which would run bookFlight() with no check at all.
  denyByDefault: true,
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const rawBody = await readBody(req);
    const result = await gateway({ method: req.method, path: req.url, headers: req.headers, rawBody });
    const headers = { 'content-type': 'application/json' };
    if (result.governance) headers['x-agentsafe-decision'] = result.governance.decision;
    res.writeHead(result.status, headers);
    res.end(JSON.stringify(result.body ?? {}));
  } catch (err) {
    // Fail CLOSED on any gateway error.
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ decision: 'block', reasonCode: 'GATEWAY_ERROR', error: String(err?.message ?? err) }));
  }
});

server.listen(PORT, () => {
  console.log('[gateway] listening on :' + PORT + ' -> the only place bookFlight() runs.');
  console.log('[gateway] every request is independently re-verified against this agent\'s own policy.');
});
