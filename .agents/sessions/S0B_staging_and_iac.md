# S0B — Staging environment + render.yaml + jobs decision

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first. Its guardrails apply except where `.agents/REMEDIATION_PLAN.md` explicitly amends them.
> 2. NEVER modify `POST /api/ap/payroll-queue/:year/:month/confirm`, `POST /api/ap/bills/:id/confirm`, `PATCH /api/ap/batches/:batchId/fm-approve`, or any existing `payment_batches`/`payment_ledger` INSERT logic until the Phase 2 integration tests (S2B) exist and pass.
> 3. After ANY backend edit: `node --check backend/server.js` and `npm test` (in `backend/`) must pass. Once Phase 2 lands: `npm run test:int` must also pass before pushing anything touching `/api/ap/*`, `/api/payroll*`, `payment_*`, `payroll_run*`, or `employee_claims`.
> 4. Work on the `staging` git branch, deploy to the staging Render service, verify, THEN merge to `main`. Never push an unverified payroll change to `main` (it auto-deploys to production).
> 5. This session executes THIS FILE ONLY. No opportunistic refactors. Out-of-scope problems go in your report, not in the diff.
> 6. Blocked after 3 attempts on a step → write details to `BLOCKED.md` and STOP.
> 7. End by executing the Verification checklist and pasting actual command outputs into your report.

## Objective
End the "every push goes straight to production" era. Create a full staging lane (git branch + Neon DB branch + Render services) and capture the deployment as code. Some steps are dashboard actions the MD must perform — give them exact click-by-click instructions and wait for confirmation.

## Steps
1. **Neon** (MD or Composer via Neon console/CLI): create two branches off the production branch: `staging` and `ci-test`. Record both connection strings privately (never committed).
2. **Git:** create branch `staging` from `main`, push it.
3. **Render (MD, dashboard):**
   - New free web service `asil-hcm-staging`: same repo, branch `staging`, root `backend/`, same build/start commands as the prod backend. Env vars: copy from prod BUT `DATABASE_URL` = Neon `staging` branch string, and **leave UNSET all of:** `RESEND_API_KEY`, all `JAZZ_*`, all `GMAIL_*`, all `INTAKE_EMAIL_*`, all `XERO_*`. This guarantees staging can never email/SMS real employees or touch real Xero. If server startup hard-fails on any of these being missing, that specific failure is in-scope: make the affected feature degrade gracefully (log a warning, disable the feature) rather than crash — smallest possible edit, and note it in the report.
   - New free static site `asil-hcm-frontend-staging`: branch `staging`, root `frontend/`, build `npm run build`, publish `dist/`, env `VITE_API_URL=https://asil-hcm-staging.onrender.com`.
4. **render.yaml:** commit a `render.yaml` at repo root describing all four services (prod backend, prod static site, staging backend, staging static site) with their build/start commands, plans, and non-secret env vars (`sync: false` for secrets). Even if Render isn't switched to Blueprint-managed deploys yet, this file is the written record of infrastructure.
5. **Jobs decision (document only):** `JOBS_RUNNER` stays `web` — pg-boss crons keep running in-process (Render background workers are paid; no scheduled job is on the payroll-compute critical path). Add a short "Ops" note to `.agents/AGENTS.md`: current mode, its limitation (crons only fire while the free dyno is awake), and the upgrade path ($7 Render worker running `worker.js` with `JOBS_RUNNER=worker`, planned Phase 9).
6. Seed staging DB: restore the S0A backup into the Neon `staging` branch so staging has realistic data.

## Deletions
None.

## Verification checklist
- [ ] `https://asil-hcm-staging.onrender.com/health` returns OK.
- [ ] Staging frontend loads and can log in (Google OAuth may need the staging URL added to the OAuth client's authorized origins — walk the MD through it; if blocked, note it and verify via API with a JWT instead).
- [ ] Write test: create a throwaway vendor via the staging UI/API; confirm via psql it exists in the Neon `staging` branch and does NOT exist in prod. Delete it.
- [ ] `render.yaml` committed; `npm test` and `node --check backend/server.js` still green.

## Rollback
Delete the staging Render services and Neon branches. Production is untouched by this session.
