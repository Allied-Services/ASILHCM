# S6B — Per-contract payroll engine flag (prevents double entry during cutover)

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 3. Backend edits: `node --check` + `npm test` + `npm run test:int` green before push (this touches payroll gating).
> 4. Work on `staging`; verify; merge to `main`.
> 5. This session executes THIS FILE ONLY.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs.

## Objective
A single, explicit, per-contract switch that says which world runs payroll for that contract, enforced in BOTH UIs and respected by Guard B's counterpart on the legacy side. Defaults preserve today's behavior everywhere.

## Steps
1. Migration: `ALTER TABLE contract_policies ADD COLUMN IF NOT EXISTS payroll_engine TEXT NOT NULL DEFAULT 'legacy'` (values 'legacy' | 'runs'). For contracts with no `contract_policies` row, absent row == 'legacy'.
2. Backend enforcement (belt to the UI's suspenders):
   - `POST /api/payroll/:year/:month` (World A save): reject rows whose employee belongs to a `payroll_engine='runs'` contract → 409 `CONTRACT_ON_RUNS_ENGINE` listing the employees. (This route has no freeze and after S2B has integration coverage — extend `worldA.payment.test.js` for the rejection.)
   - `POST /api/payroll-runs/compute`: warn (not block) when computing a contract still on 'legacy' — computing is harmless (shadow mode IS this).
3. Frontend:
   - `PayrollSheet.jsx`: employees of 'runs' contracts render as read-only rows with a banner "This contract is paid via Payroll Runs"; save/lock controls disabled for them.
   - `features/contracts/ContractOps.jsx` (or the contract editor in `ClientInformation.jsx` — put it where contract_policies is already edited): superadmin-only toggle for `payroll_engine`, with a confirm dialog spelling out the consequence.
   - `api.js` functions for any new endpoint touched.
4. Flip the flag to 'runs' for the PILOT contract only (via the new UI, on prod, with the MD present — after S5C has succeeded).

## Verification checklist
- [ ] `npm test` + `npm run test:int` green incl. the new World-A-rejection test.
- [ ] Staging: flag a contract 'runs' → PayrollSheet shows it read-only; a forced API save attempt returns the 409; flipping back to 'legacy' restores editability.
- [ ] Prod: pilot contract flagged 'runs'; all other contracts unchanged ('legacy').

## Rollback
Flip the flag back to 'legacy' (data change, instant). `git revert` for code.
