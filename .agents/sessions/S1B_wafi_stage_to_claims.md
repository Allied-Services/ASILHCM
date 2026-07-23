# S1B — Route Wafi stage-payroll into employee_claims (fix the dead-column INSERT)

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. NEVER modify `POST /api/ap/payroll-queue/:year/:month/confirm`, `POST /api/ap/bills/:id/confirm`, `PATCH /api/ap/batches/:batchId/fm-approve`, or any existing `payment_batches`/`payment_ledger` INSERT logic until the Phase 2 integration tests (S2B) exist and pass.
> 3. After ANY backend edit: `node --check backend/server.js` and `npm test` (in `backend/`) must pass. Once Phase 2 lands: `npm run test:int` must also pass before pushing anything touching `/api/ap/*`, `/api/payroll*`, `payment_*`, `payroll_run*`, or `employee_claims`.
> 4. Work on the `staging` git branch, deploy to the staging Render service, verify, THEN merge to `main`. Never push an unverified payroll change to `main` (it auto-deploys to production).
> 5. This session executes THIS FILE ONLY. No opportunistic refactors. Out-of-scope problems go in your report, not in the diff.
> 6. Blocked after 3 attempts on a step → write details to `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs into your report.

## Background (why this exists)
`POST /api/wafi-claims/sessions/:id/stage-payroll` (server.js ~7004–7075) and a second similar block (~7700–7745) are the terminal step of the entire 31-route Wafi claims workbench. They compute per-employee OT payout **amounts** (`hrs × factor × hourlyRate`) plus expense/medical amounts, then upsert into `payroll_transactions (employee_id, month, year, ot, reimb, opd)`. Those three columns exist only in the legacy `setup-db.js` bootstrap as **dead columns nothing reads** (confirm prod state in `audit/groundtruth/facts.md` from S0A). Net effect: verified Wafi claims vanish. Meanwhile the working consumer path is: `employee_claims` rows with `status='focal_approved'` → read by `computeRunForContract` (`backend/src/modules/payrollrun/service.js:331-340`) via `aggregateClaimInputs` (service.js:57), which expects **hours** for OT, **amounts** for medical/expense.

## Target design
Staging a Wafi session writes `employee_claims` rows (one per employee per claim type), idempotently, with provenance to the Wafi session/items. No `payroll_transactions` writes at all from these routes.

## Steps
1. **Migration** `backend/migrations/<timestamp>_employee_claims_source.js`:
   - Add columns to `employee_claims`: `source_kind TEXT` (values: `'portal'`, `'wafi'`, `'email'`; nullable — existing rows stay NULL), `source_session_id INTEGER`, `source_ref TEXT`.
   - Partial unique index: `UNIQUE (source_kind, source_session_id, employee_id, claim_type) WHERE source_kind IS NOT NULL` — this is the idempotency key for re-staging.
   - Idempotent (`IF NOT EXISTS` semantics via node-pg-migrate defaults). Run on staging with `npm run migrate`.
2. **Read `aggregateClaimInputs` (payrollrun/service.js:57-84) before writing any code.** Its exact contract: `claim_type='overtime'` → sums `item.ot1|ot_1x`, `item.ot2`, `item.ot3` per item (HOURS); `claim_type='medical'` → sums `item.amount`; `claim_type='expense'` → sums `item.amount`.
3. **Rewrite the staging block at server.js ~7004–7075** (keep the route path, auth, and response shape):
   - For each verified session item, build per-employee aggregates keyed by claim type:
     - OT items: map `ot_multiplier_factor` → tier: factor `2` → `ot2` hours, factor `3` → `ot3` hours, anything else (incl. 1/missing) → `ot1` hours. Store `hrs` (HOURS — not the payout amount; the engine computes pay from hours × contract policy divisors).
     - EXPENSE items → claim_type `'expense'`, item `{amount: raw_amount}`.
     - MEDICAL items → claim_type `'medical'`, item `{amount: raw_amount}`.
   - Insert one `employee_claims` row per (employee, claim_type): `claim_type` lowercase as above; `period_month`/`period_year` = the settlement month the route already determines; `claimed_items` = JSONB array of the items above (include per-item provenance fields `{wafi_item_id, date, description}` inside the JSON for auditability); `status='focal_approved'`; `focal_approved_at=NOW()`; `source_kind='wafi'`, `source_session_id=<session id>`, `source_ref=<session ref/number if available>`.
   - `ON CONFLICT (source_kind, source_session_id, employee_id, claim_type) WHERE source_kind IS NOT NULL DO UPDATE SET claimed_items=EXCLUDED.claimed_items, period_month=EXCLUDED.period_month, period_year=EXCLUDED.period_year, updated_at=NOW()` — re-staging a session replaces its own rows and never duplicates. (If node-pg/postgres rejects ON CONFLICT with a partial-index target in this form, use the equivalent explicit `WHERE` clause syntax `ON CONFLICT (source_kind, source_session_id, employee_id, claim_type) WHERE source_kind IS NOT NULL` — test it in psql first.)
   - Guard: if a matching claim row is already `in_payroll_run` (a run consumed it), skip it and include it in the response under `skipped_locked` instead of updating.
   - Keep everything else in the route unchanged: the `pushed_to_payroll`/`payroll_month` session update, the Gmail draft logic, the response counts.
4. **Apply the identical rewrite to the second broken block** at server.js ~7700–7745 (find it by grepping `INSERT INTO payroll_transactions (employee_id, month, year, ot, reimb, opd)` — there are exactly 2 occurrences; both must be gone after this session).
5. Do NOT drop the legacy `ot/opd/reimb` columns from `payroll_transactions` (prod data risk; they die with World A in Phase 7+).
6. Update the mocked test expectations if any suite (e.g. a wafi/claims suite in `backend/tests/`) asserted the old INSERT sequence.

## Deletions
The two broken `payroll_transactions` upsert loops (replaced, not just patched).

## Verification checklist
- [ ] `git grep -n "year, ot, reimb, opd" backend/server.js` → no matches.
- [ ] `node --check backend/server.js` and `npm test` green.
- [ ] Migration applied on staging (`npm run migrate` output pasted).
- [ ] Staging end-to-end: pick/create a Wafi session with ≥1 OT (factor 2), ≥1 OT (factor 3), ≥1 EXPENSE, ≥1 MEDICAL item; verify items; call stage-payroll; then via psql show the `employee_claims` rows: correct lowercase claim_type, hours (not amounts) in ot fields, amounts in expense/medical, `status='focal_approved'`, `source_kind='wafi'`.
- [ ] Idempotency: call stage-payroll AGAIN on the same session → row count unchanged (paste `SELECT COUNT(*)` before/after).
- [ ] Consumption proof: `POST /api/payroll-runs/compute` for the Wafi contract for that month on staging → the affected employees' computed rows reflect the claim hours/amounts (paste one row's `computed` JSON showing OT/opd/expense inputs applied).

## Rollback
`git revert` the code commit. The migration's new columns are additive/nullable — safe to leave in place on rollback.
