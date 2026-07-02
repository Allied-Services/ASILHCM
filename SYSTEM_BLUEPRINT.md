# ASIL HCM — SYSTEM BLUEPRINT
**Allied Services International Limited (Pvt.) Ltd.**
*Version 3.0 — Deep Audit Edition — April 2026*
*Maintained by: Antigravity AI Development Consultant*

---

## QUICK REFERENCE — DEPLOYMENT

| Item | Value |
|---|---|
| **Live URL** | https://hcm.asil.com.pk |
| **Backend (Render)** | https://asilhcm.onrender.com |
| **Frontend (Render)** | https://asil-hcm-frontend.onrender.com |
| **Database** | Neon Postgres (Serverless) |
| **Repository** | GitHub → main branch (auto-deploys on push) |
| **Authentication** | Google OAuth 2.0 (restricted to @asil.com.pk) |

---

## SECTION 1 — TECHNOLOGY STACK

### Backend
- **Runtime**: Node.js + Express.js (single `server.js` file, ~3,800 lines)
- **Database**: PostgreSQL via `pg` (Neon serverless)
- **Authentication**: Google OAuth 2.0 via Passport.js + JWT (8-hour tokens)
- **AI**: OpenAI GPT-4o (Vision) for Katcha Bill OCR
- **SMS**: Jazz CMT API (GET-based, server-IP whitelisted)
- **Email**: Nodemailer (Gmail App Password)
- **PDF**: pdf-lib (server-side HTML payslips, client-side documents)

### Frontend
- **Framework**: React 18 + Vite
- **Styling**: Vanilla CSS (dark theme, CSS variables)
- **Icons**: Lucide React
- **API**: Custom `api.js` wrapper using `fetch` with `Authorization: Bearer <JWT>`

### Infrastructure
- **Hosting**: Render.com (free tier — cold starts after inactivity)
- **DB Hosting**: Neon (serverless Postgres — free tier)
- **File Storage**: None currently (no GCS/S3 — documents are base64 in DB or generated on-the-fly)

---

## SECTION 2 — DATABASE TABLES (Complete Inventory)

| Table | Purpose | Status |
|---|---|---|
| `hcm_users` | System users + roles + Google identity | ✅ Live |
| `employees` | Master employee record (~500+ employees) | ✅ Live |
| `clients` | Client companies | ✅ Live |
| `contracts` | Contracts per client | ✅ Live |
| `contract_bid_items` | Bid specification line items per contract | ✅ Live |
| `contract_bid_actuals` | Actual monthly vs bid data | ✅ Live |
| `vendors` | Registered supplier master | ✅ Live |
| `vendor_payments` | Payment history per vendor (with WHT) | ✅ Live |
| `bills` | Procurement bills (OCR / Manual / Quotation) | ✅ Live |
| `delivery_challans` | Delivery challans linked to bills | ✅ Live (new) |
| `invoices` | AR invoices (legacy, older schema) | ✅ Live |
| `client_invoices` | New AR invoice schema with Xero fields | ✅ Live |
| `payroll_transactions` | Monthly payroll data per employee | ✅ Live |
| `payment_batches` | AP payment batch groupings | ✅ Live |
| `payment_ledger` | Individual payment lines per batch | ✅ Live |
| `banks` | Pakistan banks master (20 seeded) | ✅ Live |
| `employee_documents` | Employee certifications, CNIC, police clearance | ✅ Live |
| `employee_messages` | SMS / email log per employee | ✅ Live |
| `employee_advances` | Advance/loan tracking with installments | ✅ Live |
| `employee_pf_ledger` | Provident fund monthly entries | ✅ Live |
| `employee_gratuity_ledger` | Gratuity accrual monthly entries | ✅ Live |
| `asset_issuances` | Uniform/PPE/equipment issued to employee | ✅ Live |
| `system_config` | Key-value config store (tax tables etc.) | ✅ Live |
| `inventory` | Equipment/item stock tracking | ✅ Live |

---

## SECTION 3 — MODULES: WHAT IS BUILT AND WORKING

### 3.1 Authentication & Access Control ✅ WORKING
- Google OAuth login restricted exclusively to `@asil.com.pk` email domain
- First-ever login auto-assigned `superadmin`; all subsequent users get `pending`
- SuperAdmin pre-registers users by email + assigns role before their first login
- JWT tokens issued for 8 hours; stored in `localStorage`
- **11 defined roles**: `superadmin, operations, procurement_proposer, procurement_approver, procurement_manager, finance_proposer, finance_approver, finance_manager, ap_team, ar_team, payroll_initiator`
- Role-based navigation: each role sees only the tabs they are authorised for
- `pending` users shown a holding screen until admin assigns a role

### 3.2 Dashboard (MD View) ✅ WORKING (Basic)
- Top-level overview card
- Shows headline metrics
- **No live data feeds currently** — cards are mostly static or placeholder

### 3.3 Employee Information ✅ WORKING (Full-Featured)
- 500+ live employee records
- Full profile: personal, family, medical, bank, contract, documents, assets, advances, PF, gratuity, messages
- Bulk CSV import with contract validation (rejects unknown contracts)
- Employee ID auto-generated as `ASIL-<timestamp>`
- CNIC duplicate detection + dedup admin tool
- Salary history tab (manual entries only — no automatic ledger journal)
- Contract date auto-matched from client→contract relationship
- PDF document generation for individual employees
- **Known Gap**: Leave management tab exists in UI but leaves are hardcoded (CL=10, ML=8, EL=14) — not persisted per employee in DB

### 3.4 Payroll Sheet ✅ WORKING (Core Features)
- Monthly payroll view with filter by client, contract, BU, date of joining
- Editable columns: OT2, OT3, Paid Days, OPD, Reimbursement, Arrears, Special Allowance, Fuel/Mobile, Bonus
- WHT (income tax) auto-calculated using Pakistan 2026 FBR slab rates
- EOBI contribution: flat Rs. 400 employee side
- Advance deduction pulled from `employee_advances` table
- Month locking: a payroll officer locks a month → appears in AP queue
- **Export types**:
  - CSV (all locked+filtered employees)
  - HBL Credit Transfer format
  - IBFT format
  - PDF payslip (individual, server-generated HTML)
  - Bulk payslip email (sends to employee's email on record)
- **Known Gap**: Exports strictly use `locked` employees matching the current UI filter. Does NOT show all employees unless locked. This is by design but can confuse users.
- **Known Gap**: Payslip salary components assume a fixed 60/20/10/7/3 split (Basic/HRA/Conv/Medical/Other). This split is not configurable.

### 3.5 Document Generator ✅ WORKING
- Generates PDF documents using `pdf-lib`:
  - Contract Agreement
  - Offer Letter
  - Appointment Letter
  - Salary Certificate
  - Experience Certificate
  - NOC Letter
  - Medical Form
  - DBB Tradesmen Interview Assessment PDF (form fill)
- Documents generated in browser using employee data from DB
- **Known Gap**: No document version tracking — once printed, no audit trail in system

### 3.6 Bills & Procurement ✅ RECENTLY OVERHAULED (Partially Working)
**4 Bill Types now implemented:**
| Type | Billable | Contract Required |
|---|---|---|
| 💼 Debit Note / Imprest | Locked ON | Client only |
| 🏭 Client Procurement | Locked ON | Client + Contract |
| 📦 Contractual Purchasing | User selects | Client + Contract + Period |
| 🏢 Internal Expense | Defaults OFF | None |

- Vendor dropdown pulls from registered Vendor Master (free-text fallback available)
- Billable flag locked for Types 1 & 2
- OCR upload: photo of a Katcha/handwritten bill → GPT-4o extracts vendor, items, totals
- Bill status flow: Draft → Pending Approval → Approved → Posted / Paid
- **Paid bills archived** in a separate tab with 🔒 lock icon
- Unlock paid bills using `BILLS_UNLOCK_PASSWORD` environment variable (password-protected)
- **Delivery Challan**: generates a printable challan document for any bill
- Approval workflow: procurement_proposer creates → procurement_approver/finance_approver approves
- Xero sync stub (marks bill as "Pushed to Xero" — no actual Xero API yet)

**⚠️ KNOWN GAPS (Billing)**:
- OCR bill: vendor dropdown not yet applied to OCR form (only Manual Entry has it)
- `BILLS_UNLOCK_PASSWORD` must be set in Render environment or unlock will always fail
- No bulk bill export / reporting
- No GST return auto-summary
- Challan has a race condition: `ON CONFLICT (bill_id)` may fail on first insert if `bill_id` unique constraint doesn't exist on older DB instances
- Bill total values can be re-edited after status is "Draft" without any version control

### 3.7 Invoices / Accounts Receivable ✅ WORKING (Functional)
- Invoices created against a client + contract + period
- Auto-suggested invoice number (INV-MonYY-???)
- Client/contract dropdown **FIXED** (was crashing due to `client_name` vs `clientName` mismatch)
- Line items: salary batch + debit note bills + service charges + sales tax + WHT
- Invoice status: Draft → Sent → Paid → Void
- PDF generation and download
- **Known Gap**: Two invoice tables exist (`invoices` and `client_invoices`) — some code uses one, some the other. This needs to be consolidated.
- **Known Gap**: PO number, due date, and payment receipt confirmation are UI fields but not linked to any AP matching workflow

### 3.8 Accounts Payable ✅ WORKING (Core)
- Shows locked payroll batches grouped by (year, month, client, contract)
- AP team selects bank: **HBL or NBP only** (enforced)
- Confirms batch → writes to `payment_batches` + `payment_ledger`
- Generates HBL Credit Transfer file
- **Known Gap**: No two-tier approval within AP (AP team confirms → Finance Manager should also approve → payment goes out). Currently single-step.
- **Known Gap**: Bank must be added manually per batch — no default bank per contract

### 3.9 Client Information ✅ WORKING (Full-Featured)
- Client master with NTN, STRN, industry, contacts
- Contracts per client with: location, service type, headcount, start/end dates, costs, financials
- **Bid Tracking** tab per contract: define bid items → enter monthly actuals → see variance
- **Known Gap**: Bid tracking is read-only specification — does NOT automatically create bills. Users must open Bills and manually create a Contractual Purchasing bill linked to same contract.

### 3.10 Vendor Supplier Master ✅ WORKING
- Full vendor registration: NTN, STRN, CNIC, bank details, is_filer flag
- Payment history per vendor with WHT auto-calculation
- Vendor dropdown now powers Bills module
- **Known Gap**: No vendor approval/blacklist workflow. Any user can add a vendor.
- **Known Gap**: No duplicate NTN/CNIC check on vendor creation

### 3.11 Inventory & Equipment ✅ WORKING (Basic)
- Item categories, serial numbers, condition, location tracking
- Issue to employee / return workflow
- **Known Gap**: No integration with Bills/Procurement (purchased items not auto-added to inventory)
- **Known Gap**: No depreciation calculation
- **Known Gap**: No barcode/QR scan capability

### 3.12 Annexure Dashboard ✅ WORKING (Basic)
- Approval workflow for annexures/forms
- Connected to `annexures` table (live data)
- **Known Gap**: The process for creating/submitting an annexure from the employee side is not built

### 3.13 System Configuration ✅ WORKING
- FBR Tax Slabs (editable)
- EOBI/SESSI rates
- Company settings
- **Known Gap**: Changes to tax slabs take effect immediately for all future payroll but there is no versioning — if you change a slab mid-year, old payslips may recalculate differently

### 3.14 User Management ✅ WORKING
- SuperAdmin view of all HCM users
- Assign/change roles
- Pre-register users by email
- **Known Gap**: No audit log of who changed whose role and when

### 3.15 Employee Self-Service Portal ✅ WORKING (Basic)
- Accessible via "Preview Employee Portal" button in sidebar
- Employee logs in → sees their own payslip, documents
- **Known Gap**: OTP authentication planned but not implemented — currently uses same Google OAuth
- **Known Gap**: Employee cannot apply for leave, submit an expense claim, or update their own profile through the portal

### 3.16 SMS Gateway ✅ WORKING (Jazz CMT)
- Single and bulk SMS via Jazz CMT API
- Render server IP whitelisted with Jazz CMT
- SMS log written to `employee_messages` table
- **⚠️ CRITICAL**: SMS username `03268366056` and password `Jazz@123` are **hardcoded** as fallback values if `JAZZ_SMS_USER`/`JAZZ_SMS_PASS` env vars are not set. This is a security vulnerability.

---

## SECTION 4 — WHAT IS NOT BUILT / NOT FUNCTIONING AS DESIGNED

| # | Item | Status | Impact |
|---|---|---|---|
| 1 | **Xero OAuth Integration** | Stub only — button exists, no real API call | Medium — finance team must manually enter in Xero |
| 2 | **Leave Management** | UI tab present, values hardcoded, no DB persistence | High — leave approvals happen outside system |
| 3 | **OCR vendor dropdown** | OCR modal still uses free-text vendor field | Low |
| 4 | **Two invoice tables** | `invoices` and `client_invoices` coexist with different schemas | Medium — risk of data split |
| 5 | **Two-step AP approval** | AP team confirms but no Finance Manager final approval | High — no maker-checker on payments |
| 6 | **Employee portal leave/HR requests** | Planned but not built | Medium |
| 7 | **Inventory ↔ Bills linkage** | Purchased items not auto-added to inventory | Medium |
| 8 | **Bid Tracking → Bills auto-link** | Must be done manually | Low |
| 9 | **Payslip salary component config** | 60/20/10/7/3 split hardcoded | Medium |
| 10 | **Document version control** | No audit trail — once printed, no record in system | Medium |
| 11 | **Vendor duplicate check** | No NTN/CNIC validation on vendor creation | Low |
| 12 | **Dashboard live data** | MD Dashboard cards are mostly static or show placeholder values | High — MD cannot see real KPIs |
| 13 | **AP 2-bank restriction** | Restricted to HBL/NBP but system has 20 banks seeded | Low (by design) |
| 14 | **Annexure creation (employee side)** | Not built | Medium |
| 15 | **PF/Gratuity auto-accrual** | Manually entered only, no monthly auto-journal | Medium |
| 16 | **Employee Portal OTP auth** | Not built — same Google OAuth used | Low |
| 17 | **Bulk bill export/GST return** | No export mechanism for bills module | Medium |
| 18 | **Delivery challan bill_id constraint** | May fail on old DB instances without unique constraint on `bill_id` in `delivery_challans` | Low |
| 19 | **Role audit log** | No audit of who changed user roles | Medium |
| 20 | **Tax slab versioning** | Changes are destructive — no historical slab preservation | Medium |

---

## SECTION 5 — SECURITY AUDIT

### 5.1 Critical Vulnerabilities (Fix Immediately)

#### 🔴 CRITICAL-1: Jazz SMS Credentials Hardcoded
```js
// server.js line 488-490
const SMS_USER = process.env.JAZZ_SMS_USER || '03268366056';
const SMS_PASS = process.env.JAZZ_SMS_PASS || 'Jazz@123';
```
**Risk**: Live SMS credentials committed to codebase. Anyone with code access can send bulk SMS at ASIL's expense or read the credentials from GitHub.
**Fix**: Set `JAZZ_SMS_USER` and `JAZZ_SMS_PASS` in Render. Remove the hardcoded defaults entirely.

#### 🔴 CRITICAL-2: JWT Secret Fallback
```js
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
```
**Risk**: If `JWT_SECRET` is not set on Render, any attacker who knows the fallback value (`dev-jwt-secret`) can forge valid JWT tokens and log in as any user, including SuperAdmin.
**Fix**: Ensure `JWT_SECRET` is set in Render environment. Rotate it if it was ever deployed without being set.

#### 🔴 CRITICAL-3: Session Secret Fallback
```js
secret: process.env.SESSION_SECRET || 'session-secret',
```
**Risk**: Predictable session secret allows session forgery attacks.
**Fix**: Set `SESSION_SECRET` in Render to a random 64-character string.

#### 🔴 CRITICAL-4: SSL Certificate Validation Disabled
```js
ssl: { rejectUnauthorized: false }
```
**Risk**: Database connections skip SSL certificate verification. A man-in-the-middle attack could intercept all data flowing between Render and Neon.
**Fix**: Obtain the Neon CA certificate and set `rejectUnauthorized: true`. Alternatively, use Neon's connection pooler which handles SSL correctly.

### 5.2 High-Priority Vulnerabilities

#### 🟠 HIGH-1: Admin Destructive Endpoints Not Role-Gated
```js
app.delete('/api/admin/delete-by-client', requireAuth, ...
app.post('/api/admin/dedup-employees', requireAuth, ...
```
These endpoints only require `requireAuth` (any logged-in user), not SuperAdmin. A `finance_proposer` or `procurement_proposer` could accidentally or maliciously delete hundreds of employee records.
**Fix**: Add `requireRole('superadmin')` to all `/api/admin/` endpoints.

#### 🟠 HIGH-2: JWT in URL (OAuth Callback)
```js
res.redirect(`${FRONTEND_URL}?token=${token}`);
```
The JWT token is placed in the URL query string after OAuth. This means:
- Token appears in server access logs
- Token is stored in browser history
- Token may be leaked via `Referer` HTTP header to third parties
- Token has 8-hour validity — if URL is shared, full account access is granted

**Fix**: Use a short-lived one-time code instead. After OAuth callback, store the token in a `httpOnly` cookie, or use `postMessage` to a popup window, rather than exposing it in the URL.

#### 🟠 HIGH-3: No Rate Limiting
Any endpoint, including login-related ones, can be called unlimited times. This allows:
- Brute-force attacks on the unlock password endpoint
- Enumeration of employees, clients, vendors by automated scripts
- Amplified SMS sending via `/api/sms/bulk` with unlimited recipients

**Fix**: Install `express-rate-limit`. Apply:
- 5 requests/minute on `/api/bills/:id/unlock`
- 20 requests/minute on `/api/sms/*`
- 100 requests/minute globally

#### 🟠 HIGH-4: No Input Sanitisation
Employee name, client name, vendor name, and bill purpose fields accept any content including HTML/script tags. While the frontend renders as React JSX (safe by default), the data stored in DB could contain injections that affect:
- PDF-lib document generation (HTML strings are passed to payslip template)
- Server-side email content

**Fix**: Strip all HTML tags on input for free-text fields. Use `validator.js` or `dompurify` on server side.

#### 🟠 HIGH-5: No CSRF Protection
Although JWT-based auth provides some CSRF resistance (since cookies aren't used for auth), the session-based OAuth callback does use cookies and could be vulnerable to CSRF during the auth handshake window.
**Fix**: Use `csurf` middleware for the session-based OAuth routes.

### 5.3 Medium-Priority Vulnerabilities

#### 🟡 MED-1: Token Stored in localStorage
JWT stored in `localStorage` is accessible to any JavaScript on the page (including any injected via XSS). If a vendor's CDN is compromised or a package you use has a supply-chain attack:
- All active tokens can be extracted
- Attackers can make API calls as the logged-in user

**Fix**: Long-term, migrate to `httpOnly` cookies for token storage.

#### 🟡 MED-2: No Request Size Limit on OCR Endpoint
The `/api/bills/ocr` endpoint accepts base64 images up to the JSON body limit of `10mb`. A malicious user can send large base64 payloads repeatedly, consuming both server memory and OpenAI API credits.
**Fix**: Add a specific `5mb` limit to the OCR route. Add per-user rate limiting (max 20 OCR calls/hour).

#### 🟡 MED-3: SQL Injection Surface — Admin Endpoints
The `/api/admin/delete-by-client` endpoint takes user input and uses it in a `LIKE` query with string interpolation. While it uses parameterised queries (`pool.query(..., [param])`), the existence of this endpoint is itself dangerous. Combined with the missing role check (HIGH-1), any logged-in user can delete employees.

#### 🟡 MED-4: No Audit Logging
No system-wide audit trail exists. Sensitive actions — deleting employees, changing roles, approving bills, marking payroll as paid — leave no trace of who did what and when.
**Fix**: Create an `audit_log` table. Log all write operations with: `user_email`, `action_type`, `entity_type`, `entity_id`, `before_value`, `after_value`, `ip_address`, `timestamp`.

#### 🟡 MED-5: BILLS_UNLOCK_PASSWORD is a Shared Secret
A single password unlocks any paid bill for any user. If the password is leaked (e.g., finance manager shares it informally), any user can unlock bills permanently.
**Fix**: Require both password AND SuperAdmin role to unlock. Log every unlock with user email and timestamp.

#### 🟡 MED-6: `health/ip` Endpoint Exposes Server IP
```js
app.get('/health/ip', (req, res) => { ... })
```
This endpoint is public (no `requireAuth`), returns the server's outbound IP, and was intended for Jazz CMT whitelisting. However it gives external attackers visibility into the infrastructure IP.
**Fix**: Add `requireAuth` to this endpoint.

### 5.4 Low-Priority Items

- No `helmet.js` security headers (X-Frame-Options, CSP, HSTS, etc.)
- No `Content-Security-Policy` on the frontend
- No automatic JWT revocation (if a user is terminated, their token remains valid for up to 8 hours)
- No employee data encryption at rest (data is stored as plaintext in Neon — CNIC, phone, address are all exposed if DB is compromised)
- `console.log` outputs sensitive data in production (employee emails, SMS content, etc.)

---

## SECTION 6 — ENVIRONMENT VARIABLES (Required)

| Variable | Required | Purpose | Risk if Missing |
|---|---|---|---|
| `DATABASE_URL` | ✅ Critical | Neon Postgres connection | System doesn't start |
| `GOOGLE_CLIENT_ID` | ✅ Critical | OAuth login | System doesn't start |
| `GOOGLE_CLIENT_SECRET` | ✅ Critical | OAuth login | System doesn't start |
| `JWT_SECRET` | ✅ Critical | Sign/verify tokens | Falls back to `dev-jwt-secret` — CRITICAL RISK |
| `SESSION_SECRET` | ✅ Critical | OAuth session | Falls back to `session-secret` — HIGH RISK |
| `FRONTEND_URL` | ✅ Important | CORS + OAuth redirect | CORS failures |
| `BACKEND_URL` | ✅ Important | OAuth callback URL | OAuth fails |
| `OPENAI_API_KEY` | ⚠️ OCR only | GPT-4o bill scanning | OCR disabled |
| `EMAIL_USER` | ⚠️ Email only | Gmail sender address | Email sending fails |
| `EMAIL_APP_PASSWORD` | ⚠️ Email only | Gmail app password | Email sending fails |
| `JAZZ_SMS_USER` | ⚠️ SMS only | Jazz CMT login | Uses hardcoded fallback — SECURITY RISK |
| `JAZZ_SMS_PASS` | ⚠️ SMS only | Jazz CMT password | Uses hardcoded fallback — SECURITY RISK |
| `JAZZ_SMS_MASK` | Optional | Sender ID for SMS | Falls back to `ALLIED SERV` |
| `BILLS_UNLOCK_PASSWORD` | ⚠️ Billing | Unlock paid bills | Unlock always fails with 503 |
| `ALLOWED_DOMAIN` | Optional | Email domain whitelist | Falls back to `asil.com.pk` |
| `NODE_ENV` | Optional | Set to `production` | Cookie `secure` flag inactive |

---

## SECTION 7 — ROLE PERMISSIONS MATRIX

| Module | superadmin | finance_manager | finance_approver | finance_proposer | ap_team | ar_team | payroll_initiator | procurement_manager | procurement_approver | procurement_proposer | operations |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Employee Info | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Payroll | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Documents | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Bills & Proc | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Invoices (AR) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Accounts Payable | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Client Info | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Vendor Master | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Inventory | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Annexure | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| System Config | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| User Mgmt | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## SECTION 8 — API ROUTES (Full Inventory)

### Auth
- `GET /auth/google` — Initiate Google OAuth
- `GET /auth/google/callback` — OAuth callback → issues JWT
- `GET /auth/me` — Validate token, return user info
- `POST /auth/logout` — Client-side only (clears localStorage)

### User Management
- `GET /api/users` — List users (superadmin)
- `POST /api/users` — Pre-register user (superadmin)
- `PATCH /api/users/:id/role` — Change user role (superadmin)

### Employees
- `GET /api/employees` — Full list with contract_date auto-match
- `POST /api/employees` — Create/upsert single employee
- `PUT /api/employees/:id` — Update employee
- `DELETE /api/employees/:id` — Delete employee
- `POST /api/employees/bulk` — Bulk import with contract validation + strict ID/CNIC guard; optional `notifyNew` welcome SMS (superadmin)
- `GET /api/employees/:id/documents` + `POST/PUT/DELETE` — Employee documents
- `GET /api/employees/:id/messages` + `POST` — Message log
- `GET /api/employees/:id/advances` + `POST/DELETE` — Advance/loan
- `POST /api/employees/:id/advances/:advId/pay-installment` — Mark installment paid
- `GET /api/employees/:id/pf-ledger` + `POST` — PF ledger
- `GET /api/employees/:id/gratuity-ledger` + `POST` — Gratuity ledger
- `GET /api/employees/:id/assets` + `POST/DELETE` — Asset issuances
- `PATCH /api/employees/:id/assets/:assetId/return` — Return asset

### Admin Tools
- `GET /api/admin/employee-duplicates` — Find CNIC duplicates ⚠️ needs role guard
- `POST /api/admin/dedup-employees` — Auto-deduplicate ⚠️ needs role guard
- `DELETE /api/admin/delete-by-client` — Mass delete by client ⚠️ needs role guard

### Payroll
- `GET /api/payroll` — All transactions (filterable by year/month)
- `POST /api/payroll` — Upsert payroll rows
- `POST /api/payroll/:empId/lock` — Lock employee for month
- `POST /api/payroll/lock-all` — Lock all visible employees for month
- `GET /api/payslip/:empId/:month/:year` — Generate HTML payslip
- `POST /api/payroll/email-payslips` — Bulk email payslips
- `GET /api/payroll/advance-deductions` — Active deductions for payroll

### Bills / Procurement
- `GET /api/bills` — List all bills
- `POST /api/bills` — Create/upsert bill
- `PATCH /api/bills/:id/status` — Update bill status (incl. Paid)
- `POST /api/bills/:id/unlock` — Password-protected unlock of Paid bills
- `POST /api/bills/:id/challan` — Generate delivery challan
- `GET /api/bills/:id/challan` — Retrieve challan for bill
- `DELETE /api/bills/:id` — Delete bill (superadmin only)
- `POST /api/bills/ocr` — GPT-4o OCR for Katcha bills

### Invoices (AR)
- `GET /api/invoices` — List invoices
- `POST /api/invoices` — Create invoice (finance_proposer)
- `PATCH /api/invoices/:id/status` — Update status (finance_approver)
- `DELETE /api/invoices/:id` — Delete (superadmin)

### Clients & Contracts
- `GET /api/clients` — List clients with contracts
- `POST /api/clients` — Create client
- `PUT /api/clients/:id` — Update client + upsert contracts
- `DELETE /api/clients/:id` — Delete client
- `GET /api/contracts` — All contracts with client name
- `DELETE /api/contracts/:id` — Delete contract
- `PATCH /api/contracts/:id/reassign` — Move contract to different client
- `GET /api/contracts/:id/bid-items` + `POST/PUT/DELETE` — Bid item management
- `GET /api/contracts/:id/bid-actuals` + `POST` — Monthly actuals

### Vendors
- `GET /api/vendors` — List vendors with total paid + WHT
- `POST /api/vendors` — Create vendor
- `PUT /api/vendors/:id` — Update vendor
- `DELETE /api/vendors/:id` — Delete vendor
- `GET /api/vendors/:id/payments` — Payment history
- `POST /api/vendors/:id/payments` — Record payment with WHT

### Accounts Payable
- `GET /api/ap/queue` — Locked payroll batches (filtered by client/contract)
- `GET /api/ap/queue/:batchId` — Batch detail with employee list
- `POST /api/ap/confirm` — Confirm batch payment → create batch + ledger

### Employee Portal (Self-Service — Phone OTP)
- `POST /api/portal/request-otp` — Public; rate-limited; sends 6-digit OTP via Jazz SMS
- `POST /api/portal/verify-otp` — Public; returns 24h portal-scoped JWT
- `GET /api/portal/me` — Read-only profile, payslips, advances (portal JWT)
- `POST /api/portal/change-request` — Submit field correction request (whitelist-validated)
- `GET /api/portal/my-requests` — Worker's own change-request history

### Employee Change Requests (Office Approval)
- `GET /api/change-requests?status=Pending|Approved|Rejected|All` — Queue (superadmin, operations, payroll_initiator)
- `PATCH /api/change-requests/:id/approve` — Apply proposed value to `employees`
- `PATCH /api/change-requests/:id/reject` — Reject with optional note + SMS notification

### SMS
- `POST /api/sms/send` — Single SMS
- `POST /api/sms/bulk` — Bulk SMS

### System & Misc
- `GET /api/config/:key` — Get system config
- `PUT /api/config/:key` — Update system config
- `GET /health` — Health check (public)
- `GET /health/ip` — Server IP (⚠️ should be protected)
- `GET /` — Root info

---

## SECTION 9 — FUTURE ROADMAP (Priority Order)

### Phase 1 — Security Hardening (Immediate — 1–2 weeks)
1. **Remove all hardcoded credential fallbacks** (JWT_SECRET, SESSION_SECRET, Jazz SMS credentials)
2. **Add `requireRole('superadmin')` to all /api/admin/ endpoints**
3. **Install `helmet.js`** — adds 11 security headers in one line
4. **Install `express-rate-limit`** — protect OCR, SMS, unlock endpoints
5. **Add `requireAuth` to `/health/ip`**
6. **Create `audit_log` table + middleware** — log all INSERT/UPDATE/DELETE with user email
7. **Protect BILLS_UNLOCK with SuperAdmin role check in addition to password**

### Phase 2 — Dashboard Intelligence (MD View — 2–4 weeks)
1. **Live KPI cards**: total headcount, active contracts, monthly payroll cost, outstanding invoices, overdue bills
2. **Financial P&L summary**: billable vs non-billable spend per month
3. **Contract health board**: expiring contracts (30/60/90 days), headcount vs contracted headcount
4. **Payroll calendar**: which months are locked, which are pending
5. **Vendor spend analysis**: top vendors by value, WHT collected
6. **Alert center**: CNIC expiries, document expiries, employees with no bank account

### Phase 3 — Xero Integration (Real API — 3–6 weeks)
1. **Xero OAuth 2.0**: real `client_credentials` or `authorization_code` flow
2. **Push invoices to Xero**: client invoices with line items → Xero AR
3. **Push bills to Xero**: approved procurement bills → Xero AP
4. **Pull payment status from Xero**: mark invoice as Paid when Xero confirms payment
5. **Chart of Accounts mapping**: each bill type maps to a Xero account code

### Phase 4 — Leave Management (3–4 weeks)
1. **Leave types**: Annual (EL), Casual (CL), Sick (ML), Short Leave configured per contract
2. **Leave application** in Employee Portal (employee submits, manager approves)
3. **Leave ledger** in DB per employee per year
4. **Leave balance** shown on payslip
5. **Integration with Payroll**: leave without pay auto-deducts from paid_days

### Phase 5 — Employee Self-Service Maturity (4–6 weeks)
1. **OTP Authentication**: employee logs in via CNIC + OTP to mobile
2. **Leave applications** (see Phase 4)
3. **Expense claims**: employee submits claim → manager approves → creates Internal Expense bill
4. **Profile update requests**: employee requests change → HR approves
5. **Asset self-confirmation**: employee confirms receipt of uniform/PPE → digital signature

### Phase 6 — Advanced Financial Features (6–8 weeks)
1. **GST Return summary**: auto-aggregate all bills by month → printable GST return schedule
2. **WHT Challan Generation**: auto-create WHT challan for vendor payments
3. **Billing-to-Inventory link**: approved Client Procurement bills → auto-add items to inventory
4. **PF/Gratuity auto-journal**: on payroll lock → auto post PF/Gratuity accrual to ledger
5. **Multi-currency**: USD-billed contracts, PKR-paid employees
6. **Contract profitability report**: revenue vs cost vs margin per contract, per client

### Phase 7 — Compliance & Reporting (Ongoing)
1. **FBR E-Filing export**: generate IRIS-compatible XML for income tax returns
2. **EOBI submission report**: monthly EOBI challan generation
3. **SESSI reports**: for applicable provinces
4. **Audit Report export**: all changes to a record over its lifetime
5. **Bank reconciliation**: match AP payments to bank statement entries

---

## SECTION 10 — KNOWN DATA INTEGRITY ISSUES (Current)

1. **Two Invoice Schemas**: `invoices` table (old) and `client_invoices` table (new) coexist. Routes for older `invoices` table are still live. Consolidation needed.
2. **Employee Contract Date**: Auto-matched using LIKE-based client name matching. If client name changes in the master, existing employees lose their auto-match.
3. **Payroll Advance Deduction**: Pulled from `employee_advances` at payroll view time. If an advance is deleted after payroll is locked, the deduction disappears from the payslip retrospectively.
4. **Bill IDs**: Generated as `BILL-<timestamp>` — two simultaneous bill creations in the same millisecond could theoretically conflict (extremely unlikely but not impossible).
5. **Duplicate Employee Bulk Import**: Resolved 2026-07-02 — bulk import now rejects CNIC/ID mismatches instead of silent overwrites.

---

## SECTION 11 — OPERATIONAL PROCEDURES

### How to Add a New Staff Member to HCM
1. Go to User Management → Add User → enter @asil.com.pk email → assign role
2. Tell employee to visit hcm.asil.com.pk and click "Sign in with Google"
3. System recognises their pre-registered email → assigns their role automatically

### Monthly Payroll Process
1. Payroll Initiator opens Payroll → selects month/year
2. Applies filters (client, contract, BU)
3. Updates OT hours, paid days, allowances per employee
4. Clicks "Lock All" for the filtered set
5. AP Team opens Accounts Payable → sees locked batch
6. Selects bank (HBL or NBP) → confirms payment
7. Downloads HBL Credit Transfer file → uploads to bank portal

### Monthly Bill Processing
1. Procurement Officer: Bills → Create Bill → select bill type → fill vendor (from dropdown) → add line items
2. Submits for Approval
3. Procurement Approver: opens bill → Approve
4. Finance Manager: marks as Posted or Paid
5. Once Paid → bill moves to Paid/Archived tab and is locked

### Creating a Client Invoice
1. Finance Officer → Invoices → New Invoice
2. Select client + contract
3. System auto-suggests invoice number (INV-MonYY-???)
4. Add line items (salary, debit notes, service charges)
5. Send to Finance Approver to finalise
6. Download PDF → email to client

---

*Document maintained by Antigravity Development Consultant. Update after every major release.*
*Last updated: April 8, 2026*
