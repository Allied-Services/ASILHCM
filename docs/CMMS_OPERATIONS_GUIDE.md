# CMMS Operations Guide — Allied Services

Simple instructions for supervisors, operations, and finance using **Maintenance & CMMS** in ASIL HCM.

**Staff login:** https://asil-hcm-frontend.onrender.com  
**Client portal (external focals):** https://asil-hcm-frontend.onrender.com/cmms

---

## 1. Who does what

| Role | Access | Main tasks |
|------|--------|------------|
| **Site supervisor** (e.g. Mukesh) | HCM → Maintenance & CMMS → Tickets | Log issues with photo, update status, spend petty cash on minor fixes |
| **Operations** | Tickets, Sites, Escalation Matrix | Manage sites, escalation chain, reassign tickets |
| **Finance** | Billing Report, Emergency Petty Cash | Mark billable vs internal, monthly reporting, fund top-ups |
| **Client focal** (e.g. Wafi) | `/cmms` email OTP | View all site tickets, log new issues (photo optional) |

---

## 2. Raising a ticket (ASIL staff)

1. Open **Maintenance & CMMS → Tickets**.
2. Select **Site** from the dropdown (e.g. LOBP — do not type free text).
3. Pick **Category**, **Priority**, and **Title**.
4. Set **Deadline** if the client or action plan gave you one.
5. **Photo is mandatory** for staff — attach a clear photo of the issue.
6. Click **Submit Ticket**.

**What happens next:**
- Ticket is auto-assigned to the site’s default supervisor (LOBP → Mukesh).
- An **email** goes to the assignee (and CC if configured).
- If the deadline passes, escalation emails fire automatically (see section 5).

**Minor emergency spend:** If you used petty cash on the spot, tick **Minor Issue — Emergency Petty Cash used** and enter the amount before submitting. This creates a spend record linked to the ticket (section 4).

---

## 3. Working a ticket

On the **Open Tickets** table:

| Action | When to use |
|--------|-------------|
| **Start** | Work has begun (`in_progress`) |
| **Resolve** | Issue is fixed (`resolved`) |

Overdue tickets (past deadline, still open) show in **red**.

**Reassign owner:** Operations can PATCH/reassign via API today; from the board, contact operations if the wrong person is assigned. Reassignment sends a new email to the new owner.

**Billable column** (operations/finance only):

| Value | Meaning |
|-------|---------|
| **tbd** | Not yet decided — default for new tickets |
| **billable** | Cost can be charged to the client |
| **internal** | Allied absorbs the cost — not invoiced |

Set this when you know how the spend or work should be treated.

---

## 4. Emergency petty cash

**Purpose:** Track small on-site spends (supplies, urgent fixes) per site, linked to tickets.

### When logging a ticket with spend
- Tick **Minor Issue — Emergency Petty Cash used**.
- Enter the **amount spent** (Rs).
- Submit with photo as usual.
- A **ledger spend row** is created automatically with the ticket ID.

### Finance: configure a site fund
1. **Maintenance & CMMS → Emergency Petty Cash**
2. Enter **Site**, **Monthly threshold**, and **Finance emails** (comma-separated).
3. Click **Save**.

When balance drops below 20% of threshold, finance receives an **email alert**.

### Manual ledger entries
Use **Ledger Entry** for allocations or replenishments (not tied to a ticket):
- **Allocation** — opening balance for the month
- **Replenishment** — top-up after approval
- **Spend** — manual spend (prefer ticket-linked spend via the ticket form instead)

Every spend row shows the **Ticket** column when linked.

---

## 5. Escalation matrix (operations)

**Maintenance & CMMS → Escalation Matrix**

Escalation emails are sent automatically every ~10 minutes when rules match.

### Two trigger types

| Basis | Use when |
|-------|----------|
| **Hours overdue** | Ticket has a **deadline** — fires after the deadline passes |
| **Hours open** | Ticket has **no deadline** — fires based on time since creation |

**Threshold (hours):** How long after the trigger point before this step fires.  
Example LOBP chain (deadline-based):
- **0h overdue** → Obaid (deadline just passed)
- **48h overdue** → Rabia
- **120h overdue** → Shezad

**Priority `any`** = applies to all priority levels at that site.

### Editing rules
1. Click **Edit** on a row — the form fills at the top.
2. Change fields, toggle **Active** off to pause a rule without deleting.
3. Click **Save Changes**, or **Cancel** to discard.
4. Click **Delete** to remove a rule permanently.

---

## 6. Sites and client access (operations)

**Maintenance & CMMS → Sites**

### Add a new site
1. Site name (must match attendance site name, e.g. `LOBP`).
2. Client name, categories (comma-separated), default assignee email, CC email.
3. Click **Add Site**.

### Give a client focal access
1. Under **Client Portal Access**, enter client **email**, **name**, and **site**.
2. Click **Add Client**.
3. Client goes to `/cmms`, enters email, receives OTP, and sees all tickets at their site.

---

## 7. Billing report (finance)

**Maintenance & CMMS → Billing Report**

1. Select **site** and **month/year**.
2. Review totals: billable vs internal tickets and linked petty-cash spend.
3. Click **Export CSV** for invoicing or internal records.

Ensure tickets are marked **billable** or **internal** before month-end close.

---

## 8. LOBP quick reference (Wafi Energy)

| Item | Value |
|------|-------|
| Site code | LOBP |
| Client portal | Sami.Abdul@wafi-energy.com |
| Default assignee | Mukesh (mukesh.solanky@asil.com.pk) |
| CC | Obaid (obaid.rana@asil.com.pk) |
| Escalation | Obaid → Rabia → Shezad (deadline-based) |

Seeded backlog tickets: **MT-LOBP-1** through **MT-LOBP-7**.

---

## 9. Common questions

**Q: Client says they cannot log in.**  
A: Confirm their email is listed under Sites → Client Portal Access and they use `/cmms` (not the staff HCM login).

**Q: No escalation email received.**  
A: Check the ticket has a deadline (for overdue rules), status is still open/in_progress, and the rule is **Active** in the matrix.

**Q: Photo rejected on staff ticket.**  
A: Staff must attach a JPEG/PNG/WebP image. Clients on `/cmms` may submit without a photo.

**Q: How do I onboard the next site?**  
A: Sites → add site → Escalation Matrix → add chain → Client Portal Access → Petty Cash fund → Attendance Team Setup for staff.

---

*Last updated: July 2026 — ASIL HCM Phase 2 CMMS*
