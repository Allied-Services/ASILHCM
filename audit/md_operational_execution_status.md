# MD Operational Mandates — Execution Status

Generated: 2026-07-09

## 0. Blueprint

MD Operational Mandates permanently appended to  
`C:\Users\Shoaib Siddique\.cursor\plans\hcm_go_live_master_plan.plan.md`.

## 1. Workspace roster & access control

| Email | HCM role set live | MD roles covered |
|---|---|---|
| huzaifa.rafaqat@asil.com.pk | finance_manager | finance_manager, ar_team, payroll |
| laiba.mughal@asil.com.pk | procurement_manager | ap_team, procurement |
| asif.awan@asil.com.pk | finance_approver | finance_approver |
| obaid.rana@asil.com.pk | operations | operations_team |
| rabia.bhutto@asil.com.pk | operations | operations_supervisor, bizdev |

Script: `scripts/provision_workspace_roster.py`  
Startup seed + VALID_ROLES expanded in `backend/server.js` (needs deploy for `operations_supervisor` / `bizdev` / `payroll` aliases).  
Report: `audit/workspace_roster_provision.md`

## 2. Data corrections

- **Protected (verified present):** `ASIL/PSO-298/25`, `ASIL/SPL-418/21`, `ASIL/SPL-420/21`
- **Junk delete:** blocked on live until cascade endpoint deploys — plain `DELETE /api/employees/:id` returns 500 (FK deps).  
  Local code ready: `POST /api/admin/purge-employee-cascade` + `scripts/data_corrections_md.py`  
  Report: `audit/data_corrections_report.md`

## 3. Historical payroll extraction

Source: `Attachments/BPO FM Payroll & Invoice File.xlsx` (local copy `C:\temp\BPO_FM_Payroll.xlsx` for import)

| Period | Live import |
|---|---|
| May-26 → Mar-26 | **DONE** |
| Feb-26 → Sep-25 | **DONE** (batch 2) |
| Aug-25 → PR Dec-24 | **DONE** (batch 3, exit 0) |
| **Feb-25** | **MISSING** from workbook — only gap |

All 17 available month sheets imported. Script: `scripts/import_payroll_history.py`  
Report: `audit/payroll_import_report.md`


## 4. Core payroll mechanics (Zero Variance)

Implemented locally; covered by 18/18 pillar assertions:

1. OT 1X in `prSheetEngine` + claim aggregation + rate-card billing  
2. Working days = month − Sundays − holidays + override (`computeWorkingDays`)  
3. Default present days when attendance empty  
4. Medical (OPD) in gross; excluded from WHT base  
5. Previous dues add to gross  
6. EOBI EE = 400 PKR  
7. FBR 2025-26 tax slabs via `taxEngine`  

Status cycle: `draft → proposed → locked → paid → revised`  
Excel fixtures: ASIL/SPL-205/21 OT=3980, ASIL/SPL-213/21 OT=6433 — **0 variance**

Tests: `backend/tests/payrollParity.test.js`  
`npm test` exit 0 (suite). Direct runner: 18 PASS.

## 5. AR / invoicing / Xero

- Contract sales tax columns: migration `20260709160000_md_operational_mandates.js` (`sales_tax_rate`, `sales_tax_exempt`) wired into compute  
- Manual Paid status: restricted to `shezad.mumtaz` / `asif.awan` (+ superadmin)  
- EOD summary email queue: `payment_status_change_log` + scheduler 17:55 PKT → asif, shezad, huzaifa, laiba  
- Historic receipts: existing `import_invoice_history` / AR receipt path (Build 4 already live)

## 6. Claims flow

- Endpoint ready: `POST /api/admin/test-claim-notify` (needs deploy)  
- Live attempt failed: endpoint 404 on current Render; local RESEND key absent  
- Script: `scripts/test_claims_notify.py` — re-run after deploy with Render `RESEND_API_KEY`  
- Target: `laiba.mughal@asil.com.pk`

## Deploy gate (required for remaining live actions)

Push/deploy this branch so Render picks up:

1. Cascade junk delete  
2. `operations_supervisor` / `bizdev` role aliases  
3. `test-claim-notify` + payment-status guard + EOD email  
4. Payroll pillar engine + status cycle  

Then re-run:

```powershell
python scripts/data_corrections_md.py
python scripts/test_claims_notify.py
python scripts/import_payroll_history.py   # if live import incomplete
```
