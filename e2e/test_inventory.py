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

def qty(rows, iid):
    return float(next(r["onHandQty"] for r in rows if r["ingredientId"] == iid))

_, owner = call("POST", "/auth/login", {"email": "owner@demokopitiam.my", "password": "password12345"})
OWNER = owner["token"]

# --- ingredients (unique names per run to stay idempotent)
run = uuid.uuid4().hex[:6]
_, rice = call("POST", "/admin/ingredients", {"name": f"Rice {run}", "unit": "G", "costCents": 0.5}, OWNER)
_, chicken = call("POST", "/admin/ingredients", {"name": f"Chicken {run}", "unit": "G", "costCents": 2.2}, OWNER)
_, eggs = call("POST", "/admin/ingredients", {"name": f"Eggs {run}", "unit": "PCS", "costCents": 60}, OWNER)
check("ingredients created", all(x[1].get("id") for x in [(0, rice), (0, chicken), (0, eggs)]), json.dumps(rice))

# --- find products/modifiers
_, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
prods = {p["name"]: p for c in menu["categories"] for p in c["products"]}
cr = prods["Hainanese Chicken Rice"]
egg_mod = next(m for g in cr["modifierGroups"] for m in g["modifiers"] if m["name"] == "Extra egg")

# --- recipes: chicken rice = 200g rice + 150g chicken; extra egg = 1 egg
s, recipe = call("PUT", f"/admin/products/{cr['id']}/recipe", {"items": [
    {"ingredientId": rice["id"], "qty": 200},
    {"ingredientId": chicken["id"], "qty": 150},
]}, OWNER)
check("product recipe saved", s == 200 and len(recipe["items"]) == 2, json.dumps(recipe))
# theoretical cost: 200*0.5 + 150*2.2 = 100 + 330 = 430 cents
check("theoretical cost 430c", abs(float(recipe["theoreticalCostCents"]) - 430) < 0.01, recipe["theoreticalCostCents"])
s, _ = call("PUT", f"/admin/modifiers/{egg_mod['id']}/recipe", {"items": [{"ingredientId": eggs["id"], "qty": 1}]}, OWNER)
check("modifier recipe saved", s == 200, s)

# --- receive stock
call("POST", f"/admin/outlets/{OUTLET}/stock/receive", {"ingredientId": rice["id"], "qty": 10000}, OWNER)
call("POST", f"/admin/outlets/{OUTLET}/stock/receive", {"ingredientId": chicken["id"], "qty": 5000}, OWNER)
call("POST", f"/admin/outlets/{OUTLET}/stock/receive", {"ingredientId": eggs["id"], "qty": 30}, OWNER)
_, stock = call("GET", f"/admin/outlets/{OUTLET}/stock", token=OWNER)
check("stock received", qty(stock, rice["id"]) == 10000 and qty(stock, eggs["id"]) == 30, json.dumps([qty(stock, rice['id']), qty(stock, eggs['id'])]))

# --- sell 2x chicken rice with extra egg -> rice -400, chicken -300, eggs -2
oid = str(uuid.uuid4())
s, order = call("POST", "/orders", {"id": oid, "outletId": OUTLET, "type": "DINE_IN", "source": "POS",
    "items": [{"id": str(uuid.uuid4()), "productId": cr["id"], "quantity": 2, "modifierIds": [egg_mod["id"]]}]}, OWNER)
check("order created", s == 201, json.dumps(order))
_, stock = call("GET", f"/admin/outlets/{OUTLET}/stock", token=OWNER)
check("rice deducted 400g", qty(stock, rice["id"]) == 9600, qty(stock, rice["id"]))
check("chicken deducted 300g", qty(stock, chicken["id"]) == 4700, qty(stock, chicken["id"]))
check("eggs deducted 2 (modifier x qty)", qty(stock, eggs["id"]) == 28, qty(stock, eggs["id"]))

# --- void the item -> stock restored
item_id = order["items"][0]["id"]
s, _ = call("POST", f"/orders/{oid}/items/{item_id}/void", {"reason": "kitchen error"}, OWNER)
check("item voided", s == 201, s)
_, stock = call("GET", f"/admin/outlets/{OUTLET}/stock", token=OWNER)
check("rice restored", qty(stock, rice["id"]) == 10000, qty(stock, rice["id"]))
check("eggs restored", qty(stock, eggs["id"]) == 30, qty(stock, eggs["id"]))

# --- sell again, then void whole order -> restored
oid2 = str(uuid.uuid4())
call("POST", "/orders", {"id": oid2, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": cr["id"], "quantity": 1}]}, OWNER)
_, stock = call("GET", f"/admin/outlets/{OUTLET}/stock", token=OWNER)
check("second sale deducted", qty(stock, rice["id"]) == 9800, qty(stock, rice["id"]))
call("POST", f"/orders/{oid2}/void", {"reason": "customer left"}, OWNER)
_, stock = call("GET", f"/admin/outlets/{OUTLET}/stock", token=OWNER)
check("order void restored", qty(stock, rice["id"]) == 10000, qty(stock, rice["id"]))

# --- wastage & adjustment
call("POST", f"/admin/outlets/{OUTLET}/stock/wastage", {"ingredientId": chicken["id"], "qty": 200, "reason": "spoiled"}, OWNER)
_, stock = call("GET", f"/admin/outlets/{OUTLET}/stock", token=OWNER)
check("wastage deducted", qty(stock, chicken["id"]) == 4800, qty(stock, chicken["id"]))

# --- stocktake with variance (count rice at 9950 -> variance -50)
s, st = call("POST", f"/admin/outlets/{OUTLET}/stocktake", {"counts": [{"ingredientId": rice["id"], "countedQty": 9950}]}, OWNER)
check("stocktake variance -50", float(st["results"][0]["varianceQty"]) == -50, json.dumps(st))
_, stock = call("GET", f"/admin/outlets/{OUTLET}/stock", token=OWNER)
check("on-hand set to counted", qty(stock, rice["id"]) == 9950, qty(stock, rice["id"]))

# --- low stock flag
call("POST", f"/admin/outlets/{OUTLET}/stock/low-threshold", {"ingredientId": eggs["id"], "lowThresholdQty": 50}, OWNER)
_, stock = call("GET", f"/admin/outlets/{OUTLET}/stock", token=OWNER)
egg_row = next(r for r in stock if r["ingredientId"] == eggs["id"])
check("low stock flagged", egg_row["lowStock"] is True, json.dumps(egg_row))

# --- movements ledger has the story
s, moves = call("GET", f"/admin/outlets/{OUTLET}/stock/movements?ingredientId={rice['id']}", token=OWNER)
types = [m["type"] for m in moves]
check("ledger has purchase/sale/void/stocktake", all(t in types for t in ["PURCHASE", "SALE_DEDUCT", "VOID_RETURN", "STOCKTAKE"]), json.dumps(types))
check("sale movement carries order ref", any(m["refId"] == oid for m in moves if m["type"] == "SALE_DEDUCT"), "no ref")

# --- role gate
_, reg = call("POST", "/devices", {"outletId": OUTLET, "name": f"InvTest {run}", "kind": "POS"}, OWNER)
_, cashier = call("POST", "/auth/pin-login", {"pin": "5678"}, headers={"X-Device-Token": reg["deviceToken"]})
s, _ = call("GET", f"/admin/outlets/{OUTLET}/stock", token=cashier["token"])
check("cashier blocked from inventory 403", s == 403, s)

# --- product with no recipe unaffected (kopi has no recipe): sell should not error
kopi = prods["Kopi O"]
s, _ = call("POST", "/orders", {"outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 1}]}, OWNER)
check("no-recipe product sells fine", s == 201, s)

print("\nSOME CHECKS FAILED" if failed[0] else "\nAll inventory e2e checks passed.")
raise SystemExit(1 if failed[0] else 0)
