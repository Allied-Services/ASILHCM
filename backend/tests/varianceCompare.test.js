'use strict';

const {
    normalizeEmployeeId,
    parseMoney,
    roundRupee,
    fieldDelta,
    parseExcelCsv,
    extractHcmRow,
    comparePayrollVariance,
    formatVarianceSummaryMd,
} = require('../src/payroll/varianceCompare');

describe('varianceCompare', () => {
    test('normalizeEmployeeId trims and uppercases', () => {
        expect(normalizeEmployeeId(' asil-123 ')).toBe('ASIL-123');
        expect(normalizeEmployeeId('asil  456')).toBe('ASIL456');
    });

    test('parseMoney handles commas and blanks', () => {
        expect(parseMoney('45,991')).toBe(45991);
        expect(parseMoney('')).toBe(0);
        expect(parseMoney(null)).toBe(0);
    });

    test('rounding edge case 0.005 rounds to 0.01 rupee', () => {
        expect(roundRupee(100.005)).toBe(100.01);
        expect(fieldDelta(100.005, 100)).toBe(0.01);
    });

    test('parseExcelCsv maps alternate column headers', () => {
        const csv = `emp_id,name,paid days,gross,wht,eobi,sessi,pf,adv,other deductions,net
ASIL-1,Ali Khan,30,50000,1200,400,0,0,0,0,48400`;
        const rows = parseExcelCsv(csv);
        expect(rows).toHaveLength(1);
        expect(rows[0].employee_id).toBe('ASIL-1');
        expect(rows[0].gross).toBe(50000);
        expect(rows[0].income_tax).toBe(1200);
        expect(rows[0].net_pay).toBe(48400);
    });

    test('extractHcmRow maps computed JSONB to Excel shape', () => {
        const row = extractHcmRow({
            employee_id: 'ASIL-99',
            employee_name: 'Test Emp',
            paid_days: 28,
            computed: {
                paidDays: 28,
                gross: 45000,
                wht: 900,
                eobiEmployee: 400,
                sessiEmployer: 1200,
                pfDeduction: 500,
                netPay: 43200,
            },
            inputs: { otherDeduction: 0, advanceDeduction: 0 },
        });
        expect(row.gross).toBe(45000);
        expect(row.income_tax).toBe(900);
        expect(row.sessi_or_pessi).toBe(1200);
        expect(row.net_pay).toBe(43200);
    });

    test('comparePayrollVariance detects known deltas and unmatched rows', () => {
        const hcmRows = [
            {
                employee_id: 'ASIL-A',
                employee_name: 'Alpha',
                paid_days: 30,
                gross: 50000,
                income_tax: 1000,
                eobi: 400,
                sessi_or_pessi: 0,
                pf: 0,
                advances: 0,
                other_deductions: 0,
                net_pay: 48600,
            },
            {
                employee_id: 'ASIL-B',
                employee_name: 'Beta',
                paid_days: 30,
                gross: 40000,
                income_tax: 800,
                eobi: 400,
                sessi_or_pessi: 0,
                pf: 0,
                advances: 0,
                other_deductions: 0,
                net_pay: 38800,
            },
            {
                employee_id: 'ASIL-ONLY-HCM',
                employee_name: 'Hcm Only',
                paid_days: 30,
                gross: 30000,
                income_tax: 500,
                eobi: 400,
                sessi_or_pessi: 0,
                pf: 0,
                advances: 0,
                other_deductions: 0,
                net_pay: 29100,
            },
        ];
        const excelCsv = `employee_id,employee_name,paid_days,gross,income_tax,eobi,sessi_or_pessi,pf,advances,other_deductions,net_pay
ASIL-A,Alpha,30,50000,1000,400,0,0,0,0,48600
ASIL-B,Beta,30,40000,850,400,0,0,0,0,38750
ASIL-ONLY-EXCEL,Excel Only,30,25000,400,400,0,0,0,0,24200`;
        const excelRows = parseExcelCsv(excelCsv);
        const result = comparePayrollVariance(excelRows, hcmRows);

        expect(result.summary.rowsCompared).toBe(2);
        expect(result.summary.unmatchedExcelCount).toBe(1);
        expect(result.summary.unmatchedHcmCount).toBe(1);
        expect(result.summary.hasVariance).toBe(true);

        const beta = result.comparisons.find((r) => r.employee_id === 'ASIL-B');
        expect(beta.fields.income_tax.delta).toBe(50);
        expect(beta.fields.net_pay.delta).toBe(-50);
        expect(beta.all_zero).toBe(false);

        const alpha = result.comparisons.find((r) => r.employee_id === 'ASIL-A');
        expect(alpha.all_zero).toBe(true);

        const md = formatVarianceSummaryMd(result, { contractId: 'CTR-TEST', month: 4, year: 2026 });
        expect(md).toContain('FAIL');
        expect(md).toContain('ASIL-ONLY-EXCEL');
        expect(md).toContain('ASIL-ONLY-HCM');
    });

    test('comparePayrollVariance all-zero when Excel matches HCM', () => {
        const hcmRows = [
            {
                employee_id: 'ASIL-Z',
                employee_name: 'Zero',
                paid_days: 30,
                gross: 55000,
                income_tax: 1100,
                eobi: 400,
                sessi_or_pessi: 0,
                pf: 0,
                advances: 0,
                other_deductions: 0,
                net_pay: 53500,
            },
        ];
        const excelRows = parseExcelCsv(`employee_id,employee_name,paid_days,gross,income_tax,eobi,sessi_or_pessi,pf,advances,other_deductions,net_pay
ASIL-Z,Zero,30,55000,1100,400,0,0,0,0,53500`);
        const result = comparePayrollVariance(excelRows, hcmRows);
        expect(result.summary.hasVariance).toBe(false);
        expect(result.summary.rowsAllZero).toBe(1);
    });
});
