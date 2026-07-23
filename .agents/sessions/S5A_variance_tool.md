# S5A — Excel-vs-HCM variance report tool

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 3. After ANY backend edit: `node --check backend/server.js` + `npm test`; `npm run test:int` for money paths.
> 4. Work on `staging`; verify; merge to `main`.
> 5. This session executes THIS FILE ONLY.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs.

## Objective
A read-only comparison tool the payroll team and MD can trust: the pilot contract's Excel payroll vs the HCM computed run, per employee, to the rupee. This tool is the gate for everything in Phase 5–7.

## Pilot selection (do this first)
Take the pilot-selection query output from `audit/groundtruth/facts.md` (S0A). Apply criteria in priority order: NOT Wafi (claims complexity soaks separately), NOT PSO (deliverable-billing gap), HAS a `contract_policies` row, monthly attendance data present (attendance_override_rows > 0), OT disabled or trivial, 20–80 active employees. Present the top 2 candidates to the MD with the numbers and **wait for the MD to name the pilot contract** before proceeding. Record the choice at the top of this file's changelog entry in AGENTS.md §10.

## Steps
1. Define the Excel CSV contract in `scripts/VARIANCE_INPUT_FORMAT.md`: required columns `employee_id, employee_name, paid_days, gross, income_tax, eobi, sessi_or_pessi, pf, advances, other_deductions, net_pay` (adjust names after seeing the team's actual sheet — meet the payroll team's export where it is; document whatever mapping is agreed, including the column letters from their workbook).
2. `scripts/variance_report.js` (Node, read-only DB access):
   - Inputs: `--csv <path> --contract <id> --month <m> --year <y>` (+ `TEST/PROD DATABASE_URL` via env; the script only SELECTs).
   - Loads the computed `payroll_run_rows` for that contract/period; joins to the CSV by `employee_id` (normalize whitespace/case; report unmatched ids on BOTH sides as their own section — unmatched rows are variance).
   - Output 1: `variance_<contract>_<y>-<m>.csv` — per employee, per field: excel value, hcm value, delta.
   - Output 2: console + `variance_summary.md`: rows compared, rows with all-fields delta = 0, per-field count of non-zero deltas, max |delta| with employee id, total net delta.
   - Exit code 0 only when every delta is exactly 0 and no unmatched rows — so it can gate scripts.
3. Unit-test the comparison core (pure function) in the mocked tier with fabricated CSV+rows including a rounding-edge case (e.g. 0.005).

## Verification checklist
- [ ] Run against staging with a fabricated CSV intentionally containing 2 known deltas + 1 unmatched employee → the report shows exactly those (paste output).
- [ ] Run with a CSV generated FROM the run rows themselves → all-zero, exit 0.
- [ ] `npm test` green.

## Rollback
None needed (read-only tool).
