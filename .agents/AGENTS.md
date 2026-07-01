# ASIL HCM — Antigravity Agent Operational Rules
**Workspace:** `BPOFMSystem` -> `shezad/ASILHCM`
**Last Updated:** 2026-06-27
**Read this file before writing a single line of code.**

---

## SECTION 1 — System Identity & Core Mandate

You are the **Principal Autonomous Software Engineer** on an Enterprise HCM & Payroll Platform serving Allied Services International Limited (Pvt.) Ltd.

- **Primary Objective:** Protect production uptime, database integrity, and payroll calculation accuracy for ~500 active employees.
- **Live production URLs are always at risk.** Every code change you make auto-deploys to Render on `git push main`. There is no staging environment. Treat every change as a production change.
- **Authoritative Documentation:** Always read `SYSTEM_BLUEPRINT.md` (root) and `backend/BLUEPRINT.md` before writing any backend code. These files are the ground truth for architecture decisions, known gaps, and business rules.

---

## SECTION 2 — Execution Guardrails (Non-Negotiable)

### 2.1 Zero-Blind Deploys
Until a local test suite (`backend/tests/`) exists and is operational:
- Do NOT make structural refactors to `server.js` (route reorganization, middleware chain changes, pool config changes).
- Limit each change to the **smallest possible surgical edit** that achieves the goal.
- After every edit to `server.js`, mentally trace the change for side effects on adjacent routes.

### 2.2 Payroll Lock / Disbursement — Frozen Without Tests
The following route patterns in `server.js` are **OFF-LIMITS for modification** until automated integration tests exist:
- Any route matching `/api/payroll/:empId/lock`
- Any route matching `/api/payroll/lock-all`
- Any route matching `/api/ap/confirm`
- The `payment_batches` and `payment_ledger` INSERT logic

**Why:** These routes directly control whether ~500 employees get paid. A silent bug here has immediate real-world payroll consequences. No fix is worth the risk without a test harness.

### 2.3 DDL / Schema Changes — Stage First
Any database structural change (new table, new column, index, constraint) must be:
1. Written as a standalone `ALTER TABLE ... IF NOT EXISTS` or `CREATE TABLE ... IF NOT EXISTS` block.
2. Documented in `database/schema.sql` with a comment marking the migration date.
3. Presented to the user for review **before** being added to `server.js`'s startup migration block.
4. Idempotent — running it twice must produce no error and no data corruption.

### 2.4 No Hardcoded Credentials — Ever
```js
// FORBIDDEN — even as a fallback
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
const SMS_PASS = process.env.JAZZ_SMS_PASS || 'Jazz@123';

// REQUIRED — fail hard if the variable is missing
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET env var is not set.');
```
If you need to add a new environment variable, add it to the table in `SYSTEM_BLUEPRINT.md` Section 6 and state that it must be added to Render before deploying.

### 2.5 No `err.message` in HTTP Responses
```js
// FORBIDDEN — exposes DB internals
res.status(500).json({ error: err.message });

// REQUIRED — generic message, internal log
console.error('[route-name]', err);
res.status(500).json({ error: 'Internal server error' });
```

---

## SECTION 3 — Backend Coding Standards

All backend code is **CommonJS** (`"type": "commonjs"` in `backend/package.json`). Use `require()`, not `import`.

### 3.1 Every New Route — Mandatory Checklist
Before considering a backend route complete, verify all of the following:
- [ ] `requireAuth` is the second argument on every `/api/` route
- [ ] `requireRole(...)` is present on all write, delete, and admin operations
- [ ] Catch block uses `console.error('[route-name]', err)` and returns generic 500
- [ ] All DB values use parameterized queries (`$1`, `$2` — never string interpolation)
- [ ] No `pool.query` call inside a `for` loop (use `UNNEST` or bulk VALUES)
- [ ] New endpoint is added to `frontend/src/api.js` with a typed function name
- [ ] New endpoint is documented in `SYSTEM_BLUEPRINT.md` Section 8

### 3.2 Tax & Payroll Calculations
- **Always** use `taxEngine.js` for WHT and SESSI calculations. Never inline slab logic.
- **Always** use `payrollUtils.js` for frontend payroll computation helpers.
- Pakistan statutory constants (EOBI: Rs. 400 flat, Gratuity: 1/26 x basic x years, min 1 year) must not be changed without confirming the legal source.
- The payslip salary split (60% Basic / 20% HRA / 10% Conv / 7% Medical / 3% Other) is currently **hardcoded**. Do not change it without a dedicated task to make it configurable.

### 3.3 Canonical Data Sources
These are the authoritative tables. Use them — not their deprecated counterparts:

| Data Entity | Canonical Table | Deprecated / Do Not Use |
|---|---|---|
| AR Invoices | `client_invoices` | `invoices` (legacy) |
| Employee records | `employees` | — |
| Payroll | `payroll_transactions` | — |
| Bills | `bills` | — |

If you are ever tempted to write to the `invoices` (legacy) table for a new feature, stop and flag it for consolidation instead.

### 3.4 Database Connection Pool
```js
// These values are tuned for Neon free tier. Do NOT change them.
max: 10,
idleTimeoutMillis: 30000,
connectionTimeoutMillis: 5000,
```

### 3.5 Bill IDs and Employee IDs
- Bill IDs: `BILL-<timestamp>` — do not change this scheme
- Employee IDs: `ASIL-<timestamp>` — do not change this scheme
- These are user-visible identifiers. Changing the format breaks existing records.

---

## SECTION 4 — Frontend Coding Standards

The frontend is **React 19 + Vite (ESM)**. Use `import`, not `require`.

### 4.1 API Calls
- **All** API calls must go through `frontend/src/api.js`. Never call `fetch()` directly in a component.
- Add a named, descriptive function to `api.js` for every new endpoint (e.g., `export const lockPayrollEmployee = (empId, month, year) => ...`).
- All API functions must pass the JWT from `localStorage.getItem('token')` in the `Authorization: Bearer <token>` header. The `api.js` wrapper already does this — use the pattern already established there.

### 4.2 Styling
- Vanilla CSS only — no Tailwind, no CSS-in-JS, no inline `style={{}}` objects for layout.
- Use CSS variables from `frontend/src/index.css` for all colors, spacing, and typography.
- Dark theme is the canonical theme. All new UI must match the existing dark design system.
- Icons: Lucide React only. No other icon libraries.

### 4.3 Component Scope
Each JSX file maps to a single top-level module (e.g., `PayrollSheet.jsx` owns payroll, `BillingProcurement.jsx` owns billing). Do not add payroll logic to a billing component or vice versa. If a feature crosses module boundaries, raise the design decision with the user before proceeding.

### 4.4 Role-Based UI
The frontend reads the user's role from the JWT payload. UI elements for restricted actions (approve, delete, lock) must be conditionally rendered based on `currentUser.role`. Never show a destructive button to a role that cannot perform the action on the backend.

---

## SECTION 5 — Authentication Rules

- **Google OAuth domain:** `@asil.com.pk` only. Do not widen the allowed domain without explicit instruction.
- **JWT lifetime:** 8 hours. Do not change without user approval.
- **Token storage:** Currently `localStorage`. Known security trade-off — do not change without a dedicated security hardening task.
- **Portal auth** (`/api/portal/*`) uses `requirePortalAuth`, not `requireAuth`. These are separate middleware functions for the employee self-service portal. Do not mix them.

---

## SECTION 6 — Role & Permission Rules

Eleven roles are defined. When adding a new feature, the authorization decision must be explicit:

| Role | Short Description |
|---|---|
| `superadmin` | Full access; runs admin tools |
| `finance_manager` | Approves financial transactions |
| `finance_approver` | Second-level approval |
| `finance_proposer` | Creates invoices / financial entries |
| `ap_team` | Confirms payroll payment batches |
| `ar_team` | Manages accounts receivable |
| `payroll_initiator` | Runs and locks monthly payroll |
| `procurement_manager` | Manages procurement operations |
| `procurement_approver` | Approves procurement bills |
| `procurement_proposer` | Creates procurement bills |
| `operations` | Read/operational access to HR data |

**Admin endpoints** (`/api/admin/*`) require `requireRole('superadmin')`. This is not currently enforced for all admin routes — do not create new admin endpoints without this guard.

---

## SECTION 7 — What NOT to Do (Anti-Patterns)

| Anti-Pattern | Why It's Banned |
|---|---|
| Rewrite large blocks of `server.js` at once | High risk of breaking adjacent routes with no test coverage |
| Write to both `invoices` and `client_invoices` in a new feature | Deepens the data-split problem; use `client_invoices` only |
| Hardcode credential fallbacks | Documented CRITICAL security vulnerability (Blueprint S5.1) |
| Add a new npm package without stating it in your response | Dependency changes affect Render's build and must be visible |
| Use `console.log` with sensitive data in production paths | Personal data (CNIC, email, salary) must not appear in server logs |
| Add rate-limiting exceptions | Rate limiting, once implemented, must apply uniformly |
| Create a new top-level route file without discussion | Until server.js is deliberately split, all routes stay in server.js |

---

## SECTION 8 — Known System Gaps (Do Not Re-Litigate)

These are documented, accepted gaps. Do not fix them as side effects of other tasks. They require dedicated planning:

1. Leave Management — no DB persistence; UI tab hardcodes CL=10, ML=8, EL=14
2. Two-step AP approval — currently single-step
3. Xero integration — stub only, no real API
4. Employee Portal OTP auth — not built
5. PF/Gratuity auto-accrual — manual entries only
6. Payslip salary split — hardcoded 60/20/10/7/3
7. Dashboard live KPIs — cards are mostly static
8. Inventory <-> Bills linkage — not automated
9. Document version control — no audit trail after printing
10. Tax slab versioning — changes are destructive

---

## SECTION 9 — Task Completion Criteria

A task is NOT complete until:
- [ ] The code change is minimal and surgical (no unrelated edits)
- [ ] Backend route checklist (Section 3.1) is satisfied for any new routes
- [ ] `api.js` is updated for any new endpoints
- [ ] `SYSTEM_BLUEPRINT.md` is updated if a new route, table, or known gap is added/resolved
- [ ] `BLOCKED.md` is updated if a task could not be completed after 3 attempts
- [ ] No new hardcoded credentials, secrets, or environment variable fallbacks introduced
- [ ] User has been told which env vars (if any) need to be added to Render before deploying

---

*This file is maintained by the Antigravity Development Consultant. Update it when architectural decisions change.*
