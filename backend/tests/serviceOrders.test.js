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
const { findLineForDesignation } = require('../src/modules/serviceOrders/attendanceIngest');
const { renderInvoiceHtml } = require('../src/modules/serviceOrders/invoiceHtml');
const { composeFocalEmail, monthYearLabel } = require('../src/modules/serviceOrders/service');
const {
    ST_WITHHOLDING_RATE,
    enrichInvoiceRow,
    resourcesFromLines,
    parseInvoiceNotes,
} = require('../src/modules/serviceOrders/billing');
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
                siteName: 'Tarujabba Depot',
                siteCode: 'TARUJABBA',
                resources: 12,
                province: 'KPK',
                lineItems: [{ description: 'Services', quantity: 1, rate: net, amount: net }],
            },
        });
        expect(html).toContain('2,479,745');
        expect(html).toMatch(/Stamped grand|Grand Net Invoice Amount/i);
        expect(html).toMatch(/Income (Tax )?WHT/i);
        expect(html).toContain('Tarujabba Depot');
        expect(html).toMatch(/Resources \(billed manpower\):[\s\S]*?\b12\b/);
        expect(html).not.toMatch(/Grand Net Invoice Amount[\s\S]*PKR 2,156,300/);
    });
});

describe('serviceOrders — registry invoice metadata', () => {
    test('parseInvoiceNotes handles TEXT JSON from client_invoices', () => {
        const notes = parseInvoiceNotes('{"site_code":"TARUJABBA","service_order_id":"SO-PSO-TARUJABBA"}');
        expect(notes.site_code).toBe('TARUJABBA');
        expect(notes.service_order_id).toBe('SO-PSO-TARUJABBA');
    });

    test('resourcesFromLines sums manpower role counts only', () => {
        const n = resourcesFromLines([
            { is_manpower_dependent: true, roles: [{ count: 4 }, { count: 2 }] },
            { is_manpower_dependent: false, roles: [{ count: 99 }] },
            { isManpowerDependent: true, roles: [{ count: 1 }] },
        ]);
        expect(n).toBe(7);
    });

    test('enrichInvoiceRow backfills site_name/resources from service order', () => {
        const soById = new Map([['SO-PSO-TARUJABBA', {
            id: 'SO-PSO-TARUJABBA',
            site_code: 'TARUJABBA',
            name: 'Tarujabba Depot',
            lines: [
                { is_manpower_dependent: true, roles: [{ count: 8 }, { count: 4 }] },
                { is_manpower_dependent: false, roles: [{ count: 1 }] },
            ],
        }]]);
        const row = enrichInvoiceRow({
            id: 1,
            invoice_number: 'INV-JUL26-0001',
            grand_total: 100,
            notes: JSON.stringify({
                source: 'fixed_value_service_order',
                service_order_id: 'SO-PSO-TARUJABBA',
                site_code: 'TARUJABBA',
            }),
        }, soById);
        expect(row.site_name).toBe('Tarujabba Depot');
        expect(row.site_code).toBe('TARUJABBA');
        expect(row.resources).toBe(12);
        expect(row.notes.site_name).toBe('Tarujabba Depot');
        expect(row.province).toBe('KPK');
    });
});

describe('serviceOrders — focal email subject', () => {
    test('subject includes site and month year', () => {
        const { subject, cc, signOff } = composeFocalEmail({
            siteName: 'Morgah Installation',
            siteCode: 'MORGAH',
            month: 7,
            year: 2026,
            invoiceHtml: '<p>test</p>',
            primaryEmail: 'focal.user@psopk.com',
            intendedTo: ['focal.user@psopk.com'],
        });
        expect(subject).toBe('Payroll & Invoice Verification for July 2026 — Morgah Installation');
        expect(cc).toEqual(expect.arrayContaining([
            'obaid.rana@asil.com.pk',
            'huzaifa.rafaqat@asil.com.pk',
        ]));
        expect(signOff).toContain('Allied Services');
        expect(monthYearLabel(7, 2026)).toBe('July 2026');
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

    test('does not cross-match on generic DEPOT/INSTALLATION tokens', () => {
        expect(matchFileToSite('Sihala_Installation_Attendance_Master.xlsx', 'MORGAH')).toBe(false);
        expect(matchFileToSite('Tarru_Jabba_Depot_Attendance_Master.xlsx', 'CHAKPIRANA')).toBe(false);
        expect(matchFileToSite('Morgah_Installation_Attendance_Master.xlsx', 'SIHALA')).toBe(false);
        expect(matchFileToSite('Chakpirana_Depot_Attendance_Master.xlsx', 'TARUJABBA')).toBe(false);
    });
});

describe('serviceOrders — designation → SO line match', () => {
    const sites = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/seeds/pso_sites.json'), 'utf8'));
    const tarujabba = sites.find(s => s.id === 'TARUJABBA');
    const faqirabad = sites.find(s => s.id === 'FAQIRABAD');
    const tjLines = tarujabba.lineItems.map(l => ({
        id: l.id,
        is_manpower_dependent: !!l.isManpowerDependent,
        rate: l.rate,
        roles: l.roles || [],
    }));
    const faqLines = faqirabad.lineItems.map(l => ({
        id: l.id,
        is_manpower_dependent: !!l.isManpowerDependent,
        rate: l.rate,
        roles: l.roles || [],
    }));

    test('Laboratory / Lab Services fuzzy-match Tarujabba line 1', () => {
        for (const des of ['Laboratory', 'Laboratory Services', 'Lab Services', 'Lab']) {
            const m = findLineForDesignation(tjLines, des);
            expect(m).not.toBeNull();
            expect(m.line.id).toBe('tj-item-1');
            expect(m.roles.some(r => /lab/i.test(r.designation))).toBe(true);
        }
    });

    test('Pump Room aliases to Tarujabba Invoicing Room (no dedicated pumproom role)', () => {
        for (const des of ['Pump Room', 'Pump Room Services']) {
            const m = findLineForDesignation(tjLines, des);
            expect(m).not.toBeNull();
            expect(m.line.id).toBe('tj-item-1');
        }
    });

    test('Pump Room matches Faqirabad Filling Pumproom / Invoicing Room', () => {
        const m = findLineForDesignation(faqLines, 'Pump Room');
        expect(m).not.toBeNull();
        expect(m.line.id).toBe('faq-item-1');
        expect(m.roles.some(r => /pumproom|invoicing/i.test(r.designation))).toBe(true);
    });

    test('unrelated designation still returns null', () => {
        expect(findLineForDesignation(tjLines, 'Astronaut')).toBeNull();
    });

    test('Storekeeper aliases to Store Keeping services', () => {
        const m = findLineForDesignation(tjLines, 'Storekeeper');
        expect(m).not.toBeNull();
        expect(m.roles.some(r => /store/i.test(r.designation))).toBe(true);
    });

    test('Lube Handling Services aliases to Lubricant Handling', () => {
        // Sihala uses "Lubricant Handling services"; sheet often says "Lube Handling Services"
        const sihala = require('../../scripts/seeds/pso_sites.json').find(s => s.id === 'SIHALA');
        const sihLines = sihala.lineItems.map(l => ({
            id: l.id,
            is_manpower_dependent: !!l.isManpowerDependent,
            rate: l.rate,
            roles: l.roles || [],
        }));
        const m = findLineForDesignation(sihLines, 'Lube Handling Services');
        expect(m).not.toBeNull();
    });

    test('M & R Support Services matches M&R Support after & normalize', () => {
        const chak = require('../../scripts/seeds/pso_sites.json').find(s => s.id === 'CHAKPIRANA');
        const chakLines = chak.lineItems.map(l => ({
            id: l.id,
            is_manpower_dependent: !!l.isManpowerDependent,
            rate: l.rate,
            roles: l.roles || [],
        }));
        const m = findLineForDesignation(chakLines, 'M & R Support Services');
        expect(m).not.toBeNull();
    });

    test('Janitor aliases to Sweeping / Cleaning on Chakpirana Office/Misc', () => {
        const chak = require('../../scripts/seeds/pso_sites.json').find(s => s.id === 'CHAKPIRANA');
        const chakLines = chak.lineItems.map(l => ({
            id: l.id,
            is_manpower_dependent: !!l.isManpowerDependent,
            rate: l.rate,
            roles: l.roles || [],
        }));
        const m = findLineForDesignation(chakLines, 'Janitor');
        expect(m).not.toBeNull();
        expect(m.line.id).toBe('cp-item-1');
        expect(m.roles.some(r => /sweeping|cleaning/i.test(r.designation))).toBe(true);
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

    test('siteProvince prefers so.meta.province over SITE_PROVINCES', () => {
        expect(siteProvince('TARUJABBA', { soMeta: { province: 'Punjab' } })).toBe('Punjab');
        expect(siteProvince('SS94', { soMeta: { province: 'Punjab' } })).toBe('Punjab');
        expect(siteProvince('UNKNOWN_SITE')).toBe('Punjab');
    });
});

describe('serviceOrders — CORO SS94 invoice fixture', () => {
    const coroPathCandidates = [
        path.join(__dirname, '../src/modules/serviceOrders/seedData/pso_coro_ss94.json'),
        path.join(__dirname, '../../scripts/seeds/pso_coro_ss94.json'),
    ];
    const coroPath = coroPathCandidates.find(p => fs.existsSync(p));
    const coro = JSON.parse(fs.readFileSync(coroPath, 'utf8'));
    const round2 = (n) => Math.round(Number(n) * 100) / 100;

    test('pinned lines sum to 4,136,919.94', () => {
        const lines = coro.sites[0].lines;
        const gross = round2(lines.reduce((s, l) => s + Number(l.rate), 0));
        expect(gross).toBe(4136919.94);
        expect(lines).toHaveLength(5);
    });

    test('Punjab 16% ST → grand 4,798,827.13', () => {
        const gross = 4136919.94;
        const pst = round2(gross * 0.16);
        const grand = round2(gross + pst);
        expect(pst).toBe(661907.19);
        expect(grand).toBe(4798827.13);
    });

    test('canonical CORO ids', () => {
        expect(coro.contractId).toBe('CTR-PSO-CORO-MA');
        expect(coro.sites[0].so_id).toBe('SO-PSO-CORO-SS94');
        expect(coro.sites[0].site_code).toBe('SS94');
        expect(coro.meta.fv_product).toBe('coro_retail_ops');
        expect(coro.policy.billing_model).toBe('service_order_deduction');
    });
});

describe('serviceOrders — contractCrud CORO validation', () => {
    const { createFixedValueContract, CORO_EXPECTED_GROSS } = require('../src/modules/serviceOrders/contractCrud');

    test('rejects CORO payload when line sum drifts', async () => {
        const fakePool = {
            connect: async () => ({ query: async () => ({ rows: [] }), release() {} }),
        };
        await expect(createFixedValueContract(fakePool, {
            id: 'CTR-PSO-CORO-MA',
            contract_name: 'CORO - Masood Anwari',
            start_date: '2026-07-01',
            end_date: '2027-06-30',
            meta: { fv_product: 'coro_retail_ops', expected_monthly_gross: CORO_EXPECTED_GROSS },
            policy: { billing_model: 'service_order_deduction' },
            sites: [{
                site_code: 'SS94',
                name: 'SS94',
                lines: [{ name: 'x', rate: 100 }],
            }],
        })).rejects.toMatchObject({ status: 400 });
    });
});
