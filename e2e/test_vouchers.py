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

# --- campaigns
s, promo = call("POST", "/admin/campaigns", {
    "name": f"Merdeka {run}", "kind": "CODE", "code": f"MRDK{run}",
    "discountType": "PERCENT", "valueBps": 1000, "maxDiscountCents": 500,
    "minSpendCents": 2000}, OWNER)
check("promo campaign created", s == 201, json.dumps(promo))
s, welcome = call("POST", "/admin/campaigns", {
    "name": f"Welcome RM5 {run}", "kind": "ISSUED",
    "discountType": "AMOUNT", "valueCents": 500}, OWNER)
check("issued campaign created", s == 201, json.dumps(welcome))
s, _ = call("POST", "/admin/campaigns", {
    "name": "bad", "kind": "CODE", "code": f"MRDK{run}",
    "discountType": "AMOUNT", "valueCents": 100}, OWNER)
check("duplicate code rejected 409", s == 409, s)

# --- member + personal voucher
phone = "01" + str(uuid.uuid4().int)[:8]
_, member = call("POST", "/members", {"phone": phone, "name": "Voucher Vera"}, OWNER)
s, voucher = call("POST", f"/admin/campaigns/{welcome['id']}/issue", {"memberId": member["id"]}, OWNER)
check("voucher issued with code", s == 201 and voucher["code"].startswith("V-"), json.dumps(voucher))
s, mv = call("GET", f"/members/{member['id']}/vouchers", token=OWNER)
check("member voucher list shows it", any(v["code"] == voucher["code"] for v in mv), json.dumps(mv))

# --- menu items
_, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
prods = {p["name"]: p for c in menu["categories"] for p in c["products"]}
cr = prods["Hainanese Chicken Rice"]
kopi = prods["Kopi O"]

# --- promo code: min spend enforcement
o1 = str(uuid.uuid4())
call("POST", "/orders", {"id": o1, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 1}]}, OWNER)  # RM2.80 subtotal
s, err = call("POST", f"/orders/{o1}/voucher", {"code": f"MRDK{run}"}, OWNER)
check("below min spend rejected 400", s == 400, s)

# --- promo on RM24 order: 10% = 2.40 capped at 5.00 -> 2.40; svc/tax on 21.60
o2 = str(uuid.uuid4())
_, order2 = call("POST", "/orders", {"id": o2, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": cr["id"], "quantity": 2}]}, OWNER)
s, disc = call("POST", f"/orders/{o2}/voucher", {"code": f"mrdk{run.lower()}"}, OWNER)
check("promo applied (case-insensitive)", s == 201, json.dumps(disc) if s != 201 else "")
check("discount 240", disc["discountCents"] == 240, disc["discountCents"])
check("svc on discounted base (216)", disc["serviceChargeCents"] == 216, disc["serviceChargeCents"])
check("tax on discounted base (143)", disc["taxCents"] == 143, disc["taxCents"])
check("total 2519", disc["totalCents"] == 2519, disc["totalCents"])
s, _ = call("POST", f"/orders/{o2}/voucher", {"code": voucher["code"]}, OWNER)
check("second voucher on same order rejected 409", s == 409, s)

# --- remove restores totals and decrements usage
s, removed = call("DELETE", f"/orders/{o2}/voucher", {}, OWNER)
check("voucher removed", s == 200 and removed["discountCents"] == 0 and removed["totalCents"] == order2["totalCents"], f"{removed['discountCents']} / {removed['totalCents']}")
_, camps = call("GET", "/admin/campaigns", token=OWNER)
promo_row = next(c for c in camps if c["id"] == promo["id"])
check("promo usedCount back to 0", promo_row["usedCount"] == 0, promo_row["usedCount"])

# --- personal voucher: auto-attaches member, one-time use
s, applied = call("POST", f"/orders/{o2}/voucher", {"code": voucher["code"]}, OWNER)
check("personal voucher applied (RM5 off)", s == 201 and applied["discountCents"] == 500, json.dumps(applied) if s != 201 else "")
check("member auto-attached", applied["memberId"] == member["id"], applied.get("memberId"))

# pay -> voucher consumed; points earn on discounted total
_, pay = call("POST", f"/orders/{o2}/payments", {"method": "CASH", "tenderedCents": 5000}, OWNER)
check("paid with discount", pay["order"]["status"] == "COMPLETED", pay["order"]["status"])
spent = pay["order"]["totalCents"] + pay["order"]["roundingCents"]
_, mdetail = call("GET", f"/members/{member['id']}", token=OWNER)
check("points earned on discounted total", mdetail["pointsBalance"] == spent // 100, f"{mdetail['pointsBalance']} vs {spent//100}")
s, mv = call("GET", f"/members/{member['id']}/vouchers", token=OWNER)
check("voucher no longer usable", not any(v["code"] == voucher["code"] for v in mv), json.dumps(mv))
o3 = str(uuid.uuid4())
call("POST", "/orders", {"id": o3, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": cr["id"], "quantity": 2}]}, OWNER)
s, _ = call("POST", f"/orders/{o3}/voucher", {"code": voucher["code"]}, OWNER)
check("reuse of redeemed voucher rejected 409", s == 409, s)

# --- maxUses on promo codes
s, limited = call("POST", "/admin/campaigns", {
    "name": f"OneUse {run}", "kind": "CODE", "code": f"ONE{run}",
    "discountType": "AMOUNT", "valueCents": 100, "maxUses": 1}, OWNER)
call("POST", f"/orders/{o3}/voucher", {"code": f"ONE{run}"}, OWNER)
o4 = str(uuid.uuid4())
call("POST", "/orders", {"id": o4, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 1}]}, OWNER)
s, _ = call("POST", f"/orders/{o4}/voucher", {"code": f"ONE{run}"}, OWNER)
check("maxUses exhausted rejected 409", s == 409, s)

# --- inactive campaign rejected
call("PATCH", f"/admin/campaigns/{promo['id']}", {"active": False}, OWNER)
s, _ = call("POST", f"/orders/{o4}/voucher", {"code": f"MRDK{run}"}, OWNER)
check("inactive campaign rejected 400", s == 400, s)

# --- payment-started guard
o5 = str(uuid.uuid4())
call("POST", "/orders", {"id": o5, "outletId": OUTLET, "type": "DINE_IN", "source": "POS",
    "items": [{"productId": cr["id"], "quantity": 2}]}, OWNER)
call("POST", f"/orders/{o5}/payments", {"method": "CASH", "tenderedCents": 500}, OWNER)
s, _ = call("POST", f"/orders/{o5}/voucher", {"code": f"ONE{run}"}, OWNER)
check("apply after payment started rejected 409", s == 409, s)

# --- role gates
_, reg = call("POST", "/devices", {"outletId": OUTLET, "name": f"VchTest {run}", "kind": "POS"}, OWNER)
pin = str(uuid.uuid4().int)[:6]
call("POST", "/staff", {"name": "Vch Cashier", "role": "CASHIER", "pin": pin}, OWNER)
_, cashier = call("POST", "/auth/pin-login", {"pin": pin}, headers={"X-Device-Token": reg["deviceToken"]})
o6 = str(uuid.uuid4())
call("POST", "/orders", {"id": o6, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": cr["id"], "quantity": 2}]}, cashier["token"])
s, _ = call("POST", f"/orders/{o6}/voucher", {"code": f"ONE{run}"}, cashier["token"])
check("cashier can apply codes (409 exhausted is fine)", s in (201, 409), s)
s, _ = call("POST", "/admin/campaigns", {"name": "x", "kind": "CODE", "code": "XX123", "discountType": "AMOUNT", "valueCents": 1}, cashier["token"])
check("cashier cannot create campaigns 403", s == 403, s)

print("\nSOME CHECKS FAILED" if failed[0] else "\nAll voucher/campaign e2e checks passed.")
raise SystemExit(1 if failed[0] else 0)
