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
month = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m")

# --- profile gating
s, prof = call("GET", "/admin/einvoice/profile", token=OWNER)
check("profile loads with providers", s == 200 and "MOCK" in prof["providers"], json.dumps(prof))
if prof["tin"] is None:
    s, _ = call("POST", "/admin/einvoice/consolidated", {"month": month}, OWNER)
    check("submit without TIN rejected 400", s == 400, s)
else:
    print("PASS  submit without TIN rejected 400 (profile already set, skipped)")

s, prof = call("PATCH", "/admin/einvoice/profile", {
    "tin": "C21876543210", "brn": "202001012345", "sstNo": "W10-1808-32100062",
    "msicCode": "56103", "invoiceAddress": "12 Jalan SS2/64, Petaling Jaya, Selangor"}, OWNER)
check("profile saved", s == 200 and prof["tin"] == "C21876543210", json.dumps(prof))

# --- make a completed order, then individual e-invoice
_, menu = call("GET", f"/outlets/{OUTLET}/menu", token=OWNER)
prods = {p["name"]: p for c in menu["categories"] for p in c["products"]}
cr = prods["Hainanese Chicken Rice"]
oid = str(uuid.uuid4())
_, order = call("POST", "/orders", {"id": oid, "outletId": OUTLET, "type": "TAKEAWAY", "source": "POS",
    "items": [{"productId": cr["id"], "quantity": 2}]}, OWNER)
buyer = {"name": "Tan Ah Kow Enterprise", "tin": "C10203040506", "idType": "BRN", "idValue": "201901054321"}

s, _ = call("POST", f"/admin/einvoice/orders/{oid}", {"buyer": buyer}, OWNER)
check("open order rejected 409", s == 409, s)
_, payres = call("POST", f"/orders/{oid}/payments", {"method": "CARD"}, OWNER)
total = payres["order"]["totalCents"] + payres["order"]["roundingCents"]

s, inv = call("POST", f"/admin/einvoice/orders/{oid}", {"buyer": buyer}, OWNER)
check("individual e-invoice submitted", s == 201 and inv["status"] == "SUBMITTED", json.dumps(inv))
check("individual totals match order", inv["totalCents"] == total and inv["taxCents"] == payres["order"]["taxCents"], f"{inv['totalCents']} vs {total}")
doc = inv["docJson"]
check("doc supplier carries TIN/BRN/MSIC", doc["supplier"]["tin"] == "C21876543210" and doc["supplier"]["brn"] == "202001012345" and doc["supplier"]["msicCode"] == "56103", json.dumps(doc["supplier"]))
check("doc buyer recorded", doc["buyer"]["name"] == buyer["name"] and doc["buyer"]["tin"] == buyer["tin"], json.dumps(doc["buyer"]))
check("doc has item lines", len(doc["lines"]) == 1 and doc["lines"][0]["quantity"] == 2, json.dumps(doc["lines"]))

s, _ = call("POST", f"/admin/einvoice/orders/{oid}", {"buyer": buyer}, OWNER)
check("duplicate individual rejected 409", s == 409, s)

# --- refresh -> VALID with longId + qr link
s, refreshed = call("POST", f"/admin/einvoice/{inv['id']}/refresh", {}, OWNER)
check("refresh validates", s == 201 and refreshed["status"] == "VALID" and refreshed["longId"] and refreshed["qrUrl"], json.dumps({k: refreshed[k] for k in ('status','longId','qrUrl')}))

# --- consolidated preview excludes the individually-invoiced order
s, prev = call("GET", f"/admin/einvoice/consolidated/preview?month={month}", token=OWNER)
check("preview loads", s == 200 and prev["orderCount"] >= 1, json.dumps(prev))
check("individually-invoiced excluded", prev["excludedIndividuallyInvoiced"] >= 1, prev["excludedIndividuallyInvoiced"])
s, _ = call("GET", "/admin/einvoice/consolidated/preview?month=garbage", token=OWNER)
check("bad month rejected 400", s == 400, s)

# --- consolidated submit
s, cons = call("POST", "/admin/einvoice/consolidated", {"month": month}, OWNER)
if s == 409:
    print("PASS  consolidated submitted (exists from a previous run — skipping detail checks)")
    _, lst0 = call("GET", "/admin/einvoice", token=OWNER)
    cons = next(r for r in lst0 if r["type"] == "CONSOLIDATED" and (datetime.datetime.fromisoformat(r["periodStart"].replace("Z", "+00:00")) + datetime.timedelta(hours=8)).strftime("%Y-%m") == month)
else:
    check("consolidated submitted", s == 201 and cons["type"] == "CONSOLIDATED", json.dumps(cons) if s != 201 else "")
    check("consolidated totals = preview", cons["totalCents"] == prev["totalCents"] and cons["orderCount"] == prev["orderCount"], f"{cons['totalCents']} vs {prev['totalCents']}")
    cdoc = cons["docJson"]
    check("consolidated buyer = General Public TIN", cdoc["buyer"]["tin"] == "EI00000000010", json.dumps(cdoc["buyer"]))
    check("consolidated line mentions receipts", "receipts #" in cdoc["lines"][0]["description"], cdoc["lines"][0]["description"])

s, _ = call("POST", "/admin/einvoice/consolidated", {"month": month}, OWNER)
check("duplicate month rejected 409", s == 409, s)

s, refreshed2 = call("POST", f"/admin/einvoice/{cons['id']}/refresh", {}, OWNER)
check("consolidated validates", refreshed2["status"] == "VALID", refreshed2["status"])

# --- list shows both
s, lst = call("GET", "/admin/einvoice", token=OWNER)
types = [r["type"] for r in lst]
check("list has both documents", "INDIVIDUAL" in types and "CONSOLIDATED" in types, json.dumps(types))

# --- role gate
_, reg = call("POST", "/devices", {"outletId": OUTLET, "name": f"EinvTest {uuid.uuid4().hex[:4]}", "kind": "POS"}, OWNER)
pin = str(uuid.uuid4().int)[:6]
call("POST", "/staff", {"name": "Einv Cashier", "role": "CASHIER", "pin": pin}, OWNER)
_, cashier = call("POST", "/auth/pin-login", {"pin": pin}, headers={"X-Device-Token": reg["deviceToken"]})
s, _ = call("GET", "/admin/einvoice", token=cashier["token"])
check("cashier blocked 403", s == 403, s)

print("\nSOME CHECKS FAILED" if failed[0] else "\nAll e-invoicing e2e checks passed.")
raise SystemExit(1 if failed[0] else 0)
