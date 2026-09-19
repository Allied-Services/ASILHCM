# Monthly Cycle — September 2026 team how-to

Monthly Cycle collects attendance and claims only.

## Tabs

| Tab | Use it for |
|---|---|
| Setup | Claim types, collection mode, deadlines |
| People | Claimer / Reviewer / Approver |
| Collect | Machine file + invite emails |
| Review | What came back |
| Track | Status and chase (no payroll push) |
| Corrections | Fix a person or CSV |

Stale `?section=payroll` and `?section=close` links open **Track**.

## Where finance lives

| Action | Screen |
|---|---|
| Review and push claims to the sheet | **Payroll Sheet** → Review and push claims |
| Month-close checklist, close pack, statutory JSON | **Payroll Sheet** → Month close |
| Cost-plus invoice | **Invoices (AR)** |
| Service-order / Fixed Value invoice | **Month Invoices** / Client → Service Orders |

Do not lock payroll or raise invoices from Monthly Cycle.

## PSO North Zone service orders

Each line lists nested services with count, monthly rate, and manpower Yes/No. Shortages use the matched role rate ÷ 30 × days. Unfilled role slots (departed or never hired) bill as **Missing service** at the full role rate. Repair live lines with:

`node backend/scripts/repair_pso_north_zone_so.js`

Dry-run first. Production apply needs `--apply --allow-production` after review.
