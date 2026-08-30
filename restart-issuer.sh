#!/bin/bash
cd "$(dirname "$0")"
PID=$(ss -ltnp 2>/dev/null | grep ':4402 ' | grep -oP 'pid=\K[0-9]+' | head -1)
[ -n "$PID" ] && kill "$PID" && sleep 1
setsid nohup node mock-issuer.mjs > issuer.log 2>&1 < /dev/null &
sleep 1.5
cat issuer.log
