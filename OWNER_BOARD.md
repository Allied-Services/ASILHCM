# OWNER BOARD — ASIL HCM
> Living scoreboard for the owner. Agents must read and update this.
> Last updated: 2026-08-27 · Keep under ~100 lines. Plain English only.

---

## MISSION (one framing — expanded scope)
**Make ASIL HCM trustworthy end-to-end: contract → people → correct pay → payslip in hand — starting with one pilot payroll month, then rolling out the rest.**

The first proof point is unchanged: **one real month for the pilot contract (38 employees, Facility Management) where HCM matches Excel and pays correctly.** Everything else in your vision (portal, claims, imprest, Xero, OCR) queues behind that proof unless it directly blocks it.

STATUS: **YELLOW** — July Wafi Calculate was wiping sheet OT when Monthly Hub had OT=0; fix on branch `fix/payroll-sheet-calc-preserves-sheet-ot` (do not Calculate on prod until merged).  
LIVE: prod API healthy; **do not re-Calculate July Wafi on live** until this fix ships (OT would wipe again).

**Full audit:** `docs/OWNER_VISION_AUDIT.md`  
**30-day agent plan:** `docs/AUTONOMOUS_EXECUTION_PLAN.md`

---

## MANDATE (standing — Chief acts alone inside this)
> Set by owner 2026-08-25. Chief may not edit this block; it may only propose changes.

- **Ship without asking:** bug fixes, screens, reports, endpoints, tests, docs, board work,
  and auth / session / schema-add work — provided Chief verifies it live and keeps a revert ready.
- **Always:** branch + PR + CI green (auto-merge) → deploy confirmed → checked on the real site
  in the browser → one receipt afterwards.
- **Staging first** when payroll, payments, or World A paths are touched — then prod after proof.
- **Stop and ask (exact phrase `Go red: …`):** posting or moving cash / disbursement · bulk
  employee data change / merge / delete · live SMS or email to real people · prod engine-flag
  flip · anything irreversible.
- **Never touch:** anything under PARKED. World A pay path until cutover. BPO staging contract
  work without coordinating merges.
- **Reporting:** the receipt + the morning email. No plans, no diffs, no reasoning unless the
  owner asks.
- **Owner words that carry weight:** `undo` · `Go red: …` · `Override lock: … — [why]` · `plan only`

---

## TOP LINE (for agents / morning brief)
**Why Calculate changed July totals with no hour edits:** Monthly Hub rows with OT hours = 0 were treated as authoritative and overwrote sheet OT2/OT3. Default “Pull approved claims” made that path run. Fix: sheet OT is baseline; hub zeros never clear hours; Calculate defaults to sheet inputs. Remaining Excel net gap (~bonus/tax) is separate.

---

## STILL OPEN (do not bury these)

### Payroll (P0)
1. **S5B shadow month** — pilot Excel vs HCM must reach zero variance; blocked on payroll team CSV export (`BLOCKED.md`)
2. **S5C** — no production pay through new engine yet
3. **Two payroll brains** — World A (browser) vs World B (server); risk of conflicting numbers until S6B engine flag exists
4. **June 2026 reconciliation** — may be ahead in `C:\Projects\ASILHCM-Staging`; not merged here (S5B1–S5B3)

### Owner vision gaps (P1 — after pilot proof)
5. **Portal payslips** — portal reads old pay table only; new-engine employees would see nothing
6. **Claims** — Monthly Cycle hub shipped (contract pack + people UI); four legacy intake paths still exist until hide pass
7. **Payslip branding** — emails work if Resend is set; **no logo image** in templates today
8. **Nothing is automatic** — compute, lock, disburse, email each need a human click

### Infrastructure / ops
9. **Staging cold starts** — free tier sleeps; verify after wake before calling staging "broken"
10. **Local tests on GDrive** — `jest` node_modules corrupt; use temp clone or CI for counts
11. **Morning brief Automation** — email only; not switched on until you say so

### Parked until mission gate clears
12. **Imprest workflow** — bill type exists; no dedicated process
13. **Xero superiority** — OAuth/sync code exists; not connected without your credentials + approval
14. **World A retirement (S7R)** — only after pilot paid through new path
15. **Paid background worker (Phase 9)**

---

## IN PROGRESS
- BPO / PSO contract matching on staging (separate track — do not block)

## JUST SHIPPED (2026-08-27)
- **Portal Claims submit confirmation** — Employee, Focal, or Line Manager who submits now gets an email with OT 2X/3X hours, expense and medical totals, and the list of lines they just entered. Approve/reject is unchanged.
- **July claims closed** — fill and Line Manager approve links both show “Deadline has expired”. No emails sent.

## JUST SHIPPED (2026-08-25)
- **Monthly Cycle hub** — new tab: contract claim pack (OT/Expense/Medical toggles), people assignment, collect/track/payroll on same Portal Claims engine; Wafi unchanged
- **Portal Claims who entered / who approved** — fill and approve links name the person and time. LM-only says “same person — submit is final.”
- **Portal Claims fill window** — July work stays open through 27 Aug 11:59 PM. A campaign send had reset the close date back to 17 July; that rewind is blocked.
- **Employee Information Focal / Line Manager** — view and save the same Focal email and Line Manager name/email Portal Claims uses (`feat/employee-focal-lm`)
- **Portal Claims routing** — LM only is final; employee invites only Wafi or asil.com.pk; Setup needed emails Sadia (`feat/wafi-claims-routing`)
- **Rabia 25 Aug Wafi contacts on production** — 303 people updated (phones / email / Focal / LM only; salary and bank untouched). Re-check is clean (0 remaining). Go-red apply.
- **Portal Claims Control Desk** — action-first dashboard, LM approval without auto-payroll, ASIL bulk push, August one-time LM reopen (`main` PR #113)
- **Portal Claims fill-status ops desk** — desk status, smart reminders, daily email+SMS cron, ops-support on all claims mail (`main` PR #112)
- **Portal Claims August chase base** — Response board truth, ACTUAL-only chase, 27 Aug trial window (`main` PR #110)

---

## BLOCKED ON YOU
- Payroll team **Excel export** for pilot shadow month (S5B) — see `scripts/VARIANCE_INPUT_FORMAT.md`
- **MD sign-off** on zero-variance report before any production pay through new engine
- **Go red:** production disbursement, prod engine-flag flip, Render secrets (Resend, Jazz, OpenAI, Xero)

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
- Owner: state what you want once (plain English) and walk away — Coach sharpens silently, Chief ships
- `/status` any time · `/backlog` to reorder · `/morning` for today's card · `undo` to revert a ship
- Agents: claim your own folder (`npm run wt:new -- <slug>`); never build in the owner's folder
- Never hide STILL OPEN items to make progress look better
- `OWNER_BOARD.md` is the only living scoreboard
