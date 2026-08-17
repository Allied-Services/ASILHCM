# OWNER BOARD — ASIL HCM
> Living scoreboard for the owner. Agents must read and update this.
> Last updated: 2026-08-13 · Keep under ~100 lines. Plain English only.

---

## MISSION (one framing — expanded scope)
**Make ASIL HCM trustworthy end-to-end: contract → people → correct pay → payslip in hand — starting with one pilot payroll month, then rolling out the rest.**

The first proof point is unchanged: **one real month for the pilot contract (38 employees, Facility Management) where HCM matches Excel and pays correctly.** Everything else in your vision (portal, claims, imprest, Xero, OCR) queues behind that proof unless it directly blocks it.

STATUS: **AMBER** — Calculate forever-fix shipped (#44–#50); July Wafi Unlock → Calculate live proof still open.  
LIVE: prod API healthy (`/health` 200, migrations ok, commit `3f1b248`); July payslip test-run deploy (#53) merged 2026-08-12.

**Full audit:** `docs/OWNER_VISION_AUDIT.md`  
**30-day agent plan:** `docs/AUTONOMOUS_EXECUTION_PLAN.md`

---

## TOP LINE (for agents / morning brief)
**Next proof:** Unlock July → Calculate on staging, then prod; confirm SPL-208 / SPL-91 nets. Calculate OT wipe is fixed on main (#48). Pilot Excel export still blocks S5B shadow month. No open work PR needs a yes today.

---

## STILL OPEN (do not bury these)

### Payroll (P0)
1. **S5B shadow month** — pilot Excel vs HCM must reach zero variance; blocked on payroll team CSV export (`BLOCKED.md`)
2. **S5C** — no production pay through new engine yet
3. **Two payroll brains** — World A (browser) vs World B (server); risk of conflicting numbers until S6B engine flag exists
4. **June 2026 reconciliation** — may be ahead in `C:\Projects\ASILHCM-Staging`; not merged here (S5B1–S5B3)

### Owner vision gaps (P1 — after pilot proof)
5. **Portal payslips** — portal reads old pay table only; new-engine employees would see nothing
6. **Claims** — four intake paths; not one configurable "who claims / who approves" UI
7. **Payslip branding** — Allied logo work shipped (#58/#59); confirm live look on a real send
8. **Nothing is automatic** — compute, lock, disburse, email each need a human click

### Infrastructure / ops
9. **Staging cold starts** — free tier sleeps; verify after wake before calling staging "broken"
10. **Local tests on GDrive** — `jest` node_modules corrupt; use temp clone or CI for counts
11. **Morning brief Automation** — weekday cron on; **email delivery still not connected**

### Parked until mission gate clears
12. **Imprest workflow** — bill type exists; no dedicated process
13. **Xero superiority** — OAuth/sync code exists; not connected without your credentials + approval
14. **World A retirement (S7R)** — only after pilot paid through new path
15. **Paid background worker (Phase 9)**

---

## IN PROGRESS
- Portal Claims Response board (July work vs August sheet, OTHER DATA import block) — branch `feat/portal-claims-response`
- BPO / PSO contract matching on staging (separate track — do not block)
- **PSO July invoice lines** — live Drafts corrected 2026-08-15 (Sihala 32,002; Chakpirana line 6 + Rasab; Juglot 16,493; Faqirabad Akbar on Technical). Print matcher on `fix/pso-invoice-line-matching` (not on prod UI until merge)

## JUST SHIPPED (recent)
- **Calculate forever-fix + OT wipe fix** — #44–#50 on main (server Calculate; sheet OT preserved)
- **July payslip test-run → prod** — #53 merged 2026-08-12
- **Payslip / snapshot / Send Payslips UI** — #55–#63 (logo, scope, SMS/PDF path)
- **FV invoice + lock-scope work** — #64–#67

---

## BLOCKED ON YOU
- **July live proof:** Unlock → Calculate on staging then prod; check SPL-208 / SPL-91
- Payroll team **Excel export** for pilot shadow month (S5B) — see `scripts/VARIANCE_INPUT_FORMAT.md`
- **MD sign-off** on zero-variance report before any production pay through new engine
- **Go red:** production disbursement, prod engine-flag flip, Render secrets (Resend, Jazz, OpenAI, Xero)
- Connect **morning email** on the Automation (briefs still cannot send)
- Reply **yes / no / change …** on any open ship card

---

## WHAT WORKS TODAY (short list)
- Production API up; old Payroll Sheet + AP payment path pays staff
- New payroll engine computes server-side (Excel-validated in tests)
- Disbursement bridge coded (not used in prod yet)
- Portal OTP login coded; change requests; contact info
- Bill OCR endpoint (needs OpenAI key)
- Fixed Value / PSO contract wizard (Aug 2026)
- Variance comparison tool for pilot contract

---

## LOCKED DECISIONS (do not reopen without override)
| Decision | Until / rule |
|----------|----------------|
| Prove pilot month before broad feature work | New ideas → PARKED unless they unblock pilot |
| Branch + PR only; never push `main` | Always |
| Staging before production | Verify on staging; then merge |
| World A keeps paying until cutover says otherwise | Do not break old pay path |
| No "done" without live evidence | URL / count / screenshot |
| Morning digests = email only | No SMS / WhatsApp / Twilio |
| Money routes need tests green | `npm test` + `npm run test:int` |
| Do not interfere with BPO staging contract work | Coordinate merges |

**Override phrase (owner):** `Override lock: [decision] — [why]`

---

## CLOSE CRITERIA (Phase 1 — pilot month)
- [ ] Pilot shadow month: zero meaningful pay difference vs Excel (S5B + MD sign-off)
- [ ] Pilot month paid through new engine; bank file from HCM (S5C)
- [ ] World A still works as fallback for other contracts
- [ ] Owner received plain "all clear" brief with proof

**Phase 2+ (full vision)** — see `docs/OWNER_VISION_AUDIT.md` phased table.

---

## SUGGESTIONS (optional — agents must not start these)
- Turn on weekday morning email after you like the first few briefs
- After pilot: portal payslips + logo for pilot contract employees
- After pilot: cut over next contract (same playbook)

---

## HOW TO USE
- Owner: `/status` any time · `/backlog` to reorder · `/coach` to sharpen · `/chief` to build · `/morning` for today's card
- Agents: open with the **TOP LINE**; update when mission/status/locks change
- Never hide STILL OPEN items to make progress look better
- `OWNER_BOARD.md` is the only living scoreboard
