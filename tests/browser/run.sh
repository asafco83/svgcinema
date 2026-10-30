#!/bin/bash
# Browser tests (Playwright for Python + Chromium). Usage:
#   tests/browser/run.sh            all of them
#   tests/browser/run.sh cp gh      only some (file names without .py)
# Feature tests run against a fresh Vite dev server (port 5199) because they import /src modules;
# the smoke test runs against a production build (port 5301). Screenshots go to $CIN_OUT
# (default /tmp/svgcinema-shots/). Exit code 1 when any check fails.
cd "$(dirname "$0")/../.." || exit 1
DIR=tests/browser
LOG=${CIN_OUT:-/tmp/svgcinema-shots/}; mkdir -p "$LOG"
want=("$@")
pick() { [ ${#want[@]} -eq 0 ] && return 0; for w in "${want[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }

# a fresh dev server: an old one can serve stale duplicate module instances after edits
pkill -f "vite --port [5]199" 2>/dev/null; sleep 0.5
npx vite --port 5199 --strictPort > "$LOG/vite.log" 2>&1 &
DEV=$!
trap 'kill $DEV $SRV 2>/dev/null' EXIT
until curl -s localhost:5199 > /dev/null; do sleep 0.3; done

bad=0
for f in "$DIR"/*.py; do
  n=$(basename "$f" .py)
  [ "$n" = smoke ] && continue
  pick "$n" || continue
  to=180; [ "$n" = help ] && to=1500 # every help topic, step by step
  out=$(timeout $to python3 "$f" http://localhost:5199/ 2>&1)
  res=$(echo "$out" | grep -a '^FAILS' | tail -1)
  if [ "$res" = "FAILS []" ]; then echo "ok    $n"; else echo "FAIL  $n  ${res:-$(echo "$out" | tail -3)}"; bad=1; fi
  echo "$out" > "$LOG/$n.txt"
done

if pick smoke; then
  npx vite build > "$LOG/build.log" 2>&1 || { echo "FAIL  build"; exit 1; }
  (cd dist && exec python3 -m http.server 5301 --bind 127.0.0.1 > /dev/null 2>&1) &
  SRV=$!
  sleep 1
  out=$(timeout 280 python3 "$DIR/smoke.py" http://127.0.0.1:5301/ 2>&1)
  echo "$out" > "$LOG/smoke.txt"
  res=$(echo "$out" | grep -a '^FAILS' | tail -1)
  if [ "$res" = "FAILS []" ]; then echo "ok    smoke"; else echo "FAIL  smoke  ${res:-$(echo "$out" | tail -3)}"; bad=1; fi
fi
exit $bad
