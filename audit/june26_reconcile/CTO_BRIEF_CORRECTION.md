# CTO Brief Correction — PSO "Need to Pay" (S5B1)

**Retracted:** The prior agent brief stated that PSO Operational column AJ ("Need to Pay") is a different metric from net pay.

**Corrected (CTO audit 2026-07-26):** For all coded PSO rows, **AJ = AE (Gross) − AI (Total Deductions)** — the same formula as main-sheet net pay. Max deviation < Rs 1 across 166 data rows.

**Root cause of PSO variance:** HCM used OT divisor **26×8** (cloned Wafi FM policy) while Excel PSO uses **30×8 at 1×**. Fixed via `contract_policies.ot_divisor_days=30`, `ot_divisor_hours=8` on all PSO contracts.

**Cash wagers (rows 155–169):** See `cash_wagers_decision.md` — Rs 227,831 out-of-system pending MD gate.

**S5B1 progress (2026-07-28):**
- Seed/reconcile extended to June-26 rows 4–519 (516 employees); PSO duplicate `ASIL/PSO-329/25` aggregated with second-row gross as arrears.
- Engine: Model A always used when monthly overrides present; optional `eobi_employee` override per row; PSO merge no longer clobbers June `new_salary` with null.
- **Remaining variance:** Main sheet net delta Rs 15,491 (28 employees with non-zero net); mostly early PSO Janitorial rows on main sheet vs HCM OT inputs. PSO sheet: SESSI employer column (AL) vs engine cap still flags non-net fields; net on coded rows largely within Rs 1 after EOBI override.
