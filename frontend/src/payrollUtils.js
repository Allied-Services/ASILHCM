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
export const calcWHT = (annual) => {
    if (annual <= 600000) return 0;
    if (annual <= 1200000) return Math.round(((annual - 600000) * 0.05) / 12);
    if (annual <= 2200000) return Math.round((30000 + (annual - 1200000) * 0.15) / 12);
    if (annual <= 3200000) return Math.round((180000 + (annual - 2200000) * 0.25) / 12);
    if (annual <= 4100000) return Math.round((430000 + (annual - 3200000) * 0.30) / 12);
    return Math.round((700000 + (annual - 4100000) * 0.35) / 12);
};
export const calcEOBI_fn = (basic) => {
    const w = Math.min(basic, 37000);
    return { employee: Math.round(w * 0.01), employer: Math.round(w * 0.05) };
};
export const calcPF_fn = (basic, enrolled) => enrolled ? Math.round(basic * 0.0833) : 0;
export const calcGratuityMonthly = (gross) => Math.round((gross / 26) * 30 / 12);

export const calcEmployeeRow = (emp, ov, cfg, workDays) => {
    const pd = parseFloat(ov.paid_days ?? workDays) || 0;
    const dailyBasic = emp.basic / workDays;
    const hrlyBasic = dailyBasic / 8;
    const basicPaid = Math.round(dailyBasic * pd);
    const hraPaid = Math.round((emp.hra || 0) * pd / workDays);
    const convPaid = Math.round((emp.conveyance || 0) * pd / workDays);
    const medPaid = Math.round((emp.medical_allowance || 0) * pd / workDays);
    const otherPaid = Math.round((emp.other_allowances || 0) * pd / workDays);
    const ot2hrs = parseFloat(ov.ot2_hrs || 0);
    const ot3hrs = parseFloat(ov.ot3_hrs || 0);
    const otAmount = Math.round(hrlyBasic * (ot2hrs * 2 + ot3hrs * 3));
    const opdClaim = parseFloat(ov.opd_claim || 0);
    const reimb = parseFloat(ov.reimbursement || 0);
    const arrears = parseFloat(ov.arrears || 0);
    const splAllow = parseFloat(ov.special_allowance || 0);
    const fuelMob = parseFloat(ov.fuel_mobile || 0);
    const grossMonthly = basicPaid + hraPaid + convPaid + medPaid + otherPaid + otAmount + opdClaim + reimb + arrears + splAllow + fuelMob;
    const annualIncome = grossMonthly * 12;
    const incomeTax = calcWHT(annualIncome);
    const eobi = calcEOBI_fn(emp.basic);
    const pfEE = calcPF_fn(emp.basic, emp.pf_enrolled);
    const otherDed = parseFloat(ov.other_deduction || 0);
    const advanceDed = parseFloat(ov.advance_deduction || 0);
    const loanDed = parseFloat(ov.loan_deduction || 0);
    const totalDeductions = incomeTax + eobi.employee + pfEE + otherDed + advanceDed + loanDed;
    const netPay = grossMonthly - totalDeductions;
    const sessi = parseFloat(cfg.sessi || 0);
    const eduCess = parseFloat(cfg.edu_cess || 0);
    const bonusAmount = parseFloat(ov.bonus_amount || 0);
    const gratuity = calcGratuityMonthly(emp.gross);
    const pfER = calcPF_fn(emp.basic, emp.pf_enrolled);
    const lifeIns = parseFloat(cfg.life_insurance || 0);
    const medEE = parseFloat(ov.medical_ee ?? (cfg.medical_ee || 0));
    const medSP = parseFloat(ov.medical_sp ?? (cfg.medical_sp || 0));
    const medCh1 = parseFloat(ov.medical_ch1 ?? (cfg.medical_ch || 0));
    const medCh2 = parseFloat(ov.medical_ch2 ?? 0);
    const totalMedical = medEE + medSP + medCh1 + medCh2;
    const totalPayrollCost = grossMonthly + eobi.employer + sessi + eduCess + bonusAmount + gratuity + lifeIns + totalMedical + pfER;
    const svcPct = parseFloat(cfg.service_charges_pct || 0);
    const stPct = parseFloat(cfg.sales_tax_pct || 0);
    const serviceCharges = Math.round(totalPayrollCost * svcPct / 100);
    const salesTax = Math.round(serviceCharges * stPct / 100);
    const totalInvoice = totalPayrollCost + serviceCharges + salesTax;
    return {
        pd, ot2hrs, ot3hrs, basicPaid, hraPaid, convPaid, medPaid, otherPaid,
        otAmount, opdClaim, reimb, arrears, splAllow, fuelMob, grossMonthly, annualIncome,
        incomeTax, eobi_ee: eobi.employee, pfEE, otherDed, advanceDed, loanDed,
        totalDeductions, netPay, eobi_er: eobi.employer, sessi, eduCess, bonusAmount,
        gratuity, pfER, lifeIns, medEE, medSP, medCh1, medCh2, totalMedical,
        totalPayrollCost, serviceCharges, salesTax, totalInvoice,
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
    'Special Allowance': calc.splAllow, 'Fuel/Mobile Allow': calc.fuelMob,
    'Gross Monthly': calc.grossMonthly,
    'Income Tax': calc.incomeTax, 'EOBI EE': calc.eobi_ee, 'PF EE': calc.pfEE,
    'Advance': calc.advanceDed, 'Loan Installment': calc.loanDed,
    'Total Deductions': calc.totalDeductions, 'Net Pay': calc.netPay,
    'EOBI ER': calc.eobi_er, 'SESSI': calc.sessi,
    'Gratuity Provision': calc.gratuity, 'Life Insurance': calc.lifeIns,
    'Medical EE': calc.medEE, 'Medical SP': calc.medSP,
    'Medical Ch1': calc.medCh1, 'Medical Ch2': calc.medCh2,
    'Total Medical': calc.totalMedical, 'Total Payroll Cost': calc.totalPayrollCost,
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
