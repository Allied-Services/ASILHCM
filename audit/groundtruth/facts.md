# Production ground-truth facts (S0A)
**Captured:** 2026-07-24 (UTC+5)  
**Source:** Read-only queries against production Neon (`neondb`) via `psql`.  
**Schema snapshot:** `audit/groundtruth/schema_prod.sql` (6,246 lines, 254 KB).  
**Full backup:** `backups/prod_20260724_041440.dump` (797 MB, local only — not committed).

## SSL / production health note (user-confirmed, re-verified here)

`GET https://asilhcm.onrender.com/health` returned **HTTP 200** on commit `8efc8c0` with body:

```json
{"status":"column \"asil_bu\" of relation \"clients\" already exists","time":"2026-07-23T23:14:20.391Z","migrations":"column \"asil_bu\" of relation \"clients\" already exists","commit":"8efc8c0dff8376ff0ac4d914a1b42672003c39cb"}
```

SSL `rejectUnauthorized: true` is **live and working** — the backend connected to Neon successfully. The `/health` response also surfaces a pending migration DDL conflict (`asil_bu` on `clients`) from `20260716120000_client_org_masters` not yet applied cleanly; flag for S0C/S3.

---

## 1. `pgmigrations` — which repo migrations have run on prod?

**Repo:** 21 files in `backend/migrations/`.  
**Prod:** 19 applied.

### Applied on prod (19)

```
                      name                       |           run_on
-------------------------------------------------+----------------------------
 20260705100000_enable_extensions                | 2026-07-05 14:48:27.945109
 20260705100100_intake_hub                       | 2026-07-05 14:48:28.307735
 20260705100200_projects                         | 2026-07-05 14:48:28.873405
 20260705100300_contract_constraints             | 2026-07-05 14:48:29.364003
 20260705100400_pnl_billing                      | 2026-07-05 14:48:29.79116
 20260705100500_claims_attendance                | 2026-07-05 14:48:30.556715
 20260705100600_compliance_ar_ops                | 2026-07-05 14:48:31.388483
 20260705100700_bizdev_onboarding_cashflow       | 2026-07-05 14:48:32.411858
 20260706120000_payroll_runs                     | 2026-07-06 07:12:48.515544
 20260706130000_claims_focal_comment             | 2026-07-06 07:12:49.135067
 20260706150000_run_spine                        | 2026-07-06 08:50:15.993189
 20260706160000_client_invoices_contract_id_text | 2026-07-06 10:33:58.095389
 20260707150000_xero_billable_receipts           | 2026-07-07 11:01:43.026706
 20260708120000_bill_approval                    | 2026-07-08 18:15:58.740337
 20260709160000_md_operational_mandates          | 2026-07-09 13:37:10.090486
 20260710120000_attendance_ops_alignment         | 2026-07-10 09:40:37.003692
 20260715120000_employee_roster_focals           | 2026-07-15 06:05:36.782035
 20260715140000_portal_claims                    | 2026-07-15 09:41:12.161505
 20260715190000_portal_claim_attachment_category | 2026-07-15 14:08:11.136621
```

### Missing on prod (2)

| Migration file | Notes |
|---|---|
| `20260716120000_client_org_masters.js` | `/health` reports `asil_bu` column conflict — partial/manual DDL likely attempted |
| `20260720120000_leave_policies.js` | Leave policy overrides table not yet on prod |

**`20260706120000_payroll_runs` HAS run** — Phase 4 disbursement bridge is **not** blocked by missing payroll_runs migration.

---

## 2. `payroll_transactions` columns — legacy `ot`, `opd`, `reimb`?

**Yes — all three legacy columns exist on prod**, along with newer claim-related columns:

```
    column_name
-------------------
 id
 employee_id
 month
 year
 basic
 hra
 conv
 med
 ot
 opd
 reimb
 gross
 wht
 eobi_ee
 eobi_er
 sessi_ee
 sessi_er
 pf_ee
 adv
 net
 status
 paid_on
 created_at
 locked
 locked_by
 locked_at
 paid_days
 special_allowance
 fuel_mobile
 other_deduction
 advance_deduction
 loan_deduction
 bonus_amount
 arrears
 medical_ee
 medical_sp
 medical_ch1
 medical_ch2
 service_charges
 sales_tax
 total_invoice
 created_by
 ot2_hrs
 ot3_hrs
 opd_claim
 reimbursement
 updated_at
(47 rows)
```

**Implication:** `POST /api/wafi-claims/.../stage-payroll` INSERTs into `ot`/`opd`/`reimb` will **not crash** on this prod DB — they write to columns that exist but are not consumed by World A payroll compute. S1B should still route into `employee_claims`.

---

## 3. Phase 2–5 dependency tables — existence check

```sql
SELECT to_regclass(t) FROM unnest(ARRAY[
  'payroll_runs','payroll_run_rows','contract_policies','employee_claims',
  'monthly_attendance_overrides','cost_allocations','contract_rate_cards','public_holidays'
]) AS t;
```

```
         to_regclass
------------------------------
 payroll_runs
 payroll_run_rows
 contract_policies
 employee_claims
 monthly_attendance_overrides
 cost_allocations
 contract_rate_cards
 public_holidays
(8 rows)
```

**All 8 tables exist on prod.**

---

## 4. `employee_claims` full column list

```
    column_name
-------------------
 id
 intake_message_id
 employee_id
 claim_type
 period_month
 period_year
 claimed_items
 status
 focal_email
 focal_token_hash
 focal_approved_at
 focal_rejected_at
 compliance_notes
 created_at
 updated_at
 focal_comment
 payroll_run_id
 contract_id
(18 rows)
```

Matches migration `20260705100500_claims_attendance` plus later additions (`focal_comment`, `payroll_run_id`, `contract_id`).

---

## 5. Locked payroll history

`locked` column **exists**.

```sql
SELECT MIN(year*100+month), MAX(year*100+month), COUNT(*)
FROM payroll_transactions WHERE locked = TRUE;
```

```
  min   |  max   | count
--------+--------+-------
 202604 | 202604 |   303
(1 row)
```

Only **April 2026** has locked payroll rows (303 employees). No other months locked yet.

---

## 6. Pilot contract selection data (S5 input)

Query ran as written (no column adaptations needed).

```
        id         |                  contract_name                  |             client             | status | emp_count | has_policy | ot_allowed | working_days_override | attendance_override_rows
-------------------+-------------------------------------------------+--------------------------------+--------+-----------+------------+------------+-----------------------+--------------------------
 TEST-CTR-1        | TEST WHT                                        | TEST-CLIENT-1                  | Active |         0 | t          | t          |                       |                        0
 TEST-CTR-1        | TEST WHT                                        | TEST-CLIENT-1                  | Active |         0 | t          | t          |                       |                        0
 TEST-CTR-WHT-E2E  | TEST WHT Contract                               | TEST Client WHT E2E            | Active |         0 | t          | t          |                       |                        0
 CTR-1773054060255 | Conservancy Services Punjab                     | Pakistan State Oil Company Ltd | Active |         0 | t          | t          |                       |                        0
 CTR-1773054335402 | Conservancy Services Gilgit Baltistan           | Pakistan State Oil Company Ltd | Active |         0 | f          |            |                       |                        0
 CTR-1773054204870 | Conservancy Services KPK                        | Pakistan State Oil Company Ltd | Active |         0 | f          |            |                       |                        0
 CTR-1773053337970 | Janitorial Services LMT Korangi & LMP-A Kemari  | Pakistan State Oil Company Ltd | Active |        29 | t          | t          |                       |                        0
 CTR-1773048704450 | Facility Management                             | Wafi Energy Pakistan Pvt Ltd   | Active |        38 | t          | t          |                       |                        0
 CTR-1773048523696 | Facility Management (Trading & Supply)          | Wafi Energy Pakistan Pvt Ltd   | Active |        56 | f          |            |                       |                        0
 CTR-1778149976025 | Operations Handling LMT Korangi & LMP-A Keamari | Pakistan State Oil Company Ltd | Active |       115 | t          | t          |                       |                        0
 CTR-1773046722553 | Business Process Outsourcing (BPO)              | Wafi Energy Pakistan Pvt Ltd   | Active |       211 | f          |            |                       |                        0
(11 rows)
```

**Pilot shortlist observations (for S5 `[MD GATE]`):**
- Smallest real headcount with `has_policy=true`: **Janitorial LMT Korangi (29)** or **Wafi Facility Management (38)**.
- Largest contract **BPO Wafi (211)** has **no** `contract_policies` row — would need policy setup before World B pilot.
- **Zero** `monthly_attendance_overrides` rows across all active contracts.
- Duplicate `TEST-CTR-1` rows in result (likely duplicate contract records or join artifact) — exclude test contracts from pilot.

**Total employees in prod:** `SELECT COUNT(*) FROM employees;` → **682**.

---

## 7. Backup restore-test (step 5)

| Item | Status |
|---|---|
| `pg_dump -Fc` backup created | ✅ `backups/prod_20260724_041440.dump` — 797 MB, `pg_restore --list` shows 1,095 TOC entries |
| Neon branch `restore-test` + `pg_restore` + employee count | ❌ **BLOCKED** — `NEON_API_KEY` not available in shell; `neonctl` requires interactive browser OAuth. See `BLOCKED.md`. |

Prod employee count (reference for restore parity): **682**.
