# S7 — Per-contract cutover (TEMPLATE — one instance per remaining contract)

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 3. `npm run test:int` green before any push; engine changes require a payrollParity test first (S5B rule).
> 4. Production operation: `scripts/backup_prod.ps1` before compute and before disburse each month.
> 5. One contract per instance of this template. Copy this file to `S7_<contract-id>.md`, fill the header block, execute.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP. Payday fallback is always Excel.
> 7. End by executing the Verification checklist and pasting actual outputs.

## Header block (fill per contract)
- Contract: `____` Client: `____` Headcount: `____`
- Attendance mode: none / manual / monthly Excel / online — and who supplies it
- Special features in scope: OT? claims? advances? which policy fields matter?
- Shadow month: `____` Cutover month: `____`

## Cutover order (decreed)
1. Simplest monthly-salary contracts first.
2. **Wafi late**: only after S1B-staged claims have appeared correctly in computed Wafi runs for **2+ consecutive months** (evidence filed in `audit/pilot/`).
3. **PSO**: salaries may cut over on the normal template — deliverable-based *billing* (cans/drums) is NOT a blocker because deliverables affect the client invoice, not employee net pay. Until Phase 9 builds deliverable billing, PSO's client invoice continues via its current process (skip the invoice step for PSO or issue it the existing way — record which in the header block).

## Procedure (compressed Phase 5)
1. Confirm `contract_policies` + rate cards for this contract are complete; fix CONFIG first (most variance lives here).
2. Shadow month: compute in shadow while Excel pays; `scripts/variance_report.js` to zero (S5B triage rules; ENGINE fixes need a parity test first).
3. MD signs the variance CSV → flip `payroll_engine='runs'` (S6B toggle).
4. Cutover month: S5C runbook verbatim (inputs → compute → variance vs shadow Excel → review/overrides → lock → invoice → disburse → bank file → MD gate → transmit → reconcile).
5. File `audit/cutover/<contract>_<month>.md` with run id, batch id, variance outputs, sign-offs.

## Verification checklist (per contract)
- [ ] Shadow month variance = 0 (or MD-accepted list), signed.
- [ ] Cutover month paid via `payment_ledger` bank file, reconciled post-payment.
- [ ] Flag = 'runs'; the contract no longer appears editable in PayrollSheet.

## Rollback
Any contract flips back to `payroll_engine='legacy'` instantly and pays via Excel/World A next month (World A routes stay alive until S7R).
