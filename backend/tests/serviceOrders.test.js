'use strict';

const XLSX = require('xlsx');
const {
    absenceDeductionAmount,
    roleCount,
    siteProvince,
    isSoBillingModel,
    PSO_SERVICE_TYPE,
} = require('../src/modules/serviceOrders/sitesMeta');
const {
    expectedSheetName,
    parseConservancyWorkbook,
} = require('../src/modules/serviceOrders/attendanceParse');
const { matchFileToSite } = require('../src/modules/serviceOrders/driveAttendance');
const { renderInvoiceHtml } = require('../src/modules/serviceOrders/invoiceHtml');
const { composeFocalEmail, monthYearLabel } = require('../src/modules/serviceOrders/service');
const { ST_WITHHOLDING_RATE } = require('../src/modules/serviceOrders/billing');
const fs = require('fs');
const path = require('path');

describe('serviceOrders — absence formula', () => {
    test('daily rate = (lineRate / roleCount) / 30', () => {
        const roles = [{ designation: 'Sweeping', count: 4 }, { designation: 'Gardening', count: 2 }];
        expect(roleCount(roles)).toBe(6);
        const amt = absenceDeductionAmount(120000, roles, 3, 30);
        expect(amt).toBe(Math.round((120000 / 6 / 30) * 3 * 100) / 100);
    });

    test('zero absences → zero deduction', () => {
        expect(absenceDeductionAmount(50000, [{ count: 2 }], 0)).toBe(0);
    });
});

describe('serviceOrders — Tarujabba grand total', () => {
    const sites = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/seeds/pso_sites.json'), 'utf8'));
    const tarujabba = sites.find(s => s.id === 'TARUJABBA');

    test('2156300 + 323445 = 2479745', () => {
        const gross = tarujabba.lineItems.reduce((s, l) => s + Number(l.rate), 0);
        expect(gross).toBe(2156300);
        const pst = Math.round(gross * tarujabba.taxRate);
        expect(pst).toBe(323445);
        expect(gross + pst).toBe(2479745);
    });

    test('invoice HTML stamped grand excludes WHT from total', () => {
        const net = 2156300;
        const pst = 323445;
        const grand = net + pst;
        const incomeWht = Math.round(net * 0.15);
        const html = renderInvoiceHtml({
            computed: {
                netTaxable: net,
                provincialSt: pst,
                grandTotal: grand,
                incomeWht,
                stWithholding: Math.round(pst * ST_WITHHOLDING_RATE),
                taxRate: 0.15,
                lineItems: [{ description: 'Services', quantity: 1, rate: net, amount: net }],
            },
        });
        expect(html).toContain('2,479,745');
        expect(html).toContain('Stamped Grand Total');
        expect(html).toContain('Income Tax WHT');
        expect(html).not.toMatch(/Stamped Grand Total[\s\S]*2,156,300/);
    });
});

describe('serviceOrders — focal email subject', () => {
    test('subject includes site and month year', () => {
        const { subject, cc, signOff } = composeFocalEmail({
            siteName: 'Morgah Installation',
            siteCode: 'MORGAH',
            month: 6,
            year: 2026,
            invoiceHtml: '<p>test</p>',
        });
        expect(subject).toBe('Proforma Invoice & Monthly Payroll Report — Morgah Installation [June 2026]');
        expect(cc).toEqual(['shahzaib@asil.com.pk']);
        expect(signOff).toContain('SHAHZAIB');
        expect(monthYearLabel(6, 2026)).toBe('June 2026');
    });
});

describe('serviceOrders — drive file match', () => {
    test('matches site code in filename', () => {
        expect(matchFileToSite('Morgah Conservancy June 2026.xlsx', 'MORGAH')).toBe(true);
        expect(matchFileToSite('Tarujabba_Attendance_Mar2026.xlsx', 'TARUJABBA')).toBe(true);
        expect(matchFileToSite('Tarru_Jabba_Depot_Attendance_Master.xlsx', 'TARUJABBA')).toBe(true);
        expect(matchFileToSite('Serai_Naurang_Depot_Attendance_Master.xlsx', 'SERAINOURANG')).toBe(true);
        expect(matchFileToSite('Chakpirana Depot.xlsx', 'CHAKPIRANA')).toBe(true);
        expect(matchFileToSite('Random.xlsx', 'KOHAT')).toBe(false);
    });
});

describe('serviceOrders — excel parse', () => {
    test('parses conservancy sheet headers', () => {
        const ws = XLSX.utils.aoa_to_sheet([
            ['Emp Code', 'Name', 'Designation', 'Expected Days', 'Total Present', 'Total Absent'],
            ['W-001', 'Ali Khan', 'Sweeping / Cleaning Services', 26, 24, 2],
            ['W-002', 'Sara', 'Gardening Services', 26, 26, 0],
        ]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'June 2026');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const result = parseConservancyWorkbook(buffer, { month: 6, year: 2026 });
        expect(result.ok).toBe(true);
        expect(result.sheetName).toBe('June 2026');
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0]).toMatchObject({ empCode: 'W-001', absentDays: 2, presentDays: 24 });
    });

    test('expectedSheetName format', () => {
        expect(expectedSheetName(3, 2026)).toBe('March 2026');
    });
});

describe('serviceOrders — billing model guard', () => {
    test('isSoBillingModel recognizes service_order_deduction', () => {
        expect(isSoBillingModel('service_order_deduction')).toBe(true);
        expect(isSoBillingModel('fixed_value')).toBe(true);
        expect(isSoBillingModel('headcount_rate')).toBe(false);
    });

    test('PSO service type constant', () => {
        expect(PSO_SERVICE_TYPE).toBe('Fixed Value / Conservancy');
    });

    test('siteProvince for Tarujabba is KPK', () => {
        expect(siteProvince('TARUJABBA')).toBe('KPK');
    });
});
