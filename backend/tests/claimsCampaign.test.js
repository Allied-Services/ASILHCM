'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeBatchTotals } = require('../src/modules/claims/claimsCampaign');

describe('claimsCampaign', () => {
    it('computeBatchTotals groups by approver', () => {
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
        assert.equal(r.totals.otHours, 2);
        assert.equal(r.totals.expense, 100);
        assert.equal(r.totals.medical, 50);
        assert.equal(r.byApprover.length, 2);
    });
});
