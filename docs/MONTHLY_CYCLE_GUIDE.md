# Monthly Cycle — User Guideline

How to run the monthly OT / Expense / Medical cycle in ASIL HCM.

**Staff login:** [https://asil-hcm-frontend.onrender.com](https://asil-hcm-frontend.onrender.com)  
**Where:** left menu → **Monthly Cycle**

This is the same engine as Portal Claims. Monthly Cycle is the one place to set the contract pack, assign who fills and who approves, send the emails, track every person, correct mistakes, and push approved amounts onto the Payroll Sheet.

---

## 1. Who this is for

| Role | What you do here |
|---|---|
| **Operations / Payroll / Finance** | Configure the month, assign people, send invites, chase, correct, push to payroll |
| **Focal (Claimer)** | Receives an email with a fill link — enters OT, expense, and medical for nominated staff |
| **Line Manager (Approver)** | Receives an approve link — Accept or Reject each person’s submission |
| **Employee (when there is no Focal)** | May receive the fill link themselves if they have a Wafi or ASIL work mailbox |
| **Sadia Komal** | Gets a setup-needed list when someone has no Focal, no work mailbox, and no Line Manager |

Focals and Line Managers do **not** log into the staff app. They work only from the email link.

---

## 2. How a month works

Wafi default (this is what staff should expect unless Setup says otherwise):

1. **Work month** = the month the overtime / expense / medical actually happened (example: August).
2. Fillers submit by **day 18** of that work month.
3. Line Managers approve by **day 22**.
4. **Paid on** = the **following month’s** salary (August work → September Payroll Sheet).

When you open Track, the screen defaults to last month as Work month and this month as Paid on.

**Work month** and **Paid on Payroll Sheet** are two different filters. Always check both before sending emails or pushing payroll.

---

## 3. The six tabs (in order)

Use them left to right the first time a contract is set up. After that, most months start at **Collect**.

| Tab | Purpose |
|---|---|
| **Setup** | What this contract collects, how, and by which calendar days |
| **People** | Who fills (Claimer / Focal), optional Reviewer, and who approves (Line Manager) |
| **Collect** | Load the roster, tick people, send SAMPLE then ACTUAL invite emails |
| **Track** | Everyone who should have been invited — status, amounts, chase, View |
| **Corrections** | Fix a person (or bulk CSV) and optionally send back to the Line Manager |
| **Payroll** | Same board as Track, already filtered to **Ready for Payroll** — tick and push |

---

## 4. Setup — contract pack

Pick a **Contract**, then save. The same options also exist under **Client Information → edit contract → Monthly Cycle / Claims Policy**.

### Claim types enabled

Tick what fillers are allowed to enter for this contract. Unticked types do not appear on the fill wizard.

| Option | What it does |
|---|---|
| **Attendance** | Greyed out. Not collected through Monthly Cycle yet (PSO later). |
| **Overtime** | Fillers can enter OT lines (date, start, end, nature of work). Hours calculate automatically. Rate is 2× on Sundays / 3× on holidays; otherwise 2×. |
| **Expense reimbursement** | Fillers can enter expense lines (date, amount PKR, description) and must upload matching receipts. |
| **Medical reimbursement** | Fillers can enter medical lines (date, amount PKR, patient, description) and must upload matching receipts. |

Wafi contracts are already set to Overtime + Expense + Medical.

### Collection mode

How this contract is supposed to gather the month. **Only Monthly form is live today.**

| Option | What it does |
|---|---|
| **Monthly form (Wafi default)** | Email a magic link. Focal / employee / LM fills on screen or via a personalised Excel. **Use this.** |
| **Machine file upload (PSO phase)** | Saved for later. Attendance machine files are **not** collected here yet. |
| **Daily supervisor marks** | Saved for later. Not live. |
| **Mixed (site decides later)** | Saved for later. Not live. |

### Calendar & pay timing

| Option | What it does |
|---|---|
| **When claims pay → Following month salary** | August work is paid on the September Payroll Sheet. Wafi default. |
| **When claims pay → Same month salary** | Work month and payroll month are the same. Only use this if the contract really pays that way. |
| **Submit by (day)** | Last calendar day of the work month the filler may still submit (1–28). Wafi default **18**. After this, unanswered people can auto-close as “No Claims — Auto-closed”. |
| **Approve by (day)** | Last calendar day the Line Manager may still approve (1–28). Wafi default **22**. After this the approval window closes; anything still pending rolls to the next cycle. |

### Require separate reviewer step

Tick this if the contract should have a person **between** the Claimer and the Approver.

**Today:** the tick and the Reviewer email are **stored** on the contract / employee. Live emails still go **Claimer → Approver (Line Manager)** only. Do not promise a three-step chain to the client until ops confirms it is switched on.

Click **Save contract pack** after any change.

---

## 5. People — who fills and who approves

Filter first, tick people, type the emails, then **Apply to N selected**. Only **Active = Yes** employees appear.

Leave a role box empty to keep whatever is already on the roster for that field. Only filled boxes are written.

### Filters

| Filter | What it does |
|---|---|
| **Client** | Restrict the table to one client (e.g. Wafi). |
| **Contract** | Then restrict to one contract. |
| **Location** | Then restrict to one site / location. |

### Assignment fields (above the table)

| Field | What it does |
|---|---|
| **Claimer / Focal email** | Who receives the fill link for the selected people. Stored as Claim Authority. Use a work mailbox (`@wafi-energy.com` or `@asil.com.pk`), not personal Gmail. |
| **Reviewer email (optional)** | Stored on the employee. Not used in the live email/approval path yet (see Setup). |
| **Approver / LM email** | Who receives the approve link after the filler submits. Must be a work mailbox. |
| **Approver / LM name** | Display name shown to fillers and on the board. |

### People table columns

| Column | What it shows |
|---|---|
| **(tick box)** | Include this person in the next **Apply**. Use **Select all** for everyone in the current filter. |
| **Employee** | Full name. Second line is the ASIL employee code (e.g. `ASIL/SPL-001`). |
| **Location** | Site / location from the roster. |
| **Claimer** | Current Focal / Claim Authority email. `—` means none. |
| **Reviewer** | Current reviewer email. `—` means none. |
| **Approver** | Current Line Manager email. `—` means none. |
| **Setup** | **OK** if the person has a Claimer or an Approver. **Setup needed** if both are missing — Collect will not be able to send them a fill email. |

Fix **Setup needed** here or in **Employee Information**. Until a Claimer or LM exists, that person cannot be invited.

---

## 6. Who actually gets the fill email

The system does **not** always mail the employee. It picks a **path** from the roster:

| If the employee has… | Who fills | Who approves |
|---|---|---|
| Focal **and** Line Manager | **Focal** | **Line Manager** |
| Focal only (no LM) | **Focal** | No extra step — Focal submit is final |
| No Focal, has LM, employee has only a personal email (Gmail etc.) | **Line Manager** | No extra step — LM fill is final |
| No Focal, has LM, employee has `@wafi-energy.com` or `@asil.com.pk` | **Employee** | **Line Manager** |
| No Focal, no LM, official Wafi/ASIL mailbox | **Employee** | **Sadia** (`sadia.komal@asil.com.pk`) |
| No Focal, no LM, personal email only | **Sadia** | No extra step — Sadia fills and it is approved |

**Official email** means the roster email ends with `@wafi-energy.com` or `@asil.com.pk`. Personal Gmail/Yahoo does not count as a filler address.

On Collect this path appears as a badge: **Focal + LM**, **Focal only**, **Employee + LM**, **LM only**, **Employee + ASIL**, or **Setup needed**.

---

## 7. Collect — send the month’s emails

This is the invite campaign. One Focal gets **one email** covering all nominated people you ticked. Employees without a Focal get their own mail.

### Step 1 — period and mode

| Control | What it does |
|---|---|
| **Claim month / Year** | The **work month** you are collecting (when OT / expense / medical happened). |
| **SAMPLE** | Safe test. The table still shows each person’s real Focal/LM address, but mail is redirected to the SAMPLE inbox. Nothing is written to pay. **Always send SAMPLE first.** |
| **ACTUAL** | Live mail to real Focal / LM / employee addresses. Blocked on the server until ops turns ACTUAL send on. You must tick the confirmation box. |
| **Load employees** / **Reload roster** | Builds the audience for that month. Then pick Client. |

A monitor copy currently CCs `claims@asil.com.pk` so ops can see what went out.

### Step 2 — audience filters (in order)

You must pick a **Client** before the table fills.

| Filter | What it does |
|---|---|
| **2. Client** | Required. Lists employees for that client. |
| **3. Contract** | Optional. Narrow to one contract. |
| **4. Department** | Optional. Narrow to one department. |
| **5. Location** | Optional. Narrow to one location. |
| **Clear filters** | Resets Contract / Department / Location and the ticks. |

### Collect table columns

Tick **only** the people who should receive this send. Unticked people are not mailed.

| Column | What it shows |
|---|---|
| **Send?** | Green box. Tick to include. **Select / clear all pending** ticks everyone currently visible. |
| **Employee** | Name. Second line is the ASIL code. Click the row to preview that filler’s email on the right. |
| **Dept** | Department from the roster. |
| **Contract** | Contract name. |
| **Location** | Site / location. |
| **Path** | Routing badge (Focal + LM, LM only, Setup needed, …). See section 6. |
| **Email goes to** | The filler address that will receive the link. In SAMPLE mode a yellow line shows the redirect inbox. |
| **Approver** | Line Manager (or ASIL) who will approve after submit. `—` means submit is final. |

### Email preview (right panel)

Click a row. You see **To**, **CC**, **Subject**, and the HTML the filler will get. If several ticked people share one Focal, Send still produces **one** email for that Focal listing only the ticked names.

### Send buttons

| Button | What it does |
|---|---|
| **Send SAMPLE (N employees → M emails)** | Mails the test inbox. Use this to check names, path, and the fill link. |
| **I confirm sending … ACTUAL** | Required tick before live send. |
| **Send ACTUAL to N selected** | Live send. Confirm the popup. Only ticked employees are included. |

If ACTUAL is blocked, SAMPLE is still available. Ask a superadmin to enable live send after SAMPLE looks right.

### After send — results table

| Column | What it shows |
|---|---|
| **Filler** | Who the campaign tried to mail. |
| **To** | Address actually used (SAMPLE inbox, or the real filler). |
| **Result** | **Sent** or the failure reason. |

### Excluded table (below)

People who could not be invited.

| Column | What it shows |
|---|---|
| **Employee** | Name and ASIL code. |
| **Dept** | Department. |
| **Client** | Client. |
| **Category** | **Setup needed** = no Focal, no Wafi/ASIL mailbox, and no Line Manager. Sadia is emailed a roster-fix link. **Not eligible** = other skip reason. |
| **Reason** | Why this person was left out. Fix in **People** or **Employee Information**, then Reload roster. |

---

## 8. Track — the month’s control board

Lists **everyone in the audience**, not only people who already submitted.

### Period filters (top of Track / Payroll)

| Filter | What it does |
|---|---|
| **Work month** | Month the claims happened. Changing it also moves **Paid on** to the following month. |
| **Paid on Payroll Sheet** | Which Payroll Sheet month you will write to. For Wafi this is usually work month + 1. You can override if needed. |
| **Client** | Defaults toward Wafi when the board first loads. Same audience as Collect. |
| **Contract** | Narrow the board. |
| **Location** | Narrow the board. |
| **Audience** | Headcount for the current filters. Reminder: submit by day 18 · LM by day 22. |

### Summary tiles

Counts for the loaded board (after Client / Contract / Location).

| Tile | Meaning |
|---|---|
| **Submitted by Focals** | Filler has submitted; waiting on LM (or already in final LM review). |
| **Claims Approved** | Approved, or already on the Payroll Sheet. |
| **Ready for Payroll** | LM (or final filler) approved. ASIL has **not** pushed to the sheet yet. |
| **Final LM review** | Previously rejected, reopened once. Waiting on the Line Manager. A second reject is final. |
| **Waiting on others** | Invite sent / waiting Focal / waiting LM — not your push yet. |
| **Sent to Payroll** | Already written to the Payroll Sheet. Do not push again. |
| **No Claims Confirmed** | Filler tapped **Confirm No Claims**. Closed correctly. |
| **No Claims Auto-closed** | Fill deadline passed with no response. Not a confirmed zero. Chase or correct if they did have claims. |
| **No Claims (source unknown)** | Recorded as no claims, but the system cannot tell confirmed vs auto-closed. |
| **Needs Review** | Payroll Sheet already has **different** OT / medical / expense. Auto-push is blocked. Use Corrections after checking the sheet. |

### Status chips (table filters)

| Chip | Who you see |
|---|---|
| **Needs action** | Ready for Payroll, Final LM review, or Needs Review — ASIL should do something. |
| **Waiting** | Not invited, invite sent, waiting Focal, or waiting LM. |
| **Claims Submitted by Focals** | Submitted; waiting approval. |
| **Claims Approved** | Approved or already on the sheet. |
| **No Claims Confirmed** | Filler confirmed zero. |
| **No Claims Auto-closed** | Deadline closed with no response. |
| **Closed** | Sent to payroll, no-claims, or rejected-closed. |
| **All** | Full audience. |
| **Refresh** | Reload from the server. |

### Payroll push bar (above the table)

Only rows with status **Ready for Payroll** can be ticked.

| Control | What it does |
|---|---|
| **(tick) + Select visible** | Header box selects every **pushable** row currently on screen. Grey ticks cannot be selected. |
| **Preview push** | Dry-run. Shows how many are ready / need review / not ready. Does not write the sheet. |
| **Review and push to payroll** | Writes OT 2×, OT 3×, Medical, Expense onto the **Paid on** Payroll Sheet — **only if those four sheet columns are still empty**. Confirm the popup. |

LM approval does **not** write the sheet by itself. ASIL must push here.

If the sheet already has other figures in those columns, status becomes **Needs Review** and push is refused.

### Track table columns

| Column | What it shows |
|---|---|
| **(tick)** | Include in Preview / Push. Enabled only when status is Ready for Payroll. |
| **Employee** | Name. Second line: ASIL code · location. |
| **Claim summary** | Short totals from the portal, e.g. `OT2 4.00h · Med 2,500 · Exp 800`. Or “No claims — confirmed by filler” / auto-closed text. `—` means nothing entered yet. |
| **Status** | Control status (see glossary below). If already pushed, a second line shows **Sent** date/time. |
| **Last activity** | Latest event + Pakistan time, e.g. Portal opened, Submitted, Approved, Sent to payroll, Rejected, Reopened for LM, No Claims confirmed. |
| **Next** | Who must act now, with their email, e.g. `Waiting Focal to fill (name@…)`, `Waiting LM to approve (…)`. |
| **View** | Opens the person panel under the table. |

### View panel

| Item | What it shows |
|---|---|
| Header line | Code · location · path · Line Manager. |
| **Portal (Mon work)** | Hours/amounts from the fill link for the **work** month: OT 2× hrs, OT 3× hrs, Medical PKR, Expense PKR. |
| **Payroll Sheet (Mon)** | What is already on the **pay** month sheet for those four columns. Green if they match; red if they differ (Needs Review). |
| Status note | Plain-language next step for this person. |
| **Push this employee to payroll** | Same as ticking only this row and pushing. Only if Ready for Payroll. |
| **Manual correction** | Jumps to **Corrections** with this person’s current portal figures filled in. |

### Status glossary (Status column)

| Status | Meaning | What you do |
|---|---|---|
| **Not invited** | No campaign email yet. | Collect → tick → Send. |
| **Invite sent** | Mail went out; filler has not started. | Wait or chase the filler. |
| **Waiting for Focal** | Filler (Focal / employee / LM-as-filler) has the link open or draft, not submitted. | Chase the address in **Next**. |
| **Waiting LM to add claims** | Path is LM-only; LM must fill (submit is final). | Chase the LM. |
| **Waiting for LM** | Submitted; Line Manager has not decided. | Chase the LM approve link. |
| **Final LM review** | Reopened after a reject. One last LM decision. | Wait. Second reject closes it. |
| **Ready for Payroll** | Approved. Sheet columns still empty. | Tick → Preview → Push. |
| **Sent to Payroll** | Already on the sheet. | Done. |
| **No Claims — Confirmed** | Filler confirmed zero. | Done. |
| **No Claims — Auto-closed (no response)** | Deadline passed, no confirm. | If they actually had claims, use Corrections. |
| **No Claims — Closed (source unknown)** | No-claims row without a clear kind. | Check with the filler before treating as confirmed. |
| **Rejected — Closed** | LM rejected (final if already reopened). | Finance/superadmin may see a one-time reopen tool. Do not use casually. |
| **Needs Review — payroll already has different values** | Sheet ≠ portal. | Open View, compare, then Corrections. Do not push. |

---

## 9. Corrections — fix one person or many

Use this when the portal is wrong, the filler missed the deadline, or the sheet has OTHER DATA that must be aligned.

Default (recommended): save into Portal Claims and **send back to the Line Manager**. Each line must be approved again. Uncheck that only for a direct Payroll Sheet override (missed portal / OTHER DATA).

### Single-person form

| Field | What it does |
|---|---|
| **Send to Line Manager for re-approval after correction** | On (default): writes the portal and emails the LM. Off: writes the Payroll Sheet directly. |
| **ASIL Employee Code** | Required. Example `ASIL/SPL-001`. Prefilled if you clicked Manual correction from Track. |
| **OT 1× Hours** | Rare. Most Wafi OT is 2× / 3×. Leave 0 unless you know 1× applies. |
| **OT 2× Hours** | Double-time overtime hours to store. |
| **OT 3× Hours** | Triple-time (public holiday) hours. |
| **Expense Amount (PKR)** | Expense reimbursement total. |
| **Medical / OPD (PKR)** | Medical reimbursement total. |
| **Payroll mode** | Only when LM re-approval is **off**. **Add** = add to existing sheet values. Superadmin also sees **Replace** and **Remove**. |
| **Reason** | Required. Why this correction exists (shown in audit / notify). |

| Button | What it does |
|---|---|
| **Dry-run** | Preview before / after. Does not save. |
| **Commit** | Applies the change. |
| **Download CSV template** | Blank template for bulk upload. |

Huzaifa and Shezad are notified on a direct (non-LM) override.

### Bulk CSV columns

Download the template. First row is headers. Do not rename them.

| Column | What to put |
|---|---|
| **Code** | ASIL employee code. Required. |
| **Emp Name** | Name (for your reading; match is on Code). |
| **OT (1X)** | 1× hours. Use 0 if none. |
| **OT (x2)** | 2× hours. |
| **OT (x3)** | 3× hours. |
| **OPD** | Medical amount PKR. |
| **Exp** | Expense amount PKR. |
| **Exp Bills Status** | Ignored by import (kept for sheet compatibility). Leave blank. |
| **Absents** | Ignored by this import. Leave 0. |
| **Work Month** | 1–12. If blank, uses the Work month filter on screen. |
| **Work Year** | e.g. 2026. |
| **Reason** | Why. Required in spirit — template example is `Manual upload correction`. |
| **Send to LM?** | **Y** (default) = portal correction + LM re-approval. **N** = direct sheet override. |
| **Replace Existing?** | For direct override only. **N** / blank = Add. **Y** = Replace (superadmin). |

Then **Dry-run CSV** → check the summary → **Commit CSV**.

---

## 10. Payroll tab

Same board as Track, opened on **Ready for Payroll**.

1. Confirm **Work month** and **Paid on**.
2. Tick the people whose portal figures you have reviewed.
3. **Preview push** — read ready vs needs review vs not ready.
4. **Review and push to payroll**.
5. Status should become **Sent to Payroll**. Those four Payroll Sheet columns now hold the portal amounts.

Push never overwrites a sheet that already has different OT / medical / expense. Those rows stay **Needs Review**.

---

## 11. What the filler sees (email link)

The fill page is not inside Monthly Cycle. It opens from the email (or Excel upload on that same page).

### Two ways to enter

| Option | What it does |
|---|---|
| **Option A — Excel (recommended)** | Download a workbook prefilled with **this filler’s team**. Fill the sheets, upload it back. Draft is stored; then Review & Confirm. |
| **Option B — On screen** | Step-by-step wizard. Same fields as Excel. |

Disabled claim types (from Setup) do not appear as steps.

### Excel sheets and columns

Grey columns are prefilled. Do not change employee code / name / dept / location / manager.

**Overtime sheet**

| Column | Fill? | Meaning |
|---|---|---|
| **Date** | Yes | Day in the **work month** only (e.g. 15-08-2026). |
| **ASIL Employee Code** | Prefilled | Must stay the roster code. |
| **Employee Name** | Prefilled | |
| **Department** | Prefilled | |
| **Location** | Prefilled | |
| **Line Manager Name** | Prefilled | |
| **Nature of Work / Reason** | Yes | What was done in OT. |
| **OT Start Time** | Yes | Start of **overtime after normal duty**, not the full shift. Example `05:00 PM`. |
| **OT End Time** | Yes | Example `08:00 PM`. |
| **OT Hours (auto)** | Do not type | End − Start. |

Do not claim ordinary shift hours as OT. Sundays typically rate 2×; gazetted holidays 3× — applied by the system.

**Expense sheet**

| Column | Fill? | Meaning |
|---|---|---|
| **Date** | Yes | Day in the work month. |
| **ASIL Employee Code** … **Line Manager Name** | Prefilled | Same as OT. |
| **Expense Type** | Yes | Short type / category. |
| **Description of Expense** | Yes | What was spent. |
| **Total Expense Amount (PKR)** | Yes | Amount. Then upload receipts on the web page (Supports). |

**Medical & IPD sheet**

| Column | Fill? | Meaning |
|---|---|---|
| **Date** | Yes | Day in the work month. |
| **ASIL Employee Code** … **Line Manager Name** | Prefilled | |
| **Claim Type** | Yes | e.g. OPD / IPD. |
| **Patient Name / Relation** | Yes | Who was treated. |
| **Description / Treatment Detail** | Yes | |
| **Total Claim Amount (PKR)** | Yes | Amount. Then upload medical receipts on Supports. |

### On-screen wizard fields

**Overtime line:** Date (DD/MM/YYYY) · OT Start Time · OT End Time · OT Hours (auto) · Nature of work. Remove / add lines as needed.

**Expense line:** Date · Amount (PKR) · Description.

**Medical line:** Date · Amount (PKR) · Patient · Description.

**Supports:** Separate uploads for Expense receipts and Medical receipts. Files list under that upload. Remove and replace until the claim is **approved** or **in payroll**. After that, locked.

**Review & Confirm:** Check totals, then submit. Or **Confirm No Claims** if nobody in the list has OT / expense / medical this month.

The filler can still edit after Submit until a Line Manager (or final-path submit) **approves**. After approval, contact `ops-support@asil.com.pk` for a correction before payroll push.

---

## 12. What the Line Manager sees (approve link)

Same link all month. Outstanding people stay until decided.

| Control | What it does |
|---|---|
| **Outstanding** | Waiting for this LM’s decision. |
| **All** | Everyone in the pack. |
| **Already decided** | Approved, rejected, in payroll, or no-claims. |
| **Approve** | Accept this person’s lines. ASIL still has to push to the sheet. |
| **Reject** | Optional remark. Claim Authority is notified. A reopened claim shows **Final review — second rejection is final**. |

Each card shows who entered the claim, OT 1× / 2× / 3× hours, Expense PKR, Medical PKR, line items, and downloadable supports.

After **Approve by (day)** the window closes. Anything still pending rolls to the next month’s cycle.

---

## 13. Typical month (checklist)

1. **People** — Claimer and Approver look right; no unexpected **Setup needed**.
2. **Setup** — types, following-month pay, submit 18 / approve 22 (unless the contract differs).
3. **Collect** — Work month correct → Load employees → Client → tick → **SAMPLE** → check the test inbox → **ACTUAL**.
4. **Track** — chase **Waiting** until day 18 (fillers) and day 22 (LMs).
5. **Corrections** — only for misses, deadline failures, or sheet clashes.
6. **Payroll** — Preview, then push Ready rows. Confirm Payroll Sheet OT / Med / Exp.
7. Do **not** treat Auto-closed as a confirmed zero without checking.

---

## 14. Who to ask

| Issue | Who |
|---|---|
| Wrong Focal / LM / work email on the roster | Operations / Sadia — **People** or Employee Information |
| SAMPLE looks right; ACTUAL still blocked | Superadmin (server flag for live send) |
| Sheet already has OT / medical / expense | Payroll / Finance — Track **Needs Review**, then Corrections |
| Filler or LM says the link is wrong | Ops — confirm path on Collect (Email goes to / Approver) |
| Need a rejected claim reopened | Finance Manager / Superadmin — one-time reopen, not routine |
| Attendance / PSO machine files | Not in Monthly Cycle yet — do not use Collection mode expecting a file upload |

---

*Last aligned to the Monthly Cycle screens as of September 2026. Wafi is the live pattern: monthly form, OT + Expense + Medical, submit day 18, approve day 22, paid following month.*
