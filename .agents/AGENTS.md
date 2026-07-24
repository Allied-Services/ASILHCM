# ASIL HCM — Antigravity Agent Operational Rules
**Workspace:** `BPOFMSystem` -> `shezad/ASILHCM`
**Last Updated:** 2026-07-05
**Read this file before writing a single line of code.**

---

## SECTION 1 — System Identity & Core Mandate

You are the **Principal Autonomous Software Engineer** on an Enterprise HCM & Payroll Platform serving Allied Services International Limited (Pvt.) Ltd.

- **Primary Objective:** Protect production uptime, database integrity, and payroll calculation accuracy for ~500 active employees.
- **Live production URLs are always at risk.** Every `git push main` auto-deploys to Render production. Remediation work uses the **`staging` git branch** and Render services documented in `render.yaml` / `docs/STAGING_SETUP.md`. Merge to `main` only after staging verification.
- **Authoritative Documentation:** Always read `SYSTEM_BLUEPRINT.md` (root) and `backend/BLUEPRINT.md` before writing any backend code. These files are the ground truth for architecture decisions, known gaps, and business rules.

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

New route modules (post 2026-07-05 restructure) live outside `server.js` entirely, one file per domain: `backend/src/modules/{ar,attendance,billApproval,bizdev,claims,compliance,constraints,intake,onboarding,payrollrun,pnl,procurement,projects,xeroBillImport}/routes.js`, mounted via `backend/mountModules.js`.

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

**Still OFF-LIMITS for modification — no test coverage found (verified 2026-07-18):**
- `POST /api/ap/payroll-queue/:year/:month/confirm`
- `POST /api/ap/bills/:id/confirm`
- `PATCH /api/ap/batches/:batchId/fm-approve`
- The `payment_batches` and `payment_ledger` INSERT logic

**Why:** These routes directly control whether ~500 employees get paid. A silent bug here has immediate real-world payroll consequences. No fix to the still-untested routes is worth the risk without a test harness first — add the test, then make the change.

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
- After adding routes: update `frontend/src/api.js` and document in `SYSTEM_BLUEPRINT.md`

### 2.7 Background Jobs (`JOBS_RUNNER`) — Ops Note (S0B)

**Current mode:** `JOBS_RUNNER=web` (default). pg-boss scheduled jobs (intake poll, compliance crons) register inside the main Express web process via `backend/mountModules.js`.

**Limitation:** On Render's free tier, crons only fire while the web dyno is awake. Cold starts and sleep gaps can delay intake polling by hours.

**Upgrade path (Phase 9 / S9):** Deploy `backend/worker.js` as a paid Render Background Worker ($7/mo) with `JOBS_RUNNER=worker` on the worker and `JOBS_RUNNER=none` on the web service. No scheduled job is on the payroll-compute critical path today, so web-mode is acceptable until then.

---

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
- [ ] `SYSTEM_BLUEPRINT.md` is updated if a new route, table, or known gap is added/resolved
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

---

*This file is maintained by the Antigravity Development Consultant. Update it when architectural decisions change.*
