'use strict';

const { computeBatchTotals } = require('../src/modules/claims/claimsCampaign');

describe('claimsCampaign', () => {
    test('computeBatchTotals groups by approver', () => {
        const subs = [
            { id: 1, employee_id: 'A', employee_name: 'Alice', status: 'draft', approver_email: 'lm@wafi.com' },
            { id: 2, employee_id: 'B', employee_name: 'Bob', status: 'draft', approver_email: 'lm@wafi.com' },
            { id: 3, employee_id: 'C', employee_name: 'Carol', status: 'draft', approver_email: 'huzaifa@asil.com.pk' },
        ];
        const items = [
            { submission_id: 1, claim_type: 'OT', ot_hours: 2 },
            { submission_id: 2, claim_type: 'EXPENSE', amount: 100 },
            { submission_id: 3, claim_type: 'MEDICAL', amount: 50 },
        ];
        const r = computeBatchTotals(subs, items);
        expect(r.totals.otHours).toBe(2);
        expect(r.totals.expense).toBe(100);
        expect(r.totals.medical).toBe(50);
        expect(r.byApprover.length).toBe(2);
    });
});
