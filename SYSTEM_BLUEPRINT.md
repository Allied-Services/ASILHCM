# ASIL HCM — MASTER SYSTEM BLUEPRINT
**Single Source of Truth | DO NOT DELETE | Update After Every Task**

> **System**: Allied Services International HCM (Human Capital Management)
> **Company**: Allied Services International (Pvt.) Ltd. (`asil.com.pk`)
> **Domain**: `hcm.asil.com.pk` (target) / `asilhcm-frontend.onrender.com` (live)
> **Last Updated**: 2026-03-31
> **Blueprint Version**: 1.0

---

## TABLE OF CONTENTS

1. [Core Architecture](#1-core-architecture)
2. [Module & Feature Registry](#2-module--feature-registry)
3. [Database Schema Reference](#3-database-schema-reference)
4. [Tax & Payroll Engine](#4-tax--payroll-engine)
5. [API Surface & Routing](#5-api-surface--routing)
6. [Role-Based Access Control](#6-role-based-access-control)
7. [Bug Ledger](#7-bug-ledger)
8. [Data & Migration Status](#8-data--migration-status)
9. [Deployment & Infrastructure](#9-deployment--infrastructure)
10. [Non-Negotiable Business Rules](#10-non-negotiable-business-rules)
11. [Known Anti-Patterns & Gotchas](#11-known-anti-patterns--gotchas)
12. [Change Log](#12-change-log)

---

## 1. CORE ARCHITECTURE

### 1.1 System Map

```
┌────────────────────────────────────────────────────────────────┐
│                      CLIENT BROWSER                           │
│   React (Vite) SPA — asilhcm-frontend.onrender.com           │
│   Auth: JWT stored in localStorage (key: asil_hcm_token)     │
└───────────────────────┬────────────────────────────────────────┘
                        │ HTTPS REST API
                        │ Bearer Token (JWT)
┌───────────────────────▼────────────────────────────────────────┐
│               BACKEND — Render Web Service                    │
│   Node.js / Express  — asilhcm.onrender.com  (Port 10000)    │
│   Entry: backend/server.js (~160KB monolith)                  │
│   Auth: Passport.js + Google OAuth 2.0 + JWT                 │
│   Route Loading: safeRequireRoute() — silent failure guard    │
└───────────┬───────────────────────────┬────────────────────────┘
            │ node-postgres (pg)         │ OpenAI API
            │ sslmode=require            │ (Passport OCR, AI Search)
┌───────────▼────────────┐   ┌──────────▼──────────────────────┐
│  Neon PostgreSQL        │   │  Google Cloud Storage (GCS)     │
│  (Serverless, prod)     │   │  (CV uploads, passport scans)   │
│  Pooler: Port 5432      │   └─────────────────────────────────┘
└────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                 EXTERNAL INTEGRATIONS                         │
│  • Google OAuth 2.0 (restricted to @asil.com.pk domain)      │
│  • OpenAI gpt-4o-mini (Passport OCR, AI candidate search)    │
│  • HBL Bank File export (CSV for salary disbursement)        │
│  • FBR WHT Return export (10-col CSV for tax filing)         │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 Frontend File Map (`frontend/src/`)

| File | Purpose |
|---|---|
| `App.jsx` | Root router, auth flow, role-gated navigation |
| `LoginScreen.jsx` | Google OAuth entry point |
| `Dashboard.jsx` | MD View — executive KPI dashboard |
| `EmployeeInformation.jsx` | Employee list, bulk import, onboarding form |
| `EmployeeProfile.jsx` | Employee detail tabs (Salary, Leave, Medical, Settlement) |
| `PayrollSheet.jsx` | Monthly payroll processing, lock/unlock, export |
| `payrollUtils.js` | **Calculation engine** — WHT, EOBI, SESSI, Gratuity, PF |
| `ClientInformation.jsx` | Client & contract CRUD |
| `DocumentGenerator.jsx` | HR document & PDF form generation |
| `BillingProcurement.jsx` | Vendor bills, OCR pipeline, imprest |
| `InvoiceSection.jsx` | Client invoice management |
| `AnnexureDashboard.jsx` | Billing cycle consolidation & MD approval |
| `VendorMaster.jsx` | Vendor/supplier registry |
| `InventoryManagement.jsx` | Asset & uniform ledger |
| `SystemConfig.jsx` | Application-level configuration |
| `UserManagement.jsx` | Staff account & role management |
| `EmployeePortal.jsx` | ESS — employee self-service (payslip viewer) |
| `MockOCR.jsx` | OCR simulator for Katcha Bill testing |

### 1.3 Backend Structure (`backend/`)

| File | Purpose |
|---|---|
| `server.js` | Main Express monolith (~160KB). All routes, middleware, DB pool |
| `taxEngine.js` | Server-side tax calculation (EOBI, SESSI, WHT, Gratuity) |
| `setup-db.js` | Database initialization script (drops and recreates tables) |

### 1.4 Data Flow: Payroll Cycle

```
PayrollSheet.jsx
  │
  ├─ Loads employees from GET /api/employees (filtered by contract/SO)
  ├─ Loads overrides from GET /api/payroll/:month
  │
  ├─ calcEmployeeRow() [payrollUtils.js]
  │    ├─ Gross earnings (basic + allowances + OT - absences)
  │    ├─ WHT (FBR 2025-26 slabs via calcWHT)
  │    ├─ EOBI flat: EE=400, ER=2000 (min wage Rs.40,000)
  │    ├─ SESSI: min(2400, gross×6%)
  │    ├─ EOSB: cfg.eosb_type → PF or Gratuity or None
  │    └─ Province-based Sales Tax (provinceSalesTaxRate)
  │
  ├─ Lock payroll → POST /api/payroll/:month/lock
  └─ Export → HBL file / WHT CSV / EOBI CSV / SESSI CSV
```

---

## 2. MODULE & FEATURE REGISTRY

### 2.1 ✅ COMPLETED FEATURES

#### CORE INFRASTRUCTURE
- [x] Google OAuth 2.0 login (restricted to `@asil.com.pk`)
- [x] JWT-based session management with localStorage persistence
- [x] Role-based access control (6 roles + pending)
- [x] Responsive sidebar navigation with per-role tab filtering
- [x] Employee Self-Service (ESS) portal preview overlay
- [x] Global glassmorphism dark-mode UI (Inter font, indigo palette)
- [x] `safeRequireRoute()` — prevents server crash on bad route file

#### EMPLOYEE MANAGEMENT
- [x] 48-column employee master record (full lifecycle fields)
- [x] 8-step onboarding wizard (single employee entry)
- [x] CSV bulk import with 48-column ASIL Master Template
- [x] Import preview & validation step before DB commit
- [x] Full-text search (`tsvector` trigger on `employee_master`)
- [x] Real-time filter by Name, CNIC, Employee ID, Position
- [x] Cascading filters: Client → Designation → Location
- [x] Status toggles: All / Active / Inactive
- [x] EmployeeProfile with 6 tabs: Personal, Salary, Payroll, Leave, Medical, Settlement
- [x] Salary history ledger with increment management
- [x] Leave management: CL (10d), ML (8d), EL (14d), DOJ-based anniversary reset
- [x] Final settlement calculator (resignation/termination/retirement)
- [x] Bulk action controls in employee list
- [x] Contract selection field on employee record (links to `contracts` table)

#### PAYROLL & TAX ENGINE
- [x] FBR 2025-26 WHT graduated slab calculation
- [x] EOBI: flat EE=Rs.400, ER=Rs.2,000 (pegged at Rs.40,000 min wage)
- [x] SESSI: 6% of gross, capped at Rs.2,400
- [x] OT calculation: 2× weekdays/Saturday, 3× Sundays/holidays
- [x] Proration for partial months (absent days × gross/26)
- [x] EOSB system: None / Provident Fund / Gratuity (contract-level config)
- [x] PF Employee contribution: basic/24; Employer matches
- [x] Gratuity monthly accrual: gross/12 (employer liability, no EE deduction)
- [x] Province-based Sales Tax rates (PRA 16% / SRB 13% / KPRA 15% / BRA 15%)
- [x] Service charge percentage from contract config
- [x] Payroll lock/unlock with persistence (no auto-unlock on refresh)
- [x] HBL Bank disbursement file export (CSV)
- [x] FBR WHT Return export (10-column CSV)
- [x] EOBI summary export
- [x] SESSI summary export
- [x] Full payroll CSV export
- [x] Server-side PDF payslip generation
- [x] Payslip email distribution
- [x] WHT persistence in database

#### CLIENT & CONTRACT MANAGEMENT
- [x] Client profiles: Name, Industry, HQ, NTN, STRN, Contacts (JSONB)
- [x] Contract CRUD: service type, location, headcount, start/end dates
- [x] Contract status: Active / Expiring / Expired / Cancelled / Draft
- [x] Per-contract cost breakdown (EOBI, SESSI, Insurance, Uniforms, PPE, OPD)
- [x] Contract financial multipliers (Service Charge %, WHT %, Sales Tax %)
- [x] EOSB type per contract (None / Provident Fund / Gratuity)
- [x] Contract reassignment between clients (`PATCH /api/contracts/:id/reassign`)
- [x] Delete client (cascades to contracts)
- [x] Inline edit/delete for contracts in profile view
- [x] Real-time overhead-per-head preview

#### BILLING & PROCUREMENT
- [x] Vendor/Supplier master (NTN, STRN, filer status)
- [x] Katcha Bill upload with OCR-assisted review pipeline
- [x] Human-in-the-loop (HITL) flag when OCR total ≠ line items total
- [x] Bill routing: Procurement vs. Imprest workflows
- [x] Annexure draft consolidation (payroll + materials)
- [x] Annexure approval workflow (MD review before invoicing)

#### DOCUMENT GENERATION
- [x] Employment Contract (HTML/CSS, print-optimized, ASIL letterhead)
- [x] Employee Joining Report (48-field, 9-category summary)
- [x] Uniform Measurement Form (sizes XS–3XL, PPE checklist)
- [x] Bulk export: N employees × M document types
- [x] PDF overlay generation via `pdf-lib` for government forms
- [x] BCert, Oath, FSA Part I & II, StateLife Form G, Transguard form
- [x] Selection Pack launcher (opens all 5 recruitment forms in tabs)
- [x] Number-to-words salary conversion in contracts
- [x] Live employee data integration (fetches from DB on mount)

#### RECRUITMENT & VISA (Neural-ERP / Candidate Portal)
- [x] Candidate database with AI-powered two-phase hybrid search
- [x] CV upload to Google Cloud Storage (GCS)
- [x] OpenAI text embedding for vector search
- [x] Passport OCR via GPT-4o-mini Vision (`POST /api/ocr-passport`)
- [x] MRZ (Machine Readable Zone) priority extraction
- [x] Campaign Mode for walk-in drives (camera capture → OCR → form)
- [x] 14-stage visa processing pipeline tracker
- [x] Dynamic country-specific column views (KSA NAVTTC vs UAE Demand Letter)
- [x] Candidate workspace with Personal, Documents, Visa tabs
- [x] Digital signature pad for consent forms
- [x] CSR queue management for bulk calling
- [x] Client campaign masking (confidential client names hidden in queries)
- [x] PKR currency support for job advertisements

#### SECURITY (Completed March 2026)
- [x] Strict file upload validation
- [x] CORS policy enforcement
- [x] Secure session management
- [x] Migration from `xlsx` → `exceljs` (security vulnerability fix)
- [x] Migration from `imap-simple` → `imapflow` (security vulnerability fix)

---

### 2.2 🔄 PENDING / REQUESTED FEATURES

#### HIGH PRIORITY
- [ ] **Candidate → Employee conversion ("Hire" action)**: Candidates from recruitment tables must be formally promoted to `employees` table to appear in Document Generator and Payroll.
- [ ] **CSR Queue fix**: Empty queue bug — staff ID mismatch between session and `csr_batches.assigned_to` (see Bug Ledger #B-003).
- [ ] **AI Search full vectorization**: 233,000 unvectorized candidates backlog — GCS text extraction → OpenAI embedding pipeline needs to complete.
- [ ] **Frozen-header data grid**: Replace laggy list views with a sticky-header, frozen-column, inline-editable spreadsheet-like grid.

#### MEDIUM PRIORITY
- [ ] **Automated outreach campaigns**: Bulk email/SMS to candidates filtered by AI match score (≥50–70%).
- [ ] **Social job posting**: Auto-publish to LinkedIn, Facebook, Indeed.
- [ ] **Auto-nurture loop**: Search → contact → track interest → follow-up → status update.
- [ ] **Walk-in token system**: Automated tokenization for mass interview queuing.
- [ ] **Candidate portal (self-tracking)**: Let selected candidates check visa status, travel details, flight info.
- [ ] **Journey-driven SMS/Email triggers**: Automated alerts for required actions (e.g., "Passport copy needed").
- [ ] **Zero-latency grid interactions**: Spreadsheet-like performance for the Visa Sheet.

#### LOW PRIORITY / FUTURE
- [ ] **Custom domain setup**: CNAME `hcm.asil.com.pk` → Render static site URL.
- [ ] **Final settlement documentation**: One-click generation of settlement letter PDF.
- [ ] **Advance trigger automation**: DB trigger `deduct_advance_installment()` is defined in schema but body is currently a stub — needs implementation.
- [ ] **Inventory replacement alerts**: Push notifications when uniform/PPE replacement date is near.

---

## 3. DATABASE SCHEMA REFERENCE

### 3.1 Live Production Tables (Neon PostgreSQL)

#### `employees` (Active Production Table)
The **primary employee table** used by all live features. This is **different** from the `employee_master` in `schema.sql` (which is the target clean-room schema). The live table uses `TEXT` PKs and a flat 48-column structure.

```sql
CREATE TABLE employees (
  id TEXT PRIMARY KEY,               -- ASIL Employee Code (e.g. "ASIL/SPL-91/21")
  bu TEXT,                           -- Business Unit
  active TEXT DEFAULT 'Yes',         -- 'Yes' / 'No'
  client TEXT,                       -- Client name (denormalized)
  client_bu TEXT,
  dept TEXT, designation TEXT,
  location TEXT, province TEXT,
  name TEXT NOT NULL,
  father_name TEXT, mother_name TEXT,
  cnic TEXT UNIQUE,
  cnic_issue DATE, cnic_expiry DATE,
  place_of_birth TEXT,
  eobi_no TEXT,
  religion TEXT, marital_status TEXT,
  dob DATE, doj DATE,
  primary_contact TEXT, emergency_contact TEXT,
  email TEXT,
  present_address TEXT, permanent_address TEXT,
  salary NUMERIC DEFAULT 0,
  spouse_name TEXT, spouse_age TEXT, spouse_cnic TEXT,
  child1_name TEXT, child1_age TEXT, child1_id TEXT,
  child2_name TEXT, child2_age TEXT, child2_id TEXT,
  medical_type TEXT, medical_maternity TEXT,
  total_medical_coverage NUMERIC,
  bank_name TEXT, bank_account TEXT, account_title TEXT,
  nok_name TEXT, nok_relation TEXT, nok_contact TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### `clients`
```sql
CREATE TABLE clients (
  id TEXT PRIMARY KEY,               -- e.g. "CLT-001"
  name TEXT NOT NULL UNIQUE,
  hq TEXT, ntn TEXT, strn TEXT,
  industry TEXT,
  contacts JSONB DEFAULT '[]'        -- [{name, title, phone, email}]
);
```

#### `contracts`
```sql
CREATE TABLE contracts (
  id TEXT PRIMARY KEY,               -- e.g. "CTR-2026-A1"
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  contract_name TEXT,
  location TEXT,
  service_type TEXT,                 -- Janitorial, BPO, Manpower, etc.
  headcount INT DEFAULT 0,
  status TEXT DEFAULT 'Active',      -- Active/Expiring/Expired/Cancelled/Draft
  start_date DATE, end_date DATE,
  costs JSONB DEFAULT '{}',          -- {eobi, sessi, life_ins, medical_ee, uniforms, ppe, ...}
  financials JSONB DEFAULT '{}'      -- {service_charges_pct, sales_tax_pct, wht_pct, eosb_type}
);
```
> **Critical**: `financials.eosb_type` controls EOSB behavior in payroll: `"None"` | `"Provident Fund"` | `"Gratuity"`

#### `payroll_transactions`
```sql
-- Stores one row per employee per month.
-- Generated columns (computed by DB):
--   net_salary = gross - eobi_ee - wht - advance - other_deductions
--   total_cost_to_company = gross + eobi_er + sessi_er
status: 'Draft' | 'Locked'
```

#### Other Active Tables
| Table | Purpose |
|---|---|
| `staff` | Internal system users (login, role, Google OAuth profile) |
| `payroll_advances` | Advance/loan tracking with installment logic |
| `pf_gratuity_ledger` | Monthly PF and gratuity accrual records |
| `salary_history` | Increment ledger per employee |
| `raw_bills` | Vendor bill uploads (OCR pipeline) |
| `annexure_drafts` | Billing cycle consolidation |
| `vendor_supplier_master` | Vendor/supplier with NTN, STRN, filer status |
| `asset_uniform_ledger` | Asset issuances with auto-computed replacement dates |

### 3.2 Schema Mapping Convention
The backend uses `empToDb` and `empFromDb` mapper functions in `server.js`:
- **React state**: `camelCase` (`doj`, `eobiNo`, `child1Id`)
- **DB columns**: `snake_case` (`doj`, `eobi_no`, `child1_id`)
- Dates: DB `DATE` type → ISO string in API responses

---

## 4. TAX & PAYROLL ENGINE

### 4.1 Authoritative Calculation Source
**Frontend**: `frontend/src/payrollUtils.js` — `calcEmployeeRow()` is the canonical engine.
**Backend**: `backend/taxEngine.js` — server-side mirror for validation & payslip generation.

### 4.2 Current Statutory Rates (FBR 2025-26)

#### WHT Income Tax Slabs (Annual, Salaried Individuals)
| Annual Income | Formula |
|---|---|
| ≤ Rs. 600,000 | 0% |
| Rs. 600,001 – 1,200,000 | 1% of excess over 600K |
| Rs. 1,200,001 – 2,200,000 | Rs. 6,000 + 11% of excess over 1.2M |
| Rs. 2,200,001 – 3,200,000 | Rs. 116,000 + 23% of excess over 2.2M |
| Rs. 3,200,001 – 4,100,000 | Rs. 346,000 + 30% of excess over 3.2M |
| > Rs. 4,100,000 | Rs. 616,000 + 35% of excess over 4.1M |

> ⚠️ **Note**: The `payrollUtils.js` slabs differ slightly from the `schema.sql` PL/pgSQL function. The **frontend `payrollUtils.js` values are authoritative** for live payroll. The DB function is used for batch validations.

> **Taxable income** excludes OPD claims and expense reimbursements (non-taxable per FBR rules).

#### EOBI (Employees' Old-Age Benefits Institution)
- Min wage cap: **Rs. 40,000** (updated in `payrollUtils.js`)
- **Employee share**: Rs. 400 (flat, all employees)
- **Employer share**: Rs. 2,000 (flat, all employees)

#### SESSI (Sindh Employees' Social Security Institution)
- Rate: 6% of gross salary
- **Cap**: Rs. 2,400/month (`min(2400, gross × 0.06)`)

#### Province-Based Sales Tax Rates
| Province/Region | Authority | Rate |
|---|---|---|
| Sindh / Karachi / Hyderabad | SRB | 13% |
| Punjab / Lahore / Islamabad | PRA | 16% |
| KPK / Peshawar | KPRA | 15% |
| Balochistan / Quetta | BRA | 15% |
| AJK / Federal / Other | Federal | 13% |

### 4.3 EOSB Logic (End of Service Benefit)
Controlled by `contracts.financials.eosb_type`:

| EOSB Type | Employee Deduction | Employer Cost |
|---|---|---|
| `None` | Rs. 0 | Rs. 0 |
| `Provident Fund` | `basic / 24` (PF EE) | Employer matches PF EE |
| `Gratuity` | Rs. 0 | `gross / 12` (monthly accrual) |

### 4.4 OT Rate Formula
- **OT Hourly Rate** = `Gross Salary / (26 × 8)` = `Gross / 208`
- **OT @2×** (weekdays/Saturday): `hourly × 2 × hours`
- **OT @3×** (Sunday/Public Holiday): `hourly × 3 × hours`

### 4.5 Absence Deduction
- **Daily rate** = `Gross / 26`
- **Deduction** = `absent_days × (Gross / 26)`

---

## 5. API SURFACE & ROUTING

### 5.1 Authentication
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/google` | Initiates Google OAuth flow |
| `GET` | `/auth/google/callback` | OAuth callback → issues JWT |
| `GET` | `/auth/me` | Validates JWT, returns user profile |

### 5.2 Employees
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/employees` | List all employees (filter: `?client=`, `?contract=`) |
| `POST` | `/api/employees` | Create single employee |
| `POST` | `/api/employees/bulk` | Bulk import (CSV mapped array) |
| `GET` | `/api/employees/:id` | Get single employee profile |
| `PUT` | `/api/employees/:id` | Update employee record |
| `DELETE` | `/api/employees/:id` | Soft or hard delete |

### 5.3 Clients & Contracts
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/clients` | List all clients |
| `POST` | `/api/clients` | Create client |
| `PUT` | `/api/clients/:id` | Update client |
| `DELETE` | `/api/clients/:id` | Delete client + cascade contracts |
| `GET` | `/api/contracts` | List contracts (filter: `?client_id=`) |
| `POST` | `/api/contracts` | Create contract |
| `PUT` | `/api/contracts/:id` | Update contract |
| `DELETE` | `/api/contracts/:id` | Delete contract (keeps client) |
| `PATCH` | `/api/contracts/:id/reassign` | Move contract to different client |

### 5.4 Payroll
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/payroll/:month` | Fetch overrides for month (format: `YYYY-MM`) |
| `POST` | `/api/payroll/:month` | Save/update payroll overrides |
| `POST` | `/api/payroll/:month/lock` | Lock payroll month |
| `POST` | `/api/payroll/:month/unlock` | Unlock payroll month |
| `GET` | `/api/payroll/:month/status` | Get lock status |

### 5.5 Recruitment & OCR
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/ocr-passport` | GPT-4o-mini Vision passport scan |
| `GET` | `/api/candidates` | List candidates (with AI search param) |
| `POST` | `/api/candidates` | Create candidate record |

### 5.6 Documents
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/documents/contract` | Generate employment contract PDF |
| `POST` | `/api/documents/joining-report` | Generate joining report |
| `GET` | `/api/forms/:type/:candidateId` | Generate PDF overlay form (BCert, Oath, FSA, etc.) |

### 5.7 Route Loader Safety
The server uses `safeRequireRoute(path)` to load route files. If a route file has a **syntax error or missing dependency**, it fails **silently** (server boots, endpoints return 404). Check server startup logs for:
```
[BOOT] ⚠️ Failed to load route: routes/admin.js
```

---

## 6. ROLE-BASED ACCESS CONTROL

### 6.1 Roles & Navigation Access

| Role | Tabs Accessible |
|---|---|
| `superadmin` | All 12 tabs |
| `operations` | Employee Information, Document Generator |
| `procurement_proposer` | Bills & Procurement, Vendor Master, Inventory |
| `procurement_approver` | Bills & Procurement |
| `finance_proposer` | Payroll Sheet, Invoices |
| `finance_approver` | Payroll Sheet, Invoices |
| `pending` | None (access pending screen shown) |

> Roles are stored in the `staff` table. A new Google login creates a `pending` user. SuperAdmin must assign role via User Management tab.

---

## 7. BUG LEDGER

### ✅ RESOLVED BUGS

| ID | Bug | Root Cause | Fix Applied |
|---|---|---|---|
| B-001 | Passport OCR 401 error | `OPENAI_API_KEY` falling back to `_DUMMY_...` on Render | Updated `visa_routes.js` to check `AI_INTEGRATIONS_OPENAI_API_KEY` first, skip dummy values, return 503 |
| B-002 | Export ZIP silent failure | `ShortlistBar.jsx` treating JSON error response as a Blob | Added `content-type` header check — if JSON, parse and alert; else download as ZIP |
| B-003-a | Add-to-Project dropdown hidden | Dropdown opening upward behind fixed header | Changed to `top-full` (opens downward) + `z-[9999]` |
| B-004 | Project cards not clickable | Static cards in `ClientsPage.jsx` had no click handlers | Made cards clickable, added `ProjectDetailInline` component |
| B-005 | Document Generator empty list | Static placeholder array, not fetching from DB | Updated component to `GET /api/employees` on mount; added loading spinner |
| B-006 | Route endpoint 404 (forms) | Corrupted `routes/admin.js` — BOM removal script deleted a char (`const` → `onst`) | Restored file; implemented `safeRequireRoute` pattern |
| B-007 | Payroll auto-unlock on refresh | Lock state not persisted to DB | Lock/unlock state now written to `payroll_transactions.status` |
| B-008 | WHT rounding errors in OT | Float arithmetic inconsistency in overtime hours | Standardized all OT values through `parseNum()` before arithmetic |
| B-009 | EOSB not selectable per contract | No EOSB field in contract schema | Added `eosb_type` to `contracts.financials` JSONB; payrollUtils reads `cfg.eosb_type` |
| B-010 | Province-based sales tax not dynamic | Hardcoded `cfg.sales_tax_pct` from contract | Replaced with `provinceSalesTaxRate(emp.province)` lookup |
| B-011 | Candidate contract field missing | No `contract` foreign key on employee form | Added mandatory contract selection field to Employee Information form |
| B-012 | Corrupted candidate name records | CSV import used CSR name instead of candidate name | Patch script `patch_server.py` re-imported correct names from original CSV by matching email/phone |
| B-013 | Client names visible in campaign queries | No masking logic | Implemented confidential client name masking in query results |

### 🔴 OPEN BUGS

| ID | Bug | Suspected Root Cause | Status |
|---|---|---|---|
| B-003-b | CSR Queue always empty | Staff ID mismatch between JWT session and `csr_batches.assigned_to` column | **Open** — Verify `staff.id` vs `csr_batches.assigned_to` join condition |
| B-014 | AI Search returns no results | Dependency on valid OpenAI key (partially blocked by B-001 resolution); 233K unvectorized candidates | **Partially open** — Key fixed, but backlog vectorization incomplete |
| B-015 | CV Upload fails intermittently | Misconfigured GCS bucket name or service account JSON on Render env | **Open** — Verify `GCS_BUCKET_NAME` and `GOOGLE_APPLICATION_CREDENTIALS` on Render |
| B-016 | `deduct_advance_installment()` DB trigger is a stub | Trigger function body has no implementation (`RETURN NEW` only) | **Open** — Implement deduction logic in trigger or move to application layer |

### ⚠️ ENVIRONMENT / INFRASTRUCTURE WARNINGS

| ID | Warning | Detail |
|---|---|---|
| W-001 | Google Drive file locking | Developing in `G:\My Drive\...` causes `EBADF: bad file descriptor` during `npm install`. Use a local non-synced directory. |
| W-002 | Render deployment latency | Auto-deploy takes 2–4 minutes. User may report "fix not working" if they refresh immediately. Advise hard refresh (`Ctrl+Shift+R`) after build is green. |
| W-003 | PowerShell BOM corruption | Scripts using PowerShell to write source files may introduce UTF-8 BOM, causing `Unexpected identifier` parse errors. Always use `[System.IO.File]::WriteAllText(path, content, New-Object System.Text.UTF8Encoding($false))`. |
| W-004 | `dotenv` duplicate key priority | `dotenv` uses the **first** occurrence of any key. For multi-account configs, use unique prefixes (e.g., `OILGAS_IMAP_USER`, `FM_IMAP_USER`). |
| W-005 | safeRequireRoute silent failures | Bad route files fail silently at boot. Always check server startup logs before debugging 404s. |

---

## 8. DATA & MIGRATION STATUS

### 8.1 Schema Status

| Migration | Status | Notes |
|---|---|---|
| Initial schema (`setup-db.js`) | ✅ Applied | Core tables created on Neon |
| `employees` flat-48 table | ✅ Live | Production table in active use |
| `clients` + `contracts` JSONB | ✅ Live | `costs` and `financials` as JSONB blobs |
| `payroll_transactions` | ✅ Live | Lock state via `status` column |
| `salary_history` | ✅ Live | Increment ledger active |
| `pf_gratuity_ledger` | ✅ Live | Monthly accrual tracking |
| DB functions (EOBI, SESSI, WHT, Gratuity) | ✅ Applied | PL/pgSQL in `schema.sql`; see note on slab discrepancy in §4.2 |
| `asset_uniform_ledger` | ✅ Applied | Auto-computed `replacement_due_date` |
| `deduct_advance_installment` trigger | ⚠️ Stub only | Body not implemented — see Bug B-016 |
| `employee_master` (new normalized schema) | 🔄 Target only | Defined in `database/schema.sql` — **not yet applied to production** |

### 8.2 External Data Import Status

| Dataset | Status | Notes |
|---|---|---|
| Employee master (historical) | ✅ Imported | Via CSV bulk upload |
| Candidate records (CSR data) | ⚠️ Patched | ~batch of records had CSR name instead of candidate name — fixed via `patch_server.py` |
| Candidate CV embeddings | 🔴 Incomplete | ~233,000 candidates lack OpenAI vector embeddings for AI search |
| Vendor master | ✅ Active | Populated via `VendorMaster.jsx` |
| Client & contract data | ✅ Active | Live in `clients` and `contracts` tables |

### 8.3 API Integrations

| Integration | Status | Key / Config |
|---|---|---|
| Google OAuth 2.0 | ✅ Live | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` on Render |
| OpenAI (Passport OCR) | ✅ Live | `AI_INTEGRATIONS_OPENAI_API_KEY` on Render (must not be dummy) |
| OpenAI (AI Search embeddings) | ⚠️ Partial | Key live, but vectorization backlog incomplete |
| Google Cloud Storage (GCS) | ⚠️ Intermittent | `GCS_BUCKET_NAME` + service account JSON — verify on Render (see B-015) |
| HBL Bank file export | ✅ Live | Client-side CSV generation |
| FBR WHT export | ✅ Live | Client-side CSV generation |

---

## 9. DEPLOYMENT & INFRASTRUCTURE

### 9.1 Services

| Service | Platform | URL | Config |
|---|---|---|---|
| Frontend | Render Static Site | `asilhcm-frontend.onrender.com` | Root: `frontend/`, Build: `npm run build`, Publish: `dist/` |
| Backend | Render Web Service | `asilhcm.onrender.com` | Root: `backend/`, Start: `node server.js` |
| Database | Neon PostgreSQL | (connection string in env) | `sslmode=require`, pooler port 5432 |

### 9.2 Required Environment Variables (Backend — Render)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon connection string with `?sslmode=require` |
| `NODE_ENV` | ✅ | `production` |
| `PORT` | ✅ | `10000` |
| `GOOGLE_CLIENT_ID` | ✅ | OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | OAuth 2.0 Secret |
| `SESSION_SECRET` | ✅ | Session signing secret |
| `JWT_SECRET` | ✅ | JWT signing secret |
| `FRONTEND_URL` | ✅ | Live frontend URL |
| `BACKEND_URL` | ✅ | Live backend URL |
| `ALLOWED_DOMAIN` | ✅ | `asil.com.pk` |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | ✅ | Real OpenAI key (must NOT start with `dummy` or `_DUMMY`) |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Optional | Custom OpenAI gateway URL |
| `GCS_BUCKET_NAME` | ✅ | GCS bucket for CV and passport uploads |
| `GOOGLE_APPLICATION_CREDENTIALS` | ✅ | Path to service account JSON (or JSON content) |

### 9.3 Frontend Environment Variables

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://asilhcm.onrender.com` |

### 9.4 SPA Routing Rule (Render)
```
Source:      /*
Destination: /index.html
Action:      Rewrite
```

### 9.5 Google Cloud Console
- **Authorized Redirect URIs**:
  - `https://asilhcm.onrender.com/auth/google/callback` (production)
  - `http://localhost:3000/auth/google/callback` (local)
- `redirect_uri_mismatch` error = URI in console does not match `BACKEND_URL` on Render.

### 9.6 Local Development Ports
| Service | Port |
|---|---|
| Frontend (Vite) | `5173` |
| Backend (Node) | `3000` |

---

## 10. NON-NEGOTIABLE BUSINESS RULES

These rules must NEVER be violated by any code change:

1. **OT Divisor is always 208** — `Gross / (26 × 8)`. Never use 30 days or 22 days.
2. **Absence deduction divisor is always 26** — `Gross / 26` per absent day. Never use 30.
3. **EOBI is flat-rate** — Rs. 400 (EE) / Rs. 2,000 (ER), regardless of individual salary.
4. **Taxable income excludes OPD + reimbursements** — These are non-taxable per FBR rules.
5. **Sales Tax applies only on Service Charges**, not on the full payroll cost.
6. **Province determines Sales Tax rate**, not the contract config (overrides contract's `sales_tax_pct`).
7. **EOSB type is contract-level** — `cfg.eosb_type` overrides employee's `pf_enrolled` flag.
8. **Gratuity is employer-only** — No employee deduction for Gratuity type EOSB (only PF has EE deduction).
9. **Payroll lock is persistent** — Locked months must remain locked across page refreshes. Lock state lives in DB.
10. **Google OAuth is domain-restricted** — Login restricted to `@asil.com.pk`. Any `ALLOWED_DOMAIN` change is a security event.
11. **Candidates ≠ Employees** — Recruitment candidates in `candidates` table are NOT visible in Document Generator or Payroll until formally converted/hired to `employees` table.
12. **ASIL Employee Code format** — `ASIL/[BU]-[SEQ]/[YY]` (e.g., `ASIL/SPL-91/21`). This is the primary key in the live `employees` table.

---

## 11. KNOWN ANTI-PATTERNS & GOTCHAS

| Anti-Pattern | Why It Breaks | Correct Approach |
|---|---|---|
| Running `npm install` in `G:\My Drive\...` | Google Drive sync locks files → `EBADF` errors | Use a local non-synced directory; sync via Git |
| Writing source files with PowerShell default encoding | Introduces UTF-8 BOM → `Unexpected identifier` parse errors | Use `System.Text.UTF8Encoding($false)` explicitly |
| Setting `OPENAI_API_KEY` to a dummy value on Render | OCR and AI search silently fail or 503 | Always use `AI_INTEGRATIONS_OPENAI_API_KEY` with a real key |
| Refreshing immediately after a Render deploy | 2–4 min build lag; user sees old version | Wait for green build status, then hard refresh |
| Using repeated `.env` variable names | `dotenv` uses first occurrence only | Use unique key prefixes per account/integration |
| Relying on DB trigger for advance deduction | `deduct_advance_installment` trigger body is a stub | Implement deduction in application layer (server.js) until trigger is complete |
| Fetching employees for Document Generator from `candidates` table | Candidates are not employees | Always fetch from `employees` table for HCM modules |
| Hardcoding `sales_tax_pct` from contract config | Province overrides contract rate | Always use `provinceSalesTaxRate(emp.province)` |

---

## 12. CHANGE LOG

| Date | Version | Change Summary | Author |
|---|---|---|---|
| 2026-03-31 | 1.0 | Initial blueprint creation — full system analysis | AI Agent |

---

> **Maintenance Policy**: This file is the Single Source of Truth for the ASIL HCM System.
> - **DO NOT DELETE** this file.
> - **UPDATE** the Feature Registry, Bug Ledger, and Change Log after every completed task.
> - **VERIFY** statutory rate tables (EOBI min wage, WHT slabs) at the start of each new fiscal year (July 1).
> - When in doubt about any rule, this document takes precedence over ad-hoc assumptions.
