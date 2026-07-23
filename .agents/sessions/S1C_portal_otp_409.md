# S1C — Portal OTP: replace the silent 404 with actionable errors + readiness report

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. NEVER modify `POST /api/ap/payroll-queue/:year/:month/confirm`, `POST /api/ap/bills/:id/confirm`, `PATCH /api/ap/batches/:batchId/fm-approve`, or any existing `payment_batches`/`payment_ledger` INSERT logic until the Phase 2 integration tests (S2B) exist and pass.
> 3. After ANY backend edit: `node --check backend/server.js` and `npm test` (in `backend/`) must pass. Once Phase 2 lands: `npm run test:int` must also pass before pushing anything touching `/api/ap/*`, `/api/payroll*`, `payment_*`, `payroll_run*`, or `employee_claims`.
> 4. Work on the `staging` git branch, deploy to the staging Render service, verify, THEN merge to `main`. Never push an unverified payroll change to `main` (it auto-deploys to production).
> 5. This session executes THIS FILE ONLY. No opportunistic refactors. Out-of-scope problems go in your report, not in the diff.
> 6. Blocked after 3 attempts on a step → write details to `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs into your report.

## Background
Portal OTP auth (`POST /api/portal/request-otp` server.js ~2583, `POST /api/portal/verify-otp` ~2633) is fully implemented — the reason "the portal never worked" is data, not code: `verify-otp` matches employees by `employee_id` or normalized `primary_contact` and requires `active='Yes'` (~2666, ~2673). Any employee with a missing/misformatted phone, missing email, or a different `active` value gets a generic 404 **after entering a valid OTP**, with no way to know why. With 633 imported employees, contact data is patchy, so most login attempts dead-end silently.

## Steps
1. In `verify-otp`: when the OTP itself is valid but the employee lookup fails, return **409** with a machine-readable code and human message, distinguishing: `EMPLOYEE_NOT_FOUND` (no match at all), `EMPLOYEE_INACTIVE` (matched but `active` ≠ 'Yes'), `CONTACT_MISMATCH` (OTP contact resolves to no employee). Do not leak other employees' data in the message. Keep an invalid/expired OTP as the existing 4xx.
2. In `request-otp`: if the identifier matches an employee with NO deliverable contact channel (no email and no usable `primary_contact`), return 409 `NO_CONTACT_CHANNEL` with message "Contact HR to update your phone/email" instead of pretending to send.
3. `frontend/src/EmployeePortal.jsx`: surface these messages verbatim in the login UI (it already handles a 409 duplicate-phone case — follow that pattern).
4. New route `GET /api/admin/portal-readiness`, `requireAuth` + `requireRole('superadmin')`, per AGENTS.md §3.1 checklist (generic 500s, parameterized queries, added to `frontend/src/api.js` as `getPortalReadiness`): returns `{total_active, ready, missing_contact: [{id, name, contract_name, has_email, has_phone}...]}` — active employees lacking both email and `primary_contact`. Add a simple readout in the admin UI ONLY if a natural spot exists in `UserManagement.jsx` or `SystemConfig.jsx`; otherwise API-only this pass (note the choice in your report).
5. Extend `backend/tests/` portal-auth suite with the new 409 paths (mocked pool is fine here — these are contract tests).

## Verification checklist
- [ ] `npm test` green including new cases; `node --check backend/server.js` clean.
- [ ] Staging: request-otp for a staging employee with contact data works end-to-end IF a mail/SMS provider were configured — on staging (providers unset) verify the code path by checking the OTP row is persisted and the send failure is logged gracefully, not a 500.
- [ ] Staging: verify-otp with a valid OTP but an inactive employee returns the 409 with `EMPLOYEE_INACTIVE` (manufacture the case via psql on staging data).
- [ ] `GET /api/admin/portal-readiness` as superadmin returns counts consistent with a manual psql spot-check; as a non-superadmin returns 403.

## Rollback
`git revert`.
