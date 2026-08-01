# Automation draft — Morning brief (Chief)

Use this when creating a Cursor Automation at cursor.com/automations or via `/automate`.

## Name
ASIL HCM morning brief

## Description
Every weekday morning: check live health, read OWNER_BOARD, flag unfinished work, write a simple HTML card, email a short message to the owner.

## Trigger
- Schedule: weekdays 08:00 Asia/Karachi (or 03:00 UTC ≈ 08:00 PKT)

## Tools
- Repository: Allied-Services/ASILHCM (this repo), branch `main`
- Email: **required delivery** — one morning email to the owner
- Computer use: optional (open `docs/owner/morning_latest.html` and screenshot; attach/link in email if possible)
- Memories: on (remember last site color and recurring unfinished items)
- Do **not** enable SMS, WhatsApp, or Twilio

## Permissions
- Read-only preferred. May update factual lines in `OWNER_BOARD.md` and overwrite `docs/owner/morning_latest.html`.
- Do **not** merge PRs, edit Chief hard rules, or start feature builds.

## Instructions (paste into Automation prompt)

```
You are Chief morning mode for ASIL HCM.

Follow the skill at .cursor/skills/morning/SKILL.md.

1. Read OWNER_BOARD.md.
2. Check https://asilhcm.onrender.com/health.
3. List only PRs that need the owner today (gh pr list).
4. Write a VERY SIMPLE plain-text brief (Good morning / Site / Not finished yet / Needs you / I suggest / Focus).
5. Fill docs/owner/morning_brief_template.html → save as docs/owner/morning_latest.html with today's facts.
6. Email the plain-text brief to the owner. Subject: ASIL HCM — morning brief. No SMS. No WhatsApp. No Twilio.
7. If computer use is available, open the HTML card and include a screenshot or link to docs/owner/morning_latest.html in the email when possible.
8. Do not start new features. Do not hide unfinished items.

If the site is DOWN or DEGRADED, start the message with PROBLEM and recommend /incident — do not suggest new builds.
```

## Owner setup checklist
1. Create Automation from this draft (or approve the draft in Cursor chat)
2. Connect email delivery to your inbox
3. Activate weekday schedule
4. Do **not** add SMS / WhatsApp / Twilio
