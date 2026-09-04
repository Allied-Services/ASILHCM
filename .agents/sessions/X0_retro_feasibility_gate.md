# Session X0 — Retro Feasibility Gate (read-only investigation)

**Blueprint:** `.agents/plans/UNIFIED_SPINE_BLUEPRINT.md` §2.6, §4.4
**Type:** Investigation only. **No application code changes. No migrations. No writes to any database.**
**Blocks:** X1 cannot start until this session returns a verdict.

---

## NON-NEGOTIABLE RULES

1. Get your own working folder first: `npm run wt:new -- x0-retro-gate`. Never build in `C:\Projects\HCM\BPOFMSystem`.
2. This session is **read-only**. You may create exactly two new files (listed under Deliverables). You may not modify any existing file except to append your changelog entry at the end.
3. Never run a query with `UPDATE`, `INSERT`, `DELETE`, `ALTER` or `DROP` against any database. `SELECT` only.
4. If you need a live database and have no credentials, say so and complete every part of the analysis that can be done from the code and from `database/schema.sql` / `audit/groundtruth/schema_prod.sql`. Do not guess at data.
5. If blocked three times on one step, write to `BLOCKED.md`, stop, and do not improvise.

---

## Why this gate exists

The Retro Adjustment Ledger recomputes a closed month's payroll using **that month's own salary, policy and statutory basis** — never today's. It does this by reloading the origin month's frozen *inputs* and re-running `computePrSheetRow` on them.

That only works if the origin month's inputs were actually persisted. If a closed month stored only the engine's *outputs*, there is nothing to re-run and corrections against that month become disclosure-only.

**Your job is to determine, with evidence, whether the inputs are recoverable — and from which month onward.**

---

## What you need to understand first

Read these, in this order, before doing anything else:

- `backend/src/payroll/prSheetEngine.js` — `computePrSheetRow(input, policy)`. Note the full shape of `input` (roughly lines 191-250) and of the returned object (lines 303-341).
- `backend/src/payroll/snapshotView.js` — `readPayrollSnapshot`, `exportRowFromSnapshot`.
- `backend/src/modules/payrollSheet/service.js` — `calculatePayrollSheet` (~line 205) and `upsertPayrollTransactions` (~line 551), especially where it builds and writes `computed_json` (~line 592) and the pre-migration fallback path (~lines 653-684).
- `backend/src/modules/payrollrun/service.js` — `computeRunForContract` (~line 380) and `persistPayrollRunRows` (~line 127).
- `backend/migrations/20260810190000_payroll_transactions_computed_json.js`.

---

## Step 1 — Determine the World A snapshot shape

`payroll_transactions.computed_json` is written by exactly one producer: Payroll Sheet Calculate.

Answer precisely:

1. Does `computed_json` contain **only** the return value of `computePrSheetRow`, or does it also carry the `input` object that produced it? Quote the exact object literal that is serialised, with its `file:line`.
2. If the inputs are not stored: enumerate which input fields **can** be reconstructed from the flat columns on `payroll_transactions` (list the actual column names from `database/schema.sql`), and which cannot be reconstructed at all. Be specific — for each field in `computePrSheetRow`'s input contract, mark it `stored` / `reconstructible` / `lost`.
3. Pay particular attention to fields that are *derived at compute time and not stored anywhere*: `salesTaxRate`, `excludeBonusFromWht`, `contractBonusMonths`, `lifeInsurance`, `medicalCoverage`, `calendarBasis`, `expectedDays`, and the entire `policy` argument. If the policy object is not pinned in the snapshot, a recompute today would resolve **today's** `contract_policies` row, which would silently break the "same month's salary" guarantee.
4. State the earliest month for which `computed_json` is populated. The migration is dated 2026-08-10, so rows predating it fall back to legacy per-consumer maths.

## Step 2 — Determine the World B snapshot shape

`payroll_run_rows` carries both `inputs` and `computed` JSONB columns.

1. Confirm that `inputs` is the **exact argument object** passed to `computePrSheetRow`, not a partial or a pre-transformation copy. Trace it through `persistPayrollRunRows`.
2. Is the resolved `policy` object stored anywhere on the run or the row? If not, note that `computeRunForContract` resolves policy via `getPolicy(pool, contractId, null, asOf)` with `asOf` set to the 15th of the period — determine whether that resolution is stable over time or whether editing `contract_policies` today would change a historical recompute.
3. Same question for the statutory basis: WHT slabs are a hardcoded array in `taxEngine.js`. Confirm there is no versioning, and state the consequence: a slab change would silently alter every historical recompute.

## Step 3 — The reproducibility proof

This is the decisive test.

Write a **read-only** script at `backend/scripts/verify_retro_reproducibility.js` that:

1. Takes `--year`, `--month`, and optionally `--contract` and `--limit`.
2. Reads locked rows for that period (World A from `payroll_transactions` where `locked=TRUE`; World B from `payroll_run_rows` joined to a `locked`/`paid` run).
3. For each row, rebuilds the input object from whatever is stored, re-runs `computePrSheetRow` with the policy resolved as the code would resolve it today, and compares the result field-by-field against the stored `computed_json` / `computed`.
4. Reports: total rows, exact matches, mismatched rows with a per-field delta table, and rows where reconstruction was impossible.
5. Writes a JSON report to `audit/retro/reproducibility_{year}_{month}.json`.
6. Defaults to a dry, read-only run. It must contain **no** write statement of any kind. Use the same read-only connection pattern as `backend/scripts/audit_drive_vs_hcm.js`.

If you have no database access, still write the script, and verify it with a synthetic fixture: construct a fake stored row from a known input/output pair produced by calling `computePrSheetRow` directly, and prove the comparison logic detects both a match and a deliberately injected one-rupee mismatch. Say clearly in your report that the live run has not been performed.

## Step 4 — The verdict

Write `docs/RETRO_FEASIBILITY.md` containing:

1. **Verdict**, one of:
   - `FULL` — origin inputs and policy are recoverable for all locked months; X1 can proceed as designed.
   - `PARTIAL FROM <YYYY-MM>` — recoverable from a given month forward; earlier months are `disclosure_only`. State the month and why.
   - `BLOCKED` — inputs are not recoverable and a migration is required before X1. Specify exactly what the migration must persist.
2. The per-field `stored` / `reconstructible` / `lost` table for both worlds.
3. The policy- and statutory-pinning analysis from Steps 1.3 and 2.2-2.3, with a clear statement of whether a historical recompute today would be deterministic.
4. If the verdict is not `FULL`: the precise DDL you recommend (do **not** apply it) for persisting inputs and version pins going forward, plus a backfill strategy for months where reconstruction is partially possible.
5. Reproducibility results from Step 3 if you had database access; otherwise the synthetic-fixture proof.

---

## Deliverables

| File | Type |
|---|---|
| `backend/scripts/verify_retro_reproducibility.js` | New, read-only |
| `docs/RETRO_FEASIBILITY.md` | New |
| `.agents/AGENTS.md` Section 10 | Append a dated changelog entry |

## Verification checklist

- [ ] `node --check backend/scripts/verify_retro_reproducibility.js` passes
- [ ] `git diff --stat` shows **only** the files above — if any existing application file is modified, revert it
- [ ] `cd backend && npm test` count is identical to the baseline you captured before starting
- [ ] The script contains zero `UPDATE`/`INSERT`/`DELETE`/`ALTER`/`DROP` tokens — prove it with a grep in your report
- [ ] The verdict in `docs/RETRO_FEASIBILITY.md` is one of the three exact strings above

## Report back

State the verdict in your first sentence. Then: the per-field recoverability table, whether historical recompute is deterministic today, and — if not `FULL` — exactly what X1 must build first. If any premise in this session file turned out to be wrong about the code, say so plainly; a wrong premise here would propagate into a money-moving feature.
