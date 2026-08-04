'use strict';

const { filterPayrollRowsForSite, renderSitePayrollHtml } = require('../src/modules/serviceOrders/sitePayrollHtml');

describe('sitePayrollHtml', () => {
    test('filterPayrollRowsForSite matches site code', () => {
        const rows = [
            { employee_id: 'E1', site: 'CHAKPIRANA', computed: { netPay: 1000, gross: 1100 } },
            { employee_id: 'E2', site: 'TARUJABBA', computed: { netPay: 2000, gross: 2200 } },
        ];
        const filtered = filterPayrollRowsForSite(rows, 'CHAKPIRANA', 'Chakpirana Depot');
        expect(filtered).toHaveLength(1);
        expect(filtered[0].employee_id).toBe('E1');
    });

    test('renderSitePayrollHtml includes site name and row count', () => {
        const html = renderSitePayrollHtml({
            siteName: 'Chakpirana Depot',
            siteCode: 'CHAKPIRANA',
            month: 7,
            year: 2026,
            contractName: 'PSO North Zone',
            rows: [{ employee_id: 'E1', employee_name: 'Ali', computed: { netPay: 50000, gross: 55000 } }],
        });
        expect(html).toContain('Chakpirana Depot');
        expect(html).toContain('July 2026');
        expect(html).toContain('1 employees');
        expect(html).toContain('Ali');
    });
});
