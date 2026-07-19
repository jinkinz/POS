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

# --- role gate: cashier blocked from admin
_, reg = call("POST", "/devices", {"outletId": OUTLET, "name": "AdminTest POS", "kind": "POS"}, OWNER)
_, cashier = call("POST", "/auth/pin-login", {"pin": "5678"}, headers={"X-Device-Token": reg["deviceToken"]})
s, _ = call("GET", "/admin/catalog", token=cashier["token"])
check("cashier blocked from admin (403)", s == 403, s)

# --- catalog
s, cat = call("GET", "/admin/catalog", token=OWNER)
check("catalog loads", s == 200 and len(cat["products"]) >= 4, s)

# --- category + product CRUD
s, dessert = call("POST", "/admin/categories", {"name": "Desserts", "sortOrder": 3}, OWNER)
check("category created", s == 201, json.dumps(dessert))
s, cendol = call("POST", "/admin/products", {"name": "Cendol", "basePriceCents": 550, "categoryId": dessert["id"], "kitchenStation": "dessert"}, OWNER)
check("product created", s == 201 and cendol["basePriceCents"] == 550, json.dumps(cendol))
s, upd = call("PATCH", f"/admin/products/{cendol['id']}", {"basePriceCents": 600}, OWNER)
check("product price updated", s == 200 and upd["basePriceCents"] == 600, json.dumps(upd))

# --- modifier group + attach
s, grp = call("POST", "/admin/modifier-groups", {"name": "Toppings", "minSelect": 0, "maxSelect": 2}, OWNER)
check("modifier group created", s == 201, json.dumps(grp))
s, mod = call("POST", f"/admin/modifier-groups/{grp['id']}/modifiers", {"name": "Extra gula melaka", "priceDeltaCents": 100}, OWNER)
check("modifier created", s == 201, json.dumps(mod))
s, att = call("POST", f"/admin/products/{cendol['id']}/modifier-groups", {"groupId": grp["id"]}, OWNER)
check("group attached to product", s == 201, json.dumps(att))

# menu (staff view) reflects new product
_, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
names = [p["name"] for c in menu["categories"] for p in c["products"]]
check("new product visible on menu", "Cendol" in names, json.dumps(names))
cendol_menu = next(p for c in menu["categories"] for p in c["products"] if p["name"] == "Cendol")
check("attached modifiers on menu", cendol_menu["modifierGroups"][0]["name"] == "Toppings", json.dumps(cendol_menu["modifierGroups"]))

# --- tables + outlet settings
s, t9 = call("POST", f"/admin/outlets/{OUTLET}/tables", {"name": f"T{uuid.uuid4().hex[:4]}", "zone": "VIP"}, OWNER)
check("table created with qrToken", s == 201 and len(t9["qrToken"]) > 10, json.dumps(t9))
s, out = call("PATCH", f"/admin/outlets/{OUTLET}", {"serviceChargeBps": 1000}, OWNER)
check("outlet settings updated", s == 200 and out["serviceChargeBps"] == 1000, s)

# --- staff admin
s, staff = call("GET", "/admin/staff", token=OWNER)
check("staff list with login flags", s == 200 and any(x["hasPin"] for x in staff), s)
aisyah = next(x for x in staff if x["name"].startswith("Aisyah"))
s, err = call("PATCH", f"/admin/staff/{aisyah['id']}", {"pin": "1234"}, OWNER)
check("duplicate PIN rejected on update", s == 400, s)
s, _ = call("PATCH", f"/admin/staff/{aisyah['id']}", {"name": "Aisyah binti Ali"}, OWNER)
check("staff renamed", s == 200, s)

# --- daily report: sell something today, then check the numbers
oid = str(uuid.uuid4())
_, order = call("POST", "/orders", {"id": oid, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": cendol["id"], "quantity": 3}]}, OWNER)
_, pay = call("POST", f"/orders/{oid}/payments", {"method": "CASH"}, OWNER)
today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d")
s, rep = call("GET", f"/admin/outlets/{OUTLET}/reports/daily?date={today}", token=OWNER)
check("report loads", s == 200, json.dumps(rep))
check("revenue includes new sale", rep["revenueCents"] >= order["totalCents"], f"{rep['revenueCents']} vs {order['totalCents']}")
check("cash in payment breakdown", any(p["method"] == "CASH" and p["amountCents"] > 0 for p in rep["byPayment"]), json.dumps(rep["byPayment"]))
check("cendol in top items", any(i["name"] == "Cendol" and i["quantity"] >= 3 for i in rep["topItems"]), json.dumps(rep["topItems"]))
check("source breakdown present", rep["bySource"].get("POS", 0) >= 1, json.dumps(rep["bySource"]))
s, err = call("GET", f"/admin/outlets/{OUTLET}/reports/daily?date=nonsense", token=OWNER)
check("bad date rejected 400", s == 400, s)

# cleanup-ish: deactivate test product so seeds stay tidy
call("PATCH", f"/admin/products/{cendol['id']}", {"active": False}, OWNER)

print("\nSOME CHECKS FAILED" if failed[0] else "\nAll admin e2e checks passed.")
raise SystemExit(1 if failed[0] else 0)
