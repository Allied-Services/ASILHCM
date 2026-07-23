# S5C — MILESTONE 1: pilot contract pays through HCM (month M+1)  `[MD GATE]`

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 3. `npm run test:int` green before ANY push this month. No engine changes during payment week unless a variance forces one (then: parity test first, both tiers green).
> 4. This is a PRODUCTION operation. `scripts/backup_prod.ps1` runs before compute and again before disburse.
> 5. This session executes THIS FILE ONLY.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP. If blocked ON PAY DAY: the fallback is always "pay via Excel as before" — never improvise a code fix under payday pressure.
> 7. End by executing the Verification checklist and pasting actual outputs.

## Objective
The pilot contract's month M+1 salaries are computed, locked, invoiced, disbursed, and bank-filed **through HCM**. Excel is still prepared in parallel as the shadow — but this month, HCM pays and Excel checks.

## Preconditions (all must hold before starting)
- S5B MD sign-off on file. All test tiers green on `main`. Prod backup fresh.
- Guard check: no locked legacy `payroll_transactions` for the pilot contract for M+1 (otherwise the bridge's Guard B will refuse — correct behavior; resolve with the payroll team before proceeding).

## Runbook (execute in order, with the payroll team)
1. Inputs land in prod: month M+1 attendance imported; claims (if any) in `employee_claims`.
2. Payroll team ALSO prepares their Excel for M+1 as usual (shadow), exports the CSV.
3. `POST /api/payroll-runs/compute` (pilot, M+1) → run `scripts/variance_report.js` → must exit 0 against the shadow Excel (any delta: triage per S5B rules before proceeding; a CONFIG/INPUT fix + recompute is normal, an ENGINE fix restarts this runbook after tests).
4. Payroll team reviews rows in the PayrollRun UI; any final overrides via the row-patch mechanism, then recompute + re-verify variance.
5. `POST /api/payroll-runs/:id/lock` → verify `cost_allocations` written.
6. `POST /api/payroll-runs/:id/invoice` → verify the `client_invoices` row (number format, totals).
7. Fresh backup. Then Disburse via the UI (S4B): correct bank, payment date, reference. Record the `PB-...` batch id.
8. Verify in the existing AP screens: batch totals + per-employee ledger rows (SALARY, PR-references, bank accounts).
9. Produce the bank transfer file from `payment_ledger` exactly the way the AP team does for World A batches today (same screen/export). AP team + MD verify the file line-by-line against the signed variance CSV **before** transmitting to the bank.
10. `[MD GATE]` MD authorizes transmission. Bank processes. Any bounce-backs handled by AP exactly as today.
11. Post-payment reconciliation: re-run the variance report against the final Excel; file everything in `audit/pilot/cutover_M+1.md`; MD signs.

## Rollback
- Before step 10 (file not transmitted): `scripts/rollback_disbursement.sql` for the batch; run returns to 'locked'; pay via Excel this month; diagnose.
- After transmission: NO technical rollback — money moved. Recovery is operational (AP handles corrections as they do today). This is why steps 3–9 are gated.

## Verification checklist / Definition of MILESTONE 1
- [ ] Salaries for the pilot contract, month M+1, reached employee bank accounts from a bank file generated out of `payment_ledger`, sourced from a World B `payroll_run`, with zero unexplained post-hoc variance vs the shadow Excel.
- [ ] `audit/pilot/cutover_M+1.md` committed with batch id, run id, invoice number, variance outputs, MD sign-offs.
- [ ] The other 9 contracts were paid via Excel/World A untouched this month.
