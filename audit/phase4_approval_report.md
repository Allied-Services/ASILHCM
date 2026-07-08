# Phase 4 ApprovalMax — backend report

**Date:** 2026-07-08  
**Branch:** main (after Phase 4 backend increment)  
**Reference:** Approval Max Hierarchy PDF (Allied ERP template)

## Completed (this run)

- Idempotent migration `backend/migrations/20260708120000_bill_approval.js`: `bill_approval_steps` table; bills approval columns (`approval_status`, submit metadata, focal account, completed timestamp).
- `system_config` seeds: `bill_approval_rules` (Bhakkar FM-106 focal + step-1 approver; PKR 100k threshold step-2 routing Asif / Shezad); `BILL_APPROVAL_DRY_RUN` default `true`.
- Module `backend/src/modules/billApproval/`: submit, focal-action GET/POST (claims token pattern), approval-status API.
- Registered in `backend/mountModules.js`.
- Jest unit tests for threshold routing and Bhakkar focal/step-1 rules.

## Flow (backend)

1. Site focal (per `bill_approval_rules`) POST `/api/bill-approval/:billId/submit`.
2. Step 1: all configured line-manager approvers must approve via email link `/api/bill-approval/focal-action`.
3. Step 2: amount threshold — Asif Awan &lt;100k PKR, Shezad Mumtaz ≥100k PKR.
4. Final approval sets `approval_status=approved` and bill `status=Approved`.

## Pending (next run)

- Frontend: approval status on Bills / Xero review queue UI.
- Live dry-run off + MD sign-off before emailing production Wafi approvers.

## Ops notes

- Google Drive workspace copy may be out of disk; work committed from `C:\temp\bpofm-phase4-work` clone — `git pull` on `G:\My Drive\Experiments\BPOFMSystem` when space available.
- Jest: run from `C:\temp\bpofm-backend` or sync backend and `npm test -- billApproval`.
- Frontend complete.
