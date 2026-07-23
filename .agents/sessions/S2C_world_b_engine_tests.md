# S2C — Integration tests for the World B payroll engine

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. The AP confirm routes are now covered (S2B) — still: any edit to them requires `npm run test:int` green before push.
> 3. After ANY backend edit: `node --check backend/server.js` + `npm test` + `npm run test:int` green before pushing anything touching `/api/ap/*`, `/api/payroll*`, `payment_*`, `payroll_run*`, or `employee_claims`.
> 4. Work on the `staging` git branch; verify on staging; then merge to `main`.
> 5. This session executes THIS FILE ONLY. No opportunistic refactors.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs.

## Objective
Pin down `computeRunForContract` (backend/src/modules/payrollrun/service.js:237) and its lock/invoice lifecycle with real-DB tests, so Phase 4 (bridge), Phase 5 (pilot), and all future engine fixes have a safety net. These are **characterization tests**: they document what the engine does; behavior changes are decided in S5B's variance triage, not here.

## Steps
1. Fixture builder `tests-int/fixtures/worldB.js`: client + contract + `contract_policies` row (set explicit ot_allowed, ot caps, divisors, service_charge_pct, medical cap) + `contract_rate_cards` + employees + `attendance_records` + one `monthly_attendance_overrides` row + `employee_claims` rows in `focal_approved` (one 'overtime' with {ot2: hours}, one 'medical' {amount}, one 'expense' {amount}, and one with `source_kind='wafi'` from S1B's shape) + a `public_holidays` row.
2. `tests-int/worldB.engine.test.js` covering:
   - Compute produces a run + rows; paid days derived from attendance; the monthly override takes precedence over daily records.
   - OT: hours honored when `ot_allowed`; capped by `ot_monthly_cap_hours`; zeroed when `ot_allowed=false` (with a warning).
   - Claims applied: computed row reflects OT hours and opd/expense amounts from focal_approved claims, including the wafi-provenance one; consumed claims flip to `in_payroll_run`.
   - Recompute idempotency: second compute for the same period doesn't duplicate rows and re-frees then re-consumes claims (service.js:284-288 behavior).
   - `RUN_LOCKED` refusal on locked/invoiced/paid runs.
   - `patchRunRow` overrides persist and survive nothing-else-changed recompute rules (characterize actual behavior).
   - `lockRun` → status 'locked' + `cost_allocations` rows written.
   - `generateInvoiceFromRun` → `client_invoices` row with expected totals + invoice_number format `INV-{MON}{yy}-{seq}`.
3. **Characterize `classifyOtDate`** (service.js:86-92): note it returns `'ot2'` for BOTH Sundays and ordinary weekdays (the weekday branch never yields `'ot1'`). Write the test asserting current behavior and add a `// TODO(S5B): confirm with MD — weekday OT tier looks suspicious` comment. Do NOT change the function; log it prominently in your report so it enters the S5B variance triage list.
4. Confirm `backend/tests/payrollParity.test.js` still green (it must never regress in any session).

## Verification checklist
- [ ] `npm run test:int` green with the new suite (paste count).
- [ ] `npm test` green, `payrollParity.test.js` included.
- [ ] Report lists any engine behaviors that surprised you (esp. classifyOtDate) for the S5B triage list.

## Rollback
Delete the new test files.
