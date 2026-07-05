# SYSTEM BLUEPRINT (MASTER)
**Allied Services International Limited (Pvt.) Ltd.**

*An executive overview of the ASIL HCM & Payroll application architecture, data, roles, and known limitations.*

---

## 1. THE MAP OF THE HOUSE (Architecture Overview)

Our system is divided into three distinct layers, working together to provide a seamless experience:

*   **Frontend (The Face):** Built using **React** and **Vite**. This is what the users see and interact with in their web browser. It uses a custom dark theme built with pure CSS, ensuring it is blazing fast, highly responsive, and tailored strictly to our operational needs.
*   **Backend API (The Brain):** Powered by **Express.js (Node.js)**. This acts as the middleman. When a user clicks a button on the frontend, the backend receives the request, enforces all our business rules and permissions, and safely talks to the database.
*   **Database (The Vault):** We use **Neon PostgreSQL**, a cloud-native, serverless SQL database. It is highly structured and relational, meaning every piece of data is strictly linked (e.g., an employee *must* belong to a contract).

### Core Modules (What Users Interact With):
*   **Employee Information (HR):** The master directory for managing our 500+ workforce, their contracts, documents, and historical data.
*   **Payroll Sheet:** The engine for calculating monthly salaries, generating payslips, and locking periods for disbursement.
*   **Bills & Procurement:** The expense tracker. It handles vendor payments, internal expenses, and features an AI (OCR) scanner for digitizing handwritten receipts.
*   **Invoices (AR):** Accounts Receivable module for generating, tracking, and sending invoices to our clients.
*   **Accounts Payable (AP):** The disbursement queue where locked payroll batches and approved bills are sent to the bank for actual payment.
*   **Claims Processing:** Specialized modules (like Wafi Claims) for ingesting, calculating, and approving complex employee claims.

---

## 2. THE SOUL OF THE SYSTEM (Database & Records)

The database consists of **23 interconnected tables**. 

**How they link together:**
The system is built around the relationship between our clients and our staff. **Clients** sign **Contracts**. **Employees** are assigned to those contracts. When the month ends, the system generates **Payroll Transactions** for those employees, which are grouped into **Payment Batches** for the finance team. On the operational side, **Vendors** submit **Bills**, which can be tied directly to specific client contracts or marked as internal overhead.

### The Absolute Critical Tables
If the database is a body, these tables are the heart and lungs. Their integrity is paramount:
1.  `employees`: The master directory. Holds identity, base salary structures, and contract links for the entire workforce.
2.  `payroll_transactions`: The financial ledger for every single payslip ever generated.
3.  `payment_batches` & `payment_ledger`: The definitive source of truth for money leaving the company to pay staff.
4.  `bills` & `client_invoices`: The core tables tracking all company procurement expenses and incoming client revenue.

---

## 3. THE KEYS TO THE CASTLE (The 11 User Roles)

Access to the system is strictly gated by Google OAuth (restricted to `@asil.com.pk`). Users are assigned one of 11 explicit roles:

1.  **Superadmin**: Has full, unrestricted access to the entire system, database configurations, and dangerous admin tools.
2.  **Finance Manager**: The final authority who approves all top-level financial transactions, bills, and payroll processing.
3.  **Finance Approver**: Reviews and provides first-level approval for invoices and financial entries.
4.  **Finance Proposer**: Drafts and creates client invoices and initial financial entries for review.
5.  **Procurement Manager**: Oversees all procurement operations, inventory tracking, and vendor management.
6.  **Procurement Approver**: Reviews and provides first-level approval for procurement bills.
7.  **Procurement Proposer**: Drafts and submits procurement bills (including OCR uploads) for approval.
8.  **AP Team (Accounts Payable)**: Confirms and executes locked payroll payment batches, generating bank transfer files.
9.  **AR Team (Accounts Receivable)**: Manages, views, and tracks outgoing client invoices and payments.
10. **Payroll Initiator**: Calculates, edits, runs, and officially locks the monthly payroll for the company.
11. **Operations**: Has read and operational access to HR data, documents, and client information, but cannot alter financial ledgers.

---

## 4. THE CALCULATORS (Core Logic Engines)

The system doesn't just store data; it actively calculates statutory requirements and complex claims.

*   **Tax & Labor Laws:** The system automatically calculates Withholding Tax (WHT) using the latest Pakistan FBR slab rates, processes EOBI contributions (fixed at Rs. 400), and handles SESSI calculations. 
*   **Claims Processing:** The system features advanced automated engines that parse massive claim files (via Excel/CSV) or emails, matches them against our employee database, and calculates reimbursements based on complex client-specific rules.

**Where does this math live in the code?**
*   **Backend Tax Engine:** `backend/taxEngine.js` — The absolute source of truth for all WHT and SESSI calculations.
*   **Frontend UI Math:** `frontend/src/payrollUtils.js` — Helper functions that ensure the user interface correctly displays salary splits and totals in real-time.
*   **Claims Processing:** `backend/wafiClaimsService.js` and `backend/emailClaimsService.js` — Massive, dedicated logic engines strictly for parsing and processing claims.

---

## 5. CURRENT BUMPY ROADS (Known Limitations)

Transparency is critical. The following areas are currently fragile, incomplete, or require extreme caution from the development team:

*   **The Giant `server.js` File:** The entire backend API operates out of a single, massive file (`backend/server.js`) that is over 18,000 lines long. It is a fragile monolith. A small change in one area can unexpectedly break another. *No structural refactoring is permitted here until an automated test suite is built.*
*   **Hardcoded Payroll Splits:** The payslip salary components currently assume a fixed `60/20/10/7/3` split (Basic / HRA / Conv / Medical / Other). This split cannot be dynamically changed via the user interface yet.
*   **Single-Step AP Approvals:** Accounts Payable confirms payroll batches in a single step. It currently lacks a secondary "Maker-Checker" final approval step from the Finance Manager.
*   **Dual Invoice Tables:** The database currently has two overlapping tables for invoices (`invoices` and `client_invoices`). This data-split causes code confusion and requires a dedicated consolidation project.
*   **Leave Management is a Placeholder:** The frontend has a "Leave Management" tab, but the values (CL=10, ML=8) are hardcoded placeholders. Leave balances are not currently saved to the database per employee.
*   **Fragile Bulk Imports:** When bulk-importing employees via CSV, the system relies on ASIL-ID conflict resolution rather than strictly enforcing CNIC uniqueness. Importing the same person twice can cause silent overwrites.
