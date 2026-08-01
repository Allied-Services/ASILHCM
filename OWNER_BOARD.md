# OWNER BOARD — ASIL HCM
> Living scoreboard for the owner. Agents must read and update this.
> Last updated: 2026-08-01 · Keep under ~80 lines. Plain English only.

---

## MISSION (one active thing)
**Prove one real payroll month through HCM for the pilot contract** — people get paid correctly from the new engine, with proof you can see.

STATUS: AMBER  
LIVE: OK (2026-08-01 morning health check — site up)

---

## STILL OPEN (do not bury these)
1. Pilot shadow month (S5B) — need payroll-team Excel vs HCM at zero difference
2. Staging must stay the proving ground — merge to main only after staging checks pass
3. World A (old payroll sheet) still pays ~500 people — keep it working until cutover is done
4. Morning brief Automation — first weekday run started; email must reach your inbox

---

## IN PROGRESS
- Morning brief cadence (HTML card + owner email) — Chief OS landed on main

---

## BLOCKED ON YOU
- Reply **yes / no / change …** on any open ship card
- Payroll team Excel export for the pilot month (S5B) when ready
- Secrets only when asked with one clear action (e.g. Render env)
- Red work needs exact phrase: `Go red: [what]`

---

## PARKED (you asked; we will not start until mission closes)
- Big new products unrelated to payroll proof
- Full World A retirement (S7R) before pilot is proven
- Paid background worker upgrade (Phase 9)
- Portal Google OAuth product decision

---

## LOCKED DECISIONS (do not reopen without override)
| Decision | Until / rule |
|----------|----------------|
| One active mission at a time | New ideas → PARKED |
| Branch + PR only; never push `main` | Always |
| Staging before production | Verify on staging; then merge |
| World A keeps paying until cutover says otherwise | Do not break the old pay path |
| No “done” without live evidence | URL / count / screenshot |
| Morning digests = email only | No SMS / WhatsApp / Twilio |
| Money routes need tests green | `npm test` + `npm run test:int` when those paths change |

**Override phrase (owner):** `Override lock: [decision] — [why]`

---

## CLOSE CRITERIA (mission done only when all true)
- [ ] Pilot contract shadow month shows zero meaningful pay difference vs Excel
- [ ] Owner got one plain “all clear” brief with proof (not agent guessing)
- [ ] Staging walkthrough done before any production pay through the new path
- [ ] World A still able to pay if we need a fallback

---

## SUGGESTIONS (optional — agents must not start these)
- Keep weekday morning email on if the brief looks right
- After pilot proof: cut over the next contract (same playbook)
- Keep draft PRs short-lived — triage or close, don’t leave forever

---

## HOW TO USE
- Owner: `/status` any time · `/backlog` to reorder · `/coach` to sharpen · `/chief` to build · `/morning` for today’s card
- Agents: open with the **TOP LINE** from this file; update this file when mission/status/locks change
- Never hide STILL OPEN items to make progress look better
- `OWNER_BOARD.md` is the only living scoreboard — do not invent CODEMAP / PULSE registries
