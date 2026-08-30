#!/bin/bash
# run-gate.sh — the CI entry point. Starts the mock issuer + gateway, runs the mechanical
# regression checks (matrix.mjs's original six, gate.mjs's two new ones), tears everything
# down, and exits non-zero the moment either suite fails — this is the actual "no release
# ships without the suite green" gate, not just a script you run and read by eye.
set -u
cd "$(dirname "$0")"

cleanup() {
  # Capture $? FIRST: the exit code that triggered this trap (our own `exit $status` below)
  # must survive killing the background processes, or the script's real exit code silently
  # becomes whatever `kill`/the last command in here happened to return — which would make
  # the gate report green even when a check actually failed. (Also: killing mock-issuer.mjs
  # on Windows can trip a benign libuv assertion on its way down — noisy on stderr, harmless,
  # and irrelevant to this exit code either way.)
  local exit_code=$?
  [ -n "${ISSUER_PID:-}" ] && kill "$ISSUER_PID" 2>/dev/null
  [ -n "${GATEWAY_PID:-}" ] && kill "$GATEWAY_PID" 2>/dev/null
  exit $exit_code
}
trap cleanup EXIT

echo "[gate] installing pinned gateway libs..."
(cd gateway && npm install --no-audit --no-fund) || exit 1

echo "[gate] starting mock issuer (:4402)..."
node mock-issuer.mjs > /tmp/agentsafe-cleanroom-issuer.log 2>&1 &
ISSUER_PID=$!

echo "[gate] starting gateway (:4401)..."
(cd gateway && node server.mjs) > /tmp/agentsafe-cleanroom-gateway.log 2>&1 &
GATEWAY_PID=$!

# Wait for both to actually accept connections rather than a fixed sleep — a slow CI runner
# should not produce a false-negative "connection refused" failure that looks like a real gate
# failure.
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:4402/__state > /dev/null 2>&1 && curl -sf -o /dev/null -w '' http://127.0.0.1:4401/ 2>&1
  { curl -sf http://127.0.0.1:4402/__state > /dev/null 2>&1; } && ready_issuer=1 || ready_issuer=0
  # The gateway has no unauthenticated GET route, so any HTTP response (even a 404/401) proves
  # it is listening — a connection failure is the only thing that means "not up yet."
  { curl -s -o /dev/null http://127.0.0.1:4401/__probe 2>&1; } && ready_gateway=1 || ready_gateway=0
  [ "$ready_issuer" = "1" ] && [ "$ready_gateway" = "1" ] && break
  sleep 1
done
if [ "${ready_issuer:-0}" != "1" ] || [ "${ready_gateway:-0}" != "1" ]; then
  echo "[gate] issuer or gateway never came up — see /tmp/agentsafe-cleanroom-*.log"
  cat /tmp/agentsafe-cleanroom-issuer.log /tmp/agentsafe-cleanroom-gateway.log 2>/dev/null
  exit 1
fi

status=0
echo "[gate] running matrix.mjs (the six prior findings + the honest path)..."
node matrix.mjs || status=1

echo "[gate] running gate.mjs (the two newest findings)..."
node gate.mjs || status=1

exit $status
