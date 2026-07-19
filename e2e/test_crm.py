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
phone = "01" + str(uuid.uuid4().int)[:8]

# --- create member; duplicate (with formatting differences) rejected
s, member = call("POST", "/members", {"phone": phone, "name": "Mei Ling"}, OWNER)
check("member created", s == 201, json.dumps(member))
MID = member["id"]
pretty = phone[:3] + "-" + phone[3:6] + " " + phone[6:]
s, _ = call("POST", "/members", {"phone": pretty}, OWNER)
check("duplicate phone (formatted) rejected 409", s == 409, s)
s, look = call("GET", f"/members?phone={urllib.request.quote(pretty)}", token=OWNER)
check("lookup normalizes phone", look["member"] and look["member"]["id"] == MID, json.dumps(look))

# --- order with member at creation; cash pay -> earn
_, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
check("menu exposes loyalty rates", menu["outlet"]["loyaltyEarnPerCurrencyUnit"] == 1 and menu["outlet"]["loyaltyRedeemCentsPerPoint"] == 1, json.dumps(menu["outlet"]))
prods = {p["name"]: p for c in menu["categories"] for p in c["products"]}
kopi = prods["Kopi O"]
cr = prods["Hainanese Chicken Rice"]

o1 = str(uuid.uuid4())
_, order1 = call("POST", "/orders", {"id": o1, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "memberId": MID, "items": [{"productId": cr["id"], "quantity": 1}]}, OWNER)
check("order carries memberId", order1["memberId"] == MID, order1.get("memberId"))
pay_id = str(uuid.uuid4())
s, pay1 = call("POST", f"/orders/{o1}/payments", {"id": pay_id, "method": "CASH", "tenderedCents": 2000}, OWNER)
spent1 = pay1["order"]["totalCents"] + pay1["order"]["roundingCents"]
expected_pts1 = (spent1 // 100) * 1
s, m = call("GET", f"/members/{MID}", token=OWNER)
check("points earned on completion", m["pointsBalance"] == expected_pts1, f"{m['pointsBalance']} vs {expected_pts1}")
check("visit + lifetime tracked", m["visits"] == 1 and m["lifetimeSpendCents"] == spent1, f"{m['visits']} / {m['lifetimeSpendCents']}")
check("EARN in ledger with order ref", any(t["type"] == "EARN" and t["orderId"] == o1 for t in m["transactions"]), json.dumps(m["transactions"]))

# --- pay replay doesn't double-award
call("POST", f"/orders/{o1}/payments", {"id": pay_id, "method": "CASH", "tenderedCents": 2000}, OWNER)
_, m = call("GET", f"/members/{MID}", token=OWNER)
check("award idempotent on pay replay", m["pointsBalance"] == expected_pts1, m["pointsBalance"])

# --- attach to open order + redeem points as payment
o2 = str(uuid.uuid4())
_, order2 = call("POST", "/orders", {"id": o2, "outletId": OUTLET, "type": "DINE_IN", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 2}]}, OWNER)
s, attached = call("POST", f"/orders/{o2}/member", {"memberId": MID}, OWNER)
check("member attached to open order", s == 201 and attached["memberId"] == MID, s)

balance = m["pointsBalance"]
s, err = call("POST", f"/orders/{o2}/redeem-points", {"points": balance + 999}, OWNER)
check("over-balance redeem rejected 400", s == 400, s)
redeem_pts = min(balance, 5)
s, red = call("POST", f"/orders/{o2}/redeem-points", {"points": redeem_pts}, OWNER)
check("partial redeem accepted", s == 201, json.dumps(red) if s != 201 else "")
pts_pay = [p for p in red["payments"] if p["method"] == "POINTS"]
check("POINTS payment on order", len(pts_pay) == 1 and pts_pay[0]["amountCents"] == redeem_pts, json.dumps(red["payments"]))
check("order still open after partial redeem", red["status"] == "OPEN", red["status"])

# cash for the rest -> completes and earns again on full total
s, pay2 = call("POST", f"/orders/{o2}/payments", {"method": "CASH"}, OWNER)
check("order completed", pay2["order"]["status"] == "COMPLETED", pay2["order"]["status"])
spent2 = pay2["order"]["totalCents"] + pay2["order"]["roundingCents"]
expected_final = expected_pts1 - redeem_pts + (spent2 // 100)
_, m = call("GET", f"/members/{MID}", token=OWNER)
check("balance = earn1 - redeem + earn2", m["pointsBalance"] == expected_final, f"{m['pointsBalance']} vs {expected_final}")
check("REDEEM negative in ledger", any(t["type"] == "REDEEM" and t["points"] == -redeem_pts for t in m["transactions"]), json.dumps([t for t in m['transactions'] if t['type']=='REDEEM']))
check("visits = 2", m["visits"] == 2, m["visits"])

# --- redeem on unattached/completed orders rejected
s, _ = call("POST", f"/orders/{o2}/redeem-points", {"points": 1}, OWNER)
check("redeem on completed order rejected 409", s == 409, s)
o3 = str(uuid.uuid4())
call("POST", "/orders", {"id": o3, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 1}]}, OWNER)
s, _ = call("POST", f"/orders/{o3}/redeem-points", {"points": 1}, OWNER)
check("redeem without member rejected 400", s == 400, s)

# --- gateway settle also awards
_, gp = call("POST", f"/orders/{o3}/member", {"memberId": MID}, OWNER)
s, gpay = call("POST", f"/orders/{o3}/gateway-payments", {"provider": "MOCK"}, OWNER)
before = m["pointsBalance"]
call("POST", "/webhooks/mock", {"ref": gpay["providerRef"], "status": "completed", "secret": "mock-secret"})
_, m = call("GET", f"/members/{MID}", token=OWNER)
check("gateway completion awards points", m["pointsBalance"] > before, f"{m['pointsBalance']} vs {before}")

# --- admin: adjust, clamp, list, roles
s, adj = call("POST", f"/admin/members/{MID}/points-adjust", {"points": 100, "reason": "goodwill"}, OWNER)
check("admin adjust +100", s == 201 and adj["pointsBalance"] == m["pointsBalance"] + 100, json.dumps(adj))
s, _ = call("POST", f"/admin/members/{MID}/points-adjust", {"points": -999999, "reason": "nope"}, OWNER)
check("negative-balance adjust rejected 400", s == 400, s)
s, lst = call("GET", f"/admin/members?search=Mei", token=OWNER)
check("admin search finds member", any(x["id"] == MID for x in lst), json.dumps([x['name'] for x in lst]))

_, reg = call("POST", "/devices", {"outletId": OUTLET, "name": f"CrmTest {uuid.uuid4().hex[:4]}", "kind": "POS"}, OWNER)
pin = str(uuid.uuid4().int)[:6]
call("POST", "/staff", {"name": "Crm Cashier", "role": "CASHIER", "pin": pin}, OWNER)
_, cashier = call("POST", "/auth/pin-login", {"pin": pin}, headers={"X-Device-Token": reg["deviceToken"]})
s, _ = call("GET", f"/members?phone={phone}", token=cashier["token"])
check("cashier can look up members", s == 200, s)
s, _ = call("POST", f"/admin/members/{MID}/points-adjust", {"points": 5, "reason": "sneaky"}, cashier["token"])
check("cashier cannot adjust points 403", s == 403, s)

print("\nSOME CHECKS FAILED" if failed[0] else "\nAll CRM e2e checks passed.")
raise SystemExit(1 if failed[0] else 0)
