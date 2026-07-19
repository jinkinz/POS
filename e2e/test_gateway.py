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

# --- providers list includes MOCK in dev
s, providers = call("GET", "/payments/providers", token=OWNER)
check("mock provider available", s == 200 and any(p["provider"] == "MOCK" for p in providers), json.dumps(providers))

# --- order to pay: kopi x2
_, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
prods = {p["name"]: p for c in menu["categories"] for p in c["products"]}
kopi = prods["Kopi O"]
oid = str(uuid.uuid4())
_, order = call("POST", "/orders", {"id": oid, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 2}]}, OWNER)
total = order["totalCents"]

# --- create gateway payment for remaining balance
s, gp = call("POST", f"/orders/{oid}/gateway-payments", {"provider": "MOCK"}, OWNER)
check("gateway payment created", s == 201 and gp["status"] == "PENDING", json.dumps(gp))
check("amount = remaining balance", gp["amountCents"] == total, f"{gp['amountCents']} vs {total}")
check("QR data present", gp["qrData"] and gp["providerRef"] in gp["qrData"], gp.get("qrData"))

# --- reuse: second create returns the same pending intent
s, gp2 = call("POST", f"/orders/{oid}/gateway-payments", {"provider": "MOCK"}, OWNER)
check("pending intent reused", gp2["id"] == gp["id"], f"{gp2['id']} vs {gp['id']}")

# --- webhook with wrong secret rejected
s, _ = call("POST", "/webhooks/mock", {"ref": gp["providerRef"], "status": "completed", "secret": "wrong"})
check("bad webhook secret rejected 401", s == 401, s)
s, o = call("GET", f"/orders/{oid}", token=OWNER)
check("order still OPEN after bad webhook", o["status"] == "OPEN", o["status"])

# --- unknown ref rejected
s, _ = call("POST", "/webhooks/mock", {"ref": "mock_nope", "status": "completed", "secret": "mock-secret"})
check("unknown ref rejected 404", s == 404, s)

# --- correct webhook settles the order
s, wh = call("POST", "/webhooks/mock", {"ref": gp["providerRef"], "status": "completed", "secret": "mock-secret"})
check("webhook accepted", s == 201 and wh["status"] == "SUCCEEDED", json.dumps(wh))
s, gp_after = call("GET", f"/orders/{oid}/gateway-payments/{gp['id']}", token=OWNER)
check("gateway payment SUCCEEDED", gp_after["status"] == "SUCCEEDED", gp_after["status"])
s, o = call("GET", f"/orders/{oid}", token=OWNER)
check("order COMPLETED", o["status"] == "COMPLETED", o["status"])
qr_pay = [p for p in o["payments"] if p["method"] == "QR_WALLET"]
check("QR_WALLET payment recorded", len(qr_pay) == 1 and qr_pay[0]["amountCents"] == total, json.dumps(o["payments"]))
check("gatewayRef recorded", qr_pay[0]["gatewayRef"] == f"MOCK:{gp['providerRef']}", qr_pay[0]["gatewayRef"])

# --- duplicate webhook is idempotent (gateways retry)
call("POST", "/webhooks/mock", {"ref": gp["providerRef"], "status": "completed", "secret": "mock-secret"})
_, o = call("GET", f"/orders/{oid}", token=OWNER)
check("webhook replay: still 1 payment", len([p for p in o["payments"] if p["method"] == "QR_WALLET"]) == 1, len(o["payments"]))

# --- split tender: cash first, gateway covers the rest
oid2 = str(uuid.uuid4())
_, order2 = call("POST", "/orders", {"id": oid2, "outletId": OUTLET, "type": "DINE_IN", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 3}]}, OWNER)
call("POST", f"/orders/{oid2}/payments", {"method": "CASH", "tenderedCents": 500}, OWNER)  # partial RM5
s, gp3 = call("POST", f"/orders/{oid2}/gateway-payments", {"provider": "MOCK"}, OWNER)
expected_remaining = order2["totalCents"] - 500
check("gateway amount = post-cash remainder", gp3["amountCents"] == expected_remaining, f"{gp3['amountCents']} vs {expected_remaining}")
call("POST", "/webhooks/mock", {"ref": gp3["providerRef"], "status": "completed", "secret": "mock-secret"})
_, o2 = call("GET", f"/orders/{oid2}", token=OWNER)
check("split-tender order completed", o2["status"] == "COMPLETED", o2["status"])

# --- cancel flow
oid3 = str(uuid.uuid4())
call("POST", "/orders", {"id": oid3, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": kopi["id"], "quantity": 1}]}, OWNER)
_, gp4 = call("POST", f"/orders/{oid3}/gateway-payments", {"provider": "MOCK"}, OWNER)
s, canceled = call("POST", f"/orders/{oid3}/gateway-payments/{gp4['id']}/cancel", {}, OWNER)
check("cancel works", s == 201 and canceled["status"] == "CANCELED", s)
s, _ = call("POST", "/webhooks/mock", {"ref": gp4["providerRef"], "status": "completed", "secret": "mock-secret"})
_, o3 = call("GET", f"/orders/{oid3}", token=OWNER)
check("webhook after cancel does not pay", o3["status"] == "OPEN" and len(o3["payments"]) == 0, o3["status"])

# --- failed payment
_, gp5 = call("POST", f"/orders/{oid3}/gateway-payments", {"provider": "MOCK"}, OWNER)
call("POST", "/webhooks/mock", {"ref": gp5["providerRef"], "status": "failed", "secret": "mock-secret"})
_, gp5_after = call("GET", f"/orders/{oid3}/gateway-payments/{gp5['id']}", token=OWNER)
check("failed webhook marks FAILED", gp5_after["status"] == "FAILED", gp5_after["status"])
_, o3 = call("GET", f"/orders/{oid3}", token=OWNER)
check("order untouched by failure", o3["status"] == "OPEN" and len(o3["payments"]) == 0, o3["status"])

# --- paying an already-completed order rejected
s, _ = call("POST", f"/orders/{oid}/gateway-payments", {"provider": "MOCK"}, OWNER)
check("gateway payment on paid order rejected 409", s == 409, s)

# --- kitchen role cannot start payments
_, reg = call("POST", "/devices", {"outletId": OUTLET, "name": f"GwTest {uuid.uuid4().hex[:4]}", "kind": "POS"}, OWNER)
pin = str(uuid.uuid4().int)[:6]
call("POST", "/staff", {"name": "Gw Kitchen", "role": "KITCHEN", "pin": pin}, OWNER)
_, kit = call("POST", "/auth/pin-login", {"pin": pin}, headers={"X-Device-Token": reg["deviceToken"]})
s, _ = call("POST", f"/orders/{oid3}/gateway-payments", {}, kit["token"])
check("kitchen role blocked 403", s == 403, s)

print("\nSOME CHECKS FAILED" if failed[0] else "\nAll gateway e2e checks passed.")
raise SystemExit(1 if failed[0] else 0)
