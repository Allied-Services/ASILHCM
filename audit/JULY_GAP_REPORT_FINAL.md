# July 2026 WAFI Payroll Gap Report — FINAL (post-merge)

Generated: 2026-08-03  
Scope: **Wafi Energy Pakistan Pvt Ltd** only  
PR merged: [#17](https://github.com/Allied-Services/ASILHCM/pull/17) → `main` @ `46a4688`

## Alignment status: **NOT CONFIRMED** — blocked on July payroll save

Code fixes are merged and deploying to production. **HCM still has zero `payroll_transactions` rows for July 2026** for WAFI at baseline/final check time. Net-pay alignment cannot be confirmed until:

1. Run `npm run migrate` on Render (adds `payroll_transactions.remarks`)
2. Open Payroll Sheet → July 2026 → import `audit/july_inputs/wafi_claims_import.csv`
3. Save payroll (CONTRACT_MAP fix ensures contract bonus config applies)
4. Re-run: `node audit/july_alignment_report.js --out audit/JULY_GAP_REPORT_FINAL.md`

## Baseline vs target

| Metric | Baseline (pre-fix) | Target | Notes |
|--------|-------------------:|-------:|-------|
| WAFI employees (Excel) | 304 | 305 | 1 Excel row filtered (inactive/zero net) or header parse; HCM master has 305 |
| Excel net total | 43,517,805 | 43,953,273 | Δ 435,468 — likely missing employee + payroll not yet computed |
| HCM net total (July 2026) | 0 | 43,953,273 | No payroll saved yet |
| Net mismatches | 304 | 0 | All rows: `no payroll row` |
| Bonus (Excel AB sum) | 17,385,973 | — | Verify vs HCM `bonusDisbursed` after save |

## Remaining unexplained variances by contract (baseline)

All contracts show **100% mismatch** because HCM net = 0 (no saved payroll). Largest Excel net by BU:

| Contract (Client BU) | Employees | Excel Net |
|---------------------|----------:|----------:|
| Trading & Supply | 208 | 26,226,182 |
| Lubes | 18 | 5,063,726 |
| Retail | 18 | 4,417,726 |
| IT | 7 | 2,392,014 |
| LSC | 34 | 1,526,117 |
| LSC Logistics | 5 | 1,134,735 |
| LSC Production | 4 | 926,067 |
| Finance | 3 | 670,448 |
| Real Estate | 4 | 660,663 |
| Human Resources | 1 | 240,287 |
| OTC | 1 | 140,765 |
| Doctor | 1 | 119,075 |

## What was built and merged

- **P0** `CONTRACT_MAP` fix — `getContracts()` returns array; map was empty → bonus/contract config missing
- **Import modal** — ASIL code primary, name fuzzy warn, present-days overflow warning, no Special Allowance import
- **Bonus guard** — contract auto-bonus month zeroes `special_allowance` in gross calc
- **Remarks** — migration `20260803140000_payroll_transactions_remarks.js` + GET/POST
- **Gap report** — `audit/july_alignment_report.js` (WAFI-only filter)

## Next operator steps

1. Render: `npm run migrate` on prod backend
2. Import WAFI claims CSV via Payroll Sheet UI
3. Re-run gap report; expect ≤305 mismatches at ±PKR 1 tolerance
4. Investigate any remaining per-employee deltas by contract using report output
