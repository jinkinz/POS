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
run = uuid.uuid4().hex[:5].upper()
month = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m")

# --- consignor + retail product
s, vera = call("POST", "/admin/consignment/consignors", {"name": f"Vera Bakes {run}", "commissionBps": 2000}, OWNER)
check("consignor created (20%)", s == 201, json.dumps(vera))
s, brownie = call("POST", "/admin/products", {"name": f"Brownie {run}", "basePriceCents": 800, "sku": f"BR-{run}"}, OWNER)
check("retail product created with SKU", s == 201, json.dumps(brownie))
s, upd = call("PATCH", f"/admin/products/{brownie['id']}", {"trackStock": True, "consignorId": vera["id"]}, OWNER)
check("trackStock + consignor set", s == 200 and upd["trackStock"] and upd["consignorId"] == vera["id"], json.dumps(upd))

# --- menu carries sku
_, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
mprod = next((p for c in menu["categories"] for p in c["products"] if p["id"] == brownie["id"]), None)
check("menu exposes SKU for scanning", mprod is None or mprod.get("sku") == f"BR-{run}", json.dumps(mprod))
# note: product has no category -> not in category list; check uncategorized handling
if mprod is None:
    print("NOTE  product without category not on menu — assigning category")
    cats = call("GET", "/admin/catalog", token=OWNER)[1]["categories"]
    call("PATCH", f"/admin/products/{brownie['id']}", {"categoryId": cats[0]["id"]}, OWNER)
    _, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
    mprod = next(p for c in menu["categories"] for p in c["products"] if p["id"] == brownie["id"])
    check("menu exposes SKU after categorizing", mprod["sku"] == f"BR-{run}", json.dumps(mprod))

# --- receive stock
s, rec = call("POST", f"/admin/outlets/{OUTLET}/retail-stock/receive", {"productId": brownie["id"], "qty": 50}, OWNER)
check("received 50 units", s == 201 and rec["onHandQty"] == 50, json.dumps(rec))

# --- sell 3 -> stock 47
oid = str(uuid.uuid4())
_, order = call("POST", "/orders", {"id": oid, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": brownie["id"], "quantity": 3}]}, OWNER)
_, pay = call("POST", f"/orders/{oid}/payments", {"method": "CASH", "tenderedCents": 5000}, OWNER)
s, stock = call("GET", f"/admin/outlets/{OUTLET}/retail-stock", token=OWNER)
row = next(r for r in stock if r["productId"] == brownie["id"])
check("sale deducted units (47)", row["onHandQty"] == 47, row["onHandQty"])
check("consignor shown on stock row", row["consignor"]["name"].startswith("Vera"), json.dumps(row["consignor"]))

# --- void restores
oid2 = str(uuid.uuid4())
_, o2 = call("POST", "/orders", {"id": oid2, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": brownie["id"], "quantity": 2}]}, OWNER)
_, stock = call("GET", f"/admin/outlets/{OUTLET}/retail-stock", token=OWNER)
check("second sale deducted (45)", next(r for r in stock if r["productId"] == brownie["id"])["onHandQty"] == 45, "")
call("POST", f"/orders/{oid2}/void", {"reason": "test void"}, OWNER)
_, stock = call("GET", f"/admin/outlets/{OUTLET}/retail-stock", token=OWNER)
check("void restored units (47)", next(r for r in stock if r["productId"] == brownie["id"])["onHandQty"] == 47, "")

# --- wastage + stocktake variance
call("POST", f"/admin/outlets/{OUTLET}/retail-stock/wastage", {"productId": brownie["id"], "qty": 2, "reason": "damaged"}, OWNER)
s, st = call("POST", f"/admin/outlets/{OUTLET}/retail-stocktake", {"counts": [{"productId": brownie["id"], "countedQty": 44}]}, OWNER)
check("stocktake variance -1 (45->44)", st["results"][0]["varianceQty"] == -1, json.dumps(st))
_, stock = call("GET", f"/admin/outlets/{OUTLET}/retail-stock", token=OWNER)
check("on-hand set to counted (44)", next(r for r in stock if r["productId"] == brownie["id"])["onHandQty"] == 44, "")

# --- low threshold flag via product low? (skip — ingredient-style threshold not exposed for retail set; check lowStock false)
# --- consignment settlement: 3 sold * RM8 = RM24; 20% commission RM4.80; payout RM19.20
s, prev = call("GET", f"/admin/consignment/consignors/{vera['id']}/settlements/preview?month={month}", token=OWNER)
check("preview: 3 units RM24", prev["unitsSold"] == 3 and prev["salesCents"] == 2400, json.dumps(prev))
check("commission 20% = RM4.80", prev["commissionCents"] == 480, prev["commissionCents"])
check("payout RM19.20", prev["payoutCents"] == 1920, prev["payoutCents"])
s, settle = call("POST", f"/admin/consignment/consignors/{vera['id']}/settlements", {"month": month}, OWNER)
check("settlement generated", s == 201 and settle["payoutCents"] == 1920, json.dumps(settle) if s != 201 else "")
s, _ = call("POST", f"/admin/consignment/consignors/{vera['id']}/settlements", {"month": month}, OWNER)
check("duplicate period rejected 409", s == 409, s)
s, paid = call("POST", f"/admin/consignment/settlements/{settle['id']}/paid", {}, OWNER)
check("marked paid", s == 201 and paid["status"] == "PAID", s)
s, _ = call("POST", f"/admin/consignment/settlements/{settle['id']}/paid", {}, OWNER)
check("double pay rejected 409", s == 409, s)

# --- non-tracked product creates no unit movements (kopi)
prods = {p["name"]: p for c in menu["categories"] for p in c["products"]}
kopi = prods["Kopi O"]
o3 = str(uuid.uuid4())
call("POST", "/orders", {"id": o3, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 1}]}, OWNER)
_, stock = call("GET", f"/admin/outlets/{OUTLET}/retail-stock", token=OWNER)
check("non-tracked product absent from retail stock", not any(r["productId"] == kopi["id"] for r in stock), "")

# --- role gate
_, reg = call("POST", "/devices", {"outletId": OUTLET, "name": f"RetTest {run}", "kind": "POS"}, OWNER)
pin = str(uuid.uuid4().int)[:6]
call("POST", "/staff", {"name": "Ret Cashier", "role": "CASHIER", "pin": pin}, OWNER)
_, cashier = call("POST", "/auth/pin-login", {"pin": pin}, headers={"X-Device-Token": reg["deviceToken"]})
s, _ = call("GET", "/admin/consignment/consignors", token=cashier["token"])
check("cashier blocked from consignment 403", s == 403, s)

print("\nSOME CHECKS FAILED" if failed[0] else "\nAll retail/consignment e2e checks passed.")
raise SystemExit(1 if failed[0] else 0)
