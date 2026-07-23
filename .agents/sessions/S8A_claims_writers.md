# S8A — Consolidate all claims writers onto employee_claims (STRICTLY after S7R)

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 3. `node --check` + `npm test` + `npm run test:int` green before push (claims feed payroll).
> 4. Work on `staging`; verify; merge to `main`.
> 5. This session executes THIS FILE ONLY.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual outputs.

## Why the wait
`backend/src/modules/claims/portalService.js` (~lines 1345 and 1520) and server.js ~6517 write approved claim hours directly into `payroll_transactions` (with correct columns). Before S7R those writes fed live World A months — touching them earlier would have broken running payroll. Now `payroll_transactions` is history-only, so these writers must move to the one store the engine reads.

## Steps
1. Rewrite the three write sites to insert `employee_claims` rows (status `focal_approved`, `source_kind='portal'` or `'email'`, idempotency via the S1B unique index pattern using their own session/request ids in `source_session_id`/`source_ref`) — mirror S1B's shapes exactly: overtime → `{ot1|ot2|ot3: hours}`, medical/expense → `{amount}`.
2. Delete the `payroll_transactions` writes from those sites. Grep to confirm: after this session the ONLY writers to `payroll_transactions` are the (now-410'd) legacy routes and the history importers — i.e. no live code path writes it.
3. Update the phase2/portal mocked tests that asserted the old call sequences (AGENTS.md changelog notes `phase2.test.js` has a chained mock-sequence test for `GET /api/leave/action/:token` — keep its expectations aligned with the new writes).
4. tests-int: extend the S2C fixture flow — a portal-approved claim and an email-approved claim both land in `employee_claims` and are consumed by the next compute.

## Verification checklist
- [ ] `git grep -n "INSERT INTO payroll_transactions" backend/ | grep -v tests` → only importer scripts/history paths remain (list them in the report).
- [ ] All three tiers green.
- [ ] Staging: portal claim → focal approval → appears in the next computed run for that employee.

## Rollback
`git revert`.
