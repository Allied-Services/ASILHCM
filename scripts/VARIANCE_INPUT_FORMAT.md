# Excel payroll export format for variance reporting (S5A)

The payroll team exports one CSV per contract per month. `scripts/variance_report.js` compares this file to HCM `payroll_run_rows` for the same contract and period.

## Required columns

| Column | Excel workbook (typical) | HCM source | Notes |
|---|---|---|---|
| `employee_id` | Col A — ASIL ID | `payroll_run_rows.employee_id` | Matched case-insensitively; whitespace stripped |
| `employee_name` | Col B — Name | `employees.name` | Informational; not used in delta gate |
| `paid_days` | Col C — Paid / Present days | `computed.paidDays` | Model A calendar basis (30-day) |
| `gross` | Col D — Gross pay | `computed.gross` | Whole rupees |
| `income_tax` | Col E — WHT / Income tax | `computed.wht` | From `taxEngine.calculateMonthlyIncomeTax` |
| `eobi` | Col F — EOBI (employee) | `computed.eobiEmployee` | Flat Rs. 400 |
| `sessi_or_pessi` | Col G — SESSI/PESSI | `computed.sessiEmployer` | **Employer** contribution in HCM (employee share is 0) |
| `pf` | Col H — PF deduction | `computed.pfDeduction` or `inputs.pfDeduction` | Often 0 unless manually patched |
| `advances` | Col I — Advances | `inputs.advanceDeduction` | Not auto-computed; patch via row override if used |
| `other_deductions` | Col J — Other deductions | `inputs.otherDeduction` | Reduces gross in engine |
| `net_pay` | Col K — Net pay | `computed.netPay` | Gate field — total net delta must be 0 |

Alternate header names are accepted (see `EXCEL_ALIASES` in `backend/src/payroll/varianceCompare.js`), e.g. `wht` for `income_tax`, `net` for `net_pay`.

## Export procedure (payroll team)

1. Run the contract month in the master Excel PR sheet as today.
2. Export **only active employees on that contract** for the target month.
3. Save as CSV (UTF-8). Do not include total/summary rows.
4. Run: `node scripts/variance_report.js --csv <file> --contract <id> --month <m> --year <y>`

## Pilot contract (S5A selection)

**Selected:** `CTR-1773048704450` — **Facility Management**, Wafi Energy Pakistan Pvt Ltd (**38** active employees, `contract_policies` present).

Rationale (from `audit/groundtruth/facts.md` §6): smallest headcount in the 20–80 band with a policy row; Wafi-style PR sheet is what `prSheetEngine.js` / `payrollParity.test.js` were validated against. PSO contracts deferred (deliverable-billing gap); BPO Wafi (211) lacks `contract_policies`.

## Gate semantics

- Exit code **0** only when every matched row has all-field delta = 0 **and** there are no unmatched rows on either side.
- Unmatched employees are treated as variance (counted in summary, listed in `variance_summary.md`).
- Rupee amounts are compared to 2 decimal places (half-up rounding).
