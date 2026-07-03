-- Core Database Entities: Allied Services Operations Engine

CREATE TYPE employment_status AS ENUM ('Active', 'Inactive', 'Terminated', 'Suspended');
CREATE TYPE id_card_status AS ENUM ('Pending', 'Issued', 'Expired', 'Lost');
CREATE TYPE asset_category AS ENUM ('Uniform', 'PPE', 'Equipment');
CREATE TYPE billing_cycle AS ENUM ('Weekly', 'Fortnightly', 'Monthly');
CREATE TYPE margin_type AS ENUM ('Fixed', 'Percentage');

-- 1. Employee Master (Refactored Categories)
CREATE TABLE employee_master (
    employee_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    full_name VARCHAR(255) NOT NULL,
    cnic VARCHAR(15) UNIQUE NOT NULL,
    dob DATE,
    id_card_status id_card_status DEFAULT 'Pending',
    
    -- Employment
    status employment_status DEFAULT 'Active',
    designation VARCHAR(100),
    department VARCHAR(100),
    joining_date DATE NOT NULL,
    location VARCHAR(255),
    so_id UUID, -- Reference to service order
    
    -- Compliance
    eobi_number VARCHAR(50),
    sessi_number VARCHAR(50),
    ntn_number VARCHAR(50),
    
    -- Financial
    bank_account_title VARCHAR(255),
    bank_account_number VARCHAR(100),
    bank_name VARCHAR(255),
    branch_code VARCHAR(50),
    gross_salary DECIMAL(12,2) DEFAULT 0.00,
    
    -- Benefits
    gratuity_eligible BOOLEAN DEFAULT FALSE,
    provident_fund_eligible BOOLEAN DEFAULT FALSE,
    
    -- Medical
    insurance_policy_number VARCHAR(100),
    blood_group VARCHAR(10),
    emergency_contact_name VARCHAR(255),
    emergency_contact_number VARCHAR(20),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Service Order Master for Billing
CREATE TABLE service_order_master (
    so_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    so_reference VARCHAR(100) UNIQUE NOT NULL,
    client_id UUID,
    location VARCHAR(255),
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key constraint back to employee_master
ALTER TABLE employee_master ADD CONSTRAINT fk_employee_so FOREIGN KEY (so_id) REFERENCES service_order_master(so_id);

-- 2. Asset/Uniform Ledger
CREATE TABLE asset_uniform_ledger (
    ledger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employee_master(employee_id) ON DELETE CASCADE,
    asset_category asset_category NOT NULL,
    item_description TEXT NOT NULL,
    issue_date DATE NOT NULL,
    replacement_due_date DATE GENERATED ALWAYS AS (
        CASE 
            WHEN asset_category = 'Uniform' THEN issue_date + INTERVAL '6 months'
            WHEN asset_category = 'PPE' THEN issue_date + INTERVAL '12 months'
            ELSE issue_date + INTERVAL '1 year'
        END
    ) STORED,
    cost DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Client Master
CREATE TABLE client_master (
    client_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_name VARCHAR(255) NOT NULL,
    billing_cycle billing_cycle NOT NULL,
    margin_type margin_type NOT NULL,
    margin_value DECIMAL(10, 2) NOT NULL,
    tax_exempt BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE service_order_master ADD CONSTRAINT fk_so_client FOREIGN KEY (client_id) REFERENCES client_master(client_id);

-- 4. Vendor/Supplier Master
CREATE TABLE vendor_supplier_master (
    vendor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_name VARCHAR(255) NOT NULL,
    is_filer BOOLEAN DEFAULT FALSE,
    ntn_number VARCHAR(50),
    strn_number VARCHAR(50),
    default_fbr_sales_tax_category VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Procurement & Annexure Support Tables
CREATE TABLE raw_bills (
    bill_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES vendor_supplier_master(vendor_id),
    client_id UUID REFERENCES client_master(client_id),
    receipt_image_url TEXT,
    ocr_extracted_total DECIMAL(12,2),
    calculated_items_total DECIMAL(12,2),
    needs_manual_audit BOOLEAN DEFAULT FALSE,
    verification_status VARCHAR(50) DEFAULT 'Pending HITL',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE annexure_drafts (
    annexure_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES client_master(client_id),
    billing_period_start DATE,
    billing_period_end DATE,
    total_material_cost DECIMAL(12,2),
    total_service_charges DECIMAL(12,2),
    total_sales_tax DECIMAL(12,2),
    total_invoice_amount DECIMAL(12,2),
    status VARCHAR(50) DEFAULT 'Draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Financial Benefits & Payroll Support Tables
CREATE TABLE payroll_advances (
    advance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employee_master(employee_id) ON DELETE CASCADE,
    total_amount DECIMAL(10,2) NOT NULL,
    total_installments INT NOT NULL CHECK (total_installments > 0),
    installment_amount DECIMAL(10,2) NOT NULL,
    installments_paid INT DEFAULT 0,
    remaining_balance DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Separate Payroll Transactions Table (replaces month-specific columns)
CREATE TABLE payroll_transactions (
    payroll_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employee_master(employee_id) ON DELETE CASCADE,
    payroll_month DATE NOT NULL, -- Stored as the first day of the month (e.g., '2026-07-01')
    
    -- Grouping for SO Billing / Debit Note
    so_id UUID REFERENCES service_order_master(so_id),
    location VARCHAR(255),
    
    -- Earnings
    basic_salary DECIMAL(12,2) DEFAULT 0.00,
    allowances DECIMAL(12,2) DEFAULT 0.00,
    gross_salary DECIMAL(12,2) DEFAULT 0.00,
    
    -- Compliance Deductions
    eobi_employee_share DECIMAL(10,2) DEFAULT 0.00,
    eobi_employer_share DECIMAL(10,2) DEFAULT 0.00,
    sessi_employer_share DECIMAL(10,2) DEFAULT 0.00,
    income_tax_wht DECIMAL(10,2) DEFAULT 0.00,
    
    -- Other Deductions
    advance_deduction DECIMAL(10,2) DEFAULT 0.00,
    other_deductions DECIMAL(10,2) DEFAULT 0.00,
    
    -- Net Payable
    net_salary DECIMAL(12,2) GENERATED ALWAYS AS (
        gross_salary - eobi_employee_share - income_tax_wht - advance_deduction - other_deductions
    ) STORED,
    
    -- Total Cost to Company (for Services Order billing / Debit notes)
    total_cost_to_company DECIMAL(12,2) GENERATED ALWAYS AS (
        gross_salary + eobi_employer_share + sessi_employer_share
    ) STORED,
    
    status VARCHAR(50) DEFAULT 'Draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pf_gratuity_ledger (
    ledger_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employee_master(employee_id) ON DELETE CASCADE,
    pf_employee_contrib DECIMAL(10,2) DEFAULT 0.00,
    pf_employer_contrib DECIMAL(10,2) DEFAULT 0.00,
    gratuity_accrual DECIMAL(10,2) DEFAULT 0.00,
    record_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- AUTOMATED CALCULATIONS FOR PAKISTAN 2026 COMPLIANCE
-- ==============================================================================

-- 1. EOBI Calculation Function
CREATE OR REPLACE FUNCTION calculate_eobi(gross_wage DECIMAL)
RETURNS TABLE (employee_share DECIMAL, employer_share DECIMAL) AS $$
DECLARE
    min_wage DECIMAL := 37000; -- Current min wage bound
    applicable_wage DECIMAL;
BEGIN
    applicable_wage := LEAST(gross_wage, min_wage);
    employee_share := applicable_wage * 0.01; -- 1% Employee
    employer_share := applicable_wage * 0.05; -- 5% Employer
    RETURN QUERY SELECT employee_share, employer_share;
END;
$$ LANGUAGE plpgsql;

-- 2. SESSI Calculation Function
CREATE OR REPLACE FUNCTION calculate_sessi(gross_wage DECIMAL)
RETURNS DECIMAL AS $$
DECLARE
    min_wage DECIMAL := 37000; -- Current legal limit cap for SESSI
    applicable_wage DECIMAL;
BEGIN
    applicable_wage := LEAST(gross_wage, min_wage);
    RETURN applicable_wage * 0.06; -- 6% of wages
END;
$$ LANGUAGE plpgsql;

-- 3. Income Tax (WHT) Function (FBR 2025-26 Salary Tax Slabs)
CREATE OR REPLACE FUNCTION calculate_monthly_income_tax(monthly_gross DECIMAL)
RETURNS DECIMAL AS $$
DECLARE
    annual_salary DECIMAL;
    annual_tax DECIMAL := 0;
BEGIN
    annual_salary := monthly_gross * 12;
    
    -- FBR 2025-26 Tax Slabs for Salaried Individuals
    IF annual_salary <= 600000 THEN
        annual_tax := 0;
    ELSIF annual_salary <= 1200000 THEN
        annual_tax := (annual_salary - 600000) * 0.05;
    ELSIF annual_salary <= 2200000 THEN
        annual_tax := 30000 + (annual_salary - 1200000) * 0.15;
    ELSIF annual_salary <= 3200000 THEN
        annual_tax := 180000 + (annual_salary - 2200000) * 0.25;
    ELSIF annual_salary <= 4100000 THEN
        annual_tax := 430000 + (annual_salary - 3200000) * 0.30;
    ELSE
        annual_tax := 700000 + (annual_salary - 4100000) * 0.35;
    END IF;

    RETURN ROUND(annual_tax / 12, 2);
END;
$$ LANGUAGE plpgsql;

-- 4. Gratuity Calculation Function
CREATE OR REPLACE FUNCTION calculate_gratuity(employee_id_param UUID, calc_date DATE)
RETURNS DECIMAL AS $$
DECLARE
    emp_record RECORD;
    years_of_service DECIMAL;
    gratuity_amount DECIMAL := 0;
BEGIN
    SELECT joining_date, gross_salary INTO emp_record 
    FROM employee_master 
    WHERE employee_id = employee_id_param;

    IF FOUND THEN
        -- Precise year extraction based on days
        years_of_service := EXTRACT(EPOCH FROM (calc_date - emp_record.joining_date)) / 31536000;
        
        -- Formula: (Last Drawn Gross Salary / 26) * 30 * Years of Service
        IF years_of_service > 0 THEN
            gratuity_amount := (emp_record.gross_salary / 26) * 30 * years_of_service;
        END IF;
    END IF;

    RETURN ROUND(gratuity_amount, 2);
END;
$$ LANGUAGE plpgsql;

-- Trigger Function for Advance Deductions upon Payroll Generation
CREATE OR REPLACE FUNCTION deduct_advance_installment()
RETURNS TRIGGER AS $$
BEGIN
    -- Logic to deduct installment_amount from remaining_balance
    -- and increment installments_paid.
    -- If remaining_balance <= 0, mark as completed.
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- LIVE PRODUCTION SCHEMA ADDITIONS (employees table — not employee_master)
-- migration 2026-07-02 — Phase 1 Data Layer & Portal Upgrade
-- ═══════════════════════════════════════════════════════════════════════════════

-- Operational fields appended to live `employees` table
-- employees.dept stores Department (canonical column name since v1)
-- ALTER TABLE employees ADD COLUMN IF NOT EXISTS site TEXT;
-- ALTER TABLE employees ADD COLUMN IF NOT EXISTS sessi_no TEXT;
-- ALTER TABLE employees ADD COLUMN IF NOT EXISTS shirt_size TEXT;
-- ALTER TABLE employees ADD COLUMN IF NOT EXISTS trouser_size TEXT;
-- ALTER TABLE employees ADD COLUMN IF NOT EXISTS safety_shoe_size TEXT;
-- ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_uniform_issue_date DATE;
-- ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_ppe_issue_date DATE;
-- ALTER TABLE employees ADD COLUMN IF NOT EXISTS gate_pass_expiry DATE;
-- ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_cycle_type TEXT DEFAULT 'Monthly';

CREATE TABLE IF NOT EXISTS portal_otps (
    id          SERIAL PRIMARY KEY,
    phone       TEXT NOT NULL,
    otp         TEXT NOT NULL,
    used        BOOLEAN DEFAULT FALSE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_change_requests (
    id              SERIAL PRIMARY KEY,
    employee_id     TEXT NOT NULL,
    employee_name   TEXT,
    field_name      TEXT NOT NULL,
    field_label     TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT NOT NULL,
    status          TEXT DEFAULT 'Pending',
    submitted_at    TIMESTAMPTZ DEFAULT NOW(),
    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,
    notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_chgreq_status ON employee_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_chgreq_empid ON employee_change_requests(employee_id);

-- ═══ Phase 2 Operations Mandate (2026-07-03) ═══════════════════════════════
-- Tables created idempotently at startup via backend/phase2Service.js:
-- uploaded_files, employee_warnings, report_subscriptions, report_dispatch_log,
-- maintenance_tickets, site_escalation_rules, ticket_escalations,
-- petty_cash_funds, petty_cash_ledger, employee_leaves, employee_leave_balances
-- attendance_records extended: site, dept, status includes 'unexcused'
-- contracts extended: allied_focal_email, client_focal_name, client_focal_email
-- CMMS site onboarding (2026-07-03): cmms_sites, cmms_client_users, client_otps
-- maintenance_tickets extended: due_date, billable_to_client, raised_via, cc_email
-- site_escalation_rules extended: basis (hours_open | hours_overdue)
