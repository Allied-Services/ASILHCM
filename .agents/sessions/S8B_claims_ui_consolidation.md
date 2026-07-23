# S8B — Claims UI consolidation

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 3. Backend edits: all tiers green before push.
> 4. Work on `staging`; verify; merge to `main`.
> 5. This session executes THIS FILE ONLY.
> 6. Blocked after 3 attempts → `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual outputs.

## Objective
From 4+ overlapping claims UIs to a clear two-surface model: **intake workbenches** (get claims INTO employee_claims) and **one approval queue** (decide them).

## Target state
- `WafiClaimsDashboard.jsx` — KEPT as the Wafi email/Excel intake workbench (its parsing/verify/stage tooling is genuinely valuable). Its terminal action is S1B's stage-to-claims.
- `features/claims/ClaimsQueue.jsx` — KEPT and becomes THE single approval queue over `employee_claims` regardless of source_kind (portal/wafi/email), with filters by source, status, contract, period.
- `features/claims/PortalClaimsHub.jsx` + public `ClaimsFillPage.jsx`/`ClaimsApprovePage.jsx` — KEPT (employee/focal-facing surfaces).
- `EmailClaimsListener.jsx` — RETIRED: its useful functionality (viewing intake_messages, manual poll trigger) either already exists in the intake admin module UI or moves into a small panel inside ClaimsQueue. Grep-prove what it uniquely does before deleting; port the unique parts, delete the rest, remove its tab from `App.jsx`.

## Steps
1. Audit what each surface uniquely does (grep routes each one calls); write the mapping in your report before touching code.
2. Extend ClaimsQueue with the source_kind/status/contract/period filters and cross-source list (backend list endpoint may need a filter param — module route + api.js function per checklist).
3. Port unique EmailClaimsListener features; delete the component + its tab + its private fetch helper.
4. Update ROLE_NAV in `App.jsx` (remove the dead tab from every role list — remember the superadmin list is duplicated in two places).

## Verification checklist
- [ ] `npm run build` green; no eslint regressions on touched files.
- [ ] Staging: a wafi-staged claim, a portal claim, and an email claim all visible and filterable in ClaimsQueue; approval from the queue works for each.
- [ ] `git grep -n "EmailClaimsListener" frontend/src` → no matches.

## Rollback
`git revert`.
