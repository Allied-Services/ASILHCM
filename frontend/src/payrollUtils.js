// ═══ Payroll Export & Import Utilities ═══════════════════════════════════════
export const COMPANY = {
    name: 'Allied Services (Pvt.) Ltd.',
    ntn: '7483900-1',
    city: 'Karachi',
    address: 'Office 301, 3rd Floor, Business Avenue, Shahrah-e-Faisal, Karachi',
};

// Employees are loaded from the Neon DB via the backend API
export const PAYROLL_EMPLOYEES = [];


export const PAYROLL_CONTRACT_CFG = {
    'CTR-2026-A1': { service_charges_pct: 15, sales_tax_pct: 17, life_insurance: 500, medical_ee: 800, medical_sp: 600, medical_ch: 300, sessi: 2220, edu_cess: 0, client_approval: true },
    'CTR-2025-X9': { service_charges_pct: 10, sales_tax_pct: 17, life_insurance: 300, medical_ee: 600, medical_sp: 0, medical_ch: 0, sessi: 2220, edu_cess: 0, client_approval: false },
};

// ─── Calculation engine ───────────────────────────────────────────────────────
// Strip comma-formatting from CSV numbers like "10,000" → 10000
export const parseNum = (v) => parseFloat(String(v || '').replace(/,/g, '')) || 0;

// FBR 2025-26 Salaried Individual — Finance Act 2024
// taxableAnnual = (grossMonthly - OPD - Reimbursement) × 12
export const calcWHT = (annual) => {
    if (annual <= 600000) return 0;
    if (annual <= 1200000) return Math.round(((annual - 600000) * 0.01) / 12);
    if (annual <= 2200000) return Math.round((6000 + (annual - 1200000) * 0.11) / 12);
    if (annual <= 3200000) return Math.round((116000 + (annual - 2200000) * 0.23) / 12);
    if (annual <= 4100000) return Math.round((346000 + (annual - 3200000) * 0.30) / 12);
    return Math.round((616000 + (annual - 4100000) * 0.35) / 12);
};
export const calcEOBI_fn = () => {
    // EOBI is a flat statutory amount — 1%/5% of minimum wage Rs. 40,000
    // Fixed for ALL employees regardless of their salary
    return { employee: 400, employer: 2000 };
};
// PF: 1/24th of Gross Salary (≈ 4.166%) — both EE and ER
export const calcPF_fn = (gross, enrolled) => enrolled ? Math.round(parseFloat(gross || 0) / 24) : 0;
// Gratuity monthly accrual: 1/12th of Gross Salary (≈ 8.33%) — Employer cost only, per EOB Ord 1968
export const calcGratuityMonthly = (gross) => Math.round(parseFloat(gross || 0) / 12);

// ─── Province → Provincial Service Tax Rate ──────────────────────────────────
// Punjab: PRA 16%, Sindh: SRB 13%, KPK: KPRA 15%, Balochistan: BRA 15%, Federal/Other: 13%
// provinceSalesTaxRate: looks up the rate from System Config "Tax by Region" (DB-driven).
// Falls back to statutory defaults if the province isn't found in the rates array.
// rates = array of { province: string, salesTaxPct: number } from system_config key 'region_tax'
export const provinceSalesTaxRate = (province, rates = []) => {
    const p = (province || '').toLowerCase();
    // 1. Try DB-driven rates from System Config (Tax by Region tab)
    if (rates && rates.length > 0) {
        const match = rates.find(r => p.includes((r.province || '').toLowerCase().split('/')[0].trim()));
        if (match) return (parseFloat(match.salesTaxPct) || 0) / 100;
    }
    // 2. Fallback: statutory defaults aligned with System Config defaults
    if (p.includes('sindh') || p.includes('karachi') || p.includes('hyderabad') || p.includes('sukkur')) return 0.15;
    if (p.includes('punjab') || p.includes('lahore') || p.includes('faisalabad') || p.includes('rawalpindi') || p.includes('islamabad') || p.includes('multan') || p.includes('gujranwala')) return 0.16;
    if (p.includes('kpk') || p.includes('khyber') || p.includes('peshawar') || p.includes('abbottabad') || p.includes('kohat')) return 0.15;
    if (p.includes('balochistan') || p.includes('quetta')) return 0.15;
    if (p.includes('ict') || p.includes('federal') || p.includes('islamabad')) return 0.17;
    return 0.15; // default: apply Sindh rate (most common region for ASIL)
};

// provinceRates: optional array of { province, salesTaxPct } from System Config
export const calcEmployeeRow = (emp, ov, cfg, workDays, provinceRates = []) => {
    const pd = parseFloat(ov.paid_days ?? workDays) || 0;
    // FIXED FORMULAS (per user spec):
    // - OT Hourly Rate  = Gross Salary / (26 × 8) — always 208 hours/month
    // - Leave Deduction = Gross Salary / 26       — always 26 working days
    const grossSalary = parseFloat(emp.gross) || parseFloat(emp.salary) || parseFloat(emp.basic) || 0;
    const hrlyGross = grossSalary / (26 * 8);   // for OT calc
    const dailyGross = grossSalary / 26;         // for leave/absence deduction

    // Attendance proration of salary components
    // Two modes:
    //   A) Joining-month pro-rata: salary = calDaysWorked/totalCalDays × grossSalary
    //      Used when ov.totalCalDays is set (new joiner mid-month).
    //      Business rule: 27 calendar days out of 31 = 27/31 × salary
    //   B) Standard absence deduction: absentDays × (gross/26)
    //      Used for normal attendance shortfalls.
    let absenceDeduction;
    let absentDays = 0;
    if (ov.totalCalDays && ov.calDaysWorked) {
        // Mode A: pro-rata by calendar days (new joiner)
        const proratedGross = Math.round(grossSalary * ov.calDaysWorked / ov.totalCalDays);
        absenceDeduction = grossSalary - proratedGross;
        absentDays = 0; // not applicable in this mode
    } else {
        // Mode B: standard working-day absence deduction
        absentDays = Math.max(0, workDays - pd);
        absenceDeduction = Math.round(absentDays * dailyGross);
    }
    // Gross components (paid = full month, absence deducted)
    const basicPaid   = Math.round(parseFloat(emp.basic || 0));
    const hraPaid     = Math.round(parseFloat(emp.hra || 0));
    const convPaid    = Math.round(parseFloat(emp.conveyance || 0));
    const medPaid     = Math.round(parseFloat(emp.medical_allowance || 0));
    const otherPaid   = Math.round(parseFloat(emp.other_allowances || 0));

    const ot2hrs = parseNum(ov.ot2_hrs || 0);
    const ot3hrs = parseNum(ov.ot3_hrs || 0);
    // OT: Gross / (26×8) × multiplier × hours
    const ot2Amount = Math.round(hrlyGross * 2 * ot2hrs);
    const ot3Amount = Math.round(hrlyGross * 3 * ot3hrs);
    const otAmount = ot2Amount + ot3Amount;
    const opdClaim = parseNum(ov.opd_claim || 0);
    const reimb = parseNum(ov.reimbursement || 0);
    const arrears = parseNum(ov.arrears || 0);
    const splAllow = parseNum(ov.special_allowance || 0);
    const fuelMob = parseNum(ov.fuel_mobile || 0);
    // Gross = full salary components + OT + extras - absence deduction
    const grossMonthly = basicPaid + hraPaid + convPaid + medPaid + otherPaid
        + otAmount + opdClaim + reimb + arrears + splAllow + fuelMob - absenceDeduction;
    // Taxable income EXCLUDES OPD and expense reimbursements (non-taxable per FBR rules)
    const taxableMonthly = grossMonthly - opdClaim - reimb;
    const annualIncome = taxableMonthly * 12;
    const incomeTax = calcWHT(annualIncome);
    const eobi = calcEOBI_fn(); // flat Rs. 400 EE / Rs. 2,000 ER
    // ── End-of-Service Benefit (EOSB) from contract type ──────────────────────
    // Priority: contract cfg.eosb_type > employee pf_enrolled flag
    const eosbType = cfg.eosb_type || (emp.pf_enrolled ? 'Provident Fund' : 'None');
    const isPF       = eosbType === 'Provident Fund';
    const isGratuity = eosbType === 'Gratuity';
    // PF Employee & Employer: Gross/24 if Provident Fund scheme
    const pfEE = isPF ? calcPF_fn(grossSalary, true) : 0;
    const pfER = pfEE; // employer matches employee 1-for-1
    const otherDed = parseNum(ov.other_deduction || 0);
    const advanceDed = parseNum(ov.advance_deduction || 0);
    const loanDed = parseNum(ov.loan_deduction || 0);
    const totalDeductions = incomeTax + eobi.employee + pfEE + otherDed + advanceDed + loanDed;
    const netPay = grossMonthly - totalDeductions;
    // SESSI: 6% of minimum wage (Rs.40,000), always capped at Rs.2,400
    const sessi = Math.min(2400, Math.round(grossMonthly * 0.06));
    const eduCess = parseFloat(cfg.edu_cess || 0);
    const bonusAmount = parseFloat(ov.bonus_amount || 0);
    // Bonus accrual: contract defines bonus_months × gross / 12 as monthly employer provision
    // e.g. 1 bonus month/yr → 1/12 of gross added to employer cost each month
    const bonusMonths = parseFloat(cfg.bonus_months || 0);
    const bonusAccrual = bonusMonths > 0 ? Math.round(bonusMonths * grossSalary / 12) : 0;
    // Gratuity monthly accrual (Employer cost only — no employee deduction):
    //   Gratuity  = Gross / 12  (1/12th = 8.33% of Gross — per EOB Ordinance 1968)
    //   PF        = 0 when Gratuity scheme active (pfER covers Provident Fund instead)
    //   None      = 0 (no EOSB provision)
    const gratuity = isGratuity ? Math.round(grossSalary / 12) : 0;
    // pfER already declared above — employer matches employee contribution
    const lifeIns = parseFloat(cfg.life_insurance || 0);
    const medEE = parseFloat(ov.medical_ee ?? (cfg.medical_ee || 0));
    const medSP = parseFloat(ov.medical_sp ?? (cfg.medical_sp || 0));
    const medCh1 = parseFloat(ov.medical_ch1 ?? (cfg.medical_child || 0));
    const medCh2 = parseFloat(ov.medical_ch2 ?? 0);
    const totalMedical = medEE + medSP + medCh1 + medCh2;
    // Total employer payroll cost = gross + all employer obligations
    // pfER is employer's PF contribution (= employee's contribution when PF type)
    // bonusAccrual is the monthly provision for annual bonus (from contract.bonus_months)
    // overhead is a fixed per-head charge from the contract
    const overhead = parseFloat(cfg.overhead_per_employee || 0);
    const totalPayrollCost = grossMonthly + eobi.employer + sessi + eduCess + bonusAmount + bonusAccrual + gratuity + lifeIns + totalMedical + pfER + overhead;
    const svcPct = parseFloat(cfg.service_charges_pct || 0);
    // Sales tax: rate from System Config "Tax by Region" (DB-driven via provinceRates param)
    // Base: Total Payroll Cost + Service Charges (full invoice value, per MD instruction)
    const stRate = provinceSalesTaxRate(emp.province || emp.location || '', provinceRates);
    const serviceCharges = Math.round(totalPayrollCost * svcPct / 100);
    const salesTax = Math.round((totalPayrollCost + serviceCharges) * stRate);
    const totalInvoice = totalPayrollCost + serviceCharges + salesTax;
    return {
        pd, ot2hrs, ot3hrs, ot2Amount, ot3Amount, basicPaid, hraPaid, convPaid, medPaid, otherPaid,
        otAmount, opdClaim, reimb, arrears, splAllow, fuelMob, absenceDeduction, absentDays,
        grossMonthly, taxableMonthly, annualIncome,
        incomeTax, eobi_ee: eobi.employee, pfEE, otherDed, advanceDed, loanDed,
        totalDeductions, netPay, eobi_er: eobi.employer, sessi, eduCess, bonusAmount, bonusAccrual,
        gratuity, pfER, lifeIns, medEE, medSP, medCh1, medCh2, totalMedical, overhead,
        totalPayrollCost, serviceCharges, salesTax, totalInvoice,
        hrlyGross, dailyGross,
    };
};

// ─── CSV download helper ──────────────────────────────────────────────────────
export const downloadCSV = (filename, rows) => {
    if (!rows.length) return alert('No data to export.');
    const headers = Object.keys(rows[0]);
    const csv = [
        headers.join(','),
        ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

// ─── Export builders ──────────────────────────────────────────────────────────
export const buildPayrollCSV = (rows, month) => rows.map(({ emp, calc }) => ({
    'Month': month, 'Employee ID': emp.id, 'Employee Name': emp.name,
    'CNIC': emp.cnic, 'Contract': emp.contract, 'Location': emp.location,
    'Gross Salary': emp.gross, 'Paid Days': calc.pd,
    'OT @2X Hrs': calc.ot2hrs, 'OT @3X Hrs': calc.ot3hrs, 'OT Amount': calc.otAmount,
    'OPD Claim': calc.opdClaim, 'Reimbursement': calc.reimb, 'Arrears': calc.arrears,
    // Bug fix: Other Allowances (3% component) and Bonus were missing from export
    'Other Allowances': calc.otherPaid,
    'Special Allowance': calc.splAllow, 'Fuel/Mobile Allow': calc.fuelMob,
    'Bonus (Cash)': calc.bonusAmount,
    'Gross Monthly': calc.grossMonthly,
    'Income Tax': calc.incomeTax, 'EOBI EE': calc.eobi_ee, 'PF EE': calc.pfEE,
    'Advance': calc.advanceDed, 'Loan Installment': calc.loanDed,
    'Other Deduction': calc.otherDed,
    'Total Deductions': calc.totalDeductions, 'Net Pay': calc.netPay,
    'EOBI ER': calc.eobi_er, 'SESSI': calc.sessi,
    'PF Employer': calc.pfER,
    'Bonus Accrual (Monthly)': calc.bonusAccrual,
    'Gratuity Provision': calc.gratuity, 'Life Insurance': calc.lifeIns,
    'Medical EE': calc.medEE, 'Medical SP': calc.medSP,
    'Medical Ch1': calc.medCh1, 'Medical Ch2': calc.medCh2,
    'Total Medical': calc.totalMedical,
    'Overhead (Fixed)': calc.overhead,
    'Total Payroll Cost': calc.totalPayrollCost,
    'Service Charges': calc.serviceCharges, 'Sales Tax': calc.salesTax,
    'Total Invoice': calc.totalInvoice,
}));

export const buildHBLFile = (rows, month) => rows.map(({ emp, calc }, i) => ({
    'Employee ID': emp.id,
    'Beneficiary Name': emp.name,
    'Beneficiary Account Number': emp.bankAccount || '',
    'Transaction Amount': calc.netPay,
    'Customer Reference Number': `ASIL-${month}-${String(i + 1).padStart(3, '0')}`,
    'Beneficiary Bank Name': emp.bankName || 'HBL',
    'Bene Bank Code': emp.bankCode || 'HBL001',
    'Contact Number': emp.contact || '',
    'Email Address': emp.email || '',
}));

export const buildWHTFile = (rows) => rows.filter(r => r.calc.incomeTax > 0).map(({ emp, calc }) => ({
    'Payment Section': 'Salary',
    'TaxPayer_NTN': '',
    'TaxPayer_CNIC': emp.cnic,
    'TaxPayer_Name': emp.name,
    'TaxPayer_City': emp.city || 'Karachi',
    'TaxPayer_Address': emp.address || '',
    'TaxPayer_Status': 'Individual - Salaried',
    'TaxPayer_Business_Name': COMPANY.name,
    'Taxable_Amount': calc.grossMonthly,
    'Tax_Amount': calc.incomeTax,
}));

export const buildEOBIFile = (rows, month) => rows.map(({ emp, calc }) => ({
    'Month': month,
    'Employee ID': emp.id,
    'Employee Name': emp.name,
    'CNIC': emp.cnic,
    'EOBI Number': emp.eobiNo || '',
    'EOBI Employee (1%)': calc.eobi_ee,
    'EOBI Employer (5%)': calc.eobi_er,
    'Total EOBI': calc.eobi_ee + calc.eobi_er,
}));

export const buildSESSIFile = (rows, month) => rows.map(({ emp, calc }) => ({
    'Month': month,
    'Employee ID': emp.id,
    'Employee Name': emp.name,
    'CNIC': emp.cnic,
    'EOBI Number': emp.eobiNo || '',
    'SESSI Amount': calc.sessi,
}));
