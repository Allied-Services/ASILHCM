// â•â•â• Payroll Export & Import Utilities â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

// â”€â”€â”€ Calculation engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Strip comma-formatting from CSV numbers like "10,000" â†’ 10000
export const parseNum = (v) => parseFloat(String(v || '').replace(/,/g, '')) || 0;

// FBR 2025-26 Salaried Individual â€” Finance Act 2024
// taxableAnnual = (grossMonthly - OPD - Reimbursement) Ã— 12
export const calcWHT = (annual) => {
    if (annual <= 600000) return 0;
    if (annual <= 1200000) return Math.round(((annual - 600000) * 0.01) / 12);
    if (annual <= 2200000) return Math.round((6000 + (annual - 1200000) * 0.11) / 12);
    if (annual <= 3200000) return Math.round((116000 + (annual - 2200000) * 0.23) / 12);
    if (annual <= 4100000) return Math.round((346000 + (annual - 3200000) * 0.30) / 12);
    return Math.round((616000 + (annual - 4100000) * 0.35) / 12);
};
export const calcEOBI_fn = () => {
    // EOBI is a flat statutory amount â€” 1%/5% of minimum wage Rs. 40,000
    // Fixed for ALL employees regardless of their salary
    return { employee: 400, employer: 2000 };
};
// PF: 1/24th of Gross Salary (â‰ˆ 4.166%) â€” both EE and ER
export const calcPF_fn = (gross, enrolled) => enrolled ? Math.round(parseFloat(gross || 0) / 24) : 0;
// Gratuity monthly accrual: 1/12th of CONTRACTUAL BASE SALARY (â‰ˆ 8.33%) â€” Employer cost only, per EOB Ord 1968
// IMPORTANT: always pass emp.gross (contractual base), NOT grossMonthly (which inflates with OT)
export const calcGratuityMonthly = (grossSalary) => Math.round(parseFloat(grossSalary || 0) / 12);

// â”€â”€â”€ Province â†’ Provincial Service Tax Rate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    const pd = Math.max(0, parseFloat(ov.paid_days ?? workDays) || 0);

    // â”€â”€ Core salary values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const grossSalary = parseFloat(emp.gross) || parseFloat(emp.salary) || 0;

    // â”€â”€ UNIVERSAL GROSS FORMULA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // gross = salary Ã— paid_days / working_days
    // This is the single source of truth for all cases:
    //   â€¢ Full month attendance  â†’ pd = workDays â†’ gross = salary  âœ“
    //   â€¢ Absence deduction      â†’ pd < workDays â†’ gross prorated  âœ“
    //   â€¢ New joiner mid-month   â†’ pd = days actually worked       âœ“
    //   â€¢ Mid-month exit         â†’ pd = days worked before exit    âœ“
    // No Mode A / Mode B. No competing calendar-day proration.
    const grossPay = workDays > 0 ? Math.round(grossSalary * pd / workDays) : 0;

    // For the breakdown panel display â€” show the deduction so users understand
    const absentDays = Math.max(0, workDays - pd);
    const absenceDeduction = grossSalary - grossPay; // = salary Ã— absentDays/workDays

    // â”€â”€ OT always uses full contractual salary / 208 hrs (business rule) â”€â”€â”€â”€â”€â”€â”€â”€
    const hrlyGross  = grossSalary / (26 * 8); // OT rate stays fixed regardless of attendance
    const dailyGross = grossSalary / 26;        // exposed for breakdown panel

    const ot2hrs = parseNum(ov.ot2_hrs || 0);
    const ot3hrs = parseNum(ov.ot3_hrs || 0);
    const ot2Amount = Math.round(hrlyGross * 2 * ot2hrs);
    const ot3Amount = Math.round(hrlyGross * 3 * ot3hrs);
    const otAmount  = ot2Amount + ot3Amount;

    const opdClaim = parseNum(ov.opd_claim        || 0);
    const reimb    = parseNum(ov.reimbursement     || 0);
    const arrears  = parseNum(ov.arrears           || 0);
    const splAllow = parseNum(ov.special_allowance || 0);
    const fuelMob  = parseNum(ov.fuel_mobile       || 0);

    // -- Bonus: calculated BEFORE grossMonthly so it is included in pay and tax ---
    const bonusAmount    = parseFloat(ov.bonus_amount || 0);
    const bonusMonths    = parseFloat(cfg.bonus_months || 0);
    const bonusMinMonths = parseFloat(cfg.bonus_min_months ?? 12);
    const disbursementMo = parseInt(cfg.bonus_disbursement_month || 0);
    const bonusAccrual   = bonusMonths > 0 ? Math.round(bonusMonths * grossSalary / 12) : 0;

    let bonusDisbursed = bonusAmount;
    let contractAutoBonus = false;
    const isJuly2026Cutover = typeof window !== 'undefined'
        && window.__payrollMonth === '2026-07';
    // July 2026 WAFI: bonus comes from payroll_transactions.bonus_amount (accrual sheet), not contract formula.
    if (!isJuly2026Cutover
        && bonusMonths > 0 && bonusAmount === 0 && disbursementMo > 0
        && typeof window !== 'undefined' && window.__payrollMonth) {
        const [pyear, pmonth] = String(window.__payrollMonth).split('-').map(Number);
        if (pmonth === disbursementMo) {
            contractAutoBonus = true;
            let monthsServed = 12;
            if (emp.doj) {
                const doj        = new Date(emp.doj);
                const cycleStart = new Date(pyear - 1, disbursementMo - 1, 1);
                if (doj > cycleStart) {
                    const cycleEnd = new Date(pyear, disbursementMo - 1, 28);
                    monthsServed   = Math.max(0,
                        (cycleEnd.getFullYear() - doj.getFullYear()) * 12 +
                        (cycleEnd.getMonth() - doj.getMonth())
                    );
                }
            }
            if (monthsServed >= bonusMinMonths) {
                bonusDisbursed = Math.round(bonusMonths * grossSalary);
            } else if (monthsServed > 0) {
                bonusDisbursed = Math.round(bonusMonths * grossSalary * monthsServed / 12);
            } else {
                bonusDisbursed = 0;
            }
        }
    }

    // Excel "Special Allowance" maps to bonus for verification only — never stack on contract auto-bonus.
    const effectiveSplAllow = contractAutoBonus && bonusDisbursed > 0 ? 0 : splAllow;

    // Gross Monthly: ALL cash paid to the employee, including bonus disbursement.
    const grossMonthly = grossPay + otAmount + opdClaim + reimb + arrears + effectiveSplAllow + fuelMob + bonusDisbursed;

    // Breakdown display fields (used by BreakdownPanel — keep same names)
    const basicPaid  = grossPay;
    const hraPaid    = 0;
    const convPaid   = 0;
    const medPaid    = 0;
    const otherPaid  = 0;

    // Taxable income EXCLUDES OPD and expense reimbursements (non-taxable per FBR rules)
    const taxableMonthly = grossMonthly - opdClaim - reimb;
    const annualIncome   = taxableMonthly * 12;
    const incomeTax      = calcWHT(annualIncome);
    const eobi           = calcEOBI_fn(); // flat Rs. 400 EE / Rs. 2,000 ER

    // ——— EOSB ———————————————————————————————————————————————————————————————
    const eosbType   = cfg.eosb_type || (emp.pf_enrolled ? 'Provident Fund' : 'None');
    const isPF       = eosbType === 'Provident Fund';
    const isGratuity = eosbType === 'Gratuity';
    const pfEE       = isPF ? calcPF_fn(grossSalary, true) : 0;
    const pfER       = pfEE;

    const otherDed   = parseNum(ov.other_deduction   || 0);
    const advanceDed = parseNum(ov.advance_deduction  || 0);
    const loanDed    = parseNum(ov.loan_deduction     || 0);
    const totalDeductions = incomeTax + eobi.employee + pfEE + otherDed + advanceDed + loanDed;
    const netPay     = grossMonthly - totalDeductions;

    // ——— Gratuity ———————————————————————————————————————————————————————————
    const gratuity = isGratuity ? Math.round(grossSalary / 12) : 0;
    const lifeIns  = parseFloat(cfg.life_insurance || 0);

    // ——— Medical insurance ——————————————————————————————————————————————————
    const hasSpouse   = !!(emp.hasSpouse);
    const numChildren = parseInt(emp.numChildren) || 0;
    const cfgRateSP   = parseFloat(cfg.medical_sp    || 0);
    const cfgRateCh   = parseFloat(cfg.medical_child || 0);
    const medSP  = !hasSpouse     ? 0 : ov.medical_sp  != null ? parseFloat(ov.medical_sp)  : cfgRateSP;
    const medCh1 = numChildren < 1 ? 0 : ov.medical_ch1 != null ? parseFloat(ov.medical_ch1) : cfgRateCh;
    const medCh2 = numChildren < 2 ? 0 : ov.medical_ch2 != null ? parseFloat(ov.medical_ch2) : cfgRateCh;
    const medEE  = parseFloat(ov.medical_ee ?? (cfg.medical_ee || 0));
    const totalMedical = medEE + medSP + medCh1 + medCh2;

    // ——— Employer cost & invoice ------------------------------------------------
    const eduCess = parseFloat(cfg.edu_cess || 0);
    // grossForTPC: base gross WITHOUT the bonus lump-sum disbursement.
    // The client has already been provisioned for bonus via monthly bonusAccrual
    // (1/12 x salary). Using grossMonthly here would double-bill in April.
    const grossForTPC = grossPay + otAmount + opdClaim + reimb + arrears + effectiveSplAllow + fuelMob;
    // SESSI: based on base gross (without bonus lump-sum)
    const sessi   = grossForTPC > 40000 ? 0 : Math.min(2400, Math.round(grossForTPC * 0.06));
    const overhead = parseFloat(cfg.overhead_per_employee || 0);
    const bonusTPC = bonusAccrual;  // 1/12 monthly provision -- NOT the lump-sum disbursement
    const totalPayrollCost = grossForTPC + eobi.employer + sessi + eduCess +
        bonusTPC + gratuity + lifeIns + totalMedical + pfER + overhead - otherDed;
    const svcPct          = parseFloat(cfg.service_charges_pct || 0);
    const stRate          = provinceSalesTaxRate(emp.province || emp.location || '', provinceRates);
    const serviceCharges  = Math.round(totalPayrollCost * svcPct / 100);
    const salesTax        = Math.round((totalPayrollCost + serviceCharges) * stRate);
    const totalInvoice    = totalPayrollCost + serviceCharges + salesTax;

    return {
        pd, ot2hrs, ot3hrs, ot2Amount, ot3Amount, basicPaid, hraPaid, convPaid, medPaid, otherPaid,
        otAmount, opdClaim, reimb, arrears, splAllow: effectiveSplAllow, fuelMob, absenceDeduction, absentDays,
        grossMonthly, taxableMonthly, annualIncome,
        incomeTax, eobi_ee: eobi.employee, pfEE, otherDed, advanceDed, loanDed,
        totalDeductions, netPay, eobi_er: eobi.employer, sessi, eduCess,
        bonusAmount: bonusDisbursed, bonusAccrual, bonusDisbursed,
        gratuity, pfER, lifeIns, medEE, medSP, medCh1, medCh2, totalMedical, overhead,
        totalPayrollCost, serviceCharges, salesTax, totalInvoice,
        hrlyGross, dailyGross,
    };
};


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

// â”€â”€â”€ Export builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Bank file split by HBL vs Other Banks per client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// isHBL: returns true if bank name contains 'hbl' or 'habib'
const isHBLBank = (bankName = '') =>
    bankName.toLowerCase().replace(/\s/g, '').includes('hbl') ||
    bankName.toLowerCase().includes('habib');

/**
 * buildBankFileSplit â€” returns { hbl: rows[], other: rows[] } split by bank type
 * Format matches actual HBL Net Payment file (columns from sample files)
 */
export const buildBankFileSplit = (rows, month) => {
    const monthAbbr = new Date(month + '-01').toLocaleString('en-US', { month: 'short' }); // 'Apr'
    const yr2 = month.slice(2, 4); // '26'
    const makeRow = ({ emp, calc }) => ({
        'Beneficiary\u00a0Name':        emp.name,
        'Beneficiary Account Number':   emp.bankAccount || '',
        'Transaction Amount':           Math.round(calc.netPay),
        'Reference # 1':                `PR${monthAbbr}${yr2}-${emp.id}`,
        'Reference # 2':                '',
        'Reference # 3':                '',
        'Inovice Number':               '',
        'Account Title':                emp.accountTitle || emp.name,
    });
    return {
        hbl:   rows.filter(r => isHBLBank(r.emp.bankName)).map(makeRow),
        other: rows.filter(r => !isHBLBank(r.emp.bankName)).map(makeRow),
    };
};

// â”€â”€â”€ Xero Tax Type string builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Must match EXACTLY what is in Xero (case-sensitive). From real sample file.
const xeroTaxType = (province = '') => {
    const p = province.toLowerCase();
    if (p.includes('punjab') || p.includes('lahore') || p.includes('islamabad') || p.includes('rawalpindi') || p.includes('multan') || p.includes('faisalabad') || p.includes('gujranwala'))
        return 'Punjab Services Tax 16% (16%)';
    if (p.includes('sindh') || p.includes('karachi') || p.includes('hyderabad') || p.includes('sukkur'))
        return 'Sindh Sales Tax 15% (15%)';
    if (p.includes('kpk') || p.includes('khyber') || p.includes('peshawar') || p.includes('abbottabad'))
        return 'KPK Services Tax 15% (15%)';
    if (p.includes('balochistan') || p.includes('quetta'))
        return 'Balochistan Services Tax 15% (15%)';
    return 'Sindh Sales Tax 15% (15%)'; // default
};

// â”€â”€â”€ Tracking Option: BPO or FM based on employee code â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const xeroTracking = (empId = '') =>
    empId.toUpperCase().includes('ASILFM') ? 'FM' : 'BPO';

/**
 * buildXeroCSV â€” Xero Sales Invoice import format
 * Grouped by: ClientBU + Province (each BU-Province = one sequential invoice)
 * Each invoice = 2 rows: [payroll cost line] + [service charges line]
 *
 * EXACT column order and format from production Xero sample file (Apr-26):
 * *ContactName = "{ClientBU} - {ClientName}"
 * *InvoiceNumber = sequential starting from startInvNum
 * *InvoiceDate = DD-MM-YY (last day of month, or invoiceDay param)
 * *DueDate = 60 days after invoiceDate
 * *Description = "Services in {Province} for the month of {Month} {Year}" (BPO)
 *              = "FM Services in {Province} for the month of {Month} {Year}" (FM)
 * *AccountCode = 208 (hardcoded â€” all payroll invoices use this Xero account)
 * *TaxType = province-based exact string e.g. "Punjab Services Tax 16% (16%)"
 * TrackingOption1 = "BPO" or "FM"
 * BrandingTheme = "Letterhead"
 *
 * @param {Array} rows - array of { emp, calc } from PayrollSheet
 * @param {string} month - "YYYY-MM"
 * @param {number} startInvNum - starting sequential invoice number (e.g. 4939)
 * @param {number} invoiceDay - day of month for invoice date (default 27)
 */
export const buildXeroCSV = (rows, month, startInvNum = 5000, invoiceDay = 27) => {
    const [yr, mo] = month.split('-');
    const monthName = new Date(month + '-01').toLocaleString('en-US', { month: 'long' });
    const yr2 = yr.slice(-2); // '26'
    const moNum = parseInt(mo);

    // Invoice date: DD-MM-YY (e.g. "27-04-26")
    const invDate = `${String(invoiceDay).padStart(2,'0')}-${mo}-${yr2}`;
    // Due date: 60 days later
    const dueD = new Date(parseInt(yr), moNum - 1, invoiceDay + 60);
    const dueDate = `${String(dueD.getDate()).padStart(2,'0')}-${String(dueD.getMonth()+1).padStart(2,'0')}-${String(dueD.getFullYear()).slice(-2)}`;

    // Group by ClientBU + Province (each group = one invoice)
    const groups = {};
    rows.forEach(({ emp, calc }) => {
        const clientName = emp.client || 'Unknown';
        const bu         = emp.contract || emp.clientBU || emp.contract || '';
        const province   = emp.province || emp.location || 'Sindh';
        const tracking   = xeroTracking(emp.id || '');
        const key        = `${clientName}||${bu}||${province}`;
        if (!groups[key]) groups[key] = {
            contactName:      `${bu} - ${clientName}`,
            clientName, bu, province, tracking,
            totalPayrollCost: 0, serviceCharges: 0, salesTax: 0, count: 0,
        };
        groups[key].totalPayrollCost += Math.round(calc.totalPayrollCost || 0);
        groups[key].serviceCharges   += Math.round(calc.serviceCharges   || 0);
        groups[key].salesTax         += Math.round(calc.salesTax         || 0);
        groups[key].count++;
    });

    // Sort: clientName â†’ bu â†’ province (deterministic order)
    const sorted = Object.values(groups).sort((a, b) =>
        a.clientName.localeCompare(b.clientName) ||
        a.bu.localeCompare(b.bu) ||
        a.province.localeCompare(b.province)
    );

    const xeroRows = [];
    let invNum = startInvNum;

    sorted.forEach(grp => {
        const inv     = String(invNum++);
        const taxType = xeroTaxType(grp.province);
        const isFM    = grp.tracking === 'FM';
        const descPfx = isFM ? 'FM Services' : 'Services';
        const descMain = `${descPfx} in ${grp.province} for the month of ${monthName} ${yr}`;
        const descSvc  = 'Service Charges';

        // Payroll cost line
        xeroRows.push({
            '*ContactName':     grp.contactName,
            'EmailAddress':     '',
            'POAddressLine1':   '',
            'POAddressLine2':   '',
            'POAddressLine3':   '',
            'POAddressLine4':   '',
            'POCity':           '',
            'PORegion':         '',
            'POPostalCode':     '',
            'POCountry':        '',
            '*InvoiceNumber':   inv,
            'Reference':        '',
            '*InvoiceDate':     invDate,
            '*DueDate':         dueDate,
            'Total':            '',
            'InventoryItemCode':'',
            '*Description':     descMain,
            '*Quantity':        '1',
            '*UnitAmount':      grp.totalPayrollCost,
            'Discount':         '',
            '*AccountCode':     '208',
            '*TaxType':         taxType,
            'TaxAmount':        grp.salesTax,
            'TrackingName1':    'Tracking Category',
            'TrackingOption1':  grp.tracking,
            'TrackingName2':    'Type',
            'TrackingOption2':  'Official',
            'Currency':         'PKR',
            'BrandingTheme':    'Letterhead',
        });
        // Service charges line (same invoice number)
        if (grp.serviceCharges > 0) {
            xeroRows.push({
                '*ContactName':     grp.contactName,
                'EmailAddress':     '',
                'POAddressLine1':   '',
                'POAddressLine2':   '',
                'POAddressLine3':   '',
                'POAddressLine4':   '',
                'POCity':           '',
                'PORegion':         '',
                'POPostalCode':     '',
                'POCountry':        '',
                '*InvoiceNumber':   inv,
                'Reference':        '',
                '*InvoiceDate':     invDate,
                '*DueDate':         dueDate,
                'Total':            '',
                'InventoryItemCode':'',
                '*Description':     descSvc,
                '*Quantity':        '1',
                '*UnitAmount':      grp.serviceCharges,
                'Discount':         '',
                '*AccountCode':     '208',
                '*TaxType':         taxType,
                'TaxAmount':        '',
                'TrackingName1':    'Tracking Category',
                'TrackingOption1':  grp.tracking,
                'TrackingName2':    'Type',
                'TrackingOption2':  'Official',
                'Currency':         'PKR',
                'BrandingTheme':    'Letterhead',
            });
        }
    });
    return xeroRows;
};

/**
 * buildInvoiceSummaryCSV â€” grouped summary table equivalent to columns AT:AW in master CSV
 * Grouped by Client â†’ BU â†’ Province
 */
export const buildInvoiceSummaryCSV = (rows, month) => {
    const groups = {};
    rows.forEach(({ emp, calc }) => {
        const client   = emp.client || 'Unknown';
        const bu       = emp.contract || emp.clientBU || '';
        const province = emp.province || emp.location || 'Other';
        const key = `${client}||${bu}||${province}`;
        if (!groups[key]) {
            groups[key] = {
                Client: client, 'Business Unit': bu, Province: province,
                Employees: 0,
                'Net Pay to Employees': 0,
                'Gross Monthly': 0,
                'Total Payroll Cost (AT)': 0,
                'Service Charges (AU)': 0,
                'Sales Tax (AV)': 0,
                'Total Invoice (AW)': 0,
            };
        }
        groups[key].Employees++;
        groups[key]['Net Pay to Employees']    += Math.round(calc.netPay || 0);
        groups[key]['Gross Monthly']           += Math.round(calc.grossMonthly || 0);
        groups[key]['Total Payroll Cost (AT)'] += Math.round(calc.totalPayrollCost || 0);
        groups[key]['Service Charges (AU)']    += Math.round(calc.serviceCharges || 0);
        groups[key]['Sales Tax (AV)']          += Math.round(calc.salesTax || 0);
        groups[key]['Total Invoice (AW)']      += Math.round(calc.totalInvoice || 0);
    });
    return Object.values(groups).sort((a, b) =>
        a.Client.localeCompare(b.Client) || a['Business Unit'].localeCompare(b['Business Unit']) || a.Province.localeCompare(b.Province)
    );
};
