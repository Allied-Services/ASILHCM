# HCM team accounts setup (Build 6)

**Environment:** https://asilhcm.onrender.com  
**Do not commit passwords or magic links in git.**

## Super Admin: create users

1. Sign in as **superadmin** (or **finance_manager** / **finance_approver** with User Management access).
2. Sidebar -> **User Management**.
3. **Add User** -> enter work **email** and **role** -> submit.
4. New user signs in with Google; if role was `pending`, Super Admin sets role on the user row (dropdown) and user re-logs in.
5. Optional: expand **Permissions** on a user to override module access (superadmin only for custom permission JSON).

**Who can manage users (API):** `superadmin`, `finance_approver`, `finance_manager` (`USER_MGMT_ROLES` in `backend/server.js`). Only **superadmin** may assign `superadmin` or edit custom permissions.

## Valid roles (server)

`superadmin`, `operations`, `procurement_proposer`, `procurement_approver`, `finance_proposer`, `finance_approver`, `ap_team`, `ar_team`, `payroll_initiator`, `procurement_manager`, `finance_manager`, `supervisor`, `hr_manager`, `admin`, `pending`

## Role -> key API permissions (summary)

| Role | Primary write actions in HCM |
|------|----------------------------|
| **finance_manager** | AP queues, FM bill batch approval, client BUs, config (with FA), user mgmt, AR/AP read paths |
| **finance_approver** | Approve invoices & bills, lock/unlock payroll, user mgmt, config |
| **finance_proposer** | Create invoices & payroll months, create bills |
| **ar_team** | Client invoices, POs, push Xero, bill->invoice |
| **ap_team** | Confirm payroll queue & bills queue payments |
| **procurement_proposer** | Create bills |
| **procurement_approver** | Approve/reject bill status |
| **payroll_initiator** | Change requests approve/reject; payroll run with operations |
| **operations** | Change requests, attendance, contracts intake |
| **superadmin** | All admin routes, void Xero, imports, audit log |

Sidebar modules per role are defined in `frontend/src/App.jsx` (`ROLE_NAV`).

## Go-live roster (MD Operational Mandates §1)

| Role (MD) | HCM primary role | Email | Notes |
|------|------------------|-------|-------|
| finance_manager | finance_manager | huzaifa.rafaqat@asil.com.pk | Also covers ar_team + payroll modules |
| ar_team | *(via finance_manager)* | huzaifa.rafaqat@asil.com.pk | Same mailbox — permissions expanded |
| ap_team | *(via procurement_manager)* | laiba.mughal@asil.com.pk | Same mailbox |
| procurement | procurement_manager | laiba.mughal@asil.com.pk | |
| payroll | *(via finance_manager)* | huzaifa.rafaqat@asil.com.pk | July parallel run owner |
| finance_approver | finance_approver | asif.awan@asil.com.pk | Manual Paid status co-authorised with MD |
| operations_team | operations | Obaid.rana@asil.com.pk | |
| operations_supervisor | operations_supervisor | rabia.bhutto@asil.com.pk | |
| bizdev (BD) | *(via operations_supervisor)* | rabia.bhutto@asil.com.pk | BD pipeline access |

Provision script: `scripts/provision_workspace_roster.py`  
Startup seed in `backend/server.js` enforces these roles on every deploy.


## One-pager guides

| Role | Doc |
|------|-----|
| finance_manager | [team_guide_finance_manager.md](./team_guide_finance_manager.md) |
| ar_team | [team_guide_ar_team.md](./team_guide_ar_team.md) |
| ap_team | [team_guide_ap_team.md](./team_guide_ap_team.md) |
| procurement_proposer | [team_guide_procurement_proposer.md](./team_guide_procurement_proposer.md) |
| payroll_initiator | [team_guide_payroll_initiator.md](./team_guide_payroll_initiator.md) |

## Live user census (optional)

Attempted `GET /api/users` with `C:\temp\hcm_jwt.txt` on 2026-07-09 -> **401 Unauthorized** (token expired). Re-run after fresh superadmin JWT:

``powershell
$token = (Get-Content C:\temp\hcm_jwt.txt -Raw).Trim()
Invoke-RestMethod -Uri https://asilhcm.onrender.com/api/users -Headers @{ Authorization = "Bearer $token" }
``

Record emails and roles in the roster table above; do not paste tokens in the repo.