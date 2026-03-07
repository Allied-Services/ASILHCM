# Self-Audit Report: Tax Engine Module

**Date:** March 4, 2026
**Module Tested:** `taxEngine.js` & FBR 2025-26 Compliance Rules

## Verification Step 1: EOBI
- **Scenario:** Gross wage: 150,000 PKR. Minimum wage bound: 37,000 PKR.
- **Expected:** Employee should pay 1% of 37K (370), Employer should pay 5% of 37K (1,850).
- **Actual Result:** `{ employeeShare: 370, employerShare: 1850 }`
- **Status:** PASS 🟢

## Verification Step 2: SESSI
- **Scenario:** Gross wage: 150,000 PKR. Minimum wage bound: 37,000 PKR.
- **Expected:** Employer pays 6% of 37K (2,220).
- **Actual Result:** `2220`
- **Status:** PASS 🟢

## Verification Step 3: Income Tax (WHT)
- **Scenario:** Monthly Gross 150,000 PKR (1,800,000 PKR Annually).
- **Expected based on 2025-26 Slabs:** Salary between 1.2M and 2.2M tax formula = 30,000 + 15% of amount > 1.2M.
    - 1,800,000 - 1,200,000 = 600,000
    - 600,000 * 0.15 = 90,000
    - Annual total tax = 30,000 + 90,000 = 120,000
    - Monthly Tax = 120,000 / 12 = 10,000.
- **Actual Result:** `10000`
- **Status:** PASS 🟢

## Verification Step 4: Gratuity Formula
- **Scenario:** Base 150,000 PKR from `2020-01-01` to `2026-03-04` (~6.17 years).
- **Expected Formula:** `(150,000 / 26) * 30 * ~6.17`
- **Actual Result:** `1068783.02`
- **Status:** PASS 🟢

---

# Self-Audit Report: Frontend Prototype

**Date:** March 4, 2026
**Module Tested:** `frontend` React Views

## Verification Step 5: Master Summary Dashboard (MD View)
- **Scenario:** Verify high-level aggregates are presented cleanly. Total Payroll, Total Procurement Volume, and System Alerts constraints.
- **Components:** `Dashboard.jsx`, Lucide-react iconography, `glassmorphism` aesthetic css.
- **Observation:** Verified dynamic UI render. 'Pending Replacements' card accurately calculates uniform thresholds (6 months) vs PPE thresholds (12 months) UI states. Warning visual indicators correctly apply.
- **Status:** PASS 🟢

## Verification Step 6: Annexure Approval UI
- **Scenario:** Render Debit Note items in tabular format linked to Location and Service Order ID to allow matching raw operational costs to mapped client budgets.
- **Components:** `AnnexureDashboard.jsx`, `filter` mapping.
- **Observation:** Both the `Filter by Location` and `Filter by SOID` functions correctly update the nested table state. Total cost calculations correctly map the base margin variables in UI state simulating real backend DB schema logic.
- **Status:** PASS 🟢

## Verification Step 7: Katcha Bill Virtual OCR Simulator
- **Scenario:** Create a mock environment to act as the AI Vision pipeline since physical feed is not present. Simulate mathematical mis-match.
- **Components:** `MockOCR.jsx`.
- **Observation:** Executing scan mimics a 2000ms delay. The OCR correctly identifies a base discrepancy (Extracted OCR total `12500` vs Line Items Total `11500`). The UI correctly flags a `HUMAN IN LOOP` alert, halting automated backend insertion as defined in requirements.
- **Status:** PASS 🟢

## Execution Summary
* **Full Audit complete**: No missing links or execution blocks.
* Database Schema updated for automated Pak/Tax compliances.
* Verification tax engine server operating cleanly.
* UI Prototype fully established on React/Vite. All design mandates (glass-darkness, inter-font, micro-animations) applied globally.
