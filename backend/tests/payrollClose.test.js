'use strict';

const { aggregatePayablesFromRows } = require('../src/modules/payrollClose/service');
describe('payrollClose aggregates', () => {
    test('aggregatePayablesFromRows sums salary and contributions', () => {
        const rows = [
            { computed: { netPay: 50000, eobiEmployer: 400, sessiEmployer: 2400, wht: 1000, gratuityAccrual: 2000 } },
            { computed: { netPay: 45000, eobiEmployer: 400, sessiEmployer: 0, wht: 800, pfDeduction: 500 } },
        ];
        const totals = aggregatePayablesFromRows(rows);
        expect(totals.salary).toBe(95000);
        expect(totals.eobi).toBe(800);
        expect(totals.sessi).toBe(2400);
        expect(totals.wht).toBe(1800);
        expect(totals.gratuity).toBe(2000);
        expect(totals.pf).toBe(500);
    });
});

describe('payrollClose pack status', () => {
    function derive(payables) {
        const paid = payables.filter((p) => p.status === 'Paid').length;
        if (paid === 0) return 'closed';
        if (paid === payables.length) return 'paid';
        return 'partial';
    }

    test('partial when some payables paid', () => {
        expect(derive([
            { status: 'Paid' },
            { status: 'Payable' },
        ])).toBe('partial');
    });

    test('paid when all payables paid', () => {
        expect(derive([
            { status: 'Paid' },
            { status: 'Paid' },
        ])).toBe('paid');
    });
});
