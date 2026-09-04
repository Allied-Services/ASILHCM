# ASIL HCM — Unified BPO Payroll & Invoicing Engine
## Execution Blueprint v1.0

**Authored:** 2026-08-29
**Supersedes:** `docs/TRACK_B_HRMS_UNIFICATION_PLAN.md`, `docs/BUILT_SYSTEM_SPEC.md` (both to be archived on adoption)
**Complements:** `.agents/REMEDIATION_PLAN.md` (phases 0–4 complete; this document replaces phases 5–9)
**Executor model:** Cursor Composer 2.5 (Grok 4.6 not available as a subagent runtime in this workspace)
**Owner gates:** marked `[MD GATE]` — human sign-off required, agents must prepare and stop

---

## 0. Reading this document

Every claim about current behaviour in this blueprint was verified against the working tree on 2026-08-29 and is cited `file:line`. Where a citation is absent, treat the statement as design intent, not fact.

The blueprint assumes three things that are already true and must stay true:

1. World A (`payroll_transactions` → AP queue → `payment_batches`/`payment_ledger`) pays ~500 people today and must keep working until formal cutover.
2. `backend/src/payroll/prSheetEngine.js` `computePrSheetRow` is already the single money engine for both worlds — World A calls it at `payrollSheet/service.js:465`, World B at `payrollrun/service.js:653`. The consolidation the original plan called for is **already done at the compute layer**. What remains split is *intake*, *state*, *invoicing*, and *correction*.
3. `payroll_transactions.computed_json` is the immutable snapshot for World A, read through `backend/src/payroll/snapshotView.js`. World B's equivalent is `payroll_run_rows.computed`.

**The strategic re-read:** the codebase is much closer to the target than the remediation plan assumes. The remaining gap is not "two calculators" — it is **no correction path, no conflict gate, no provincial statutory matrix, and four intake doors writing the same fields with no arbitration**.

---

## 0.1 Decisions Register (owner-ruled 2026-08-29)

These are settled. Builders must not re-litigate them.

### D1 — Provincial social security is 6% employer-funded, capped at the minimum wage ceiling

**Ruling:** social security (SESSI / PESSI / KPK-ESSI / Balochistan-ESSI) is a **100% employer-funded 6% contribution, capped at the statutory minimum wage ceiling, routed by province, with zero deduction from the employee.**

```
ss_employer = min(basis, province_minimum_wage_ceiling) × 0.06
ss_employee = 0
```

**Gap versus what the system does today** (`prSheetEngine.js:267`, `salary < 45000 ? 2400 : 0`), at a 40,000 ceiling:

| Contractual salary | Correct employer contribution | Current | Delta |
|---|---|---|---|
| 25,000 | 1,500 | 2,400 | **over-accrued 900** |
| 39,000 | 2,340 | 2,400 | over-accrued 60 |
| 40,000 | 2,400 | 2,400 | correct |
| 44,999 | 2,400 (capped) | 2,400 | correct |
| **45,000 and above** | **2,400 (capped)** | **0** | **under-accrued 2,400 per person per month** |

**Two consequences that change the risk profile of this milestone:**

1. **No employee's net pay changes.** The contribution is employer-funded and `sessiEmployee` is already `0` in the engine. R3 is therefore *not* a repricing of 500 people's take-home. It is a correction to employer cost, which flows into `totalPayrollCost` → cost-plus client invoices → and the statutory payable.
2. **Every employee earning 45,000 or more currently has zero social security accrued**, and by extension almost certainly zero remitted. This is a live compliance exposure, and the size of it should be quantified against the roster before anything else in R3 is built.

**Action:** R3 gains a preceding read-only step — quantify the exposure per province, per month, back to the cutover floor, and report the total before any code changes. Ceilings and rates are per-province and effective-dated in `statutory_matrix`; do not hardcode 40,000 or 2,400 anywhere.

### D2 — Overtime multipliers are per-contract, with no global default

**Ruling:** weekday / rest-day / holiday OT multipliers vary by contract. There is to be no code-level default.

**Implementation constraint that this ruling does not remove:** day-one behaviour must be identical for every existing contract. Therefore:

- `contract_policy_versions.ot_weekday_multiplier` / `ot_restday_multiplier` / `ot_holiday_multiplier` are `NOT NULL` with **no `DEFAULT` clause**.
- The seeding migration backfills every existing contract with its *current effective* behaviour — which, per F7, means weekday `2`, rest-day `2`, holiday `3` — plus `ot_policy_reviewed BOOLEAN NOT NULL DEFAULT FALSE`.
- A contract with `ot_allowed = TRUE` and no multiplier row fails compute with `OT_POLICY_UNSET`. It never silently assumes a number.
- Every contract with `ot_policy_reviewed = FALSE` appears in the daily digest until an owner confirms its multipliers.

This makes the current 2×-on-weekdays behaviour **explicit and visible** rather than an accident of `classifyOtDate`, without changing a single rupee on the day the migration runs.

### D3 — One system specification, at the path `ARCHITECTURE.md`

**Ruling:** delegated. **Decision: `docs/BUILT_SYSTEM_SPEC.md` wins on content; `ARCHITECTURE.md` wins on path.**

`BUILT_SYSTEM_SPEC.md` (2026-08-28) is more current, more complete, written for exactly this handoff, and it independently identifies the same stale premise in `REMEDIATION_PLAN.md` that this blueprint does. But `ARCHITECTURE.md` has nine inbound references and is named in the AGENTS.md completion checklist, so moving the path would break tooling for no benefit.

Therefore: adopt `BUILT_SYSTEM_SPEC.md`'s content and structure as the base, fold in the depth `ARCHITECTURE.md` has and it lacks (Fixed Value tax rules and verification figures, payslip delivery detail, AP partial-payment semantics, the P4 reconciliation endpoint), write the result to `ARCHITECTURE.md`, and archive `BUILT_SYSTEM_SPEC.md`. One file, one path, zero broken references.

---

# SECTION 1 — Architectural Evaluation & Edge-Case Matrix

## 1.1 What the audit found that the spec did not anticipate

| # | Finding | Evidence | Severity |
|---|---|---|---|
| F1 | **`previousDues` is a fully-wired engine input that nothing feeds.** The engine accepts it, adds it to gross, and returns it — but no route, table column, or UI writes it. | `prSheetEngine.js:199,248,315,317` | **Opportunity** — this is the ready-made landing zone for retro corrections |
| F2 | **`previousDues` is added to gross but NOT excluded from the WHT annualization base**, while `arrears` is. Back-dated dues would therefore be taxed at the settlement month's marginal rate. | `prSheetEngine.js:248` vs `:260-261` | **Blocking** for retro |
| F3 | **`computePrSheetRow` assigns `arrears` and `previousDues` twice each** in its return object. The second assignment wins; the first is dead. | `prSheetEngine.js:311,315,316,317` | Low, but it is a latent correctness trap |
| F4 | **SESSI has four contradictory implementations.** The one that actually pays people is a flat cliff on *contractual salary*: `salary < 45000 ? 2400 : 0`. `taxEngine.calculateSESSI` uses 6% of *gross* capped at 2,400 with a 40,000 ceiling. | `prSheetEngine.js:267` vs `taxEngine.js:28` vs `payrollUtils.js:223` vs `server.js:3905` | **High** |
| F5 | **There is no provincial statutory matrix at all.** One national SESSI. No PESSI (Punjab), no KPK EESSI, no Balochistan ESSI. `siteProvince()` resolves province for *sales tax only*. | `serviceOrders/sitesMeta.js:39` | **High** — the firm operates in four provinces |
| F6 | **`calculateEOBI()` ignores every argument** and returns flat `{400, 2000}`. Correct against the Rs. 40,000 minimum wage today, but it will not track a wage revision, does not stop for over-60 employees, and does not prorate a mid-month joiner. | `taxEngine.js:16` | Medium |
| F7 | **`classifyOtDate` returns `'ot2'` for ordinary weekdays.** `'ot1'` is never returned from date classification. Every weekday overtime hour is therefore paid at 2×. | `payrollrun/service.js:96` | **High** — flagged in S2C, never resolved |
| F8 | **`patchRunRow` overrides are destroyed by any full recompute**, because `computeRunForContract` deletes all rows first. | `payrollrun/service.js:696` vs `:755` | **High** — directly contradicts the spec's provenance requirement |
| F9 | **World A unlock has no unlock code, no revision snapshot, and no money-moved check.** Any `finance_approver` can unlock a paid month. | `server.js:3495` | **High** |
| F10 | **`reopenPayrollRun` does not reverse anything.** It flips status to `revised` and leaves `payment_ledger`, `payroll_payables.status='Paid'` and `cost_allocations` intact. | `payrollClose/service.js:478-511` | **High** |
| F11 | **Two live doors write the same payroll fields with no arbitration.** Portal Claims collects OT/OPD/expense; the Monthly Hub CSV carries `OT Hrs @ 2X`, `OPD`, `Expense Reimbursement` into `monthly_attendance_overrides`. Nothing detects disagreement. | `attendance/parser.js:8-24` vs `claims/portalService.js` | **High** — this is the conflict gate the spec asks for, and it does not exist |
| F12 | **An attendance file upload silently rewrites roster assignment.** `applyAttendance` UPDATEs `employees.contract_id`, `contract_name`, `site`, `location`. | `serviceOrders/attendanceIngest.js:76-91` | **High** — least obvious door in the system |
| F13 | **Three separate focal directories.** `employees.claim_authority`, `project_client_focals`, `wafi_focal_points`. | — | Medium — the spec's `contacts` entity resolves this |
| F14 | **`claims_reviewer_email` and `reviewer_required` are written by the Monthly Cycle People tab but read by nobody.** | `20260825230000` migration vs `claimsEligibility.resolveClaimsRouting` | Medium |
| F15 | **Magic-link secret has a hardcoded fallback** `'asil-portal-claims'`. If no env var is set, every claims link is forgeable. Violates AGENTS.md §2.4. | `claims/claimsMail.js:74` | **High (security)** |
| F16 | **Claims monitor CC silently switches off on 2026-11-15** via a hardcoded default date. | `claims/claimsMail.js:6` | Low, but it is a surprise waiting to happen |
| F17 | **Year-end WHT true-up is commented as intended but implemented nowhere.** | `taxEngine.js:48` | Medium |
| F18 | **Cost-plus invoice sales tax uses a "majority province"** across the whole run, so a mixed-province contract is systematically mis-taxed. | `payrollrun/service.js:955-983` | Medium |
| F19 | **`attendance_records.ot_rate` exists in the engine's SELECT but not in the production schema snapshot.** The integration harness adds it at runtime to make tests pass. | `tests-int/runtimeDdl.js` vs `audit/groundtruth/schema_prod.sql` | Medium — real schema drift |
| F20 | **~500 lines of tests never execute.** `portalClaims.test.js` is jest-excluded and has no node-runner script; the root `package.json` has no `test`; `frontend/` has no test runner installed. | `backend/jest.config.js:7` | **High** — invisible coverage on the most-changed subsystem |

## 1.2 Edge-case matrix

Stress-tested against real BPO outsourcing operations. "Today" describes verified current behaviour; "Mitigation" is the design commitment.

### A. Employee lifecycle

| Edge case | Today | Mitigation | Milestone |
|---|---|---|---|
| **Mid-month transfer across provincial boundary** (Sindh → Punjab on the 14th) | Employee has exactly one `site`/`location`, so one province for the whole month. Sales tax picked by run-majority. SESSI is national so the question never arises. | `employee_assignments` becomes effective-dated (`valid_from`, `valid_to`). The engine computes a **day-weighted province vector** per employee-month. Statutory contributions split by the matrix in force for each province-day segment. Invoice lines split by province, each carrying its own PRA/SRB rate. | R2, P1 |
| **Mid-month joiner / leaver** | `salaryForDays` prorates correctly. EOBI is charged flat regardless. Bonus prorates by `monthsServed`. | Statutory proration policy becomes an explicit, effective-dated field per contribution type (`prorate: none \| calendar_days \| working_days`). EOBI defaults to `none` (statutory) but the rule becomes visible and versioned rather than accidental. | R3 |
| **Employee on a contract that changes commercial type mid-month** | Undefined — `isFixedValueContract` reads current policy, so the whole month flips retroactively. | Contract rulebook is versioned; a run pins `policy_version_id` at compute time. Changing a contract's commercial type is blocked while an open run exists for that contract. | R1, INV-9 |
| **Rehire with the same employee ID** | Gratuity `yearsOfService` computed from a single `joiningDate`. Service breaks are invisible. | `employment_spells` table; gratuity settlement sums per-spell. | R3 (deferred to M2) |
| **Death / disability final settlement mid-month** | No off-cycle run concept. Would be done as a normal month or by hand. | `payroll_runs.run_type` gains `off_cycle_settlement`. Off-cycle runs settle into the same period without disturbing the regular run's snapshot; both are separate immutable snapshots keyed by `(contract, period, run_type, sequence)`. | P2 |

### B. Retroactive and corrective

| Edge case | Today | Mitigation | Milestone |
|---|---|---|---|
| **OT missed in a closed, paid month** | Only path: unlock the month (`server.js:3495`, no code required), recalculate, re-lock. Destroys the audit trail and rewrites `locked_net`. | **Retro Adjustment Ledger.** Origin month stays byte-identical forever. A correction recomputes against the *origin month's frozen snapshot and policy version*, produces a signed delta, and settles the delta in the current open month. See §2.6. | **X1** |
| **Retroactive salary revision effective three months back** | No mechanism. | One correction per affected origin month, each pinned to that month's own basis, batched under one `payroll_corrections` header with `reason_code='salary_revision'`. The arrear is the sum of per-month deltas, never a single blended calculation. | X1 |
| **Deduction missed (advance not recovered)** | Same as above. | Negative-delta correction. Recovery is capped by an `net_pay_floor_pct` policy so a recovery cannot push a settlement month's net below the statutory minimum wage. | X1, INV-8 |
| **Correction discovered after the client was already invoiced** | Nothing links a payroll correction to an invoice. | Every correction computes four deltas: `net_delta`, `wht_delta`, `employer_cost_delta`, `billing_delta`. The billing delta auto-raises a credit/debit note against the origin month's invoice, or a signed `so_deductions` adjustment for Fixed Value. | X1, I1 |
| **Correction to a month that predates the cutover floor (2026-07)** | Archive toggle hides it; no correction possible. | Corrections against pre-cutover origin months are permitted but `settlement_mode='disclosure_only'` — they produce a documented variance and an AP payable, and never re-derive a snapshot that does not exist. | X1 |
| **Two corrections raised for the same employee-month by different people** | N/A | Unique partial index on `(origin_period, employee_id, field)` where `status NOT IN ('voided')`. Second raise must supersede the first explicitly. | INV-10 |
| **Correction is approved but the settlement month locks before it lands** | N/A | `payroll_corrections.status='approved'` with an unsettled delta **blocks** the settlement month's lock. Hard gate, not a warning. | INV-10 |

### C. Intake and dispute

| Edge case | Today | Mitigation | Milestone |
|---|---|---|---|
| **Portal Claims says 20 OT hours, Monthly Hub CSV says 12** | Last writer wins silently. `sourceMode='sheet_inputs'` is the default and is idempotent, so whichever door ran last is the number that pays. | **Conflict Gate.** Every cell carries `source_door` + `is_authoritative`. Two authoritative sources with different values = a `cycle_conflicts` row. A cycle cannot leave `In_Review` while unresolved conflicts exist. | C2, INV-6 |
| **Client disputes attendance after the invoice is raised** | FV: `assertFvPeriodInvoiceEditable` blocks edits once Finalized. No dispute record. | `cycle_disputes` entity with its own lifecycle. A dispute never edits a closed period — it raises a correction (payroll side) and a credit note (billing side), which is exactly the retro path. | C3, X1 |
| **Attendance upload reassigns an employee to the wrong contract** | Happens silently. | Roster mutation is removed from `applyAttendance` entirely and becomes an explicit, audited `employee_assignments` change requiring `operations` role. Attendance for an unassigned employee lands in a `cycle_exceptions` quarantine. | C2 |
| **Focal submits, then the employee disputes the focal's numbers** | No employee visibility into what the focal submitted. | Submit-record email already exists; extend it to a read-only portal view with a one-click "I disagree" that opens a dispute before the LM approves. | C3 |
| **Personal Gmail is the only contact on file** | Correctly refuses to send a claims magic link; routes to `sadia.komal@asil.com.pk` with `setup_needed=1`. | Keep as-is. Promote to a first-class `cycle_exceptions` row so it appears in the daily digest rather than only in an email. | C1, A1 |
| **Magic link forwarded to an unauthorised third party** | Deterministic HMAC token, no expiry on the token itself, only the period deadline. Hardcoded secret fallback. | Remove the hardcoded fallback (fail hard). Add token `issued_at` + absolute expiry. Bind the token to a single-use nonce for state-changing actions. | C1, F15 |

### D. Money movement

| Edge case | Today | Mitigation | Milestone |
|---|---|---|---|
| **Same contract-month settled through both World A and World B** | `disburseRun` guards with `LEGACY_PAYROLL_LOCKED` (`disbursement/service.js:121`). World A's AP confirm has **no reciprocal guard** against a World B run. | `contracts.payroll_engine` enum (`world_a \| world_b \| fv`), asserted by *both* payment paths before any write. | P2, INV-5 |
| **Partial AP payment, then the month is unlocked and recalculated** | Possible today. Per-employee `already_paid` EXISTS check prevents literal double-pay, but `locked_net` drifts from `payment_ledger`. | Unlock is retired in favour of corrections. Where unlock survives (superadmin + code), it asserts `NO_MONEY_MOVED` for the scope. | P2, INV-3 |
| **Bank file generated, then the run is reopened** | `reopenPayrollRun` allows it from `paid`. Nothing reverses the ledger. | Reopen from `paid` requires an explicit `payment_reversal` record; the only supported path from `paid` is a correction. | INV-3 |
| **Duplicate `payment_ledger` row from a retried request** | Guarded by `ON CONFLICT (batch_id, employee_id) DO NOTHING` — scoped to one batch, so two batches can each hold a row for the same employee-month. Prevented only by the application-level `already_paid` EXISTS check. | Promote to a database-level partial unique index on `(employee_id, period_year, period_month, payment_type)` where `status <> 'Void'`. Application checks are advisory; the database is the guard. | INV-4 |

### E. Compliance

| Edge case | Today | Mitigation | Milestone |
|---|---|---|---|
| **Minimum wage rises mid-year** | No floor check anywhere. A prorated salary can land below the provincial floor with no error. | `statutory_matrix` effective-dated rows carry `minimum_wage`. Lock asserts every full-month, full-attendance employee is at or above the floor for their province-day-weighted assignment. | R3, INV-8 |
| **WHT slab change mid-tax-year** | Slabs are a hardcoded array in `taxEngine.js:58-70`. Changing them is destructive to history. | Slabs move into `statutory_matrix` with `effective_from`/`effective_to`. Snapshots pin `statutory_version_id`. Historical recompute always resolves the version in force for the origin month — which is precisely what makes retro corrections reproducible. | R3, INV-9 |
| **Year-end WHT true-up** | Commented as intended, implemented nowhere. | Annual reconciliation job compares Σ(monthly WHT withheld) against the slab applied to Σ(annual taxable) including retro attributions, and raises a June correction. | M1 |
| **Provincial sales tax on a mixed-province cost-plus contract** | Majority-province approximation. | Per-employee province vector → invoice lines grouped by province, each with its own rate. | I1 |

## 1.3 World A → World B transition failure points

| Risk | Why it bites | Control |
|---|---|---|
| **World A `computed_json` may not contain the raw `inputs`** | The retro engine must rebuild the origin month's inputs to recompute a delta. If only outputs were persisted, corrections against World A months are impossible without a reconstruction migration. | **Gate X0** — verify `computed_json` shape before any retro work starts. If inputs are absent, migration `payroll_transactions.inputs_json` plus a backfill from `payroll_transactions` raw columns is a prerequisite, and months predating it are `disclosure_only`. |
| **Two engines, one contract, one month** | Both worlds can write a batch for the same contract-period through different code paths. | `payroll_engine` flag + INV-5, asserted in `disburseRun`, `confirmPayrollQueue`, and `settleSalaryPayable`. |
| **`locked_net` is the AP payment basis, `computed.netPay` is the World B basis** | Different frozen fields; a cutover mid-month leaves the reconciliation report comparing incomparables. | Cutover is per-contract and only at a period boundary. `GET /api/payroll/:year/:month/reconciliation` gains a `by_engine` breakdown. |
| **Silent regression in engine behaviour during consolidation** | Backend unit tests mock `pg.Pool` entirely, so SQL and column bugs are invisible by design. | Characterization tests (W0-C) pin every current statutory output before anything changes. Any consolidation must show a deliberate, itemised diff against those pins. |
| **Cleanup removes something load-bearing** | 29 of 34 files in `backend/scripts/` are untracked, which means no git history to recover from. | Quarantine to `_archive/`, never delete untracked files without the owner's explicit confirmation. Reverse-import proof required per file. |

---

# SECTION 2 — Deterministic State Machine & Data Model

## 2.1 Monthly Cycle lifecycle

```
                  ┌─────────────────────────────────────────┐
                  │                                         │
   Draft ──▶ Collecting ──▶ In_Review ──▶ Approved ──▶ Imported_To_Sheet
     │            │              │            │                  │
     │            │              └──▶ Disputed ┘                  │
     │            │                                               ▼
     └──▶ Cancelled                                         Compiled
                                                                  │
                                                                  ▼
                                                              Locked
                                                            (immutable)
                                                              │    │
                                                              ▼    ▼
                                                         Disbursed  Invoiced
                                                              │    │
                                                              └─┬──┘
                                                                ▼
                                                             Settled
                                                                │
                                                                ▼
                                                          Corrected*
```
`*` `Corrected` is a *derived view*, not a stored state. A settled period whose true position differs from its snapshot because approved corrections exist against it. The snapshot itself never changes.

### Transition table (the only legal moves)

| From | To | Guard |
|---|---|---|
| `Draft` | `Collecting` | Contract rulebook resolved; `enabled_types` non-empty; at least one routable recipient |
| `Draft` | `Cancelled` | No submissions exist |
| `Collecting` | `In_Review` | `fill_close_at` passed **or** all invited fillers terminal |
| `Collecting` | `Collecting` | Idempotent resend / reminder — never a state change |
| `In_Review` | `Disputed` | Any open `cycle_disputes` row |
| `Disputed` | `In_Review` | All disputes resolved |
| `In_Review` | `Approved` | Every submission terminal (`approved`/`rejected`/`no_claims`); **zero open `cycle_conflicts`** |
| `Approved` | `Imported_To_Sheet` | Staged into the compile surface; every cell carries full provenance |
| `Imported_To_Sheet` | `Compiled` | Server compute succeeded; zero `cycle_exceptions` of severity `fatal` |
| `Compiled` | `Imported_To_Sheet` | Re-import — permitted, and **must preserve overrides** (fixes F8) |
| `Compiled` | `Locked` | INV-1 … INV-10 all pass |
| `Locked` | `Disbursed` | Bank file generated, `payment_ledger` written |
| `Locked` | `Invoiced` | Client invoice persisted |
| `Disbursed` \| `Invoiced` | `Settled` | Both payment and invoice terminal |
| any ≥ `Locked` | *(no reverse edge)* | **Corrections only.** Reopen is superadmin + unlock code + `NO_MONEY_MOVED` and writes `month_close_revisions` |

### Payroll run status mapping (existing → target)

`payroll_runs.status` today is `draft \| proposed \| locked \| invoiced \| paid \| revised` (`payrollrun/service.js:12`). Target mapping, applied by migration without changing the stored vocabulary in phase 1:

| Cycle state | `payroll_runs.status` |
|---|---|
| `Imported_To_Sheet` | `draft` |
| `Compiled` | `proposed` |
| `Locked` | `locked` |
| `Invoiced` | `invoiced` |
| `Disbursed` / `Settled` | `paid` |
| — | `revised` **is deprecated** — replaced by the correction ledger |

## 2.2 Entity relationship overview

```
clients ──1:N── contracts ───────1:N─── contract_policy_versions   (the Rulebook, effective-dated)
                    │                            │
                    │                            └── statutory_matrix (province × effective date)
                    │
                    ├──1:N── contacts             (Client Focal / LM / Site Supervisor / ASIL Focal / DPR)
                    ├──1:N── service_orders       (Fixed Value only)
                    │
                    └──1:N── monthly_cycles ──1:N── monthly_cycle_entries ──1:N── cycle_entry_sources
                                   │                        │
                                   │                        └──1:N── cycle_conflicts
                                   ├──1:N── cycle_exceptions
                                   └──1:N── cycle_disputes

employees ──1:N── employee_assignments (effective-dated: contract, site, province, designation)
    │
    └──1:N── payroll_snapshot_rows ──N:1── payroll_snapshots ──1:1── monthly_cycles
                     │
                     ├──1:N── compliance_payables      (EOBI / SESSI / PESSI / WHT / PF / gratuity)
                     └──1:N── payroll_correction_results ──N:1── payroll_corrections
                                                                        │
                                                                        └──1:N── payroll_correction_lines
```

## 2.3 DDL — Records Spine

All DDL through `backend/migrations/` (node-pg-migrate), idempotent, reviewed before apply. Never in `server.js`.

```sql
-- ── The Contract Rulebook, versioned ────────────────────────────────────────
CREATE TABLE contract_policy_versions (
  id                      SERIAL PRIMARY KEY,
  contract_id             TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version_no              INTEGER NOT NULL,
  effective_from          DATE NOT NULL,
  effective_to            DATE,
  commercial_type         TEXT NOT NULL CHECK (commercial_type IN ('cost_plus','fixed_value')),
  proration_model         TEXT NOT NULL DEFAULT 'model_a'
                            CHECK (proration_model IN ('model_a','working_days')),
  calendar_basis          INTEGER NOT NULL DEFAULT 30,
  ot_divisor_days         INTEGER NOT NULL DEFAULT 26,
  ot_divisor_hours        INTEGER NOT NULL DEFAULT 8,
  ot_allowed              BOOLEAN NOT NULL DEFAULT TRUE,
  ot_monthly_cap_hours    NUMERIC(8,2),
  ot_weekday_multiplier   NUMERIC(4,2) NOT NULL DEFAULT 1,   -- fixes F7 explicitly
  ot_restday_multiplier   NUMERIC(4,2) NOT NULL DEFAULT 2,
  ot_holiday_multiplier   NUMERIC(4,2) NOT NULL DEFAULT 3,
  service_charge_pct      NUMERIC(6,4) NOT NULL DEFAULT 0.18,
  bonus_accrual_months    INTEGER NOT NULL DEFAULT 12,
  gratuity_accrual_months INTEGER NOT NULL DEFAULT 12,
  edu_cess_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  net_pay_floor_pct       NUMERIC(5,4) NOT NULL DEFAULT 0.50, -- recovery cap, INV-8
  enabled_claim_types     TEXT[] NOT NULL DEFAULT ARRAY['OT','EXPENSE','MEDICAL'],
  collection_mode         TEXT NOT NULL DEFAULT 'monthly_form'
                            CHECK (collection_mode IN ('monthly_form','machine_file','daily_marks','mixed')),
  submit_deadline_day     INTEGER NOT NULL DEFAULT 18,
  approve_deadline_day    INTEGER NOT NULL DEFAULT 22,
  created_by              TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, version_no)
);
CREATE UNIQUE INDEX contract_policy_versions_open_uq
  ON contract_policy_versions (contract_id) WHERE effective_to IS NULL;

-- ── Provincial statutory matrix (fixes F4, F5, F6, and the F17 true-up basis) ─
CREATE TABLE statutory_matrix (
  id                  SERIAL PRIMARY KEY,
  province            TEXT NOT NULL
                        CHECK (province IN ('sindh','punjab','kpk','balochistan','ict','federal')),
  effective_from      DATE NOT NULL,
  effective_to        DATE,
  minimum_wage        NUMERIC(12,2) NOT NULL,
  social_security_key TEXT NOT NULL,          -- 'SESSI' | 'PESSI' | 'KPESSI' | 'BESSI'
  -- D1: 100% employer-funded, 6%, capped at the minimum wage ceiling, zero employee share.
  --     ss_employer = min(basis, ss_wage_ceiling) * ss_employer_pct
  --     ss_wage_ceiling normally equals minimum_wage; kept separate because the two can
  --     diverge when a province revises one without the other. Never hardcode 40000 or 2400.
  ss_employee_pct     NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (ss_employee_pct = 0),
  ss_employer_pct     NUMERIC(6,4) NOT NULL,
  ss_wage_ceiling     NUMERIC(12,2) NOT NULL,
  ss_basis            TEXT NOT NULL DEFAULT 'contractual_salary'
                        CHECK (ss_basis IN ('contractual_salary','gross_earned','minimum_wage')),
  eobi_employee_pct   NUMERIC(6,4) NOT NULL DEFAULT 0.01,
  eobi_employer_pct   NUMERIC(6,4) NOT NULL DEFAULT 0.05,
  eobi_wage_base      NUMERIC(12,2) NOT NULL,
  sales_tax_pct       NUMERIC(6,4) NOT NULL,   -- SRB 15%, PRA 16%, KPRA 15%, BRA 15%
  sales_tax_authority TEXT NOT NULL,
  source_citation     TEXT NOT NULL,           -- SRO / notification reference, mandatory
  created_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX statutory_matrix_open_uq
  ON statutory_matrix (province) WHERE effective_to IS NULL;

CREATE TABLE wht_slabs (
  id             SERIAL PRIMARY KEY,
  tax_year       INTEGER NOT NULL,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  slab_floor     NUMERIC(14,2) NOT NULL,   -- annual
  base_tax       NUMERIC(14,2) NOT NULL,
  marginal_pct   NUMERIC(6,4) NOT NULL,
  source_citation TEXT NOT NULL,
  UNIQUE (tax_year, slab_floor)
);

-- ── Unified contacts (retires claim_authority / project_client_focals /
--    wafi_focal_points / supervisor_email / client_focal_emails — fixes F13) ──
CREATE TABLE contacts (
  id             SERIAL PRIMARY KEY,
  scope_type     TEXT NOT NULL CHECK (scope_type IN ('contract','site','employee')),
  scope_id       TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN
                   ('client_focal','line_manager','site_supervisor','asil_contract_focal',
                    'dedicated_payroll_resource','reviewer')),
  name           TEXT,
  email          TEXT,
  phone          TEXT,
  is_corporate   BOOLEAN NOT NULL DEFAULT FALSE,   -- gates magic-link eligibility
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX contacts_scope_role_idx ON contacts (scope_type, scope_id, role) WHERE active;

-- ── Effective-dated assignment (fixes the mid-month transfer edge case, F12) ──
CREATE TABLE employee_assignments (
  id             SERIAL PRIMARY KEY,
  employee_id    TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contract_id    TEXT NOT NULL REFERENCES contracts(id),
  site           TEXT,
  location       TEXT,
  province       TEXT NOT NULL,
  designation    TEXT,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  changed_by     TEXT NOT NULL,
  change_reason  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX employee_assignments_emp_idx ON employee_assignments (employee_id, effective_from DESC);
CREATE UNIQUE INDEX employee_assignments_open_uq
  ON employee_assignments (employee_id) WHERE effective_to IS NULL;
```

## 2.4 DDL — Cycle Spine

```sql
CREATE TABLE monthly_cycles (
  id                  SERIAL PRIMARY KEY,
  contract_id         TEXT NOT NULL REFERENCES contracts(id),
  period_month        INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year         INTEGER NOT NULL,
  policy_version_id   INTEGER NOT NULL REFERENCES contract_policy_versions(id),
  state               TEXT NOT NULL DEFAULT 'draft' CHECK (state IN
                        ('draft','collecting','in_review','disputed','approved',
                         'imported_to_sheet','compiled','locked','disbursed',
                         'invoiced','settled','cancelled')),
  collection_mode     TEXT NOT NULL,
  fill_close_at       TIMESTAMPTZ,
  approve_close_at    TIMESTAMPTZ,
  state_changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  state_changed_by    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, period_month, period_year)
);

CREATE TABLE monthly_cycle_entries (
  id              BIGSERIAL PRIMARY KEY,
  cycle_id        INTEGER NOT NULL REFERENCES monthly_cycles(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL REFERENCES employees(id),
  field           TEXT NOT NULL,              -- ot1_hours, ot2_hours, opd, expense, present_days …
  value           NUMERIC(14,4) NOT NULL,
  unit            TEXT NOT NULL CHECK (unit IN ('hours','pkr','days')),
  is_authoritative BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, employee_id, field)
);

-- Cell-level lineage: every value keeps every source that ever claimed it
CREATE TABLE cycle_entry_sources (
  id            BIGSERIAL PRIMARY KEY,
  entry_id      BIGINT NOT NULL REFERENCES monthly_cycle_entries(id) ON DELETE CASCADE,
  source_door   TEXT NOT NULL CHECK (source_door IN
                  ('portal_claim','monthly_hub_csv','machine_file','daily_marks',
                   'manual_override','retro_correction','legacy_wafi','legacy_email')),
  source_ref    TEXT,                    -- submission id, batch id, file hash
  raw_file_ref  TEXT,                    -- uploaded_files id
  value         NUMERIC(14,4) NOT NULL,
  author_id     TEXT NOT NULL,
  approver_id   TEXT,
  approved_at   TIMESTAMPTZ,
  is_authoritative BOOLEAN NOT NULL DEFAULT FALSE,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX cycle_entry_sources_entry_idx ON cycle_entry_sources (entry_id);

CREATE TABLE cycle_conflicts (
  id            BIGSERIAL PRIMARY KEY,
  cycle_id      INTEGER NOT NULL REFERENCES monthly_cycles(id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL,
  field         TEXT NOT NULL,
  source_a_id   BIGINT NOT NULL REFERENCES cycle_entry_sources(id),
  source_b_id   BIGINT NOT NULL REFERENCES cycle_entry_sources(id),
  delta         NUMERIC(14,4) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','resolved_a','resolved_b','resolved_manual')),
  resolved_value NUMERIC(14,4),
  resolved_by   TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX cycle_conflicts_open_uq
  ON cycle_conflicts (cycle_id, employee_id, field) WHERE status = 'open';

CREATE TABLE cycle_exceptions (
  id          BIGSERIAL PRIMARY KEY,
  cycle_id    INTEGER REFERENCES monthly_cycles(id) ON DELETE CASCADE,
  employee_id TEXT,
  kind        TEXT NOT NULL,     -- missing_bank, missing_cnic, no_corporate_contact,
                                 -- unassigned_employee, below_minimum_wage, stuck_approval
  severity    TEXT NOT NULL CHECK (severity IN ('info','warn','fatal')),
  detail      JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cycle_disputes (
  id            BIGSERIAL PRIMARY KEY,
  cycle_id      INTEGER NOT NULL REFERENCES monthly_cycles(id),
  employee_id   TEXT NOT NULL,
  raised_by     TEXT NOT NULL,
  raised_channel TEXT NOT NULL CHECK (raised_channel IN ('employee_portal','client_focal','line_manager','asil_ops')),
  field         TEXT,
  claimed_value NUMERIC(14,4),
  narrative     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','upheld','rejected','withdrawn')),
  resolution    TEXT,
  correction_id INTEGER,              -- FK added after payroll_corrections exists
  resolved_by   TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 2.5 DDL — Payroll Snapshot & Compliance Spine

```sql
CREATE TABLE payroll_snapshots (
  id                   BIGSERIAL PRIMARY KEY,
  cycle_id             INTEGER NOT NULL UNIQUE REFERENCES monthly_cycles(id),
  contract_id          TEXT NOT NULL,
  period_month         INTEGER NOT NULL,
  period_year          INTEGER NOT NULL,
  run_type             TEXT NOT NULL DEFAULT 'regular'
                         CHECK (run_type IN ('regular','off_cycle_settlement','retro_settlement')),
  sequence_no          INTEGER NOT NULL DEFAULT 1,
  policy_version_id    INTEGER NOT NULL REFERENCES contract_policy_versions(id),
  statutory_version_id INTEGER NOT NULL REFERENCES statutory_matrix(id),
  engine_version       TEXT NOT NULL,           -- git sha of prSheetEngine at compute time
  payroll_engine       TEXT NOT NULL CHECK (payroll_engine IN ('world_a','world_b','fv')),
  employee_count       INTEGER NOT NULL,
  total_net            NUMERIC(16,2) NOT NULL,
  total_employer_cost  NUMERIC(16,2) NOT NULL,
  content_hash         TEXT NOT NULL,           -- sha256 over ordered row snapshots
  locked_at            TIMESTAMPTZ,
  locked_by            TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, period_month, period_year, run_type, sequence_no)
);

CREATE TABLE payroll_snapshot_rows (
  id            BIGSERIAL PRIMARY KEY,
  snapshot_id   BIGINT NOT NULL REFERENCES payroll_snapshots(id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  province_vector JSONB NOT NULL,   -- [{province, days}] — day-weighted, mid-month transfers
  inputs        JSONB NOT NULL,     -- EXACT argument object passed to computePrSheetRow
  computed      JSONB NOT NULL,     -- EXACT return object
  provenance    JSONB NOT NULL,     -- {field: {source_door, source_ref, author_id, approver_id}}
  net_pay       NUMERIC(14,2) NOT NULL,
  UNIQUE (snapshot_id, employee_id)
);

CREATE TABLE compliance_payables (
  id             BIGSERIAL PRIMARY KEY,
  snapshot_id    BIGINT NOT NULL REFERENCES payroll_snapshots(id),
  payable_type   TEXT NOT NULL CHECK (payable_type IN
                   ('salary','eobi','sessi','pessi','kpessi','bessi','pf','wht',
                    'gratuity','bonus_accrual','edu_cess','life_insurance')),
  province       TEXT,
  authority      TEXT,
  amount         NUMERIC(16,2) NOT NULL,
  due_date       DATE,
  status         TEXT NOT NULL DEFAULT 'Payable'
                   CHECK (status IN ('Payable','Scheduled','Paid','Void')),
  payment_batch_id TEXT,
  challan_ref    TEXT,
  paid_at        TIMESTAMPTZ,
  paid_by        TEXT,
  UNIQUE (snapshot_id, payable_type, province)
);
```

**Migration posture.** `payroll_snapshots` / `payroll_snapshot_rows` are introduced as a **view-compatible superset**, not a replacement. Phase P1 writes them *in parallel* with `payroll_transactions.computed_json` and `payroll_run_rows.computed`, and a reconciliation test asserts the three agree field-for-field. Only after a full green month does anything read from the new tables. Nothing is ever deleted from `payroll_transactions`.

## 2.6 The Retro Adjustment Ledger — origin-month-pinned corrections

**Governing principle: a closed month is a historical fact. Corrections are new facts about the past, settled in the present. The origin snapshot is never edited.**

This directly answers the requirement that a missed due, missed OT, or missed deduction must be rectifiable *using the same month's salary for calculation*.

### How "same month's salary" is enforced

The correction engine never reads `employees.salary`. It reads `payroll_snapshot_rows.inputs` (or, in the transition, `payroll_transactions.computed_json.inputs`) for the **origin** month, which already contains the contractual salary, OT rate divisors, calendar basis, paid-days factor and province as they stood then. It then resolves `policy_version_id` and `statutory_version_id` from the origin snapshot — so the WHT slabs, SESSI ceiling, minimum wage and EOBI base used are the ones in force in the origin month, not today's.

```
delta = computePrSheetRow(originInputs ⊕ corrections, originPolicy, originStatutory)
      − computePrSheetRow(originInputs,               originPolicy, originStatutory)
```

The right-hand term must reproduce the stored `computed` object byte-for-byte. If it does not, the correction is **rejected** with `ORIGIN_NOT_REPRODUCIBLE` — this is the self-check that proves the engine is deterministic and the snapshot is intact.

### Schema

```sql
CREATE TABLE payroll_corrections (
  id                    SERIAL PRIMARY KEY,
  correction_no         TEXT NOT NULL UNIQUE,        -- COR-{YYYY}-{NNNN}
  contract_id           TEXT NOT NULL REFERENCES contracts(id),
  origin_period_month   INTEGER NOT NULL,
  origin_period_year    INTEGER NOT NULL,
  origin_snapshot_id    BIGINT REFERENCES payroll_snapshots(id),
  origin_world          TEXT NOT NULL CHECK (origin_world IN ('world_a','world_b','fv','pre_cutover')),
  settlement_month      INTEGER NOT NULL,
  settlement_year       INTEGER NOT NULL,
  settlement_mode       TEXT NOT NULL DEFAULT 'payroll'
                          CHECK (settlement_mode IN ('payroll','disclosure_only')),
  reason_code           TEXT NOT NULL CHECK (reason_code IN
                          ('missed_ot','missed_claim','missed_deduction','salary_revision',
                           'attendance_dispute','statutory_correction','data_entry_error',
                           'advance_recovery','final_settlement')),
  narrative             TEXT NOT NULL,
  evidence_ref          TEXT,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
                          ('draft','computed','proposed','approved','settled','voided')),
  raised_by             TEXT NOT NULL,
  approved_by           TEXT,
  approved_at           TIMESTAMPTZ,
  settled_snapshot_id   BIGINT REFERENCES payroll_snapshots(id),
  settled_at            TIMESTAMPTZ,
  net_delta_total       NUMERIC(16,2),
  billing_delta_total   NUMERIC(16,2),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((settlement_year, settlement_month) >= (origin_period_year, origin_period_month))
);

CREATE TABLE payroll_correction_lines (
  id              BIGSERIAL PRIMARY KEY,
  correction_id   INTEGER NOT NULL REFERENCES payroll_corrections(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL REFERENCES employees(id),
  field           TEXT NOT NULL,     -- must be a key of computePrSheetRow's input contract
  original_value  NUMERIC(14,4) NOT NULL,   -- read from the origin snapshot, never typed by a human
  corrected_value NUMERIC(14,4) NOT NULL,
  source_door     TEXT NOT NULL,
  evidence_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (correction_id, employee_id, field)
);

CREATE TABLE payroll_correction_results (
  id                  BIGSERIAL PRIMARY KEY,
  correction_id       INTEGER NOT NULL REFERENCES payroll_corrections(id) ON DELETE CASCADE,
  employee_id         TEXT NOT NULL,
  origin_computed     JSONB NOT NULL,   -- verbatim copy of the frozen origin row
  recomputed          JSONB NOT NULL,
  delta               JSONB NOT NULL,   -- every field of the engine output, signed
  net_delta           NUMERIC(14,2) NOT NULL,
  wht_delta           NUMERIC(14,2) NOT NULL,
  employer_cost_delta NUMERIC(14,2) NOT NULL,
  billing_delta       NUMERIC(14,2) NOT NULL,
  settlement_ref      TEXT,             -- payment_ledger reference once settled
  UNIQUE (correction_id, employee_id)
);

-- One open correction per employee-month-field
CREATE UNIQUE INDEX payroll_correction_lines_open_uq
  ON payroll_correction_lines (employee_id, field,
       (SELECT origin_period_year FROM payroll_corrections c WHERE c.id = correction_id),
       (SELECT origin_period_month FROM payroll_corrections c WHERE c.id = correction_id))
  WHERE TRUE;   -- implement as a trigger-backed constraint; expression subqueries are not indexable
```
> Implementation note for the builder: the last index cannot be expressed as written — PostgreSQL will not index a subquery. Denormalise `origin_period_month` / `origin_period_year` onto `payroll_correction_lines` and build the partial unique index over those columns filtered on a `status` column mirrored from the header via trigger. Do not skip this constraint; INV-10 depends on it.

### Settlement mechanics

A settled correction contributes three distinct amounts to the settlement month's compile:

| Delta | Lands as | Tax treatment |
|---|---|---|
| Gross components (salary-for-days, OT, allowances, claims) | `previousDues` input on the settlement row, signed | **Excluded** from the settlement month's WHT annualization base — requires the F2 fix to `prSheetEngine.js:260-261` |
| WHT delta | Discrete `retro_wht` line on the settlement row | Computed on the **origin month's** slab version, so the employee is taxed as they should have been then |
| Employer cost + billing delta | `compliance_payables` retro rows + a credit/debit note against the origin month's invoice (cost-plus) or a signed `so_deductions` adjustment (Fixed Value) | Provincial ST at the **origin month's** rate |

Recovery of a negative delta is capped by `contract_policy_versions.net_pay_floor_pct`; anything above the cap spreads across subsequent months as a scheduled recovery plan, each instalment its own settled line.

### API surface

| Route | Roles | Purpose |
|---|---|---|
| `POST /api/payroll-corrections` | `payroll_initiator`, `finance_manager`, `superadmin` | Raise a draft against an origin period |
| `POST /api/payroll-corrections/:id/compute` | same | Run the pinned delta computation; asserts `ORIGIN_NOT_REPRODUCIBLE` |
| `GET /api/payroll-corrections/:id/preview` | + `operations` | Per-employee before/after/delta table |
| `POST /api/payroll-corrections/:id/approve` | `finance_approver`, `superadmin` | `[MD GATE]` for `net_delta_total` above a configurable threshold |
| `POST /api/payroll-corrections/:id/void` | `finance_approver`, `superadmin` | Only while `status <> 'settled'` |
| `GET /api/payroll/:year/:month/true-position` | all finance roles | Frozen snapshot + all approved corrections = the real position for that month |

`GET /api/payroll/:year/:month/true-position` is the reporting answer to "what did that month *actually* cost" without ever mutating the snapshot. It is what the statutory returns and the client's year-end reconciliation read.

---

# SECTION 3 — The 10 Non-Negotiable System Invariants

Each invariant is a **fatal assertion**: violation aborts the transaction and returns a typed error code. Each is enforced at the lowest layer that can enforce it — a database constraint beats a trigger, a trigger beats application code. Each has a named test that must exist before the invariant is considered live.

| # | Invariant | Enforced at | Error code | Test |
|---|---|---|---|---|
| **INV-1** | **Snapshot Sovereignty.** Every downstream artifact — bank file, payslip, CSV export, invoice, close pack, statutory return — reads the frozen snapshot. No consumer may recompute payroll from raw inputs. | Application, plus a static guard test that greps consumers for engine imports | `RECOMPUTE_FORBIDDEN` | `payrollSnapshotParity.test.js` (exists; extend to all consumers) |
| **INV-2** | **Single Engine.** Exactly one module produces money: `prSheetEngine.computePrSheetRow`, drawing statutory constants only from `statutory_matrix` / `wht_slabs`. No other file may contain a WHT slab, an EOBI/SESSI rate, a PF or gratuity divisor, or a sales-tax percentage. | Static guard test over the whole repo | `DUPLICATE_STATUTORY_LOGIC` | `statutorySingleSource.test.js` (new; W0-C pins the baseline first) |
| **INV-3** | **Closed Period Immutability.** No UPDATE or DELETE may touch a snapshot row, `payroll_transactions` row with `locked=TRUE`, or `payroll_run_rows` of a run in `locked/invoiced/paid` — except the `paid_on`/`status` payment stamps. Reopen requires superadmin + unlock code + a `month_close_revisions` entry + a `NO_MONEY_MOVED` assertion over the scope. | **Database trigger** on each table | `CLOSED_PERIOD_IMMUTABLE` | `closedPeriodImmutability.test.js` (integration tier) |
| **INV-4** | **Single Payment Fact.** For a given `(employee_id, period_year, period_month, payment_type)` at most one non-void `payment_ledger` row may exist, across every batch and every engine. | **Partial unique index**, not an application `EXISTS` check | `DUPLICATE_PAYMENT` | `worldA.payment.test.js` + `disbursement.test.js` (extend) |
| **INV-5** | **Engine Exclusivity.** A `(contract_id, period)` is settled by exactly one engine. `contracts.payroll_engine` is asserted by *all three* payment paths — World A AP confirm, `disburseRun`, and `settleSalaryPayable` — before any write. | Application guard in all three paths + a covering integration test | `ENGINE_MISMATCH` | `engineExclusivity.test.js` (new) |
| **INV-6** | **Conflict Gate.** A cycle may not leave `In_Review`, and a period may not reach `Compiled`, while any `cycle_conflicts` row is `open`. Two authoritative sources disagreeing on one cell is a hard stop, never a silent last-writer-wins. | Application guard on the state transition + `cycle_conflicts_open_uq` | `UNRESOLVED_CONFLICT` | `conflictGate.test.js` (new) |
| **INV-7** | **Zero-Overwrite.** A zero, null or absent value from a non-authoritative door may never overwrite a positive value from an authoritative one. This is already the intent of `sourceMode='sheet_inputs'`; it becomes a checked rule rather than a default. | Application, in the merge layer | `NONAUTHORITATIVE_ZERO_OVERWRITE` | `zeroOverwrite.test.js` (new) |
| **INV-8** | **Statutory Floor.** No employee with full attendance for a full month may be locked at a `salaryForDays` below the minimum wage in force for their province-day-weighted assignment. No recovery or deduction may push net pay below `net_pay_floor_pct` of gross. | Application guard at lock | `BELOW_STATUTORY_FLOOR` | `statutoryFloor.test.js` (new) |
| **INV-9** | **Retro Basis Pinning.** A correction must resolve `policy_version_id` and `statutory_version_id` from the **origin** snapshot, and re-running the engine on the unmodified origin inputs must reproduce the stored `computed` object byte-for-byte. Reading `employees.salary` inside the correction path is a fatal error. | Application, plus a self-check assertion in `computeCorrection` | `ORIGIN_NOT_REPRODUCIBLE` | `retroBasisPinning.test.js` (new) |
| **INV-10** | **Ledger Balance.** For any period: `Σ payment_ledger(SALARY) == Σ snapshot net_pay + Σ approved-and-settled correction net deltas landing in that period`. An `approved` correction with an unsettled delta **blocks** the settlement month's lock. | Application assertion before lock and before month close; reconciliation endpoint exposes the residual | `LEDGER_IMBALANCE` | `ledgerBalance.test.js` (integration tier) |

**Second ring** — enforced but not fatal, surfaced as `cycle_exceptions` in the daily digest: missing bank details, missing or expired CNIC, no corporate contact for a claims-eligible employee, an employee with attendance but no active assignment, an invoice raised for a period with no locked snapshot, a statutory payable past its due date.

---

# SECTION 4 — Execution & Cutover Roadmap

## 4.0 Wave 0 — Foundation (in flight, no behaviour change)

| Session | Scope | Gate |
|---|---|---|
| **W0-A** | Dead-weight quarantine to `_archive/`; fix the broken `AttendanceManagement.jsx` sub-tab imports; guard test forbidding imports from `_archive/` | `npm test` + `npm run build` show no new failures |
| **W0-B** | Test spine unification — make the ~500 lines of currently-unrunnable tests execute from one root command; install Vitest for the frontend | All four tiers run green from `npm test` at the root |
| **W0-C** | Statutory divergence characterization — pin every current statutory output in tests, publish `docs/STATUTORY_DIVERGENCE.md`. **No application code changes.** | New suites pass 100%; `git diff --stat` shows new files only |

Wave 0 exists because none of the later waves can be verified without it. W0-C in particular is the precondition for INV-2: consolidating four SESSI implementations is only safe once the current outputs are pinned and the rupee delta per employee is known.

## 4.1 Phase R — Records Spine

| Milestone | Deliverable | Verification | Gate |
|---|---|---|---|
| **R1** Contract Rulebook | `contract_policy_versions` + read path; `getPolicy` resolves by `as_of` date and returns a version id; contract type change blocked while an open run exists | Integration test: two versions, compute resolves the correct one per period | |
| **R2** Contacts & Assignments | `contacts` + `employee_assignments`; backfill from `claim_authority`, `line_manager_email`, `project_client_focals`, `wafi_focal_points`, `supervisor_email`, `client_focal_emails`; legacy columns become **read-only shadows** written by a trigger for one full month before removal | Backfill reconciliation report: every legacy value has a `contacts` row; zero routing-profile changes across the whole roster | `[MD GATE]` — routing must not change for anyone |
| **R3a** Exposure quantification | **Read-only.** Apply the D1 formula across the roster and report, per province and per month back to the cutover floor: total currently accrued, total that should have been accrued, and the shortfall — with the ≥45,000 cohort broken out separately | A single reconciliation report. No code changes, no migrations | **Blocking** — the number determines the remediation approach |
| **R3b** Statutory Matrix | `statutory_matrix` + `wht_slabs` seeded for all four provinces with SRO citations; `taxEngine` reads from them; **`prSheetEngine` social security consolidated onto the matrix per D1**; OT multipliers seeded per D2 | W0-C characterization tests re-run: every intentional delta itemised per employee, total rupee impact reported | `[MD GATE]` |

R3 changes employer cost, not employee net pay (see D1). That materially lowers the risk — no one is paid differently on the day it ships. What it does change is `totalPayrollCost`, which flows into cost-plus client invoices and the statutory payable, so the gate is a **client-billing and compliance** decision rather than a payroll one.

It must still run as a shadow month: compute a real period twice, once on each implementation, and produce a per-employee variance file before anything goes live. The historical shortfall surfaced by R3a is a separate remediation decision for the owner — it is *not* automatically corrected by shipping R3b, because back-accruing social security for closed months is a retro correction (Phase X) with a compliance dimension, not an engine change.

## 4.2 Phase C — Monthly Cycle & Intake

| Milestone | Deliverable | Verification |
|---|---|---|
| **C1** One Door | `monthly_cycles` + `monthly_cycle_entries` + `cycle_entry_sources`; Portal Claims writes through it instead of directly to `employee_claims`; remove the `linkSecret()` hardcoded fallback (F15); add token expiry; make `CLAIMS_MONITOR_CC_UNTIL` explicit rather than a silent default (F16) | One full cycle of the current live contract runs end-to-end through the new tables with byte-identical outcomes |
| **C2** Conflict Gate | `cycle_conflicts`; Monthly Hub CSV and machine-file ingest become sources rather than writers; **roster mutation removed from `applyAttendance`** (F12) and replaced by an audited assignment change | Deliberately inject a Portal-vs-CSV disagreement; assert the cycle cannot reach `Approved` |
| **C3** Disputes & Deprecation | `cycle_disputes`; employee-visible submit record with a "disagree" action; quarantine the Wafi Gmail world (~4,700 lines), the `claims_inbox` world (~1,400 lines), and the Claims Queue UI to `_archive/`, **preserving every `employee_claims` row they produced**; wire `claims_reviewer_email` into routing or drop it (F14) | Grep proves zero live references; `employee_claims` row count unchanged before and after |

## 4.3 Phase P — Compile & Lock

| Milestone | Deliverable | Verification |
|---|---|---|
| **P1** Snapshot Spine | `payroll_snapshots` + `payroll_snapshot_rows` written **in parallel** with the existing tables; `province_vector` day-weighting; `provenance` populated per cell; fix F2 (`previousDues` WHT exclusion), F3 (duplicate return keys), F7 (`classifyOtDate` weekday multiplier via policy), F8 (overrides survive recompute) | Parallel-write reconciliation asserts all three stores agree field-for-field for a full live month |
| **P2** Lock & Guard | INV-1 … INV-8 enforced; DB triggers for INV-3; partial unique index for INV-4; `contracts.payroll_engine` for INV-5; World A unlock demoted to superadmin + code + `NO_MONEY_MOVED` (F9); reopen requires reversal (F10) | Every invariant has a red-then-green test; attempt each violation and assert the typed error |

## 4.4 Phase X — Retro Adjustment Ledger

| Milestone | Deliverable | Verification | Gate |
|---|---|---|---|
| **X0** Feasibility | Confirm `payroll_transactions.computed_json` contains the raw `inputs`. If not: migration + backfill, and months predating it are marked `disclosure_only` | Reproduce a closed month's `computed` byte-for-byte from its stored inputs, for every employee in a real month | **Blocking** |
| **X1** Correction Engine | Full schema from §2.6; compute/preview/approve/settle; `ORIGIN_NOT_REPRODUCIBLE` self-check; INV-9 and INV-10 | Golden test: a real closed month, a known missed OT claim, assert the settlement month's `previousDues`, `retro_wht`, employer-cost payable and invoice credit note all reconcile to the rupee | `[MD GATE]` on first live correction |
| **X2** Retirement of reopen | `PATCH /api/payroll/:year/:month/unlock` and `POST /api/payroll-runs/:id/reopen` return `410 USE_CORRECTION` for any period with money moved | Attempt a reopen on a paid month; assert 410 | |

X0 is a genuine go/no-go. Everything in the retro design rests on the origin month's inputs being recoverable; if they are not, the design still works but only from the first month that persists them forward, and older months become disclosure-only.

## 4.5 Phase I & M — Invoicing and Compliance

| Milestone | Deliverable | Verification |
|---|---|---|
| **I1** Dual Writers | Cost-plus writer computes from the locked snapshot with **per-province tax lines** (fixes F18); Fixed Value writer unchanged in behaviour but reads the snapshot; both refuse to invoice an unlocked period; retro credit/debit notes | Re-generate the last three months' invoices from snapshots; assert byte-identical totals to what was actually issued |
| **M1** Compliance Ledger | `compliance_payables` per province and authority; challan references; due-date tracking; annual WHT true-up job (F17) | Reconcile a closed month's payables against what was actually remitted |

## 4.6 Phase A — Orchestration

| Milestone | Deliverable |
|---|---|
| **A1** Digest & Wizard | Daily focal digest driven by `cycle_exceptions` (missing KYC/bank, stuck approvals, open conflicts, unraised invoices, overdue statutory payables); single Month-Close Wizard chaining Collect → Review → Compile → Lock → Disburse → Invoice → Remit, each step blocked by its own invariants |

## 4.7 Cutover criteria — zero downtime

A contract moves to the unified spine only when **every one** of these is true:

1. `scripts/backup_prod.ps1` run and `pg_restore --list` verified within the preceding 24 hours.
2. One full **shadow month** computed on both paths with a per-employee variance report showing zero unexplained deltas. Explained deltas (e.g. the R3 SESSI consolidation) are itemised and signed off.
3. `npm test` and `npm run test:int` green, including every invariant test.
4. `contracts.payroll_engine` set for the contract; both payment paths assert it.
5. The prior month for that contract is `Settled` with `INV-10` balanced to zero residual.
6. A rollback script exists and has been dry-run on staging.
7. `[MD GATE]` sign-off recorded in `.agents/AGENTS.md` Section 10.

Rollback for any cutover month: the legacy path is never removed, only bypassed. Reverting `contracts.payroll_engine` restores the prior behaviour, because the snapshot spine is written in parallel and never becomes the sole source until Phase 7.

## 4.8 Sequencing and parallelism

```
W0-A ─┐
W0-B ─┼─▶ R1 ─▶ R2[MD] ─▶ R3[MD] ─┐
W0-C ─┘                            ├─▶ P1 ─▶ P2 ─▶ X0 ─▶ X1[MD] ─▶ X2
           C1 ─▶ C2 ─▶ C3 ─────────┘                │
                                                     ├─▶ I1 ─▶ M1 ─▶ A1
```

R and C are independent of each other and can run in parallel worktrees. Everything downstream of P1 is strictly serial — it touches the compile surface, and two agents editing the compile surface concurrently is the failure mode AGENTS.md §1 exists to prevent.

---

## Appendix A — Archive register

Recorded here so nothing is lost. Full per-file justification lives in `_archive/README.md`.

| Group | Approx. size | Disposition |
|---|---|---|
| Wafi Gmail claims world (`wafiClaimsService.js`, `WafiClaimsDashboard.jsx`, `wafiClaims/approvalService.js`, inline `server.js` block) | ~4,700 lines | Archive at C3. Gated off by `system_config.wafi_gmail_intake_enabled` but still mounted. **`employee_claims` rows with `source_kind='wafi'` are permanent.** |
| Email Claims world (`emailClaimsService.js`, `EmailClaimsListener.jsx`, `claims_inbox`, `claims_approval_cycles`) | ~1,400 lines | Archive at C3. Nine routes are `requireAuth`-only with no role guard, including `push-to-payroll`. |
| `scripts/archive/` | 47 files | Delete at W0-A — git history retains it; already contains known-broken references. |
| One-shot data-ops scripts (root + `backend/scripts/`) | ~30 files | Archive at W0-A (tracked) / owner-confirmed (untracked). |
| Superseded planning docs (`TRACK_B_HRMS_UNIFICATION_PLAN.md`, `JULY_2026_CUTOVER_AND_WAFI_REFRESH.md`, `TESTING_LOG.md`, `audit_log.md`) | ~1,400 lines | Archive on adoption of this blueprint. |
| `frontend/src/payrollUtils.js` `calcEmployeeRow` and the client-side statutory mirror | ~200 lines | Delete at INV-2 enforcement. Export helpers (`buildHBLFile` etc.) are still live — extract them first. |
| Legacy routing columns (`supervisor_email`, `client_focal_emails`, `claims_reviewer_email`) | — | Drop one month after R2, only once the shadow-write reconciliation is clean. |

## Appendix B — Questions

### Resolved 2026-08-29 (see §0.1 Decisions Register)

| Was | Ruling |
|---|---|
| Which SESSI implementation is correct? | **D1** — 6% employer-funded, capped at the provincial minimum wage ceiling, zero employee share |
| Is weekday OT genuinely 2×? | **D2** — varies by contract; becomes an explicit per-contract policy with no code default, seeded at current behaviour |
| `BUILT_SYSTEM_SPEC.md` vs `ARCHITECTURE.md` | **D3** — merge into `ARCHITECTURE.md`, archive `BUILT_SYSTEM_SPEC.md` |

### Still open

1. **Historical social security shortfall.** R3a will quantify how much was never accrued for the ≥45,000 cohort. Once the number is known: back-accrue via Phase X corrections, disclose only, or seek a professional opinion first? This has a compliance dimension beyond the engine.
2. **Were S5B1–S5B3 executed in `C:\Projects\ASILHCM-Staging`?** `OWNER_BOARD.md:50` says the June-2026 reconciliation "may be ahead" in that checkout and was never merged here. If so, three session files are wrongly marked open.
3. **Correction approval threshold** — above what `net_delta_total` should a retro correction require MD sign-off rather than `finance_approver`?
4. **`backend/gmail-auth-setup.js`** — still needed for OAuth bootstrap, or archivable?
5. **Local `main` is 24 commits behind `origin/main`** in the owner's folder, with substantial uncommitted claims work on top. The Wave 0 branches are based on `origin/main`, so they do not carry it. Reconcile before merging anything.
