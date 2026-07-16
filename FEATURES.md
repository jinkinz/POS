# POS — Full-Suite F&B System · Feature Map

Target market: food & beverage businesses in **Malaysia and Singapore** (cafés, restaurants, kopitiams, food courts, chains/franchises), with retail-hybrid support (bakery counters, consignment shelves, merch).

---

## 1. POS Core (Front of House)

- Order types: **dine-in, takeaway, pickup, delivery, self-service kiosk**
- Table management: visual floor plan, zones, merge/split/transfer tables, table status
- Bill operations: **split bill** (by item / evenly / by amount), merge bills, partial payment, deposits for large bookings
- Coursing & hold-fire (appetizers before mains)
- Open price items, price override & void/refund **with manager PIN + audit trail**
- Discounts: item/bill level, percentage/fixed, promo codes, happy-hour & time-based pricing, staff meals
- Service charge (10%), configurable per outlet
- Tax engine: **Malaysia SST (6%/8%)**, **Singapore GST (9%)**, tax-inclusive vs exclusive pricing
- **Malaysia 5-sen cash rounding** (mandatory rounding mechanism)
- Tipping / gratuity
- **Offline-first mode with automatic sync** — POS must keep selling when internet drops (non-negotiable for F&B)
- Multi-terminal per outlet with real-time sync
- Shift management: cash float, cash in/out, blind cash-up, **X report / end-of-day Z report**
- Hardware: ESC/POS receipt printers, cash drawer kick, barcode scanners, label printers, weighing scales (for per-gram items), customer-facing second display
- Receipt customization, e-receipts (SMS/email/QR)

## 2. QR Table Ordering (Customer-Facing Web)

- Per-table QR code opening a web menu (no app install), session-scoped tokens so orders bind to the right table
- **Multi-language menus: English / Bahasa Malaysia / 中文** (extendable)
- Item photos, modifiers (sugar level, spice level, add-ons), combos/set meals, notes
- Real-time **sold-out ("86") sync** — item disabled everywhere the moment kitchen flags it
- Flows: order-first-pay-later (dine-in tab) and **pay-first** (food court style) — configurable per outlet
- Pay at table (e-wallet/card) or pay at counter
- Call-waiter / request-bill button
- Re-order from order history within session
- Group ordering: multiple phones on one table feed one bill

## 3. Kitchen Display System (KDS)

- Orders routed by **station** (wok, fryer, grill, drinks, dessert, expo)
- Bump / recall / prioritize; prep timers with SLA color alerts
- Expo screen consolidating all stations before serving
- Order coursing & sequencing
- Kitchen printer fallback (per-station printers) when screens are down
- All-day view (aggregate counts: "12 × chicken rice pending")
- Sold-out toggling from the kitchen side

## 4. Payments (MY / SG)

- Cards: credit/debit, **paywave/contactless (EMV)**, UnionPay
- **Malaysia QR**: DuitNow QR, Touch 'n Go eWallet, GrabPay, Boost, ShopeePay, MAE
- **Singapore QR**: PayNow, SGQR, GrabPay, ShopeePay
- **China wallets**: Alipay / Alipay+, WeChat Pay (tourist spend)
- Gateway/terminal integrations (pluggable): Fiuu (Razer Merchant Services), iPay88, GHL, Revenue Monster, HitPay, Stripe, Adyen
- Split tender (part cash, part card, part wallet)
- Refunds, partial refunds, payment reversal with audit trail
- **Settlement reconciliation**: match gateway payouts vs POS records, flag discrepancies, MDR fee tracking
- Gift cards & stored-value (prepaid top-up wallet tied to CRM member)

## 5. Invoicing & Tax Compliance

- Receipt → tax invoice conversion, B2B invoicing with company details
- **Malaysia LHDN MyInvois e-invoicing** (mandatory rollout — validation, QR on invoice, consolidated e-invoice for B2C)
- **Singapore InvoiceNow (Peppol)** e-invoicing
- Credit notes / debit notes
- SST / GST reporting exports

## 6. Product & Menu Management

- Categories, items, **variants** (size, hot/cold), modifier groups with rules (min/max, forced choice)
- Combos & set meals with component swaps and upcharges
- Menu scheduling: breakfast/lunch/dinner menus, day-of-week availability, seasonal items
- Multi-outlet menus: shared master catalog with per-outlet pricing & availability overrides
- Cost price tracking → live **margin analysis** per item
- Barcode / SKU / PLU support for retail items
- Photo management, allergen & dietary tags (halal indicators matter in MY)

## 7. Inventory, Ingredients & Consignment

- **Recipe / BOM**: each menu item maps to ingredients; every sale auto-deducts stock
- **Theoretical vs actual usage variance** (shrinkage/leakage detection — where F&B profit dies)
- Purchasing: suppliers, purchase orders, goods received notes (GRN), invoice matching, supplier price history
- Stocktake (full & cycle counts) with variance reports
- Wastage & spoilage logging with reasons
- **Batch/expiry tracking, FEFO** for perishables
- Low-stock alerts, par levels, suggested auto-reorder
- Inter-outlet **stock transfers**; central kitchen / commissary production (semi-finished goods, prep batches)
- **Consignment**: consignor profiles, consigned stock intake, sales tracking per consignor, commission rules, settlement statements & payouts
- Retail inventory: serialized/non-serialized SKUs, barcode receiving

## 8. CRM & Loyalty

- Member profiles (phone-number-first signup, PDPA-compliant consent — both MY & SG have PDPA)
- **Points earn/redeem**, tier levels, cashback, stored-value wallet
- Vouchers: issue, campaigns, birthday rewards, referral rewards
- Purchase history & preferences; segmentation (RFM: recency/frequency/monetary)
- Campaigns: WhatsApp / SMS / email blasts to segments
- Feedback collection (post-payment QR survey), Google review funneling

## 9. HR, Staffing & Workforce Management (MY / SG)

### 9.1 Staffing & employee lifecycle
- Staff profiles, roles, grades, multi-outlet assignment; **part-timer / casual worker pool** shared across outlets
- Recruitment basics: job postings, applicant tracking, interview scheduling
- **Onboarding / offboarding checklists**, e-contracts with digital signature, uniform & equipment issuance tracking
- Employee self-service portal / mobile app (payslips, roster, leave, claims in one place)
- **Certification & compliance tracking with expiry reminders**: food handler course & typhoid vaccination (mandatory in MY), SG WSQ Food Safety Course, halal training
- **Foreign worker management**: work permit / PLKS / Employment Pass / S Pass expiry tracking, SG foreign worker levy (FWL) & quota/dependency-ratio monitoring, passport expiry alerts
- Skills matrix / station qualification (who is trained for wok, barista, cashier, expo) — feeds the roster
- Disciplinary records, warning letters, incident log
- Staff announcements / noticeboard, SOP documents & training quizzes

### 9.2 Rostering & attendance
- **Rostering / shift scheduling** with labor-cost preview against forecast sales (demand-based staffing suggestions)
- Staff availability submission, **open-shift bidding/claiming** for part-timers, shift swap requests with approval
- Labor-law guardrails: max working hours, OT caps (MY 104 hrs/month), mandatory rest days, break tracking
- Attendance: clock in/out via POS PIN, personal QR, or selfie/geofenced mobile clock-in; lateness & OT auto-computation
- Floating staff across outlets with per-outlet attendance costing

### 9.3 E-Leave
- Leave types: annual, sick/MC, hospitalization, **maternity (98 days MY / 16 weeks SG), paternity, SG childcare leave**, compassionate, marriage, unpaid, replacement leave for public holidays worked
- **Statutory entitlement auto-computation** by length of service (MY Employment Act / SG Employment Act minimums), pro-ration for joiners/leavers, carry-forward & encashment rules
- Approval workflow with delegation, team leave calendar, **blackout dates** (e.g., no leave during CNY/Raya rush), min-staffing conflict warnings against the roster
- MC photo upload & verification; leave balance visible in staff app
- **Public holiday calendars per MY state** (states differ) and SG, auto-applied to roster, pay rates & leave

### 9.4 E-Claims
- Expense claims (meal, transport, medical, phone) with receipt photo upload, per-grade limits, approval flow, payout via payroll

### 9.5 Payroll (statutory MY / SG)
- **Malaysia**: EPF, SOCSO, EIS, PCB/MTD, HRDF levy; EA form, Borang E
- **Singapore**: CPF, SDL, self-help group funds (CDAC/SINDA/MBMF/ECF); IR8A / AIS submission
- Hourly part-timer pay auto-calculated from attendance; overtime, public-holiday & rest-day rates, shift allowances
- Tip pooling & service-charge point distribution rules
- Commission & incentive schemes driven by POS sales data (per-staff sales, upsell contests, leaderboards)
- Salary advance / earned wage access (common for F&B crew)
- Payslip generation; **bank bulk-payment file export** (DuitNow bulk / GIRO)
- Payroll audit trail, retro-pay adjustments, statutory rate updates

## 10. Reporting & Analytics

- Real-time dashboard: sales, covers, average check, top items — per outlet & consolidated
- Sales breakdowns: by hour/day, item, category, staff, order type, payment method, channel
- **Menu engineering matrix** (stars / plowhorses / puzzles / dogs — popularity × margin)
- Food cost % and labor cost % vs revenue
- Void/discount/refund audit reports (fraud detection)
- Consignment settlement reports; inventory valuation & COGS
- Scheduled email/WhatsApp report delivery (daily EOD summary to owner)
- **Accounting exports**: Xero, QuickBooks, AutoCount, SQL Account (MY favorites)

## 11. Additional Modules (suggested — commonly requested next)

- **Delivery aggregator integration**: GrabFood, foodpanda, ShopeeFood — menu sync + order injection into KDS (huge operational win, avoids tablet hell)
- **Reservations & waitlist**: bookings, deposits, no-show tracking; **queue management** with number calling screen (kopitiam/food court)
- **Self-order kiosk** mode (reuses QR ordering UI on a mounted tablet)
- **Franchise management**: royalty calculation, franchisee dashboards, controlled menu pushes
- Multi-company / multi-brand under one account
- Role-based access control + full audit log across the suite
- Open **API & webhooks** for third-party integrations
- Customer-facing order-status board ("Order #42 ready")

---

## Suggested MVP phasing

| Phase | Scope |
|-------|-------|
| 1 | POS core + product/menu + payments (cash, card via one gateway, DuitNow/PayNow QR) + receipts + basic sales reports + offline mode |
| 2 | QR table ordering + KDS + table management |
| 3 | Inventory/recipe/ingredient tracking + purchasing + consignment |
| 4 | CRM/loyalty + invoicing/e-invoice compliance (MyInvois, InvoiceNow) |
| 5 | HR payroll (MY/SG statutory) + advanced analytics + aggregator integrations |

Cross-cutting from day one: multi-outlet data model, RBAC, audit logging, offline-first sync architecture, multi-language, multi-currency (MYR/SGD).
