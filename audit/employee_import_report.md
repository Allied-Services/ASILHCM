# Employee master reconciliation (Build 2)

Generated: 2026-07-08T13:46:49Z

## Summary

| Metric | Count |
|---|---:|
| Unique in June CSV union | 666 |
| In both CSV files (overlap) | 142 |
| MATCHED | 666 |
| MISSING in HCM | 0 |
| EXTRA in HCM | 16 |

## MISSING in HCM

_None._

## EXTRA in HCM (sample 25)

- `123` Huzaifa client=Test active=Yes
- `ASIL-1774260596303` Shezad client=None active=Yes
- `ASIL/PSO-018/25` Arshad client=Pakistan State Oil Company Limited active=No
- `ASIL/PSO-030/25` Ali client=Pakistan State Oil Company Ltd active=Yes
- `ASIL/PSO-180/25` Dabeer Ahmad client=Pakistan State Oil Company Limited active=Yes
- `ASIL/PSO-192/25` Zeeshan client=Pakistan State Oil Company Limited active=Yes
- `ASIL/SPL-360/21` Mehrim Zahoor client=Wafi Energy Pakistan Pvt Ltd active=Yes
- `ASIL/SPL-388/21` Shahzad Gul client=Wafi Energy Pakistan Pvt Ltd active=No
- `ASIL/SPL-408/21` Kashif Yazdani client=Wafi Energy Pakistan Pvt Ltd active=Yes
- `ASIL/SPL-46/21` Farman Ullah client=Wafi Energy Pakistan Pvt Ltd active=Yes
- `ASILFM/SPL/22/125` Daud Khalid client=Wafi Energy Pakistan Pvt Ltd active=Yes
- `ASILFM/SPL/22/141` Rehmat shah client=Wafi Energy Pakistan Pvt Ltd active=Yes
- `ASILFM/SPL/22/142` Mehran client=Wafi Energy Pakistan Pvt Ltd active=Yes
- `ASILFM/SPL/22/40` Shehzad Masih client=Wafi Energy Pakistan Pvt Ltd active=Yes
- `ASILFM/SPL/22/81` Arshad Ali client=Wafi Energy Pakistan Pvt Ltd active=Yes
- `TEST` TEST SHEZAD client=TEST active=Yes

## Column mapping

| CSV | API field | In PR header |
|---|---|---|
| ASIL Employee Code | `id` | yes |
| Employee Name | `name` | yes |
| Active | `active` | yes |
| Client | `client` | yes |
| Client BU | `clientBU` | yes |
| Department | `dept` | yes |
| Designation | `designation` | yes |
| Location | `location` | yes |
| Province | `province` | yes |
| CNIC | `cnic` | yes |
| Bank | `bankName` | yes |
| Account | `bankAccount` | yes |
| Date of Joining | `doj` | yes |
| New Salary | `salary` | yes |
| Email Address | `email` | yes |
| Total Medical Coverage (Self & Family) | `totalMedicalCoverage` | yes |

## Data quality

- Blank CNIC: 0
- Missing bank/account: 5
- Bad DOJ: 0
- Duplicate CNIC groups: 1

## Proposed updates (not applied)

Count: 193

- `ASIL/PSO-031/25`: email
- `ASIL/PSO-032/25`: bankName, bankAccount, email
- `ASIL/PSO-033/25`: bankName, bankAccount, email
- `ASIL/PSO-034/25`: email
- `ASIL/PSO-035/25`: bankName, bankAccount, email
- `ASIL/PSO-036/25`: bankName, bankAccount, email
- `ASIL/PSO-037/25`: bankName, bankAccount, email
- `ASIL/PSO-038/25`: bankName, bankAccount, email
- `ASIL/PSO-039/25`: bankName, bankAccount, email
- `ASIL/PSO-040/25`: bankName, bankAccount, email
- `ASIL/PSO-041/25`: bankName, bankAccount, email
- `ASIL/PSO-042/25`: bankName, bankAccount, email
- `ASIL/PSO-043/25`: bankName, bankAccount, email
- `ASIL/PSO-044/25`: bankName, bankAccount, email
- `ASIL/PSO-045/25`: bankName, bankAccount, email

## Phase 2b

Action 1 import complete (49 created). Actions 2-3 pending JWT refresh.


## Phase 2b execution (detail)

| Metric | Value |
|---|---:|
| HCM count before | 633 |
| HCM count after import | 682 |
| MATCHED (final reconcile) | 666 |
| MISSING | 0 |
| EXTRA (pre-cleanup) | 16 |
| Employees created | 49 |

### Imported IDs (49)

46 via bulk /api/employees/bulk; 3 via bulk with **cnic omitted** (duplicate CNIC):

- ASIL/PSO-298/25 (CNIC held by ASIL/PSO-297/25)
- ASIL/SPL-418/21 (CNIC held by ASILFM/SPL/22/40)
- ASIL/SPL-420/21 (CNIC held by ASIL/SPL-361/21)

Full ID list in audit/phase2b_created_ids.txt.

### Action 2 — backfill (190 blanks)

**Status:** partial — run stopped on PUT 500 (DOJ format) then JWT expired. Re-run python scripts/finish_phase2b.py after fresh JWT (bankName, bankAccount, email only; DOJ skipped).

### Action 3 — cleanup

**Status:** pending — delete junk IDs 123, TEST, ASIL-1774260596303 and client renames (Ltd/Pvt Ltd -> Limited per June CSV) in finish_phase2b.py.

### Client canonical mapping (June CSV truth)

- Pakistan State Oil Company Ltd -> Pakistan State Oil Company Limited
- Wafi Energy Pakistan Pvt Ltd -> Wafi Energy Pakistan Limited

Rollback: audit/employee_phase2b_rollback.json (written on finish run).
## Phase 2b execution (finish_phase2b.py)

Finished: 2026-07-08T14:31:25Z

| Action | Result |
|---|---|
| Backfill bank/email | 0 saved, skip 665, fail 1 |
| Client renames | 50 saved, fail 0 |
| Junk deletes | 0 ok, fail 3 |
| HCM count after | 682 |
| MATCHED | 666 |
| MISSING | 0 |
| EXTRA | 16 |

### MD verify employees

- `ASIL/PSO-298/25` Mohammad Zubair | client=Pakistan State Oil Company Limited | bank=Allied Bank | email=None | cnic=(omitted — duplicate CNIC)
- `ASIL/SPL-418/21` Shahzad Masih | client=Wafi Energy Pakistan Limited | bank=HBL | email=Kanwar.Azhar@wafi-energy.com | cnic=(omitted — duplicate CNIC)
- `ASIL/SPL-420/21` Rafae Kayani | client=Wafi Energy Pakistan Limited | bank=Faysal Bank | email=R.Kayani-Contractor@wafi-energy.com | cnic=(omitted — duplicate CNIC)

Rollback: `audit\employee_phase2b_rollback.json`

### Backfill failures (first 10)

- `ASIL/PSO-085/25`: Internal server error