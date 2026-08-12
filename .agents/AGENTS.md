# ASIL HCM — Antigravity Agent Operational Rules
**Workspace:** `BPOFMSystem` -> `shezad/ASILHCM`
**Last Updated:** 2026-07-05
**Read this file before writing a single line of code.**

---

## SECTION 1 — System Identity & Core Mandate

You are the **Principal Autonomous Software Engineer** on an Enterprise HCM & Payroll Platform serving Allied Services International Limited (Pvt.) Ltd.

- **Primary Objective:** Protect production uptime, database integrity, and payroll calculation accuracy for ~500 active employees.
- **Live production URLs are always at risk.** Every `git push main` auto-deploys to Render production. Remediation work uses the **`staging` git branch** and Render services documented in `render.yaml` / `docs/STAGING_SETUP.md`. Merge to `main` only after staging verification.
- **Authoritative Documentation:** Always read `ARCHITECTURE.md` (root) and `.agents/REMEDIATION_PLAN.md` before writing any backend code. Operational guardrails live in this file (`.agents/AGENTS.md`).

---

## SECTION 0 — ACTIVE REMEDIATION PROGRAM (2026-07-24) — READ THIS FIRST

A full-codebase audit (2026-07-24, Claude Fable 5) established that ASIL HCM contains **two disconnected payroll systems** — legacy browser-computed payroll (`PayrollSheet.jsx` → `payroll_transactions`, owns the only payment path) and the July-2026 server-side engine (`backend/src/modules/payrollrun/`, Excel-parity-validated, owns no payment path) — and that this split is why payroll has never run a single month. A phased consolidation program is now the governing plan:

- **Master plan:** `.agents/REMEDIATION_PLAN.md` — read it before any non-trivial work.
- **Execution protocol:** work happens as discrete sessions defined in `.agents/sessions/S*.md`, executed in ID order, one file per session, each with its own verification checklist. Do not free-lance work that a session file covers.
- **Until the program says otherwise:** World A (legacy payroll) must keep working — ~500 people are paid through it; the blueprints named above are scheduled for deletion in session S0C (after which `ARCHITECTURE.md` replaces them); the staging-lane rules in the session files supersede the "no staging environment" line above once S0B completes.

---


## SECTION 1A — `backend/server.js` Route Map (orientation only, verify before relying on it)

`server.js` is ~8,600 lines with no internal navigation. Approximate line ranges by path prefix (generated 2026-07-18 via grep — re-run if this drifts, don't trust blindly on a stale checkout):

| Path prefix | Lines | Routes |
|---|---|---|
| `/auth/*` (google, me, logout) | 185–214 | 4 |
| `/api/users` | 220–283 | 4 |
| `/health`, `/health/ip` | 307–316 | 2 |
| `/api/admin/*` | 638–747 | 7 |
| `/api/sms/*` | 760–2205 | 3 |
| `/api/bills/*` | 812–5149 | 13 |
| `/api/employees/*` | 432–5196 | 32 (largest route group) |
| `/api/clients/*` | 1249–1412 | 9 |
| `/api/contracts/*` | 1426–4868 | 9 |
| `/api/vendors/*` | 1472–1543 | 6 |
| `/api/config/*` | 1561–5218 | 4 |
| `/api/payroll/*` | 1702–4386 | 11 |
| `/api/invoices/*`, `/api/payslip/*` | 1935–1989 | 5 |
| `/api/portal/*` | 2238–2417 | 5 |
| `/api/change-requests/*` | 2434–2505 | 3 |
| `/api/inventory/*` | 2565–2694 | 11 |
| `/api/xero/*` | 3652–3776 | 7 |
| `/api/ap/*` (payroll-queue, bills confirm, fm-approve) | 3879–5138 | 7 |
| `/api/client-invoices/*` | 4175–4344 | 5 |
| `/api/purchase-orders/*` | 4695–4792 | 6 |
| `/api/audit-log`, `/api/dashboard` | 4889–4907 | 2 |
| `/api/attendance/*` | 5470–5742 | 9 |
| `/api/claims/*` | 5775–6113 | 9 |
| `/api/wafi-claims/*` | 6146–7682 | 31 |

New route modules (post 2026-07-05 restructure) live outside `server.js` entirely, one file per domain: `backend/src/modules/{ar,attendance,billApproval,bizdev,claims,compliance,constraints,disbursement,intake,onboarding,payrollrun,pnl,procurement,projects,xeroBillImport}/routes.js`, mounted via `backend/mountModules.js`.

**World B disbursement (S4B):** `POST /api/payroll-runs/:id/disburse` in `backend/src/modules/disbursement/routes.js` — roles `ap_team`, `finance_manager`, `superadmin`; bridges locked/invoiced runs to `payment_batches` + `payment_ledger`.

---

## SECTION 2 — Execution Guardrails (Non-Negotiable)

### 2.1 Zero-Blind Deploys
A local test suite now exists and is operational (`backend/tests/`, 11 suites, 147 tests, run via `npm test`). Still:
- Run `npm test` and `node --check server.js` after any edit to `server.js` before considering the change done.
- Avoid structural refactors to `server.js` (route reorganization, middleware chain changes, pool config changes) unless the specific route/logic being touched has test coverage — check `backend/tests/` first, don't assume.
- Limit each change to the **smallest possible surgical edit** that achieves the goal.
- After every edit to `server.js`, mentally trace the change for side effects on adjacent routes.

### 2.2 Payroll Lock / Disbursement — Frozen Where Untested
Route names below are current as of 2026-07-18 (verified against `server.js` and `backend/tests/`) — the old names in prior versions of this doc (`/api/payroll/:empId/lock`, `/api/payroll/lock-all`, `/api/ap/confirm`) no longer exist in the code.

**Has test coverage — edits OK if `npm test` stays green:**
- `PATCH /api/payroll/:year/:month/lock` (`backend/tests/payroll.test.js` — role guards + lock scope)

**Covered by integration tests (`backend/tests-int/worldA.payment.test.js`) — edits allowed while `npm run test:int` stays green (procedural gate: run locally before every push touching these paths):**
- `POST /api/ap/payroll-queue/:year/:month/confirm`
- `POST /api/ap/bills/:id/confirm`
- `PATCH /api/ap/batches/:batchId/fm-approve`
- The `payment_batches` and `payment_ledger` INSERT logic

**Why the gate exists:** These routes directly control whether ~500 employees get paid. The integration suite must stay green before any change ships.

### 2.6 Restructure Modules (2026-07-05)
New BPO/FM restructure code lives under `backend/src/` — **not** inside `server.js` body:
- `backend/src/core/` — db pool helper, pg-boss jobs, mailer, migrations runner
- `backend/src/intake/` — unified email intake hub (IMAP)
- `backend/src/modules/*/` — constraints, pnl, intake admin, projects, claims, onboarding, bizdev
- `backend/migrations/` — **all new DDL** via `node-pg-migrate` (`npm run migrate`)
- `backend/mountModules.js` — single mount point wired from `server.js` (2 lines only)
- `backend/worker.js` — Render Background Worker entry for pg-boss jobs

**Rules:**
- New routes go in `backend/src/modules/<name>/routes.js`, mounted via `mountModules.js`
- Never add CREATE TABLE to `server.js` startup for restructure features
- Payroll lock / AP confirm routes remain frozen (Section 2.2)
- After adding routes: update `frontend/src/api.js` and document in `ARCHITECTURE.md`

### 2.8 No New DDL in server.js — Ever (S0C)

The inline CREATE TABLE block in `server.js` startup is **frozen as-is** (load-bearing until Phase 9). All new DDL goes through `backend/migrations/` (node-pg-migrate). Present schema changes to MD for review before applying.

### 2.9 Remediation Program (2026-07-24)

Active multi-session payroll consolidation. **Current phase:** 0 (ground truth & safety) → see `.agents/REMEDIATION_PLAN.md` for session order.

**Protocol:** Execute one file from `.agents/sessions/` at a time, in order. Append to Section 10 changelog when done. Work on `staging` branch; merge to `main` only after staging verification. `[MD GATE]` sessions require human sign-off — prepare tools, do not fake approval.

### 2.10 Integration tests (`npm run test:int`) — mandatory gate (S2A)

Second test tier: real Postgres on Neon **`ci-test`** branch only (`TEST_DATABASE_URL` must contain substring `ci-test` — runner refuses otherwise).

- **Before pushing** anything touching `/api/ap/*`, `/api/payroll*`, `payment_*`, `payroll_run*`, or `employee_claims`: run `npm test` AND `npm run test:int` locally.
- Set `TEST_DATABASE_URL` to the Neon ci-test branch string (never commit). See `docs/STAGING_SETUP.md` §7.
- Harness: `backend/tests-int/`, config `backend/jest.int.config.js`.

### 2.7 Background Jobs (`JOBS_RUNNER`) — Ops Note (S0B)

**Current mode:** `JOBS_RUNNER=web` (default). pg-boss scheduled jobs (intake poll, compliance crons) register inside the main Express web process via `backend/mountModules.js`.

**Limitation:** On Render's free tier, crons only fire while the web dyno is awake. Cold starts and sleep gaps can delay intake polling by hours.

**Upgrade path (Phase 9 / S9):** Deploy `backend/worker.js` as a paid Render Background Worker ($7/mo) with `JOBS_RUNNER=worker` on the worker and `JOBS_RUNNER=none` on the web service. No scheduled job is on the payroll-compute critical path today, so web-mode is acceptable until then.

---

### 2.3 DDL / Schema Governance (S3)

1. **Inline `server.js` DDL block is frozen** — never add CREATE TABLE/ALTER there (Phase 9 removes it).
2. **All new DDL** goes through `backend/migrations/` (node-pg-migrate), idempotent, reviewed before deploy.
3. **After each migration reaches prod**, regenerate `database/schema.sql` via `scripts/regen_schema.ps1` (`DATABASE_URL` → prod).
4. **`tests-int`** bootstraps from `database/schema.sql` + pending migrations — a stale `schema.sql` breaks CI locally by design.
5. **`audit/groundtruth/schema_prod.sql`** is a frozen S0A historical artifact; do not update it.

### 2.4 No Hardcoded Credentials — Ever
```js
// FORBIDDEN — even as a fallback
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
const SMS_PASS = process.env.JAZZ_SMS_PASS || 'Jazz@123';

// REQUIRED — fail hard if the variable is missing
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET env var is not set.');
```
If you need to add a new environment variable, add it to `backend/.env.example` with a comment and state that it must be added to Render before deploying.

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
- [ ] New endpoint is documented in `ARCHITECTURE.md`

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

---

## SECTION 8 — Known System Gaps (Do Not Re-Litigate)

These are documented, accepted gaps. Do not fix them as side effects of other tasks. They require dedicated planning:

1. ~~Leave Management — no DB persistence; UI tab hardcodes CL=10, ML=8, EL=14~~ — RESOLVED 2026-07-20: `EmployeeProfile.jsx` Leave tab now reads/writes the real `employee_leave_balances`/`employee_leaves` tables (pre-existing from the Phase 2 build, just never wired to this UI). CL=10/ML=8/EL=14 remain the defaults but are now overridable per contract via new `contract_leave_policies` table + `GET/PUT /api/leave/policy/:contractId`. See Section 10 changelog entry below for full detail. The employee self-service portal leave-request flow (separate feature, already existed) still uses the global default only — not retrofitted with contract overrides in this pass.
2. ~~Two-step AP approval — currently single-step~~ — RESOLVED: `PATCH /api/ap/batches/:batchId/fm-approve` exists (verified 2026-07-18), gated to `finance_manager`/`superadmin`. No test coverage yet though — see §2.2.
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
- [ ] `ARCHITECTURE.md` is updated if a new route, table, or known gap is added/resolved
- [ ] `BLOCKED.md` is updated if a task could not be completed after 3 attempts
- [ ] No new hardcoded credentials, secrets, or environment variable fallbacks introduced
- [ ] User has been told which env vars (if any) need to be added to Render before deploying

---

## SECTION 10 — Claude Code Session Changelog

This section is updated by Claude Code after any session that changes code, so Cursor/other tools always have a record of what happened outside their own history. Root `CLAUDE.md` imports this whole file (`@.agents/AGENTS.md`), so this is the single canonical rules + changelog file — do not fork a separate copy.

### 2026-07-18 — Security fixes in `backend/server.js` (uncommitted, working tree only)
1. **Fixed 183 error-message leak sites** — every `res.status(N).json({ error: err.message })` (and `e.message` variants) replaced with a generic message + `console.error('[METHOD /path]', err)` server-side logging. Verified via `node --check` + full `npm test` pass (147/147) before and after.
2. **`POST /api/bills/:id/unlock`** now requires `requireRole('superadmin')` (previously password-only). Also added an `audit_log` INSERT on unlock — note: `audit_log` table existed but nothing wrote to it anywhere in the codebase before this. Frontend `BillingProcurement.jsx` "Unlock" button is still shown to all roles (not yet gated) — non-superadmins will now see a "Forbidden" error instead of a working unlock; UI gating is a follow-up, not yet done.
3. **DB pool SSL: `rejectUnauthorized` changed `false` → `true`** (line ~59). **NOT YET VERIFIED against a real Neon connection** — `backend/tests/setup.js` mocks `pg.Pool` entirely, so the test suite passing does not validate this. Before deploying: test against a Neon *dev branch* `DATABASE_URL` (see `.env.example` line ~52), confirm `/health` responds, only then push to `main`.

Committed as `511def6`. Not yet pushed to remote as of the next entry below.

### 2026-07-18 (same day, second session) — Rate limiting, input sanitization, audit trail
Continuing from the prioritized list above. All verified via `node --check` + full `npm test` (147/147) at multiple checkpoints during this batch. **Uncommitted as of this entry** — review `git diff backend/server.js` before committing.

1. **SSL fix (item 3 above) — still unverified.** No DB access available in this environment to test against real Neon; still needs the dev-branch verification described above before that piece is pushed.
2. **CSRF — investigated, no code change made.** `requireAuth` (line ~144) only ever checks the `Authorization: Bearer` JWT header — no route anywhere uses `req.session`/`req.isAuthenticated()` (confirmed via grep). The Passport session cookie is used only transiently during the `/auth/google` → `/auth/google/callback` handshake, and is already `sameSite: 'lax'`. Since no state-changing `/api/*` route relies on cookies for auth, the classic CSRF attack (forged cross-site request riding on ambient cookies) doesn't apply here — adding `csurf` would add complexity for near-zero actual risk reduction. Recorded here so this isn't re-investigated from scratch next time; revisit only if a route is ever added that uses session/cookie auth for a state change.
3. **Input sanitization — added.** New global middleware right after body-parsing (line ~75) strips HTML/script tags from every string in `req.body` via the `striptags` package, skipping strings over 2000 chars (base64 OCR images, bulk CSV/import payloads) to avoid parsing large blobs on every request. (First attempt used `sanitize-html`, which pulled in an ESM-only `htmlparser2` that broke 7/11 Jest suites — swapped to `striptags`, a small zero-dependency CJS package, confirmed all 147 tests pass.)
4. **OCR rate limit — added.** `POST /api/bills/ocr` now has `strictLimiter` (10 req/min, already defined and used elsewhere) — previously had no rate limit at all despite calling paid OpenAI credits per request.
5. **Audit logging — expanded from 1 to 33 call sites.** Added a shared `logAudit(req, actionType, entityType, entityId)` helper (near `requireAuth`/`requireRole`, ~line 158) and wired it into every `app.delete(...)` route (24) and every role/status/lock/approve `PATCH` route (8), fire-and-forget with its own `.catch()` so a logging failure never blocks the actual response. This does **not** cover routes added after this date — new destructive routes need their own `logAudit()` call, it isn't automatic.

### 2026-07-20 — Real Leave Management (contract-aware policy + persisted ledger), replacing the hardcoded CL/ML/EL display
Verified via `node --check server.js` + full `npm test` (147/147, unchanged) after every backend edit, `npm run build` (zero new errors), and `npx eslint` on every touched frontend file compared against a `git show HEAD:<file>` baseline copy (no new errors introduced — pre-existing `react-hooks/static-components`, `react-hooks/purity`, and `no-unused-vars` errors in `EmployeeInformation.jsx`/`EmployeeProfile.jsx`/`ClientInformation.jsx` are untouched, in unrelated sections of those files). **Uncommitted as of this entry.**

**Important mid-task discovery that changed the design from the original plan:** before writing any code, investigation of `server.js` and `phase2Service.js` turned up a *pre-existing, already-persisted* leave system that the task brief (and `SYSTEM_BLUEPRINT.md`/this file's old Section 8 item 1) didn't know about: `employee_leave_balances` (id, employee_id, year, leave_type, entitled, used — unique per employee/year/type) and `employee_leaves` (full leave application/approve/reject history), both created by `phase2Service.js` `setupPhase2Tables`, with working routes already in `server.js` (`GET/POST /api/employees/:id/leaves`, `PATCH /api/employees/:id/leaves/:leaveId`, `GET /api/employees/:id/leave-balance/:year`) and a separate employee-portal leave-request/approval flow (`POST /api/portal/leave-request`, `POST /api/leave/requests/:id/internal-decision`, `GET /api/leave/action/:token`). None of this was wired to `EmployeeProfile.jsx`'s "Leave Management" tab — that tab had its own fully disconnected, in-memory-only fake implementation (`emp.leaves`, `addLeave()` just called `setEmp`/`onUpdate` with no `api.*` call at all, so a page refresh silently discarded every logged leave). Given AGENTS.md §7 explicitly bans deepening a data-split (the `invoices`/`client_invoices` anti-pattern), building a second, parallel `employee_leave_ledger` table as the original task brief specified would have recreated that exact problem. Instead: reused the existing tables/routes and added only the genuinely missing piece — contract-level override.

1. **Migration — `backend/migrations/20260720120000_leave_policies.js`.** New `contract_leave_policies` table only: `id serial PK, contract_id integer not null unique references contracts on delete cascade, cl_days int default 10, ml_days int default 8, el_days int default 14, created_at, updated_at`. Idempotent (`createTable`, node-pg-migrate). **Not run** — no real `DATABASE_URL` in this environment; migration is written and staged, not applied. Absence of a row for a contract means it uses the CL=10/ML=8/EL=14 Pakistan government default. **Post-review correction (same day):** this column was originally typed `text`, which would have failed outright at CREATE TABLE time — `contracts.id` is `INTEGER` (confirmed via the working `purchase_orders.contract_id INT REFERENCES contracts(id)` FK elsewhere in `server.js`), and Postgres requires FK-compatible types. Caught during independent review before anything was applied; fixed to `integer` here and in the migration file. `employees.contract_id` is separately typed `TEXT` (pre-existing, unrelated inconsistency, not touched) but holds the same numeric values as strings, and Postgres coerces that fine in a `WHERE integer_col = $1` comparison — verified this is not a second instance of the same bug.
2. **New module — `backend/src/modules/leave/` (`service.js` + `routes.js`), mounted via `mountModules.js`.** Only two routes, since balance/history/logging already existed:
   - `GET /api/leave/policy/:contractId` (`requireAuth` only, matches the read-access pattern of `GET /api/constraints/policies/:contractId`) — returns `{cl, ml, el}`, defaulting to `{10, 8, 14}` if no override row.
   - `PUT /api/leave/policy/:contractId` (`requireRole('superadmin', 'operations', 'payroll_initiator')`) — upserts an override.
3. **`server.js` — three existing leave routes made contract-aware** (surgical edits, no route added/removed, no test coverage existed for any of them so nothing to break): `POST /api/employees/:id/leaves` (~line 5033), `PATCH /api/employees/:id/leaves/:leaveId` (~line 5060), `GET /api/employees/:id/leave-balance/:year` (~line 5085) — each previously hardcoded `CASE leave_type WHEN 'CL' THEN 10 …` inline; now call a new local helper `entitlementForEmployeeLeave()` / `getLeavePolicy()` (imported from the new leave module) that looks up the employee's `contract_id` and resolves the contract override or government default. `empFromDb()` (~line 456) no longer embeds a fake `leaves: {...}` literal on every employee row — balances are fetched per-employee on demand instead. **Deliberately not touched:** `phase2Service.js`'s `ensureLeaveBalance`/`getLeaveEntitlements` (used by the portal leave-request approval flow) — added contract-awareness there too but only as an *optional* parameter that nothing currently passes, so the existing `phase2.test.js` mock-call-sequence test (`GET /api/leave/action/:token`, 8 chained `mockResolvedValueOnce` calls) stays byte-identical and green. Net effect: the portal self-service leave flow still uses only the global default until a follow-up wires the contract lookup through that path too — flagged, not fixed, per the task's stated priority (HR-side ledger + display, not the portal flow).
4. **`frontend/src/api.js`** — added `getLeavePolicy`, `updateLeavePolicy`, `getEmployeeLeave`, `getEmployeeLeaveHistory`, `recordLeaveUsage` (the last three call the *existing* `/api/employees/:id/leave-balance/:year` and `/api/employees/:id/leaves` endpoints, not new ones — intentional, see point 3).
5. **`frontend/src/EmployeeProfile.jsx`** — Leave Management tab now fetches real balances (`GET /api/employees/:id/leave-balance/:year`, current year) and history (`GET /api/employees/:id/leaves`) on mount via a `loadLeaveData()` callback; `addLeave()` now `await`s `api.recordLeaveUsage(...)` (POSTs with `status: 'Approved'`, matching the old auto-approve UX) and refetches on success instead of mutating local state only. `calcSettlement()`'s EL-balance-for-encashment calculation now reads the same fetched balance instead of the old `emp.leaves?.el` stub. Removed all remaining `emp.leaves`/`emp.leaveHistory` references.
6. **`frontend/src/EmployeeInformation.jsx`** (~line 264, the location named in the original task brief) — removed the stray hardcoded `leaves: {...}` literal from the CSV bulk-import preview row builder. This was dead weight, not the actual bug: it only fed a client-side preview table and was never in the `bulkImportEmployees` column whitelist, so it was already silently dropped server-side — but it mirrored the exact anti-pattern being fixed, so cleaned up for consistency.
7. **`frontend/src/ClientInformation.jsx`** — added a small, self-contained `LeavePolicyEditor` component inside the existing contract editor ("Contract Details" section), shown only when editing an already-saved contract (`contract?.id` truthy — a brand-new contract has no id to attach a policy to yet). Loads via `api.getLeavePolicy`, saves via its own `api.updateLeavePolicy` call and its own saving/success state, independent of the main contract-save flow (different table, no reason to couple them).

**Env vars needed before deploying:** none new.
**Not done / explicitly out of scope for this pass:** portal leave-request contract-override wiring (see point 3); leave approval workflow changes; carry-forward rules; any change to the `employee_leaves`/`employee_leave_balances` table schemas themselves (reused as-is).

### 2026-07-24 — Full-codebase audit + Remediation Program established (docs only, no application code changed)
Claude Code (Fable 5) session. Three-track audit (backend, frontend, docs/deployment) followed by an MD-approved master plan. Key audit facts, recorded so no future session re-derives them:

1. **Two disconnected payroll systems** (the root cause of payroll never running): legacy World A (browser-computed `PayrollSheet.jsx`/`payrollUtils.js` → `POST /api/payroll/:year/:month` stores blindly into `payroll_transactions`; ignores attendance + contract_policies; owns the ONLY payment path AP queue → `payment_batches`/`payment_ledger`) vs World B (`backend/src/modules/payrollrun/` — server-computed from attendance + contract_policies + employee_claims, Excel-parity-validated via `payrollParity.test.js`; owns NO payment path). Different proration bases (26 working days vs 30 calendar days).
2. **Wafi stage-payroll is broken**: server.js ~7065 and ~7739 compute OT payout amounts and INSERT into `payroll_transactions (ot, reimb, opd)` — dead legacy columns from `setup-db.js` (or nonexistent on a fresh bootstrap). Verified Wafi claims never reach payroll. The working pattern is `employee_claims` (`focal_approved`) consumed by `computeRunForContract`.
3. Reachable frontend crashes: `BillingProcurement.jsx:729-734` (undefined CLIENTS/CONTRACTS/SITES), `PayrollSheet.jsx:1390` (undefined netPay), relative-origin fetch `PayrollSheet.jsx:894`.
4. Three contradictory schema sources (dead `database/schema.sql`, ~42 inline CREATE TABLEs in server.js ~8580-8960, 21 migrations) and three contradictory blueprints (this file is the only accurate doc). Backend tests mock pg.Pool entirely — SQL bugs invisible by design.
5. `classifyOtDate` (payrollrun/service.js:86-92) returns 'ot2' for ordinary weekdays — flagged for MD confirmation during the pilot shadow month.

**Artifacts created this session:** `.agents/REMEDIATION_PLAN.md` (master plan: strangler-fig consolidation onto World B, disbursement bridge, pilot parallel-run milestone, contract-by-contract cutover, World A retirement) and `.agents/sessions/S0A…S9` (17 self-contained Composer 2.5 session files with rules headers, verification checklists, rollback notes). New SECTION 0 added at the top of this file. No application code, schema, or data was modified.

### 2026-07-24 — S0A production ground-truth snapshot (remediation program)
Read-only session per `.agents/sessions/S0A_ground_truth_snapshot.md`. No application code or database changes.

1. **`scripts/backup_prod.ps1`** — repeatable `pg_dump -Fc` wrapper; `backups/` added to `.gitignore`.
2. **`audit/groundtruth/schema_prod.sql`** — schema-only prod snapshot (6,246 lines).
3. **`audit/groundtruth/facts.md`** — live query outputs: 19/21 migrations applied (`payroll_runs` present — Phase 4 not blocked); legacy `ot`/`opd`/`reimb` columns confirmed on `payroll_transactions`; all 8 World B dependency tables exist; locked payroll only April 2026 (303 rows); pilot contract matrix for S5.
4. **Full backup** — `backups/prod_20260724_041440.dump` (797 MB, local only). Integrity verified via `pg_restore --list`.
5. **SSL note:** `/health` on commit `8efc8c0` returns HTTP 200 with live Neon connection — `rejectUnauthorized: true` concern resolved in production.
6. **Restore-test PASSED** (2026-07-24) — MD-created Neon branch `restore-test`; `pg_restore --clean --if-exists` + `SELECT COUNT(*) FROM employees` → **682** (prod parity). Minor EOF on `uploaded_files` tail — see `facts.md` §7. Delete scratch branch in Neon when done.

**Env vars needed:** `DATABASE_URL` (prod, shell-only) for backup script re-runs.

### 2026-07-24 — S0B staging environment + render.yaml (remediation program)
Infrastructure-as-code session per `.agents/sessions/S0B_staging_and_iac.md`. No application code changes.

1. **`render.yaml`** — four services: prod backend (`asilhcm`), prod frontend (`asil-hcm-frontend`), staging backend (`asil-hcm-staging`), staging frontend (`asil-hcm-frontend-staging`). Secrets marked `sync: false`.
2. **`docs/STAGING_SETUP.md`** — MD click-by-click: Neon branches `staging` + `ci-test`, Render services, OAuth origins, DB seed via `pg_restore`.
3. **§2.7 JOBS_RUNNER ops note** — web-mode documented; worker upgrade path deferred to Phase 9.
4. **Neon/Render dashboard steps** — not executed in agent environment (`NEON_API_KEY` / staging `DATABASE_URL` unavailable). See `BLOCKED.md` §S0B for MD actions.

**Env vars needed before staging is live:** Neon `staging` branch `DATABASE_URL` on Render `asil-hcm-staging`; OAuth staging URLs in Google Cloud Console.

### 2026-07-24 — S0C dead weight cleanup + ARCHITECTURE.md (remediation program)
Per `.agents/sessions/S0C_dead_weight_and_docs.md`.

1. **Deleted dead code:** `backend/_attendance_routes.js`, `attendanceKPI.js`, `check_bonus_http.js`, `test.js`, `cleanup.js`; `frontend/src/PayrollIntegration.jsx`, `ClientMaster.jsx`, `features/attendance/MonthlyReport.jsx`, `TeamSetup.jsx`; removed unused `MockOCR` import from `App.jsx` (component file retained).
2. **Deleted contradictory blueprints:** `SYSTEM_BLUEPRINT.md`, `SYSTEM_BLUEPRINT_MASTER.md`, `backend/BLUEPRINT.md`.
3. **`ARCHITECTURE.md`** — verified-facts architecture doc (two-world payroll, canonical tables, deployment topology).
4. **AGENTS.md** — blueprint refs → `ARCHITECTURE.md` + `REMEDIATION_PLAN.md`; §2.8 no-new-DDL-in-server.js; §2.9 remediation protocol; removed obsolete anti-pattern row re route files.

**Not deleted:** `server.js.bak` (did not exist). `scripts/archive/inject_attendance.js` still references deleted `_attendance_routes.js` (archive only).

### 2026-07-24 — S1B Wafi stage-payroll → employee_claims (remediation program)
Per `.agents/sessions/S1B_wafi_stage_to_claims.md`.

1. **Migration `20260724120000_employee_claims_source.js`** — `source_kind`, `source_session_id`, `source_ref` + partial unique index for idempotent Wafi staging.
2. **`server.js`** — `stageWafiSessionToEmployeeClaims()` helper; both `stage-payroll` and `verify` routes write `employee_claims` (hours for OT, amounts for expense/medical) instead of dead `payroll_transactions.ot/reimb/opd` columns.
3. **Guard** — skips rows already `in_payroll_run`; re-stage is idempotent via ON CONFLICT.

**Migration not applied in agent environment** — run `npm run migrate` on staging when `DATABASE_URL` available.

4. **AGENTS.md §2.10** — procedural gate documented.

**Verification blocked** — no `TEST_DATABASE_URL` (Neon `ci-test` branch) in agent environment. See `BLOCKED.md`.

### 2026-07-24 — S1D payroll lock accrual visibility (remediation program)
Per `.agents/sessions/S1D_lock_accruals.md`. Lock route changes committed with S1C (`ffe7c9d`) in `server.js`.

1. **`PATCH /api/payroll/:year/:month/lock`** — accruals in try/catch; `accruals` object on response; `console.error('[payroll-lock accruals]', err)` on failure.
2. **`payroll.test.js`** — accruals success shape + failure-while-lock-succeeds.

### 2026-07-24 — S1C portal OTP actionable errors (remediation program)
Per `.agents/sessions/S1C_portal_otp_409.md`.

1. **`verify-otp`** — 409 codes: `EMPLOYEE_NOT_FOUND`, `EMPLOYEE_INACTIVE`, `CONTACT_MISMATCH`.
2. **`request-otp`** — 409 `NO_CONTACT_CHANNEL` when no email/phone.
3. **`GET /api/admin/portal-readiness`** — superadmin readiness report.
4. **`EmployeePortal.jsx`**, **`api.getPortalReadiness`**, **`portalAuth.test.js`** extended.

### 2026-07-24 — S3 single schema source of truth (remediation program)
Per `.agents/sessions/S3_schema_governance.md`.

1. **`database/schema.sql`** — replaced aspirational file with prod snapshot + generated header.
2. **`scripts/regen_schema.ps1`** — pg_dump schema-only regen wrapper.
3. **AGENTS.md §2.3** — schema governance rules (frozen server.js DDL, migrations-only, regen after deploy).
4. **`tests-int/globalSetup.js`** — bootstraps from `database/schema.sql` (S0A `audit/groundtruth/schema_prod.sql` frozen).

**Verification:** `npm run test:int` 4 suites / 22 tests green from cold bootstrap; `git grep employee_master database/` empty.

---

### 2026-07-24 — S2C World B payroll engine integration tests (remediation program)
Per `.agents/sessions/S2C_world_b_engine_tests.md`.

1. **`tests-int/fixtures/worldB.js`** — policy, rate card, attendance, monthly override, focal_approved + wafi claims, holiday.
2. **`tests-int/worldB.engine.test.js`** — characterization tests for `computeRunForContract`, OT cap/disallow, claim consumption, recompute idempotency, `RUN_LOCKED`, `patchRunRow` (override not preserved on recompute), `lockRun`/`cost_allocations`, `generateInvoiceFromRun`, `classifyOtDate`.
3. **`runtimeDdl.js`** — added `attendance_records.ot_rate` (engine SELECT expects column absent from S0A snapshot).

**S5B triage flags:** `classifyOtDate` returns `ot2` for weekdays (never `ot1`); `patchRunRow` overrides lost on full recompute.

**Verification:** `npm run test:int` 22 tests green; `payrollParity.test.js` green.

---

### 2026-07-24 — S2B World A AP payment integration tests (remediation program)
Per `.agents/sessions/S2B_world_a_payment_tests.md`. No AP route logic changes.

1. **`tests-int/fixtures/worldA.js`** — client/contract/bank/employees + locked payroll_transactions fixture builder.
2. **`tests-int/worldA.payment.test.js`** — supertest against real app: payroll lock (finance_approver/superadmin), AP queue GET, confirm (batch + ledger exact rows), idempotent double-confirm, fm-approve role guard, bill confirm happy path.
3. **`tests-int/harness-proof.test.js`** — legacy `ot`/`opd`/`reimb` INSERT succeeds on prod-shaped schema (S0A facts §2).
4. **`tests-int/globalSetup.js`** + **`helpers/`** — psql schema bootstrap, pgmigrations seeding, runtime DDL for payment_batches FM columns + scoped unique index.
5. **AGENTS.md §2.2** — AP confirm routes unfrozen; `npm run test:int` procedural gate.

**Verification:** `npm run test:int` 3 suites / 12 tests green; `node --check server.js` clean. Unit tier via local `C:\temp\BPOFMSystem-backend` node_modules (GDrive-corrupted `backend/node_modules/jest`).

---

### 2026-07-24 — S4A disbursement bridge service (remediation program)
Per `.agents/sessions/S4A_disbursement_service.md`. No HTTP route; World A AP confirm routes untouched.

1. **Migration `20260724140000_payment_batches_source_run.js`** — nullable `payment_batches.source_run_id` (no FK).
2. **`backend/src/modules/disbursement/service.js`** — `disburseRun(pool, runId, opts, actor)` in one transaction: guards (`RUN_NOT_DISBURSABLE`, `BATCH_EXISTS`, `LEGACY_PAYROLL_LOCKED`, `MISSING_BANK_DETAILS`), bulk `payment_ledger` INSERT mirroring World A confirm id/reference/bank-slug format, sets run `paid`.
3. **`payrollrun/service.js`** — `invoiced` added to `PAYROLL_RUN_STATUSES`; `invoiced → paid` transition for disbursement.
4. **`tests-int/disbursement.test.js`** — happy path, Guard A/B, missing bank + `allow_missing_bank`, idempotence, atomicity rollback.
5. **`scripts/rollback_disbursement.sql`** — manual pre-bank-file rollback (ledger → batch → run `locked`).
6. **`jest.config.js`** — exclude `portalClaims.test.js` (Node `--test` runner only; was breaking `npm test`).

**Verification:** `node --check server.js` clean; `npm test` 203/203; `npm run test:int` 5 suites / 28 tests green (ci-test).

**Env vars needed:** none new. Run `npm run migrate` on staging when deploying.

---

### 2026-07-24 — S4B disbursement route + PayrollRun UI (remediation program)
Per `.agents/sessions/S4B_disbursement_route_ui.md`. World A AP confirm routes untouched.

1. **`backend/src/modules/disbursement/routes.js`** — `POST /api/payroll-runs/:id/disburse` with `requireAuth` + `requireRole('ap_team','finance_manager','superadmin')`; maps service codes to HTTP (200/404/409/422); `logAudit(req, 'DISBURSE', 'payroll_run', id)` on success.
2. **`mountModules.js`** — registers `registerDisbursementRoutes`; `logAudit` passed in deps from `server.js`.
3. **`frontend/src/api.js`** — `disbursePayrollRun(runId, payload)` with structured error (`code`, `employees`, `batch_id`).
4. **`frontend/src/features/payroll/PayrollRun.jsx`** — Disburse button (locked/invoiced runs, role-gated); modal with bank select, payment date, reference, notes; 422 missing-bank list + exclude checkbox; 409 typed messages; success shows batch id.
5. **`frontend/src/App.jsx`** — `payroll_run` tab added for `ap_team`; `PayrollRun` receives `user` prop.
6. **`backend/tests/disbursement.test.js`** — role guard contract tests (401/403/allowed roles).

**Env vars needed:** none new.

---

### 2026-07-25 — S5A Excel-vs-HCM variance report tool (remediation program)
Per `.agents/sessions/S5A_variance_tool.md`. Read-only; no HTTP route.

**Pilot contract selected:** `CTR-1773048704450` — Facility Management, Wafi Energy Pakistan Pvt Ltd (38 employees). Rationale in `scripts/VARIANCE_INPUT_FORMAT.md` and `audit/pilot/README.md`.

1. **`backend/src/payroll/varianceCompare.js`** — pure comparison core: CSV parse (alias headers), HCM `payroll_run_rows` extract, per-field delta, summary + CSV/MD formatters.
2. **`scripts/variance_report.js`** — CLI: `--csv --contract --month --year` (DB SELECT) or `--hcm-json` (offline); exit 0 only on zero variance.
3. **`scripts/VARIANCE_INPUT_FORMAT.md`** — column contract + export procedure.
4. **`backend/tests/varianceCompare.test.js`** — 7 unit tests including rounding edge case and known-delta fixtures.
5. **`audit/pilot/`** — pilot README + S5A verification fixtures.

**Verification:** `npm test` **223/223** (+7); fixture runs exit 1 (deltas) / exit 0 (all-zero).

**Env vars needed:** none new. Uses `DATABASE_URL` / `TEST_DATABASE_URL` / `STAGING_DATABASE_URL` for live runs.

---

### 2026-07-24 — S1A frontend crashes (remediation program)
Per `.agents/sessions/S1A_frontend_crashes.md`.

1. **`BillingProcurement.jsx`** — `ImportQuotationModal` review stage now uses `clientsList`/`contractsList` props (was undefined `CLIENTS`/`CONTRACTS`/`SITES`).
2. **`PayrollSheet.jsx`** — Bulk-SMS placeholder label escaped (`{'{name}'}` / `{'{netPay}'}`); payslip email routed through `api.sendPayslipEmails`.
3. **`api.js`** — added `sendPayslipEmails(year, month, employeeIds)`.

---

### 2026-07-31 — July 2026 cutover + Wafi refresh (P0–P3)
Per `.agents/plans/JULY_2026_CUTOVER_AND_WAFI_REFRESH.md`.

1. **P0** — `system_config` keys `cutover_period` / `show_pre_cutover_archive`; `backend/src/core/cutover.js`; `GET/PUT /api/admin/cutover-settings`; archive toggle in `App.jsx` (superadmin + huzaifa only).
2. **P1** — Cutover filters on employees, dashboard, AP queue, FM batches, client invoices, payroll runs, Wafi sessions/stats.
3. **P2** — `scripts/wafi_roster_refresh.js` + `backend/src/modules/employees/wafiRosterRefresh.js`; Wafi CSV header aliases in `masterRoster.js`.
4. **P3** — `wafi_claims_approval_events`; session `approval_state` / routing columns; focal→LM magic links (`/api/wafi-claims/focal-action`, `lm-action`); verify/stage gated on `ready_for_hcm`.

**Wafi routing column map:** `claim_authority` = focal filler email; `line_manager_email` = LM approver; `supervisor_email` legacy portal approver (unchanged for non-Wafi).

**Env vars needed:** none new. Run `npm run migrate` on staging before deploy.

**Verification follow-up (2026-07-31):** Tightened `assertReadyForHcm` (null state blocked for post-Jul-2026 when chain enabled); portal `resolveApproverEmail` prefers LM when focal+LM both named; Wafi roster refresh clears duplicate `supervisor_email`; dashboard invoice KPI + legacy payroll GET respect cutover floor.

---

### 2026-08-01 — Fixed Value contract wizard + CORO SS94 onboarding
Per plan `fv_coro_contracts` (CORO onboarding & data-driven PSO North Zone).

1. **Migration `20260801120000_contracts_fv_meta.js`** — `contracts.meta` JSONB (+ GIN index).
2. **`contractCrud.js`** — single write path: create/update/get FV contracts, `resyncNorthZoneFromSeed`, `createCoroFromSeed`.
3. **Routes** — `GET/POST /api/fixed-value/contracts`, `GET/PUT .../:id`, `POST .../CTR-PSO-NORTH-ZONE/resync-seed`; `POST /seed-pso` kept as deprecated alias.
4. **UI** — `FixedValueContractWizard.jsx` (6 steps); ops UI New/Edit + “Re-sync North Zone from seed JSON”.
5. **CORO seed** — `seedData/pso_coro_ss94.json` + `scripts/seed_pso_coro_ma.js` (`CTR-PSO-CORO-MA` / `SO-PSO-CORO-SS94`, monthly **4,136,919.94** + 16% ST → **4,798,827.13**).
6. **Roster assign** — `scripts/assign_coro_employees.js` (64 CORO rows → `site=SS94`).
7. **Date parse** — `backend/src/core/dateParse.js`; CNIC/gate-pass expiry `16-Aug-32` → `2032-08-16`; `scripts/fix_pso085_cnic_expiry.sql`.
8. **`siteProvince()`** — prefers `so.meta.province` / contract region before hardcoded map.

**Env vars needed:** none new. Staging/prod data ops require `DATABASE_URL` or `STAGING_DATABASE_URL`: migrate → `seed_pso_coro_ma.js` → `assign_coro_employees.js --apply` → PSO-085 SQL.

---

### 2026-08-12 — FV invoice per-line shortages (Chakpirana / PSO)

Absence shortages on Fixed Value invoices now nest under the matching SO line item instead of consolidating at the bottom as "LESS: Additional Shortages / Adjustments".

1. **`designationMatch.js`** — shared normalize/alias/`findLineForDesignation` extracted from `attendanceIngest.js` (one matcher for ingest + print).
2. **`invoiceHtml.js`** — `attributeDeductions`: `line_id` match, else designation→roles, else orphan. Per-line label: `• Name (Designation) — N day(s) absent (@ Rs. X/day)`. Amount PKR = gross − line shortages. Footer: `LESS: Shortage / Deductions`.
3. **`crud.js` `replaceLines`** — captures `so_deductions.line_id` before DELETE, re-points onto new serial ids (stops ON DELETE SET NULL orphans on SO re-sync).
4. **`billing.js` `printInvoiceHtml`** — prefers live SO line id when stamped `lineId` is stale.
5. **`backend/scripts/backfill_so_deduction_lines.js`** — dry-run by default; `--apply` writes `line_id` for existing orphans.
6. **Tests** — Chakpirana July fixture in `fvInvoiceBilling.test.js` + `replaceLines` re-point mock.

**Env vars needed:** none new. Optional staging backfill: `node backend/scripts/backfill_so_deduction_lines.js --contract CTR-PSO-NORTH-ZONE --month 7 --year 2026` then `--apply`.

---

## Cursor Cloud specific instructions

Durable notes for running ASIL HCM inside a Cursor Cloud Agent VM. Dependency install (`npm install` in `backend/` and `frontend/`) is handled by the environment update script; this section only covers the non-obvious startup/run caveats. Standard commands live in `backend/package.json` / `frontend/package.json` and `backend/.env.example` — refer to those; only the gotchas are repeated here.

### Services (dev)
- **Backend** — Express API, `backend/`, port **3000**, health at `GET /health`.
- **Frontend** — React 19 + Vite dev server, `frontend/`, port **5173**.
- **PostgreSQL 16** — local, installed in the VM snapshot. DB `asil_hcm_dev`, role `asil` / password `asil_dev_pw` (made SUPERUSER — local sandbox only). Start it after a fresh boot: `sudo pg_ctlcluster 16 main start`.

### Non-obvious caveats
1. **`server.js` does NOT load dotenv.** `npm run dev` (`node server.js`) will ignore `backend/.env`. Start the backend with dotenv preloaded: `NODE_EXTRA_CA_CERTS=/workspace/backend/.dev-pg-ca.crt node -r dotenv/config server.js` (run from `backend/`). Migrations/worker (`src/core/*`) do load dotenv.
2. **The main `server.js` pool forces `ssl: { rejectUnauthorized: true }`** even for localhost (unlike `src/core/db.js`, which disables SSL for localhost). So local Postgres has SSL enabled with a self-signed cert, and Node must trust it via **`NODE_EXTRA_CA_CERTS=/workspace/backend/.dev-pg-ca.crt`** (gitignored, machine-specific, persisted in the snapshot). Without this env var the backend cannot connect to the DB.
3. **A fresh/empty DB is only partially bootstrapped by `server.js` inline `CREATE TABLE IF NOT EXISTS` (~20 tables).** The full schema (~112 tables: `employees`, `contracts`, `clients`, `payroll_transactions`, …) comes from loading `database/schema.sql` then applying post-snapshot migrations (same flow as `backend/tests-int/globalSetup.js`). This is already done in the snapshot. If you ever rebuild the DB: `database/schema.sql` is a PG17/18 dump — strip the `SET transaction_timeout` and `\restrict`/`\unrestrict` lines before loading into PG16, then seed `pgmigrations` for migrations before `20260724120000_employee_claims_source.js` and run the rest with `node-pg-migrate`.
4. **Auth is Google OAuth (`@asil.com.pk`), which is unavailable in the VM.** `requireAuth` only verifies a JWT bearer token signed with `JWT_SECRET`, so bypass OAuth by minting a token (payload `{id,email,name,avatar,role}`) and opening `http://localhost:5173/?token=<JWT>` (the SPA stores it in `localStorage.asil_hcm_token`). A superadmin user `dev.admin@asil.com.pk` is already seeded in `hcm_users`.
5. **Frontend must have `VITE_API_URL=http://localhost:3000`** (in `frontend/.env.local`); otherwise every request defaults to the production URL `https://asilhcm.onrender.com`.

### Lint / test / build
- Backend tests: `npm test` in `backend/` (mocks `pg`, needs no DB). NOTE: a handful of tests currently fail on `main` (e.g. in `tests/serviceOrders.test.js`, `tests/cutover.test.js`) — pre-existing, unrelated to environment setup.
- Frontend lint: `npm run lint` in `frontend/` — runs, but the codebase has many pre-existing eslint errors (`react-hooks/*`, `no-unused-vars`).
- Frontend build: `npm run build` in `frontend/`.
- Integration tests `npm run test:int` require a Neon `ci-test` branch via `TEST_DATABASE_URL` and cannot run against the local DB (the runner refuses URLs without the `ci-test` marker).

---

*This file is maintained by the Antigravity Development Consultant. Update it when architectural decisions change.*
