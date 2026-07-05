# Restructure Testing Log

Running trace of every automated check performed during the BPO/FM Strategic
Restructure build, in build order. Use this to pinpoint which phase a live-test
issue traces back to.

Environment note: local `node_modules` on the Google Drive-synced workspace path
is unreliable (Drive's sync client locks files mid-install). All `npm install`,
`npm test`, and `npm run build` verification below was run against a clean copy
of the source in `C:\temp\bpofm-backend-build` / `C:\temp\bpofm-frontend-build`
(same source, install done outside Drive sync) — never against a live database.

---

## Phase 0 + 1 (2026-07-05) — Foundations, Constraints, P&L, Cashflow, Onboarding, BizDev

| Check | Result |
|---|---|
| `npm test` (jest, 8 suites) | ✅ 103/103 passed |
| `node --check` on all new `src/**/*.js` + `migrations/**/*.js` | ✅ all pass |
| `node mountModules.js` require smoke test | ✅ no missing-module errors |
| `node server.js` boot with dummy env (no real DB) | ✅ listens, routes mount (401 not 404 on `/api/projects`) |
| Frontend `vite build` | ❌ then ✅ — found & fixed wrong relative import (`Dashboard.jsx`, `CashFlowView.jsx` importing `../api` instead of `./api` / `../../api`) |
| `package-lock.json` sync | ❌ then ✅ — lockfile was missing `pg-boss`/`imapflow`/`csv-parse` entries from an interrupted install; regenerated clean |
| Live DB migration run | ⛔ NOT DONE — no local Postgres/Neon credentials available in this environment. First real run will be on Render at deploy time. |

**Known gap after Phase 1:** Procurement/Katcha bill-matching and Compliance/Tax
Ledger modules were schema-only (tables created, zero logic/routes). No frontend
UI existed yet for constraints, BD pipeline, onboarding, claims queue, or intake
inbox — only the MD Dashboard (P&L + cashflow) was wired up.

---

## Phase 2–6 (2026-07-05) — UI, Attendance Intake, Procurement, Compliance, AR

| Check | Result |
|---|---|
| Frontend `vite build` (1614 modules, all new screens) | ✅ pass |
| `jest tests/restructure.test.js` (7 tests) | ✅ 7/7 passed |
| New backend modules syntax check | ✅ attendance, procurement, compliance, ar |
| `mountModules.js` registers 11 module route groups | ✅ |
| `worker.js` schedules intake, cashflow, attendance alerts, dunning | ✅ |

**Built in this phase:**
- Frontend: Intake Hub, Claims Queue, Contract Policies & Onboarding, BD Pipeline, Bill Verification (OCR side-by-side), Compliance Ledger, Attendance CSV Intake tab
- Backend: `/api/attendance/*`, `/api/procurement/*`, `/api/compliance/*`, `/api/ar/*`
- Live test trace document: `docs/LIVE_TEST_TRACE.md` (Trace IDs P2–P6 per role)

**Still requires live env to fully verify:** IMAP intake poll (`INTAKE_EMAIL_*`), OpenAI OCR (`OPENAI_API_KEY`), Jazz SMS alerts, Xero push (existing `/api/xero/*` in server.js — AR module adds PO balance + dunning only).

---
