# Auto-adapted e2e suite — run via e2e/run.sh (needs a seeded API).
import datetime, json, os, time, urllib.request, uuid

BASE = os.environ.get("E2E_BASE", "http://localhost:3000/api")
SCRATCH = os.environ.get("E2E_ART_DIR", "/tmp/pos-e2e")

def call(method, path, body=None, token=None, headers=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = "Bearer " + token
    if headers: h.update(headers)
    req = urllib.request.Request(BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

failed = [False]
def check(name, cond, detail=""):
    print(("PASS  " if cond else "FAIL  ") + name + ("" if cond else f"  -> {detail}"))
    if not cond: failed[0] = True

_s, _o = call("POST", "/auth/login", {"email": "owner@demokopitiam.my", "password": "password12345"})
assert _s in (200, 201), f"owner login failed: {_s} {_o}"
OUTLET = call("GET", "/admin/outlets", token=_o["token"])[1][0]["id"]

_, owner = call("POST", "/auth/login", {"email": "owner@demokopitiam.my", "password": "password12345"})
OWNER = owner["token"]

# close any leftover open shift from earlier testing
s, cur = call("GET", f"/outlets/{OUTLET}/shifts/current", token=OWNER)
if cur.get("shift"):
    call("POST", f"/shifts/{cur['shift']['id']}/close", {"countedCashCents": 0, "print": False}, OWNER)

# --- no open shift
s, cur = call("GET", f"/outlets/{OUTLET}/shifts/current", token=OWNER)
check("no current shift", s == 200 and cur["shift"] is None, json.dumps(cur))

# --- open with RM200 float; duplicate rejected
s, shift = call("POST", f"/outlets/{OUTLET}/shifts", {"openingFloatCents": 20000}, OWNER)
check("shift opened", s == 201, json.dumps(shift))
SHIFT = shift["id"]
s, _ = call("POST", f"/outlets/{OUTLET}/shifts", {"openingFloatCents": 1000}, OWNER)
check("second open rejected 409", s == 409, s)

# --- sales during shift: cash + card
_, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
prods = {p["name"]: p for c in menu["categories"] for p in c["products"]}
kopi = prods["Kopi O"]

o1 = str(uuid.uuid4())
_, order1 = call("POST", "/orders", {"id": o1, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 1}]}, OWNER)
_, pay1 = call("POST", f"/orders/{o1}/payments", {"method": "CASH", "tenderedCents": 1000}, OWNER)
cash_amount = pay1["payment"]["amountCents"]  # rounded cash applied

o2 = str(uuid.uuid4())
_, order2 = call("POST", "/orders", {"id": o2, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 2}]}, OWNER)
_, pay2 = call("POST", f"/orders/{o2}/payments", {"method": "CARD"}, OWNER)
card_amount = pay2["payment"]["amountCents"]

# --- cash in/out
call("POST", f"/shifts/{SHIFT}/cash-movements", {"type": "CASH_IN", "amountCents": 5000, "reason": "top-up float"}, OWNER)
s, rep = call("POST", f"/shifts/{SHIFT}/cash-movements", {"type": "CASH_OUT", "amountCents": 2000, "reason": "buy ice"}, OWNER)
check("cash movements recorded", s == 201 and rep["cash"]["cashInCents"] == 5000 and rep["cash"]["cashOutCents"] == 2000, json.dumps(rep["cash"]))

# --- X report math
s, cur = call("GET", f"/outlets/{OUTLET}/shifts/current", token=OWNER)
x = cur["report"]
expected = 20000 + cash_amount + 5000 - 2000
check("X report kind", x["kind"] == "X", x["kind"])
check("X cash sales correct", x["cash"]["cashSalesCents"] == cash_amount, f"{x['cash']['cashSalesCents']} vs {cash_amount}")
check("X expected drawer correct", x["cash"]["expectedCents"] == expected, f"{x['cash']['expectedCents']} vs {expected}")
check("X card in payments", any(p["method"] == "CARD" and p["amountCents"] == card_amount for p in x["payments"]), json.dumps(x["payments"]))
check("X completed orders = 2", x["completedOrders"] == 2, x["completedOrders"])
check("X sales = both orders", x["salesCents"] == (order1["totalCents"] + pay1["order"]["roundingCents"]) + order2["totalCents"], x["salesCents"])

# --- close with blind count RM x - 25 sen short
counted = expected - 25
s, z = call("POST", f"/shifts/{SHIFT}/close", {"countedCashCents": counted, "print": True}, OWNER)
check("shift closed with Z", s == 201 and z["kind"] == "Z", s)
check("Z variance -25", z["cash"]["varianceCents"] == -25, z["cash"]["varianceCents"])
check("Z expected matches X", z["cash"]["expectedCents"] == expected, z["cash"]["expectedCents"])

# --- closed guards
s, _ = call("POST", f"/shifts/{SHIFT}/close", {"countedCashCents": 0}, OWNER)
check("double close rejected 409", s == 409, s)
s, _ = call("POST", f"/shifts/{SHIFT}/cash-movements", {"type": "CASH_IN", "amountCents": 100, "reason": "late"}, OWNER)
check("movement on closed shift rejected 409", s == 409, s)

# --- Z print job landed on the bridge (receipt printer file)
time.sleep(3)
zfile = ""
p = os.path.join(SCRATCH, "prn-receipt.bin")
if os.path.exists(p):
    zfile = open(p, "rb").read().decode("utf8", errors="ignore")
check("Z report printed", "Z REPORT" in zfile, zfile[-120:] if zfile else "no file")
check("Z print shows variance", "VARIANCE" in zfile, "no variance line")
check("Z print shows expected", "Expected" in zfile, "no expected line")

# --- new shift can open after close; sale outside old window not counted
s, shift2 = call("POST", f"/outlets/{OUTLET}/shifts", {"openingFloatCents": 10000}, OWNER)
check("new shift opens after close", s == 201, s)
s, oldrep = call("GET", f"/shifts/{SHIFT}/report", token=OWNER)
check("old Z frozen (still 2 orders)", oldrep["completedOrders"] == 2, oldrep["completedOrders"])
call("POST", f"/shifts/{shift2['id']}/close", {"countedCashCents": 10000, "print": False}, OWNER)

# --- admin list with variance
s, rows = call("GET", f"/outlets/{OUTLET}/shifts", token=OWNER)
mine = next(r for r in rows if r["id"] == SHIFT)
check("shift list shows variance", mine["varianceCents"] == -25, json.dumps(mine))

# --- role gate: kitchen cannot open shifts
_, reg = call("POST", "/devices", {"outletId": OUTLET, "name": f"ShiftTest {uuid.uuid4().hex[:4]}", "kind": "POS"}, OWNER)
pin = str(uuid.uuid4().int)[:6]
call("POST", "/staff", {"name": "Shift Kitchen", "role": "KITCHEN", "pin": pin}, OWNER)
_, kit = call("POST", "/auth/pin-login", {"pin": pin}, headers={"X-Device-Token": reg["deviceToken"]})
s, _ = call("POST", f"/outlets/{OUTLET}/shifts", {"openingFloatCents": 0}, kit["token"])
check("kitchen role cannot open shift 403", s == 403, s)

print("\nSOME CHECKS FAILED" if failed[0] else "\nAll shifts/Z-report e2e checks passed.")
raise SystemExit(1 if failed[0] else 0)
