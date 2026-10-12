#!/usr/bin/env bash
# (Re)starts the stable no-HMR review server on 5190 so recordings aren't interrupted by reloads
# while files are being edited. Usage: bash scripts/review-server.sh
cd "$(dirname "$0")/.."
pid=$(netstat -ano 2>/dev/null | grep "127.0.0.1:5190" | grep LISTENING | awk '{print $NF}' | head -1)
if [ -n "$pid" ]; then taskkill //PID "$pid" //F //T >/dev/null 2>&1; sleep 1; fi
SABER_PORT=5190 SABER_NO_HMR=1 nohup npx vite --host 127.0.0.1 > "${TMPDIR:-/tmp}/saber-review-5190.log" 2>&1 &
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://127.0.0.1:5190/; then echo "review server up on 5190"; exit 0; fi
  sleep 0.5
done
echo "review server failed to start"; exit 1
