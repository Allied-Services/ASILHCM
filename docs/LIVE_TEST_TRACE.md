# Live Test Trace — BPO/FM Restructure

Use this document during UAT. Each check has a **Trace ID** — when something fails, note the ID in your message so we can pinpoint the exact code path.

**How to use:** Tester runs check → marks Pass/Fail → on Fail, paste Trace ID + screenshot/error into WhatsApp/email.

**Environment:** https://asilhcm-frontend.onrender.com (backend auto-deploys from `main`)

---

## Phase 2 — Operations UI (Intake, Claims, Contracts, BD)

| Trace ID | Role | Screen | Steps | Expected | Pass/Fail | Notes |
|----------|------|--------|-------|----------|-----------|-------|
| P2-MD-001 | MD | Dashboard | Login as superadmin → Managing Director View | Portfolio margin, contract count, intake queue, 8-week cash flow table load without error | | |
| P2-MD-002 | MD | Dashboard | After payroll lock, click Refresh P&L (API or finance action) | Margin numbers update from locked payroll | | |
| P2-OPS-001 | Operations | Intake Hub | Open Intake Hub → view message list | Messages table loads (may be empty) | | |
| P2-OPS-002 | Operations | Intake Hub | Click "Poll Now" | Returns `{ polled, newMessages }` or graceful skip if IMAP not configured | | |
| P2-OPS-003 | Operations | Claims Queue | Open Claims Queue | Employee claims list loads | | |
| P2-OPS-004 | Operations | Claims Queue | Create OT claim for employee on OT-blocked contract | System rejects with OT_NOT_ALLOWED | | |
| P2-OPS-005 | Operations | Contract Ops | Select contract → view/edit policy | Policy form saves (OT cap, medical cap, credit days) | | |
| P2-OPS-006 | Operations | Contract Ops | Start onboarding for new contract | Checklist tasks appear with blocking flags | | |
| P2-OPS-007 | Operations | Contract Ops | Complete a blocking onboarding task | Task marked done; status updates | | |
| P2-BD-001 | BD / Finance | BD Pipeline | Open BD Pipeline → Add lead | Lead appears in list | | |
| P2-BD-002 | BD / Finance | BD Pipeline | Move lead to "won" with contract ID | Onboarding auto-starts for that contract | | |
| P2-BD-003 | BD / Finance | BD Pipeline | View Renewals tab | Upcoming contract renewals listed | | |

---

## Phase 3 — Attendance Intake & Alerts

| Trace ID | Role | Screen | Steps | Expected | Pass/Fail | Notes |
|----------|------|--------|-------|----------|-----------|-------|
| P3-OPS-001 | Operations | Attendance → Intake | Upload CSV attendance export | Rows parsed into attendance ledger | | |
| P3-OPS-002 | Operations | Attendance → Manual | Enter absent-only records for a site | System calculates present days from roster | | |
| P3-OPS-003 | Operations | Attendance → Manual | Enter present-only records | System calculates absent days | | |
| P3-OPS-004 | Operations | Attendance → Alerts | Configure alert rule for critical FM site | Rule saved | | |
| P3-OPS-005 | Operations | Attendance → Alerts | Mark unexcused leave on critical site | Email/SMS alert fires (if Jazz/Resend configured) | | |

---

## Phase 4 — Katcha Procurement & Bill Verification

| Trace ID | Role | Screen | Steps | Expected | Pass/Fail | Notes |
|----------|------|--------|-------|----------|-----------|-------|
| P4-PROC-001 | Procurement | Bill Verification | Open verification queue | Bills pending OCR/match listed | | |
| P4-PROC-002 | Procurement | Bill Verification | Upload unreadable bill photo → OCR | Side-by-side preview + extracted fields | | |
| P4-PROC-003 | Procurement | Bill Verification | Edit OCR fields manually → Save verified | Bill marked verified; data stored | | |
| P4-PROC-004 | Procurement | Bill Verification | Match bill line to contract budget line | match_status = matched | | |
| P4-PROC-005 | Procurement | Bills & Procurement | Approve bill without budget match | Blocked with BUDGET_UNMATCHED unless override | | |
| P4-PROC-006 | Procurement | Bill Verification | Approve matched bill | Status moves to Approved; AP queue eligible | | |

---

## Phase 5 — Compliance & Tax Ledger

| Trace ID | Role | Screen | Steps | Expected | Pass/Fail | Notes |
|----------|------|--------|-------|----------|-----------|-------|
| P5-FIN-001 | Finance | Compliance Ledger | Open Compliance → select month | EOBI, SESSI, income tax totals shown | | |
| P5-FIN-002 | Finance | Compliance Ledger | Generate filing preview | Ready-to-file summary per region (PRA/BRA/SRB) | | |
| P5-FIN-003 | Finance | Invoices (AR) | Generate invoice for contract requiring challans | Blocked until challans attached | | |
| P5-FIN-004 | Finance | Invoices (AR) | Attach required challans → regenerate | Invoice passes constraint check | | |

---

## Phase 6 — Xero, AR Cycles & PO Enforcement

| Trace ID | Role | Screen | Steps | Expected | Pass/Fail | Notes |
|----------|------|--------|-------|----------|-----------|-------|
| P6-FIN-001 | Finance | System Config / Xero | Check Xero connection status | Shows connected or connect link | | |
| P6-FIN-002 | Finance | Invoices (AR) | Push finalized invoice to Xero | Invoice appears in Xero; sync log entry | | |
| P6-FIN-003 | Finance | PO Tracking | Create invoice against PO | Used amount updates; balance reduces | | |
| P6-FIN-004 | Finance | PO Tracking | Invoice exceeds PO balance | Blocked with PO balance error | | |
| P6-FIN-005 | Finance | Invoices (AR) | Overdue invoice past credit days | Dunning reminder logged/sent | | |
| P6-MD-001 | MD | Dashboard | Review cash-flow after invoice due dates | Expected inflows reflect client payment terms | | |

---

## Failure Report Template

```
Trace ID: P?_??-???
Role: 
Screen: 
What I did: 
What happened: 
What I expected: 
Screenshot/error: 
Time (PKT): 
```
