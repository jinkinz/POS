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
OWNER = _o["token"]
OUTLET = call("GET", "/admin/outlets", token=OWNER)[1][0]["id"]

tz8 = datetime.timezone(datetime.timedelta(hours=8))
today = datetime.datetime.now(tz8).strftime("%Y-%m-%d")
weekago = (datetime.datetime.now(tz8) - datetime.timedelta(days=6)).strftime("%Y-%m-%d")

# --- make a known sale in the window
_, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
prods = {p["name"]: p for c in menu["categories"] for p in c["products"]}
kopi = prods["Kopi O"]
oid = str(uuid.uuid4())
_, order = call("POST", "/orders", {"id": oid, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 2}]}, OWNER)
_, pay = call("POST", f"/orders/{oid}/payments", {"method": "CARD"}, OWNER)
spent = pay["order"]["totalCents"] + pay["order"]["roundingCents"]

# --- analytics over the last 7 days
s, a = call("GET", f"/admin/outlets/{OUTLET}/reports/analytics?from={weekago}&to={today}", token=OWNER)
check("analytics loads", s == 200, json.dumps(a) if s != 200 else "")
check("daily buckets for short range", a["bucket"] == "day" and len(a["series"]) == 7, f"{a['bucket']}/{len(a['series'])}")
check("totals include the sale", a["totals"]["revenueCents"] >= spent and a["totals"]["orders"] >= 1, a["totals"]["revenueCents"])
check("today's bucket has revenue", any(b["bucket"] == today and b["revenueCents"] >= spent for b in a["series"]), json.dumps(a["series"][-2:]))
check("previous-period comparison present", "revenueChangePct" in a["previous"], json.dumps(a["previous"]))
check("weekday array has 7 rows with occurrences", len(a["weekday"]) == 7 and sum(w["occurrences"] for w in a["weekday"]) == 7, len(a["weekday"]))
check("hourly array has 24 rows", len(a["hourly"]) == 24, len(a["hourly"]))
check("kopi appears in items", any(i["name"] == "Kopi O" for i in a["items"]), json.dumps([i["name"] for i in a["items"]][:5]))
check("payment mix includes CARD", any(p["method"] == "CARD" for p in a["payments"]), json.dumps(a["payments"]))
check("source mix includes POS", any(s2["source"] == "POS" for s2 in a["sources"]), json.dumps(a["sources"]))
check("categories present", len(a["categories"]) >= 1, len(a["categories"]))

# --- long range switches to monthly buckets
yearago = (datetime.datetime.now(tz8) - datetime.timedelta(days=364)).strftime("%Y-%m-%d")
s, y = call("GET", f"/admin/outlets/{OUTLET}/reports/analytics?from={yearago}&to={today}", token=OWNER)
check("12-month range uses month buckets", s == 200 and y["bucket"] == "month" and 12 <= len(y["series"]) <= 13, f"{y.get('bucket')}/{len(y.get('series', []))}")

# --- guards
s, _ = call("GET", f"/admin/outlets/{OUTLET}/reports/analytics?from=nonsense&to={today}", token=OWNER)
check("bad date rejected 400", s == 400, s)
s, _ = call("GET", f"/admin/outlets/{OUTLET}/reports/analytics?from={today}&to={weekago}", token=OWNER)
check("inverted range rejected 400", s == 400, s)

_, reg = call("POST", "/devices", {"outletId": OUTLET, "name": f"AnTest {uuid.uuid4().hex[:4]}", "kind": "POS"}, OWNER)
pin = str(uuid.uuid4().int)[:6]
call("POST", "/staff", {"name": "An Cashier", "role": "CASHIER", "pin": pin}, OWNER)
_, cashier = call("POST", "/auth/pin-login", {"pin": pin}, headers={"X-Device-Token": reg["deviceToken"]})
s, _ = call("GET", f"/admin/outlets/{OUTLET}/reports/analytics?from={weekago}&to={today}", token=cashier["token"])
check("cashier blocked 403", s == 403, s)

print("\nSOME CHECKS FAILED" if failed[0] else "\nAll analytics e2e checks passed.")
raise SystemExit(1 if failed[0] else 0)
