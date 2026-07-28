# S5B3 — Contract policy overhaul: every contract gets real, signed-off, UI-editable payroll rules

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first; `.agents/REMEDIATION_PLAN.md` amendments apply.
> 3. Backend edits: all test tiers green before push. 4. All work on `staging`; prod policy seeding ONLY after MD sign-off (last step, explicit gate). 5. THIS FILE ONLY. 6. Blocked ×3 → `BLOCKED.md`, STOP. 7. End with Verification checklist + real outputs.

## Why
June-26 alignment worked by CLONING the Wafi FM policy onto BPO, FM Trading, and PSO conservancy contracts — expedient, but wrong as configuration (the PSO OT divisor bug in S5B1 is the direct proof: cloned 26×8 vs actual 30×8@1×). Payroll can only run autonomously when each contract's real rules live in `contract_policies` and the MD has signed them.

## Steps
1. **Policy truth table.** Build `audit/policy_signoff_june26.md`: one row per active contract × the policy fields that drive pay: `working_days basis (26/30/calendar) | ot_allowed | ot tiers used (1×/2×/3×) | ot_divisor_days × ot_divisor_hours | monthly OT cap | PF rule (e.g. salary/24? actual per Excel col AG) | EOBI (400 flat) | SESSI/PESSI applicability by province | income tax (engine slabs vs contract WHT %) | medical/OPD cap | service_charge_pct | sales_tax + exemption | invoice_frequency | credit_days`. Fill each cell from EVIDENCE: the June-26 workbook per BU (derive numerically like S5B1 did for PSO OT), existing prod policy (Wafi FM), and contract documents where the MD supplies them. Mark every cell as `VERIFIED (source)` or `ASSUMED (needs MD)`.
2. **MD sign-off pass.** Present the table to the MD; they confirm/correct every ASSUMED cell. The signed table is committed and becomes the configuration source of truth.
3. **Apply on staging.** Update `contract_policies` (and `contract_rate_cards` where billing rates were involved) to the signed values via the admin surface (not psql). Recompute June-26: variance must REMAIN zero with the real policies (this catches any case where cloned-policy values were silently load-bearing).
4. **Policy editor UI.** Extend the contract-policy editing surface (`features/contracts/ContractOps.jsx` or where `contract_policies` is edited today) to expose ALL fields from the truth table with the current value, an edit control (role-gated: superadmin + finance_manager), and inline field help stating what each does to pay. Include the `payroll_engine` flag (S6B) and the leave policy (existing `contract_leave_policies` editor) so a contract's full rulebook is ONE screen. Every change writes `logAudit`.
5. **Policy completeness guard.** `POST /api/payroll-runs/compute` for a contract with NO `contract_policies` row must fail loudly with `POLICY_MISSING` (409) instead of silently computing with defaults — the June root-cause #1 (BPO/FM Trading had no policy → 0 rows) must be structurally impossible to miss again. tests-int case for it.
6. **Prod readiness note (do NOT execute):** list the exact INSERT/UPDATE set that will seed prod policies after sign-off, as a script `scripts/seed_prod_policies.sql` with a header requiring the MD gate. Running it is a later, explicitly authorized step.

## Verification checklist
- [ ] `audit/policy_signoff_june26.md` committed, zero ASSUMED cells remaining after MD pass.
- [ ] Staging June-26 recompute with signed policies: variance still zero (S5B1 harness re-run output pasted).
- [ ] Policy editor screenshot per contract; a test edit round-trips and appears in `audit_log`.
- [ ] Compute against a policy-less dummy contract → 409 POLICY_MISSING (tests-int green).
- [ ] `scripts/seed_prod_policies.sql` exists, NOT run; prod `contract_policies` untouched (prove with a read query).
