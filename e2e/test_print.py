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

def fileText(name):
    p = os.path.join(SCRATCH, name)
    if not os.path.exists(p): return ""
    with open(p, "rb") as f:
        return f.read().decode("utf8", errors="ignore")

_, owner = call("POST", "/auth/login", {"email": "owner@demokopitiam.my", "password": "password12345"})
OWNER = owner["token"]
devtoken = open(os.path.join(SCRATCH, "devtoken.txt")).read().strip()

# --- bad device token rejected; staff JWT rejected on bridge routes
s, _ = call("POST", "/bridge/session", {"deviceToken": "x" * 64})
check("bad device token rejected 401", s == 401, s)
s, _ = call("GET", "/bridge/jobs", token=OWNER)
check("staff token rejected on bridge routes 401", s == 401, s)

# --- bridge session works (also used to inspect pending queue)
s, sess = call("POST", "/bridge/session", {"deviceToken": devtoken})
check("bridge session created", s == 201 and sess["outletId"] == OUTLET, s)
BR = sess["token"]

# --- bridge token cannot access staff endpoints
s, _ = call("GET", f"/outlets/{OUTLET}/menu", token=BR)
check("bridge token blocked from staff endpoints 403", s == 403, s)

# --- create an order -> kitchen tickets per station land on "printers"
_, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
prods = {p["name"]: p for c in menu["categories"] for p in c["products"]}
cr = prods["Hainanese Chicken Rice"]
egg = next(m for g in cr["modifierGroups"] for m in g["modifiers"] if m["name"] == "Extra egg")
teh = prods["Teh Tarik"]

oid = str(uuid.uuid4())
_, order = call("POST", "/orders", {"id": oid, "outletId": OUTLET, "type": "DINE_IN", "source": "POS",
    "items": [
        {"productId": cr["id"], "quantity": 2, "modifierIds": [egg["id"]], "notes": "less oil"},
        {"productId": teh["id"], "quantity": 1},
    ]}, OWNER)

time.sleep(3)  # bridge prints via socket push
wok = fileText("prn-wok.bin")
drinks = fileText("prn-drinks.bin")
check("wok ticket printed with item", "Hainanese Chicken Rice" in wok or "Chicken" in wok, wok[:80])
check("wok ticket carries modifier", "Extra egg" in wok, wok[:200])
check("wok ticket carries note", "less oil" in wok, wok[:200])
check("drinks ticket printed", "Teh Tarik" in drinks, drinks[:80])
check("stations separated", "Teh Tarik" not in wok, "teh leaked to wok")

# --- pay cash and print receipt
call("POST", f"/orders/{oid}/payments", {"method": "CASH", "tenderedCents": 5000}, OWNER)
s, job = call("POST", f"/orders/{oid}/print", {}, OWNER)
check("receipt job created", s == 201, json.dumps(job))
time.sleep(3)
receipt = fileText("prn-receipt.bin")
check("receipt printed with outlet name", "Demo" in receipt or "SS2" in receipt, receipt[:80])
check("receipt has TOTAL line", "TOTAL" in receipt, receipt[:400])
check("receipt shows rounding", "Rounding" in receipt, "no rounding line")
check("receipt shows change", "change" in receipt, "no change line")

# --- jobs acked: pending queue is empty
s, pending = call("GET", "/bridge/jobs", token=BR)
check("all jobs acked (queue empty)", s == 200 and len(pending) == 0, len(pending) if s == 200 else s)

print("\nSOME CHECKS FAILED" if failed[0] else "\nAll print e2e (online) checks passed.")
raise SystemExit(1 if failed[0] else 0)
