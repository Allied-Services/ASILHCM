# Workspace roster provision (MD Mandate §1)

Generated: 2026-07-09T11:05:42Z
Mode: LIVE
API: `https://asilhcm.onrender.com`

| Email | Primary HCM role | MD roles | Action | OK |
|---|---|---|---|---|
| huzaifa.rafaqat@asil.com.pk | finance_manager | finance_manager, ar_team, payroll | updated | True |
| laiba.mughal@asil.com.pk | procurement_manager | ap_team, procurement | updated | True |
| asif.awan@asil.com.pk | finance_approver | finance_approver | updated | True |
| obaid.rana@asil.com.pk | operations | operations_team | updated | True |
| rabia.bhutto@asil.com.pk | operations | operations_supervisor, bizdev | updated | True |

## Notes
- HCM stores one `role` per user; overlapping MD roles are merged via primary role + permissions.
- `payroll` MD role → HCM `payroll_initiator` modules on finance_manager.
- `procurement` MD role → HCM `procurement_manager`.
- `operations_team` → HCM `operations`.
- `operations_supervisor` / `bizdev` → HCM `operations_supervisor` (new role).
