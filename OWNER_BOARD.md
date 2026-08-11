# OWNER BOARD — ASIL HCM
> Living scoreboard for the owner. Agents must read and update this.
> Last updated: 2026-08-11 · Keep under ~100 lines. Plain English only.

---

## MISSION (one framing — expanded scope)
**Make ASIL HCM trustworthy end-to-end: contract → people → correct pay → payslip in hand — starting with one pilot payroll month, then rolling out the rest.**

STATUS: **AMBER** (server Calculate path shipped; July live proof still pending)  
LIVE: prod API healthy (`/health` 200, commit `a89cc05`, migrations ok — checked 2026-08-11).

**Full audit:** `docs/OWNER_VISION_AUDIT.md`  
**Track B plan:** `docs/TRACK_B_HRMS_UNIFICATION_PLAN.md`

---

## TOP LINE (for agents / morning brief)
Payroll Sheet **server-only Calculate** is live (PRs #44–#46). July Wafi still needs **Unlock → Calculate** on staging/prod to prove SPL-208 / SPL-91. PSO Fixed Value and Wafi portal must stay untouched.

---

## STILL OPEN (do not bury these)

### Payroll (P0)
1. **July Wafi live proof** — after Calculate: SPL-208 net 89,700; SPL-91 net 194,808 / tax 780
2. **S5B shadow month** — pilot Excel vs HCM zero variance
3. **Two payroll brains** — sheet uses server engine for money; World A AP path still pays; World B PSO unchanged
4. Track B full unification — plan written; not started as build

### Owner vision gaps (P1)
5. Pending claims panel before Calculate
6. Portal payslips for World B employees
7. Payslip branding / logo

### Parked
8. Imprest, Xero live connect, World A retirement, paid worker

---

## IN PROGRESS
- Waiting on owner live proof: Unlock July → Calculate (staging, then prod)

## JUST SHIPPED
- Forever fix: Payroll Sheet server-only Calculate (PR #44)
- Hotfix: Calculate 500 + Payroll Sheet white-screen (PRs #45, #46)
- Track A tax rule PR #41; Payslip delivery PR #43

---

## BLOCKED ON YOU
- Staging then prod: Unlock July → Calculate (with Pull approved claims) → confirm anchors
- Red phrase required before any bulk prod payroll rewrite if asked outside Calculate UI

---

## LOCKED DECISIONS
| Decision | Until / rule |
|----------|----------------|
| Prove payroll month before broad feature work | PARKED unless unblocks proof |
| Branch + PR only; never push `main` | Always |
| Staging before production | Verify on staging; then merge |
| World A AP path keeps paying until cutover | Do not break AP confirm |
| Money routes need tests green | `npm test` (+ int when AP touched) |

**Override phrase (owner):** `Override lock: [decision] — [why]`

---

## CLOSE CRITERIA (Phase 1)
- [ ] July Wafi: Calculate yields Excel nets (SPL-208 / SPL-91)
- [ ] Pilot shadow month zero variance (S5B)
- [ ] Owner plain "all clear" with live proof
