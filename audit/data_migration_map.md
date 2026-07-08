# HCM Data Migration Map (Build 1)

2026-07-08T12:09:13.990060+00:00

## Summary
- **Profiled:** 30 readable files (xlsx/csv) + 50 Google .gsheet stubs (10 sampled per AutoData month folder); 231 AutoData shortcut files inventoried across 5 months.
- **Latest payroll month (May-26 workbook tab):** 513 employee rows with codes.
- **PR.csv (Apr-2026):** 508 active / 573 total employees.
- **Historic invoices (wafi_invoices_clean.csv):** 3,240 rows; **payments (payments_clean.csv):** 1,391 rows.
- **Canonical offline payroll history:** Attachments/Audit BPO FM Jul 2026/BPO FM Payroll & Invoice File.xlsx (16 month tabs, ~5,598 employee-month rows).


## Live HCM baseline

| Entity | Count |
|---|---:|
| employees | 633 |
| contracts | 10 |
| client_invoices | 18 |
| bills | 20557 |

## File inventory

### AutoData `2024_12` (64 files)

| Ext | Count |
|---|---:|
| .gsheet | 63 |
| .ini | 1 |

### AutoData `2025_1` (40 files)

| Ext | Count |
|---|---:|
| .gsheet | 39 |
| .ini | 1 |

### AutoData `2025_7` (43 files)

| Ext | Count |
|---|---:|
| .gsheet | 42 |
| .ini | 1 |

### AutoData `2025_8` (43 files)

| Ext | Count |
|---|---:|
| .gsheet | 42 |
| .ini | 1 |

### AutoData `2025_9` (46 files)

| Ext | Count |
|---|---:|
| .gsheet | 45 |
| .ini | 1 |

### April 2026 outputs

| File | Kind | Notes |
|---|---|---|
| BPO HBL Apr-2026.xlsx | xlsx | HBL To HBL Transfers rows=206 |
| BPO Other Apr-2026.xlsx | xlsx | Interbank Funds Transfer rows=114 |
| desktop.ini | .ini |  |
| FM HBL Apr-2026.xlsx | xlsx | HBL To HBL Transfers rows=31 |
| FM Other Apr-2026.xlsx | xlsx | Interbank Funds Transfer rows=52 |
| PSO Convservancy Other Apr-26.xlsx | xlsx | Interbank Funds Transfer rows=152 |
| PSO HBL Conservancy Apr-26.xlsx | xlsx | HBL To HBL Transfers rows=4 |
| PSO Janitorial Other Apr-26.xlsx | xlsx | Interbank Funds Transfer rows=29 |
| desktop.ini | .ini |  |
| desktop.ini | .ini |  |
| desktop.ini | .ini |  |
| WH Income Tax Salaries Apr-26.xls | xlsx | openpyxl does not support the old .xls file format, please use xlrd to read this file, or convert it to the more recent .xlsx file format. |
| desktop.ini | .ini |  |
| Invoice File Upload on Xero Apr-26.csv | csv | rows=100 |

### SampleFiles

- BPO HBL Apr-2026.xlsx: sheet HBL To HBL Transfers cols=9 rows=206
- BPO Other Apr-2026.xlsx: sheet Interbank Funds Transfer cols=11 rows=114
- FM HBL Apr-2026.xlsx: sheet HBL To HBL Transfers cols=9 rows=31
- FM Other Apr-2026.xlsx: sheet Interbank Funds Transfer cols=11 rows=52
- Invoice File Upload on Xero Apr-26.csv: rows=100 cols=29
- PSO Convservancy Other Apr-26.xlsx: sheet Interbank Funds Transfer cols=11 rows=152
- PSO HBL Conservancy Apr-26.xlsx: sheet HBL To HBL Transfers cols=9 rows=4
- PSO Janitorial Other Apr-26.xlsx: sheet Interbank Funds Transfer cols=11 rows=29
- WH Income Tax Salaries Apr-26.xls: rows=None cols=0

### audit/out

| File | Rows | Cols |
|---|---:|---:|
| R1_wafi_outstanding.csv | 185 | 10 |
| T1_unclassified.csv | 30 | 10 |
| T2_invoices_missing_invno.csv | 70 | 10 |
| T3_expense_with_invno.csv | 6 | 10 |
| T5_notpaid_rejected.csv | 153 | 10 |
| W6_liability_per_employee.csv | 573 | 6 |
| W6_pf_withdrawals.csv | 27 | 5 |
| payments_clean.csv | 1391 | 17 |
| payments_normalized.csv | 1400 | 14 |
| wafi_invoices_clean.csv | 3240 | 27 |

## Payroll month rows

| Sheet | Employees |
|---|---:|
| May-26 | 513 |
| Apr-26 | 515 |
| Mar-26 | 511 |
| Feb-26 | 332 |
| Jan-26 | 332 |
| Dec-25 | 329 |
| Nov-25 | 331 |
| Oct-25 | 298 |
| Sep-25 | 300 |
| Aug-25 | 305 |
| Jul-25 | 304 |
| Jan-25 | 305 |
| Mar-25 | 307 |
| Apr-25 | 305 |
| May-25 | 306 |
| June-25 | 305 |
PR.csv: 571 rows, 51 columns.

## Mappings

### Payroll month sheet / PR.csv
| Source column | HCM target |
|---|---|
| ASIL Employee Code | employees.id |
| Employee master columns | employees.* via /api/employees/bulk |
| Month sheet Mon-YY | payroll_runs.period_month/year |
| Pay columns | payroll_run_rows.inputs + computed |
| Run metadata | payroll_runs locked, source=excel_import |

### Bank output xlsx
| Beneficiary Account / Amount | employees.bank_account + reconciliation |

### Xero / wafi_invoices_clean.csv
| inv, contact, dates, gross, balance | client_invoices + payment_received_at |

### payments_clean.csv
| amount, pay_date, invoice | invoice_receipts |

## GAPS & QUESTIONS

1. AutoData monthly folders are .gsheet stubs only; export xlsx or use audit workbook tabs.
2. Confirm ASIL Employee Code = employees.id.
3. Client/BU to contracts.contract_name mapping required.
4. Workbook missing Feb-25; Nov-25 missing Gratuity; Jan-25 missing PF column.
5. PR.csv Apr-2026: 508 active employees - Build 2 master?
6. Payments: multi-invoice rows, missing inv#, Not Paid/Rejected rows need policy.
7. Wafi scope: 3240 invoices in clean CSV; import all or Jan-25+ only?
8. Pre-2025 PF/gratuity openings not in W6 ledger.
9. WH Income Tax Salaries .xls not readable via openpyxl.
10. April 2026 Invoice Files folder empty.

## Import order

| Build | Scope | Est. |
|---|---|---:|
| Build 2 | Employee master | ~508 active |
| Build 3 | May-26, Apr-26, Mar-26 | ~1539 rows (5598 all months) |
| Build 4 | invoices + payments | ~3240 inv, ~1391 pay |

See audit/profile_historic_data_raw.json for sheet-level columns/samples.
