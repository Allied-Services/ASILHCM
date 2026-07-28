# S5B2 — Payroll UI complete alignment (staging): the PayrollRun workbench must show what the Excel shows

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first; `.agents/REMEDIATION_PLAN.md` amendments apply.
> 3. Backend edits: all test tiers green before push. Frontend: `npm run build` green, no new eslint errors on touched files.
> 4. All work on `staging`. NOTHING touches prod. 5. THIS FILE ONLY. 6. Blocked ×3 → `BLOCKED.md`, STOP. 7. End with Verification checklist + real outputs (screenshots).

## Objective
After S5B1 achieves zero variance in the data, the payroll team must be able to SEE and RUN June-26 entirely in the staging UI — no psql, no scripts. This is S6A pulled forward and made concrete against the June-26 workbook. Prereq: S5B1 complete.

## Column parity (the core requirement)
`features/payroll/PayrollRun.jsx` run grid must show, per employee, the Excel columns the team actually uses (workbook order, same labels so the team recognizes them):
`Emp Code | Name | Client BU | New Salary (R) | Working Days (S) | Paid Days (T) | Salary for Days Worked (U) | OT Hrs (V+W by tier) | Overtime Amount (X) | OPD Claim (Y) | Expense Reimb (Z) | Arrears (AA) | Special Allowance (AB) | Other Allowance (AC) | Other Deduction (AD) | Gross (AE) | Income Tax (AF) | PF (AG) | EOBI (AH) | Total Deductions (AI) | Net Pay (AJ)`
- Values come from each row's `computed` JSONB — extend the engine's computed payload if any of these components isn't currently emitted as its own key (engine change → parity test first).
- Totals row at the bottom (sum of every numeric column) matching the Excel's row-521 style totals.
- Column subtotal chips by Client BU (FM / BPO / Janitorial / Conservancy / Operation Handling) mirroring the workbook's "Payroll Amount" summary block (rows 524–533) — this is how the MD sanity-checks a month at a glance.

## Workflow parity
1. Contract picker → month/year → Compute button (exists). Add: a run-status banner (draft/locked/invoiced/paid) and employee count vs active-roster count (so a missing/ghost employee is visible immediately — the S5B1 lesson).
2. Inline overrides (Paid Days, OT hrs, allowances, Other Deduction) via `PATCH /api/payroll-runs/:id/rows/:rowId`; on save, the row's computed values refresh. Warnings panel listing run `warnings` with affected employees.
3. Export button: download the run grid as .xlsx in EXACTLY the June-26 column layout (server-side or client-side — pick the simpler; this is how the team cross-checks against their workbook during parallel months).
4. Variance view: upload the team's Excel (same parser as `scripts/variance_report.js`, exposed via a staging-only admin route or reuse the script) → show per-employee deltas inline in the grid (red highlight non-zero). The S5B/S7 shadow months then happen INSIDE the UI instead of via scripts.
5. Lock / Invoice / Disburse buttons per S6A/S4B specs (role-gated). Payslip preview per row.
6. All calls through `frontend/src/api.js` named functions; zero raw fetch; dark-theme CSS variables; no router/state-lib additions (Phase 9 boundary still applies).

## Verification checklist
- [ ] Staging walkthrough, screenshots: compute June-26 for (a) one Wafi contract, (b) PSO Operations Handling — grid shows all columns above; totals match the workbook's totals for that BU to the rupee.
- [ ] Override a Paid Days value → row recomputes → variance view shows the introduced delta → revert → zero again.
- [ ] Export .xlsx opens in Excel with the right columns; spot-check 3 employees against the workbook.
- [ ] Payroll team member (not the MD) drives the full flow unassisted and confirms nothing they need is missing. Record their punch-list in the report; fix trivial items now.
- [ ] `npm run build` green; no new eslint errors; backend tiers green if engine payload was extended.
