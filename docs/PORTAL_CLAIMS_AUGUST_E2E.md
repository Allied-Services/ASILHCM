# Portal Claims — August 2026 E2E Checklist

Manual verification on **staging** before ACTUAL August send. SAMPLE mode sends all mail to `shezad.mumtaz@asil.com.pk` and blocks payroll injection.

## Prerequisites

1. Run migration: `cd backend && npm run migrate`
2. Confirm `wafi_gmail_intake_enabled` = `false` in `system_config`
3. HCM signed in as `superadmin` or `finance_manager`
4. Open **Claims** tab (`PortalClaimsHub`)

## SAMPLE test pack (4 routing rows)

1. Set **Campaign mode** → **SAMPLE**
2. Click **Send 4-routing test pack** (picks one employee per profile: Focal+LM, Focal only, Employee+LM, Employee+ASIL)
3. Check Shezad inbox for **4 emails** with subjects like `[SAMPLE · Focal+LM · 1 employee(s)]`
4. Each email body shows TEST MODE banner with intended production recipient

## Per-link walkthrough

For each magic link in the test pack:

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open fill link | Claims fill page loads; employee list visible |
| 2 | Download personalized Excel | Codes/names prefilled for that pack |
| 3 | Enter OT / expense / medical (or upload Excel) | Draft saved |
| 4 | Upload batch expense + medical zips (if amounts > 0) | Batch attachments stored once per pack |
| 5 | **Review & confirm** (step 2) | Totals per employee + per LM group; destination banner |
| 6 | **Confirm & submit all** | Status → submitted; filler gets a confirmation email (OT 2X/3X + expense + medical totals and the line list); approver pack created (except focal-only auto-final) |
| 7 | Open approver link (from email or Notify approvers) | Summary cards: OT / expense / medical / count |
| 8 | Approve each employee | SAMPLE: no `employee_claims` rows created |

## Break tests

- FM department employee → **Not eligible** badge on Employee + Payroll; excluded from campaign dry-run
- Employee with missing email → **Setup needed** badge; skipped in campaign
- Bad employee code in Excel → import error, no partial corrupt rows
- Re-submit same batch → idempotent (no duplicate payroll lines in ACTUAL mode)

## Recruiter badges

On **Employee Information** and **Payroll Sheet** (Claims route column):

- Focal + LM / Focal only / Employee + LM / Employee + ASIL / Not eligible / Setup needed
- Tooltip shows focal, LM, and resolved approver emails

## Eligibility rules (admin)

1. **Preview matches** on Wafi rule → count excludes Facility Management
2. **Edit** dept exclude list → save → dry-run campaign count updates

## Flush SAMPLE data

After testing, clear sample periods:

```bash
node backend/scripts/flush_portal_claims_sample.js --period=2026-07 --client=Wafi
```

Or use **Flush SAMPLE Wafi data** in Portal Claims Hub (superadmin).

## ACTUAL launch (MD sign-off required)

1. Switch **Campaign mode** → **ACTUAL**
2. Dry-run campaign → verify filler/employee counts
3. Launch ACTUAL campaign
4. Spot-check one focal with 10+ employees: single Excel lists all staff
5. After LM approval → confirm `employee_claims` rows with `source_kind='portal'`

## Automated tests

```bash
cd backend
npm test
node --test tests/claimsEligibility.test.js
```
