# OWNER BOARD — ASIL HCM
> Living scoreboard for the owner. Agents must read and update this.
> Last updated: 2026-08-10 · Keep under ~100 lines. Plain English only.

---

## MISSION (one framing — expanded scope)
**Make ASIL HCM trustworthy end-to-end: contract → people → correct pay → payslip in hand — starting with one pilot payroll month, then rolling out the rest.**

STATUS: **AMBER** (server Calculate path built for Payroll Sheet; July live proof pending staging Calculate)  
LIVE: prod API healthy (`/health` 200).

**Full audit:** `docs/OWNER_VISION_AUDIT.md`  
**Track B plan:** `docs/TRACK_B_HRMS_UNIFICATION_PLAN.md`

---

## TOP LINE (for agents / morning brief)
Payroll Sheet is moving to **server-only Calculate** (no browser money math). July Wafi still needs **Unlock → Calculate** on staging/prod to prove SPL-208 / SPL-91. PSO Fixed Value and Wafi portal must stay untouched.

---

## STILL OPEN (do not bury these)

### Payroll (P0)
1. **July Wafi live proof** — after Calculate: SPL-208 net 89,700; SPL-91 net 194,808 / tax 780
2. **S5B shadow month** — pilot Excel vs HCM zero variance
3. **Two payroll brains** — sheet now uses server engine for money; World A AP path still pays; World B PSO unchanged
4. Track B full unification — plan written; not started as build

### Owner vision gaps (P1)
5. Pending claims panel before Calculate
6. Portal payslips for World B employees
7. Payslip branding / logo

### Parked
8. Imprest, Xero live connect, World A retirement, paid worker

---

## IN PROGRESS
- **FOREVER FIX:** Payroll Sheet `POST /api/payroll/:year/:month/calculate` + Calculate button (ship card pending)

## JUST SHIPPED
- Track A tax rule PR #41 (exclude bonus lump from monthly WHT)
- Payslip delivery PR #43

---

## BLOCKED ON YOU
- Reply **yes / no** on ship card for server-Calculate PR
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
