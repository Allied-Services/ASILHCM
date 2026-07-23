# S5B — Shadow month for the pilot contract  `[MD GATE]`

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 3. After ANY backend edit: `node --check backend/server.js` + `npm test` + `npm run test:int` green before push (engine changes are money changes).
> 4. Work on `staging`; verify; merge to `main`. Engine fixes DO deploy to prod during this session's iterations — that is safe because nothing pays through World B yet.
> 5. This session executes THIS FILE ONLY.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs.

## Objective
For one full month ("month M"), the pilot contract is paid via Excel exactly as today, while HCM computes the SAME month in shadow on production data. Every rupee of variance is driven to zero. This session may span multiple sittings across the month — keep a running log in `audit/pilot/shadow_month_M.md`.

## Operating loop (repeat until zero variance)
1. Ensure month M inputs are in prod HCM: attendance for the pilot contract imported via the existing surface the client already uses (monthly hub Excel import or CSV — `modules/attendance` routes); any approved claims present as `employee_claims`.
2. `POST /api/payroll-runs/compute` for the pilot contract, month M (on PROD — compute is non-destructive and re-runnable; do NOT lock).
3. Payroll team produces their Excel as normal → export per `scripts/VARIANCE_INPUT_FORMAT.md`.
4. Run `scripts/variance_report.js`. Every `warnings` entry on the run must be explained in the log.
5. Triage every non-zero delta into exactly one bucket, and fix in this order:
   - **(a) CONFIG** — wrong/missing `contract_policies`, `contract_rate_cards`, working-days override, holiday calendar. Fix the data via the admin UI/psql. No code changes.
   - **(b) INPUT** — attendance/claims/employee master data wrong or missing (salary, bank, joining date). Fix the data; note systemic import gaps in the log.
   - **(c) ENGINE** — the engine computes differently than the Excel. **Process: FIRST add a failing test to `backend/tests/payrollParity.test.js` reproducing the Excel formula for that case, THEN change `prSheetEngine.js`/`payrollrun/service.js` to pass it.** Both test tiers green before deploying. The S2C flag on `classifyOtDate` (weekday OT tier) must be resolved here with the MD if the pilot has any OT.
   - Where Excel itself is wrong (it happens): the MD decides; if HCM is right, record the accepted difference explicitly in the log — the gate then requires delta == accepted list, not zero.
6. Recompute and re-run the report.

## Decrees (do not relitigate)
- The backend 30-day-basis engine is authoritative. Never modify frontend `payrollUtils.js` to "help" — it is scheduled for deletion (S7R).
- No locking, no disbursing, no invoicing of the pilot run during month M.

## MD GATE (end of session)
`variance_report.js` exits 0 (or matches the accepted-differences list). The MD receives `variance_<pilot>_M.csv` + summary and **signs off in writing** (email/WhatsApp screenshot filed in `audit/pilot/`). Only then is S5C authorized.

## Verification checklist
- [ ] Final variance report: rows compared = pilot headcount, non-zero deltas = 0 (or = accepted list), unmatched = 0. Paste summary.
- [ ] Every engine change has a corresponding payrollParity test (list them).
- [ ] `npm test` + `npm run test:int` green. Shadow log committed to `audit/pilot/`.
