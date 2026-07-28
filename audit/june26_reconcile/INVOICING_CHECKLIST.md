# June 2026 Staging — Invoicing Checklist (Owner Guide)

**Last updated:** 2026-07-28  
**Environment:** [ASIL HCM Staging](https://asil-hcm-frontend-staging.onrender.com) (not production)

---

## What you need to do on the staging website

After payroll parity is confirmed (net delta Rs 0 on coded employees), update **contract policies** for each client contract that has June payroll:

1. Log in to **staging** as `superadmin` or `finance_manager`.
2. Go to **Client Information** → open the client → select the contract.
3. In **Contract Policies**, verify or set:
   - **PF** (Provident Fund accrual / deduction rules)
   - **Gratuity** accrual months
   - **Uniform** allowance (if applicable)
   - **SESSI** (employer contribution)
   - **Service charge %** (typically 18%)
   - **Sales tax** rate / exempt flag
   - **OT** divisor (PSO contracts: 30 days × 8 hours @ 1×)
4. Save each contract policy before moving to the next contract.

Contracts with June 2026 active employees (as of last compute):

| Client | Contract | Notes |
|--------|----------|-------|
| Wafi Energy Pakistan | Facility Management | Main sheet (~300+ employees) |
| Pakistan State Oil | Janitorial Services | PSO operational sheet |
| Other FM/BPO contracts | Various | See `june26_compute_all.js` output |

> **Do not invoice until policies are saved.** Invoice totals (service charge, sales tax, SESSI) come from `contract_policies`.

---

## What the agent / scripts run (after you save policies)

Run these in order from `C:\Projects\ASILHCM-Staging`:

```powershell
cd C:\Projects\ASILHCM-Staging

# 1. Ensure override columns exist on staging DB
node audit/apply_override_migration.js

# 2. Re-seed June Excel overrides (paid days, OT, PF, WHT)
node audit/seed_june26_from_master.js --execute

# 3. Recompute all contract payroll runs for June 2026
node audit/june26_compute_all.js

# 4. Verify parity against Excel workbook
node audit/june26_reconcile.js

# 5. Dry-run invoicing readiness (no changes)
node audit/invoicing_june26_staging.js

# 6. Lock runs + generate invoices (only when dry-run is clean)
node audit/invoicing_june26_staging.js --execute
```

Equivalent UI flow per contract (Payroll Run tab):

1. Select contract, month **June**, year **2026** → **Compute**
2. Review row totals → **Lock**
3. **Generate Invoice** (requires locked status + contract policy)

API paths (for reference): `POST /api/payroll-runs/compute`, `POST /api/payroll-runs/:id/lock`, `POST /api/payroll-runs/:id/invoice`.

---

## Known exclusions (not blocking coded parity)

| Item | Impact on invoicing |
|------|---------------------|
| **2 Excel-only PSO employees** (ASIL/PSO-379/25, ASIL/PSO-389/25) | Not in HCM; excluded from run row counts |
| **15 cash daily wagers** (PSO rows 155–169, Rs 227,831) | Out of system until MD decides — see `cash_wagers_decision.md` |
| **Contract policy gaps** | Blocks invoice generation until policies saved on staging |

---

## Success criteria

- [ ] `june26_reconcile.js` — main sheet net delta **Rs 0** (coded employees only)
- [ ] PSO coded rows — net delta **Rs 0**
- [ ] All contract policies saved on staging UI
- [ ] `invoicing_june26_staging.js` dry-run shows no `MISSING_CONTRACT_POLICY` blockers
- [ ] `--execute` creates `client_invoices` rows and sets runs to `invoiced`
- [ ] Invoice HTML preview matches expected service charge + sales tax

---

## If something blocks invoicing today

| Blocker | Fix |
|---------|-----|
| `MISSING_CONTRACT_POLICY` | Save contract policy on staging UI (step above) |
| `EMPTY_RUN` | Re-run `june26_compute_all.js` after seed |
| Net delta ≠ 0 | Check `variance_main.csv` / `variance_pso.csv`; re-seed + recompute |
| Run already `locked` but not invoiced | Run `invoicing_june26_staging.js --execute` (skips re-lock) |
| Run already `invoiced` | No action needed |

---

## Do not

- Push to `main` until staging verification is complete.
- Invoice on production — staging only for June 2026 pilot.
- Add cash wagers to HCM without MD sign-off on `cash_wagers_decision.md`.
