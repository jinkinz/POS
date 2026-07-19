#!/usr/bin/env bash
# End-to-end suite runner. Prerequisites:
#   - DATABASE_URL points at a running Postgres with migrations applied
#     (packages/db: npx prisma migrate deploy)
#   - workspace built (pnpm -r build)
# Usage: bash e2e/run.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export E2E_BASE="${E2E_BASE:-http://localhost:3000/api}"
export E2E_ART_DIR="${E2E_ART_DIR:-/tmp/pos-e2e}"
API_ORIGIN="${E2E_BASE%/api}"

mkdir -p "$E2E_ART_DIR"
rm -f "$E2E_ART_DIR"/prn-*.bin "$E2E_ART_DIR"/api.log "$E2E_ART_DIR"/bridge.log

cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null
  [ -n "${BRIDGE_PID:-}" ] && kill "$BRIDGE_PID" 2>/dev/null
}
trap cleanup EXIT

echo "--- starting API"
node "$ROOT/apps/api/dist/main.js" > "$E2E_ART_DIR/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 30); do
  curl -sf "$E2E_BASE/health" > /dev/null 2>&1 && break
  sleep 1
done
if ! curl -sf "$E2E_BASE/health" > /dev/null 2>&1; then
  echo "API failed to start:"; tail -40 "$E2E_ART_DIR/api.log"; exit 1
fi

echo "--- seeding demo data"
(cd "$ROOT" && pnpm --filter @pos/api seed)

echo "--- registering print bridge"
TOKEN=$(curl -s -X POST "$E2E_BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@demokopitiam.my","password":"password12345"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
OUTLET=$(curl -s "$E2E_BASE/admin/outlets" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
DEVTOKEN=$(curl -s -X POST "$E2E_BASE/devices" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"outletId\":\"$OUTLET\",\"name\":\"E2E Bridge\",\"kind\":\"PRINT_BRIDGE\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['deviceToken'])")
echo "$DEVTOKEN" > "$E2E_ART_DIR/devtoken.txt"
python3 - <<'PY'
import json, os
d = os.environ["E2E_ART_DIR"]
cfg = {
    "receipt": {"type": "file", "path": f"{d}/prn-receipt.bin"},
    "stations": {
        k: {"type": "file", "path": f"{d}/prn-{k}.bin"}
        for k in ["wok", "drinks", "kitchen", "dessert"]
    },
}
open(f"{d}/printers.json", "w").write(json.dumps(cfg))
PY
(cd "$ROOT/apps/print-bridge" && \
  DEVICE_TOKEN="$DEVTOKEN" PRINTERS_CONFIG="$E2E_ART_DIR/printers.json" API_URL="$API_ORIGIN" \
  npx tsx src/main.ts > "$E2E_ART_DIR/bridge.log" 2>&1) &
BRIDGE_PID=$!
sleep 5

FAIL=0
run_py() {
  echo ""; echo "=== e2e/$1 ==="
  python3 "$ROOT/e2e/$1" || FAIL=1
}

run_py test_admin.py
run_py test_inventory.py
run_py test_gateway.py
run_py test_crm.py
run_py test_vouchers.py
run_py test_einvoice.py
run_py test_retail.py
run_py test_hr.py
run_py test_print.py
run_py test_shifts.py

echo ""; echo "=== apps/kds/e2e/qr.mjs ==="
(cd "$ROOT/apps/kds" && node e2e/qr.mjs) || FAIL=1
echo ""; echo "=== apps/kds/e2e/aggregator.mjs ==="
(cd "$ROOT/apps/kds" && node e2e/aggregator.mjs) || FAIL=1
echo ""; echo "=== apps/pos/e2e/offline.mts ==="
(cd "$ROOT/apps/pos" && npx tsx e2e/offline.mts) || FAIL=1

echo ""
if [ "$FAIL" = "0" ]; then echo "ALL E2E SUITES PASSED"; else echo "E2E FAILURES — see above"; fi
exit $FAIL
