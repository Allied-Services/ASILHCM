# July 2026 Cutover & Wafi Master Refresh — Execution Plan

**Authored:** 2026-07-31  
**Status:** P0–P3 implemented (staging verification pending)  
**Owner:** MD (Shezad)  
**Executor:** Cursor Composer 2.5, one phase per implementation session  
**Branch policy:** All implementation on `staging`; merge to `main` only after staging verification per phase gates below.

---

## Summary

ASIL HCM will adopt a **soft operational cutover on 1 July 2026**: normal UI, AP, payroll, invoices, and dashboard surfaces show only data with period **≥ 2026-07**. Pre-July history remains in the database and is visible only via a **global archive toggle** restricted to `superadmin` and `huzaifa.rafaqat@asil.com.pk`.

In the same programme window, the **Wafi BPO master roster** (`ASIL_Master_Roster (1).csv`, 308 data rows + header, path locked below) will be dry-run compared and then **upserted in place** on `employees.id` = ASIL Employee Code — no dual IDs, no silent creates/deletes. Salary, marital status, and children fields are overwritten from CSV when present. Claim routing for Wafi will be aligned to the four-path approval matrix (Focal → LM → HCM where both are named).

PSO and other non-Wafi contracts receive **cutover filtering only** in this plan — no roster CSV refresh.

This plan is **orthogonal to** `.agents/REMEDIATION_PLAN.md` Phases 5–7 (pilot payroll engine cutover). It does not retire World A compute; it cleans operational visibility and Wafi master data for July 2026 onwards.

---

## Non-goals

| Item | Rationale |
|------|-----------|
| Delete or migrate pre-July `payroll_transactions`, `payment_batches`, `payment_ledger`, or `wafi_claims_*` rows | Cross-phase invariant in REMEDIATION_PLAN — history is immutable |
| Refresh PSO / non-Wafi employee masters from CSV | Out of scope; cutover filter only |
| Create new employee IDs or retire unmatched DB rows silently | Locked decision #11 — dry-run report only |
| Replace REMEDIATION_PLAN S5B/S5C/S7 pilot cutover runbooks | Those govern World B payroll engine adoption per contract |
| S8A portal/email claims writer consolidation | Remains scheduled after S7R |
| Change Pakistan statutory constants, tax slabs, or payslip 60/20/10/7/3 split | Unrelated to this cutover |

---

## Locked decisions

| # | Decision | Implementation anchor |
|---|----------|----------------------|
| 1 | Soft cutover **1 Jul 2026** — normal views show period ≥ 2026-07 only | `system_config.cutover_period` + shared filter helper |
| 2 | Archive toggle: **superadmin** + **huzaifa.rafaqat@asil.com.pk** only; one global switch all modules respect | `system_config.show_pre_cutover_archive` + `GET/PUT /api/admin/cutover-settings` |
| 3 | No dual IDs — match Wafi on **ASIL Employee Code** (`employees.id`); update in place | `scripts/wafi_roster_refresh.js` (new) |
| 4 | Wafi master source only: `C:\Projects\Allied HCM Content-Hub\ASIL_Master_Roster (1).csv` (~307–308 rows) | CLI `--csv` path; PSO/others cutover filter only |
| 5 | Email: **Official** if present and not `N/A`; else **Personal** | CSV column mapping in refresh script |
| 6 | Inactive **or** LWD before 1 Jul 2026 → hidden in normal UI (archive only) | `employeeVisibilityClause()` |
| 7 | Salary overwrite from CSV = truth; dry-run lists deltas | `--dry-run` mode; force-write salary even when other blanks skipped |
| 8 | Marital + children fields overwrite for insurance | Same refresh script; included in delta report |
| 9 | Pre-July Wafi claims/links → archive/ignore in normal UI | Cutover filter on `wafi_claims_sessions`, `employee_claims` period |
| 10 | Non-Wafi claim rules unchanged | Portal/email intake paths untouched except shared period filter |
| 11 | Match failures: dry-run report only; no silent create/delete | `unmatched_csv[]`, `unmatched_db_wafi[]` in report JSON/MD |
| 12 | Staging dry-run first, then prod | Two MD gates (see below) |
| 13 | Wafi claim routing matrix (see §Gap analysis) | P3 claim-routing phase |

---

## Current-state findings (read-only audit, 2026-07-31)

### Wafi claims ingestion (`backend/wafiClaimsService.js` + `server.js` ~6831–8180)

| Area | Current behaviour |
|------|-------------------|
| Lifecycle | Email poll → parse Excel → `PENDING_REVIEW` / `VALIDATION_FAILED` / etc. → admin `verify` or `stage-payroll` |
| Payroll intake | `stageWafiSessionToEmployeeClaims()` writes `employee_claims` with `status='focal_approved'` **immediately** — no focal or LM token step |
| Line manager | `line_manager` stored on `wafi_claims_items`; `matchLineManagerEmails()` fuzzy-matches names to `@wafi-energy.com` CC addresses for **Gmail verification drafts only** |
| Focal points | `wafi_focal_points` table + `checkFocalPoint()` — used for first-time sender detection and CC on verification drafts; **not** an approval gate |
| Admin verify | `POST /api/wafi-claims/sessions/:id/verify` stages to `employee_claims` and marks session `VERIFIED` in one HCM admin action |
| Stats | `GET /api/wafi-claims/stats` — `pending_review`, `pending_payroll` (no period cutover filter) |

### Employee master (`employees` table + `backend/src/modules/employees/masterRoster.js`)

| Area | Current behaviour |
|------|-------------------|
| PK | `employees.id` = ASIL Employee Code (e.g. `ASIL/SPL-91/21`) |
| Import | `POST /api/employees/import` → `importMasterRosterCsv()` — **blank CSV cells never overwrite**; can INSERT new rows if name present |
| Column mismatch | Source CSV uses `Personal Email Address`, `Official Email Address`, `Line Manager(Wafi) *`, `Focal/ Supervisor *` — **not** in current `FIELD_MAP` (expects `Email Address`, `Line Manager Name/Email`, `Supervisor Email`) |
| Routing fields | `line_manager_name`, `line_manager_email`, `supervisor_email`, `client_focal_emails`, `claim_authority` exist on `employees` |
| Visibility | `GET /api/employees` returns **all** rows — no active/LWD/cutover filter |
| Insurance fields | `marital_status`, `spouse_*`, `child1_*`, `child2_*`, `medical_*`, `total_medical_coverage` mapped in `empToDb`/`empFromDb` |

### Portal claims (`backend/src/modules/claims/portalService.js`)

| Area | Current behaviour |
|------|-------------------|
| Filler | `claim_authority` on employee → `resolveFillerEmail()` |
| Approver | `supervisor_email` \|\| `line_manager_email` → single LM magic-link approval |
| Post-approval | `injectApprovedToEmployeeClaims()` → `employee_claims` as `focal_approved` (LM email stored in `focal_email` column — naming mismatch) |
| Dual step | **No** Focal-input-then-LM-approve chain; one LM step only |

### Dashboard & AP aggregates (`server.js`)

| Endpoint | Filter today | Cutover gap |
|----------|--------------|-------------|
| `GET /api/dashboard/summary` | Headcount: `active IN ('Yes','Active',NULL)`; invoices: all non-Paid/Void; bills: pending; payroll: `cost_allocations` current or latest month | No `period >= 2026-07`; no inactive/LWD hide |
| `GET /api/ap/payroll-queue` | Locked `payroll_transactions` grouped by client/contract/month | Shows pre-July months |
| `GET /api/ap/pending-fm-approval` | All FM-pending batches | No period floor |
| `GET /api/wafi-claims/stats` | Session status counts | No claim-month cutover |

### CSV source file

- **Path:** `C:\Projects\Allied HCM Content-Hub\ASIL_Master_Roster (1).csv`
- **Readable:** Yes (verified 2026-07-31)
- **Row count:** 309 lines = 1 header + **308 data rows** (user brief: ~307 — reconcile with Rabia on 1–2 blank/header rows before prod apply)
- **Contracts in file:** Primarily `Wafi BPO` (`CTR-1773046722553`); some rows reference Facility Management contract in other exports — filter refresh to Wafi client rows only if MD confirms

---

## Gap analysis — Focal-then-LM dual approval (locked decision #13)

### Required routing matrix

| LM (Wafi) | Focal/Supervisor | Flow |
|-----------|------------------|------|
| Named | Named | **Focal INPUTS** → **LM APPROVES** → HCM (both audited, one-time links) |
| Named | N/A | Employee → LM → HCM |
| N/A | Named | Focal → HCM |
| N/A | N/A | Route to **huzaifa.rafaqat@asil.com.pk** |

### What exists today vs required

| Path | Today | Gap |
|------|-------|-----|
| Wafi email Excel (`wafiClaimsService`) | Focal/submitter emails file → HCM admin verify → `focal_approved` | **No** focal input link; **no** LM approval gate before HCM; LM is CC on optional Gmail draft only |
| Portal monthly claims | Filler (`claim_authority`) → LM (`supervisor_email`) → `focal_approved` | Missing focal-as-filler path when both named; no sequential focal-then-LM state machine |
| `employee_claims` statuses | `received`, `pending_focal`, `focal_approved`, `focal_rejected`, `in_payroll_run` | Need `pending_lm`, `lm_approved`, `lm_rejected` (or equivalent) + audit columns |
| One-time links | `focal_token_hash` + `/api/claims/focal-action` for intake claims | Reuse pattern for LM step; Wafi sessions need per-session/per-batch tokens |
| Roster → routing | CSV has `Line Manager(Wafi) *` and `Focal/ Supervisor *` | Must map to `line_manager_email` + `claim_authority` (focal) on refresh; current `masterRoster` FIELD_MAP does not read Wafi CSV headers |

### Recommended P3 state machine (new Wafi email path)

```
INGESTED → PENDING_FOCAL_INPUT → PENDING_LM_APPROVAL → PENDING_HCM_REVIEW → VERIFIED → staged employee_claims
                ↓                        ↓
           FOCAL_REJECTED            LM_REJECTED
```

- **INGESTED:** Excel parsed, items valid (current `PENDING_REVIEW` equivalent).
- **PENDING_FOCAL_INPUT:** Only when routing matrix requires focal; email magic link to `claim_authority` / focal email to confirm or correct line items.
- **PENDING_LM_APPROVAL:** LM link (reuse portal approver token pattern); skipped when LM is N/A.
- **PENDING_HCM_REVIEW:** Visible in Wafi admin queue; `verify` stages to `employee_claims` (not before LM approves when LM required).
- Audit: `wafi_claims_approval_events` table (session_id, step, actor_email, decision, comment, at) — do not rely on Gmail thread alone.

---

## Phases

### P0 — Schema, flags & shared helpers

**Objective:** Persist cutover date and archive toggle; expose admin API; add shared server-side filter utilities.

**Deliverables**

1. Migration `backend/migrations/20260731120000_cutover_settings.js`:
   - Seed `system_config` keys: `cutover_period` = `{"month":7,"year":2026}`, `show_pre_cutover_archive` = `false`
2. `backend/src/core/cutover.js`:
   - `CUTOVER_MONTH`, `CUTOVER_YEAR` constants
   - `isArchiveVisible(req)` — true if user is superadmin OR email `huzaifa.rafaqat@asil.com.pk` AND `show_pre_cutover_archive`
   - `periodAtOrAfterCutover(month, year)` 
   - `employeeVisibilityClause(alias, { archive })` — active + LWD ≥ 2026-07-01 unless archive
   - `applyPeriodFloor(sqlFragment, monthCol, yearCol, archive)`
3. `GET/PUT /api/admin/cutover-settings` — superadmin + huzaifa only; `logAudit` on toggle change
4. Frontend: archive toggle in admin shell (e.g. `App.jsx` header or `UserManagement` superadmin strip); pass `?archive=1` or header `X-Show-Archive: 1` on API calls when enabled
5. Unit tests: `backend/tests/cutover.test.js`

**Likely files**

- `backend/migrations/20260731120000_cutover_settings.js`
- `backend/src/core/cutover.js`
- `backend/server.js` (admin routes only — 2 routes)
- `backend/mountModules.js` (if routes modularized)
- `frontend/src/api.js`
- `frontend/src/App.jsx` (toggle UI)

**Risks**

- Forgetting a query path → pre-July data leaks in one screen
- Toggle state not propagated to all frontend fetchers

**Verification**

- [ ] `npm test` green including new cutover unit tests
- [ ] `node --check server.js` clean
- [ ] Staging: toggle off → huzaifa cannot see pre-July; toggle on → can; other roles never see archive regardless of toggle

---

### P1 — Cutover filter rollout (UI / AP / payroll / invoices / dashboard)

**Objective:** All normal-mode list/count aggregates respect period ≥ 2026-07 and employee visibility rules.

**Deliverables**

1. Apply `cutover` helper to backend list endpoints (minimum set):

   | Module | Routes / queries |
   |--------|------------------|
   | Employees | `GET /api/employees`, export scope=active |
   | Dashboard | `GET /api/dashboard/summary` headcount, payroll, invoices, bills |
   | AP | `GET /api/ap/payroll-queue`, `payroll-queue/:y/:m`, `pending-fm-approval` |
   | Payroll | `GET /api/payroll*` list runs, legacy payroll month lists |
   | Invoices | `GET /api/client-invoices` list |
   | Wafi | `GET /api/wafi-claims/sessions`, `stats`, `items` |
   | Claims | `employee_claims` list endpoints if any |

2. Frontend: when archive off, default month pickers to ≥ Jul 2026; disable navigation to earlier months

3. Pre-July Wafi sessions: excluded from normal queue counts; visible in archive mode only

4. Integration tests: `backend/tests-int/cutover.filter.test.js` — seed Jun + Jul rows, assert counts

**Likely files**

- `backend/server.js` (dashboard, AP, wafi list queries)
- `backend/src/modules/payrollrun/routes.js`
- `backend/src/modules/employees/masterRoster.js` (`activeEmployeeClause` extend)
- `frontend/src/PayrollSheet.jsx`, `PayrollRun.jsx`, AP screens, dashboard, Wafi claims UI

**Risks**

- AP team confusion if June payroll queue “disappears” — communicate cutover date before deploy
- World A April 2026 locked payroll still in DB for audit — must remain reachable in archive mode

**Verification**

- [ ] `npm test` + `npm run test:int` green
- [ ] Staging: dashboard headcount drops to post-cutover cohort; AP queue shows no months before 2026-07 in normal mode
- [ ] Archive mode shows Jun 2026 and earlier rows unchanged

---

### P2 — Wafi roster dry-run & upsert

**Objective:** Dedicated refresh pipeline for Wafi CSV with delta report; no prod writes until MD gate.

**Deliverables**

1. `scripts/wafi_roster_refresh.js`:
   - `--csv <path>` (required), `--dry-run` (default), `--apply`, `--database-url`
   - Read only Wafi rows (`CLIENT NAME` contains `Wafi` OR `Contract Name` = `Wafi BPO`)
   - Match on `ASIL Employee Code` → `employees.id` only
   - Map columns per locked decisions #5–8:

     | CSV column | DB field | Rule |
     |-------------|----------|------|
     | Official Email Address | `email` | Use if non-blank and not `N/A` |
     | Personal Email Address | `email` | Fallback |
     | Line Manager(Wafi) Name | `line_manager_name` | Overwrite |
     | Line Manager(Wafi) Email | `line_manager_email` | Overwrite |
     | Focal/ Supervisor Name | (report only) | |
     | Focal/ Supervisor Email | `claim_authority` or `supervisor_email` | Focal = filler; per routing matrix |
     | Salary | `salary` | **Always overwrite** when CSV present |
     | Marital Status, Spouse*, Child* | insurance fields | Overwrite when CSV present |
     | Active, LWD | `active`, `last_working_day` | Overwrite |
     | Remaining master fields | per `FIELD_MAP` | Overwrite when non-blank |

   - **No INSERT** for unmatched CSV codes (report `unmatched_csv`)
   - **No DELETE** for DB Wafi employees absent from CSV (report `unmatched_db_wafi`)
   - Emit dry-run report (see §Dry-run report contract)

2. Optional: extend `masterRoster.js` FIELD_MAP with Wafi CSV header aliases (reuse in script)

3. `backend/tests/wafiRosterRefresh.test.js` — parse, email pick, delta formatting

**Likely files**

- `scripts/wafi_roster_refresh.js`
- `backend/src/modules/employees/masterRoster.js` (aliases)
- `backend/tests/wafiRosterRefresh.test.js`
- `audit/cutover/wafi_roster_dryrun_<date>.json` (generated artifact, not committed with PII)

**Risks**

- CNIC/bank scientific notation in CSV (e.g. `3.81015E+12`) — normalize in script; flag in report
- Contract ID drift between CSV and DB — warn, do not FK-fail
- Salary comma formatting (`"87,416"`) — strip commas (existing `toNumberOrNull` pattern)

**Verification**

- [ ] Dry-run on staging against Neon `staging` branch produces report with zero unexpected `unmatched_csv` (or MD accepts list)
- [ ] No row count change in dry-run (`would_insert: 0`, `would_delete: 0`)
- [ ] Salary deltas reviewed by payroll / Rabia

---

### P3 — Wafi claim routing (Focal → LM → HCM)

**Objective:** Implement locked decision #13 for **new** Wafi claim sessions after deploy; pre-July sessions stay archive-only.

**Deliverables**

1. Migration: `wafi_claims_approval_events`; extend `wafi_claims_sessions` with `approval_state`, `routing_profile`, `lm_email`, `focal_email`

2. `backend/wafiClaimsService.js`:
   - After parse, compute routing profile from employee row (`line_manager_email`, `claim_authority`) with matrix fallback to huzaifa
   - Gate `verify` / `stage-payroll`: refuse if `approval_state` ≠ `ready_for_hcm`
   - Send one-time links (Resend/Gmail): focal input, LM approve — reuse `hashToken` pattern from `claims/service.js`

3. `backend/src/modules/claims/portalService.js` (minimal):
   - When both focal + LM named on employee, enforce sequential approval before `injectApprovedToEmployeeClaims` (portal path only if Wafi employees use portal)

4. New routes:
   - `GET/POST /api/wafi-claims/focal-action?token=&id=`
   - `GET/POST /api/wafi-claims/lm-action?token=&id=`

5. Frontend Wafi queue: show approval state column; block Verify until ready

6. Tests: unit + `tests-int/wafi.approval.test.js` for all four routing profiles

**Likely files**

- `backend/migrations/20260731140000_wafi_approval_chain.js`
- `backend/wafiClaimsService.js`
- `backend/server.js` (approval routes)
- `frontend/src/features/wafi/` or Wafi claims component
- `backend/tests-int/wafi.approval.test.js`

**Risks**

- Email delivery (`EMAILS_ENABLED`, Resend/Gmail) — test on staging with real tokens
- In-flight sessions at deploy — freeze or grandfather as `legacy_bypass` with audit flag
- Confusion between `supervisor_email`, `claim_authority`, and `focal_email` columns — document mapping in ARCHITECTURE.md

**Verification**

- [ ] All four routing profiles exercised on staging with test employees
- [ ] `verify` returns 409 if LM step pending
- [ ] Approval events audit trail complete
- [ ] Pre-July sessions unchanged and hidden in normal UI

---

### P4 — Staging verification (end-to-end)

**Objective:** Full rehearsal on `asil-hcm-staging` before prod.

**Runbook**

1. `scripts/backup_prod.ps1` equivalent for staging DB (snapshot)
2. `npm run migrate` on staging
3. Deploy staging backend + frontend from `staging` branch
4. P0: verify toggle + cutover filters
5. P2: `node scripts/wafi_roster_refresh.js --dry-run` → MD reviews report
6. P2: `--apply` on staging → spot-check 10 employees (salary, email, LM, focal, children)
7. P3: submit test Wafi Excel for Jul 2026 claim month → walk focal → LM → HCM
8. Payroll: confirm Jul 2026 run compute includes refreshed salaries + approved claims
9. Dashboard/AP: confirm Jun 2026 absent in normal mode, present in archive
10. `npm test` + `npm run test:int` green on CI

**Deliverables**

- `audit/cutover/staging_signoff_2026-07.md` with checklist outputs, report paths, tester names

**Risks**

- Staging DB stale vs prod — refresh from prod backup if >30 days old (`docs/STAGING_SETUP.md`)

---

### P5 — Production apply

**Objective:** Apply after MD GO #2; monitor first Jul 2026 payroll cycle.

**Runbook**

1. `[MD GATE]` Sign-off on staging_signoff doc
2. `scripts/backup_prod.ps1` — mandatory
3. Maintenance window: deploy `main` with migrations
4. `node scripts/wafi_roster_refresh.js --dry-run` on prod → MD spot-check (should match staging)
5. `node scripts/wafi_roster_refresh.js --apply` on prod
6. Enable cutover (config already seeded; archive default **off**)
7. Smoke: dashboard, employee count, Wafi queue, one claim routing path
8. File `audit/cutover/prod_apply_2026-07.md`

**Rollback**

- Roster: restore `employees` from pre-apply backup table or `pg_restore` selective — script should log `before` snapshot JSON per changed row
- Cutover: set `cutover_period` forward or disable filter via config without redeploy
- Claim routing: feature flag `wafi_approval_chain_enabled` default true; set false to restore admin-only verify (document in migration)

**Verification**

- [ ] Prod dry-run delta ≤ staging delta
- [ ] No unmatched CSV codes without MD sign-off
- [ ] AP/payroll team confirms Jul 2026 queue visible
- [ ] First Wafi claim post-cutover follows routing matrix

---

## Dry-run report contract

**Outputs:** `audit/cutover/wafi_roster_dryrun_<YYYYMMDD_HHMM>.json` and `.md`

```json
{
  "generated_at": "ISO-8601",
  "mode": "dry-run",
  "csv_path": "...",
  "csv_rows": 308,
  "summary": {
    "matched": 0,
    "would_update": 0,
    "would_insert": 0,
    "would_delete": 0,
    "salary_deltas": 0,
    "email_changes": 0,
    "routing_changes": 0,
    "insurance_field_changes": 0,
    "warnings": 0,
    "errors": 0
  },
  "unmatched_csv": [{ "asil_code": "", "name": "", "reason": "not_in_db" }],
  "unmatched_db_wafi": [{ "asil_code": "", "name": "", "reason": "not_in_csv" }],
  "deltas": [{
    "asil_code": "",
    "field": "salary",
    "db_value": 0,
    "csv_value": 0,
    "action": "overwrite"
  }],
  "warnings": [{ "asil_code": "", "message": "scientific_notation_cnic" }],
  "errors": []
}
```

**MD review rules**

- `would_insert` + `would_delete` must be **0** (hard gate)
- Every `unmatched_csv` row needs Rabia/HR disposition before apply
- `unmatched_db_wafi` is informational — exited employees may remain in DB
- Salary deltas >5% flagged `HIGH_DELTA` for payroll review

---

## MD GO gates

### Gate 1 — Before staging `--apply` (end of P2 dry-run)

| Checkpoint | Owner |
|------------|-------|
| Dry-run report reviewed; `would_insert` = `would_delete` = 0 | MD |
| Unmatched CSV codes list accepted or CSV corrected | Rabia / HR |
| Salary delta list signed | Payroll |
| Staging DB backup taken | Ops |

### Gate 2 — Before production `--apply` (start of P5)

| Checkpoint | Owner |
|------------|-------|
| P4 staging_signoff doc complete | MD |
| `npm test` + `npm run test:int` green on merge commit | Engineering |
| Prod backup fresh (`scripts/backup_prod.ps1`) | Ops |
| Payroll/AP notified of Jul 2026 visibility cutover | MD |
| Rollback owner assigned | MD |

---

## Session mapping (implementation)

| Phase | Suggested session file | Notes |
|-------|------------------------|-------|
| P0 | `.agents/sessions/J26A_cutover_flags.md` | Schema + admin API |
| P1 | `.agents/sessions/J26B_cutover_filters.md` | Broad query sweep |
| P2 | `.agents/sessions/J26C_wafi_roster_refresh.md` | Script + dry-run |
| P3 | `.agents/sessions/J26D_wafi_claim_routing.md` | Largest risk |
| P4–P5 | `.agents/sessions/J26E_staging_prod_apply.md` | `[MD GATE]` runbook |

Execute P0→P5 in order. Do not start P3 until P2 dry-run reviewed — routing uses refreshed `claim_authority` / LM emails.

---

## Relationship to REMEDIATION_PLAN

- **Complements** S5–S7 pilot cutover (World B payroll engine per contract) — does not replace
- **Uses** existing `employee_claims` / Wafi staging from S1B
- **Defers** S8A portal writer consolidation — only touch portal approval order if required for Wafi dual-step
- **Respects** AGENTS.md: staging first, `npm run test:int` before AP/payroll pushes, no DDL in `server.js`

---

## Appendix — CSV column header map (Wafi source → HCM)

| Wafi CSV header | HCM field |
|-----------------|-----------|
| ASIL Employee Code | `employees.id` |
| Official Email Address | `email` (priority) |
| Personal Email Address | `email` (fallback) |
| Line Manager(Wafi) Name | `line_manager_name` |
| Line Manager(Wafi) Email | `line_manager_email` |
| Focal/ Supervisor Email | `claim_authority` |
| Focal/ Supervisor Name | (display / audit only) |
| Salary | `salary` |
| Marital Status | `marital_status` |
| Spouse Name / Age / CNIC | `spouse_name`, `spouse_age`, `spouse_cnic` |
| Child 1/2 Name / Age / CNIC | `child1_*`, `child2_*` |
| Active | `active` |
| Last Working Day | `last_working_day` |
