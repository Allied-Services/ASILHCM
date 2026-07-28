# S5B1 — June-26 FULL alignment: fix PSO engine basis, missed rows, ghosts; re-run to zero

> **NON-NEGOTIABLE RULES — identical in every session file. Re-read before starting.**
> 1. Read `.agents/AGENTS.md` first; `.agents/REMEDIATION_PLAN.md` amendments apply.
> 2. AP confirm routes / payment INSERT logic: only with `npm run test:int` green (S2B gate).
> 3. After ANY backend edit: `node --check backend/server.js` + `npm test` + `npm run test:int` green before push. Engine changes are money changes: add/extend a `payrollParity.test.js` case FIRST, then change the engine.
> 4. All work on the `staging` branch/clone + Neon staging DB. NOTHING touches prod.
> 5. This session executes THIS FILE ONLY. 6. Blocked ×3 → `BLOCKED.md`, STOP. 7. End with the Verification checklist + real outputs.

## Step 0 — housekeeping (do first)
The June-26 engine changes currently sit UNCOMMITTED in `C:\Projects\ASILHCM-Staging`. Commit them to the `staging` branch (message: "June-26 reconciliation: engine + seed + overrides migration") and push, BEFORE any new work. Uncommitted work in a side clone is how this project lost history before.

## Independent audit findings this session must fix (verified 2026-07-26 by CTO review directly against the workbook)

**A. Six employees missed entirely.** June-26 sheet data does NOT end at row 513. Rows 514–519 are six active PSO Conservancy employees (ASIL/PSO-208, -374, -387, -376, -377, -209/25; AJ sum Rs 236,933). The sheet's own AJ grand total (row 521) is **Rs 34,637,159 = 34,400,226 (rows 4–513) + 236,933**. They are on NO other sheet. They appear in HCM's "unmatched HCM only" list — HCM computed them; the reconcile simply never compared them. Fix the reconcile row range and compare all 516.

**B. PSO "Need to Pay" is NOT a different metric — the brief's §2 explanation is wrong.** Verified: for ALL 166 PSO data rows, AJ = AE (Gross) − AI (Total Deductions = Income Tax + PF + EOBI), max deviation < Rs 1 — the identical formula as the main sheet's Net Pay. There is no hidden disbursement logic. Remove that claim from any docs; the gap has concrete computational causes:
   1. **OT hourly divisor.** Excel PSO: OT amount X = hrs × salary/(30×8) at 1× (verified: Abdul Mateen 67.5 hrs × 60,000/240 = 16,875 exactly). HCM used the cloned Wafi divisor 26×8=208 → 19,471 (+2,596 — exactly the delta_gross in variance_pso.csv row 1). Summed over the 145 OT rows this explains ~Rs 204k of the ~Rs 188k total PSO gap (variance_summary.md PSO section: net delta −188,448 — note: the CTO brief's "60,203" figure does not match your own summary artifact; reconcile which run produced which). **Fix via config, not code:** `contract_policies.ot_divisor_days/hours` already exist — set the PSO contracts to 30 × 8, OT tier 1×. If the engine's ot1 path doesn't read the policy divisor, fix the engine (parity test first).
   2. Residual per-row deltas (EOBI on 31 rows, arrears/allowances) — triage per S5B rules (CONFIG / INPUT / ENGINE) row by row after the divisor fix.

**C. 15 cash daily wagers excluded.** PSO sheet rows 155–169 have names but no employee codes; their AJ sum is **Rs 227,831 = exactly the "PSO Cash Daily Wages" payment group** in the main sheet's summary block. Decide with the MD: either create employee records (recommended: temp-wager employee type) or explicitly log them as out-of-system cash payroll. They cannot silently vanish — total June disbursement is Rs 41,814,871 (34,637,159 main + 7,177,712 PSO), and HCM must account for all of it.

**D. Duplicate row: `ASIL/PSO-329/25` appears TWICE on the PSO sheet.** Determine (with the payroll team) whether it's a double-payment error in Excel or two part-month stints; handle explicitly in seed + reconcile (sum the two rows for comparison if legitimate).

**E. 15 ghost employees.** HCM computed June pay for 15 employees on NO June sheet (both summary sections list them): ASIL/SPL-360/21, SPL-46/21, SPL-408/21, SPL-388/21, PSO-018/25, PSO-030/25, ASILFM/SPL/22/{142,141,81,125,40}, PSO-180/25, PSO-192/25, PSO-386/25, PSO-298/25. Check each against Master Data `Active` and resignation data: mark inactive/left in staging `employees` so compute excludes them, or if genuinely active-but-unpaid, flag to the MD. A go-live engine must produce rows for exactly the payable roster — no extras.

**F. Rounding to the rupee.** Excel rounds at component level (U, X, AE are integers; AJ is an integer). 126 employees still show ±Rs 1. Derive the exact per-column rounding from the workbook (U = ROUND(R×T/S), X = ROUND(...), AJ = ROUND(AE−AI) — verify against cells) and replicate in the engine so the target is **exact 0 on every field**, not ±1.

## Definition of done for this session
Re-run seed (fixed ranges) + compute + reconcile. Required results, pasted as real output:
- Main sheet: **516/516 rows** (4–519), every field delta = 0, totals match Rs 34,637,159.
- PSO sheet: **all coded rows** (incl. the PSO-329 duplicate handled) delta = 0, plus a documented decision on the 15 cash wagers; coded total matches Rs 6,949,881.
- Zero unmatched rows in EITHER direction (ghosts resolved).
- `payrollParity.test.js` extended for: 30×8 OT divisor @1×, component rounding. All three test tiers green.
- Updated `audit/june26_reconcile/` artifacts + a corrected brief note (retract the "Need to Pay is a different metric" claim).
