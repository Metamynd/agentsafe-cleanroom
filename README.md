# agentsafe-cleanroom

A hermetic test rig for the MetaMynd AgentSafe payment-authorization stack. It stands
up the whole enforcement path locally — no credentials, no KYB, no live
`metamynd.ai` — so you can prove what the gateway does and doesn't stop.

Three roles run as separate processes, which is the whole point of the threat model:

- **`agent.mjs`** — the attacker-controlled side. Generates its own Ed25519 key,
  builds a `did:hedera` identity, and signs canonical MAGP request messages.
  Everything here is under the adversary's control; the gateway must trust none of it.
- **`gateway/server.mjs`** — the real enforcement boundary. A standalone process
  that holds the tool's credentials and independently re-verifies every request
  against the agent's own published policy. `bookFlight()` only ever runs here —
  there's no local function for a dishonest agent to call.
- **`mock-issuer.mjs`** — stands in for `metamynd.ai/api/v1`, mirroring the
  stateful semantics verified against the real issuer on 2026-08-29: atomic
  cumulative reservation, single-use authorization claims, per-txn cap $250,
  cumulative cap $10,000, merchant allowlist `skyward-air`, plus the 0.7.7
  starter SOP.

## Layout

- `pkgs/` — pinned `.tgz` of the three published packages under test
- `ext/new/` — unpacked sources of the release under test
- `ext/prev/` — unpacked sources of the prior release, for side-by-side diffing
- `gateway/` — scaffolded gateway (installs the pinned libs) + `server.mjs`
- `proxytest/` — packaged `agentsafe-mcp-guard` proxy harness (deny-by-default,
  opt-out logs)
- `mock-issuer.mjs`, `agent.mjs`, `matrix.mjs` — the hermetic issuer, the
  canonical signer, and the full functional matrix
- `attack*.mjs`, `binder-unit.mjs`, `unit-currency*.mjs` — the exploit probes
- `restart-issuer.sh` — kills the issuer by port (never `pkill -f` — see
  Gotchas below)

## The run loop

```bash
cd agentsafe-cleanroom

# 1. start the issuer (writes issuer.log; resettable)
./restart-issuer.sh                    # or: node mock-issuer.mjs &   (:4402)

# 2. install pinned libs + start the gateway
cd gateway && npm install              # resolves ^0.4.0 gateway / ^0.3.0 guard
node server.mjs &                      # (:4401)
cd ..

# 3. functional matrix — the honest path + all refusals
node matrix.mjs                        # expect 15/15 PASS
```

`matrix.mjs` is your regression baseline: unsigned → 401, forged sig → 403,
unmatched route → `ROUTE_NOT_ALLOWED`, stale → `REQUEST_EXPIRED`, over-cap
block, merchant block, confused-deputy binding (`PAYLOAD_NOT_BOUND`), replay
1-of-4, cumulative halt at $10k, forged/absent `authorizationId`. If any of
these flip from PASS to FAIL after a version bump, enforcement regressed.

## The attack probes

Each `.mjs` at the top level is a standalone exploit attempt you run against
the live gateway + issuer. The two that matter for the current release:

```bash
node attack4.mjs           # NEW-1 (HIGH): sign amount:0 → amount binding turns off,
                            # any real amount in the body rides through. Expect
                            # HTTP 200 + upstream charged.
node unit-currency.mjs     # NEW-2 (MED, 0.3.3 regression): unit-bearing
                            # PROHIBITION fails open
node unit-currency-031.mjs # side-by-side: 0.3.1 blocked the same input
```

`attack.mjs` / `attack2.mjs` / `attack3.mjs` and `binder-unit.mjs` are the
earlier confused-deputy / decoy-field / numeric-string probes — all now
expected to return 403, confirming the six prior findings stayed closed.

## The retest workflow (how you'd actually use this next time)

1. `npm view <pkg> version dist-tags time.modified` — cheapest check for
   whether a new release even exists.
2. Drop the new `.tgz` into `pkgs/`, unpack into `ext/new/`, keep the prior
   version in `ext/prev/` for diffing.
3. `md5sum` the rendered `gatewayServerFile()` — if unchanged, no enforcement
   logic moved.
4. Run `matrix.mjs` (must stay green) then re-run every `attack*` probe.
5. `ext/prev` vs `ext/new` is there so you can prove a regression
   side-by-side, the way `unit-currency-031.mjs` does for the 0.3.3
   prohibition bug.

## Gotchas baked into the harness

- **Reset between runs**: issuer `GET /__reset`, upstream `POST /__reset` —
  otherwise reserved cumulative state leaks across tests. `GET /__state`
  shows the current reservation.
- **Never `pkill -f` a pattern that's in your own command line** — it kills
  the tool's shell (exit 144). Use `restart-issuer.sh`, which kills by port
  via `ss -ltnp`.
- **`MOCK_NO_SOP=1`** restores the pre-0.7.7 empty-SOP bundle; the default
  serves the starter SOP a real provisioned agent now carries. Serving `[]`
  hides the negative-amount fix entirely.
- **Packaged proxy** (`proxytest/`) needs `SERVICE_DID` set or
  `createMcpGuard` throws; its upstream env var is `AGENTSAFE_UPSTREAM`, not
  `UPSTREAM`.

## Findings recorded from the 2026-08-30 run

- All 6 prior findings CLOSED; functional 15/15 intact.
- NEW-1 (HIGH): signing `amount: 0` disables amount binding — see `attack4.mjs`.
  Fixed in `@metamynd/agentsafe-http-gateway@0.4.7`.
- NEW-2 (MED, 0.3.3 regression): unit-bearing PROHIBITIONs fail open — see
  `unit-currency.mjs` vs `unit-currency-031.mjs`. Fixed in
  `@metamynd/agentsafe-mcp-guard@0.3.4`.

## License

MIT
