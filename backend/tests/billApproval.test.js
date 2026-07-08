'use strict';

const {
    DEFAULT_BILL_APPROVAL_RULES,
    pickThresholdApprover,
    canUserSubmitBill,
    resolveStep1Approvers,
    isStepComplete,
    billAmountPkr,
} = require('../src/modules/billApproval/service');

describe('bill approval rules', () => {
    const rules = DEFAULT_BILL_APPROVAL_RULES;
    const bhakkarBill = { id: 'XERO-1', site: 'Bhakkar', total: 50000, amount: 45000 };

    test('pickThresholdApprover routes under 100k PKR to Asif Awan', () => {
        const approver = pickThresholdApprover(99999.99, rules);
        expect(approver.email).toBe('asif.awan@asil.com.pk');
    });

    test('pickThresholdApprover routes 100k PKR and above to Shezad Mumtaz', () => {
        expect(pickThresholdApprover(100000, rules).email).toBe('shezad.mumtaz@asil.com.pk');
        expect(pickThresholdApprover(250000, rules).email).toBe('shezad.mumtaz@asil.com.pk');
    });

    test('Bhakkar focal submitter can submit for FM-106 site bill', () => {
        const gate = canUserSubmitBill('muhammad.anees@wafi-energy.com', bhakkarBill, rules);
        expect(gate.ok).toBe(true);
        expect(gate.accountCode).toBe('FM-106');
    });

    test('non-focal user cannot submit Bhakkar bill', () => {
        const gate = canUserSubmitBill('random@asil.com.pk', bhakkarBill, rules);
        expect(gate.ok).toBe(false);
        expect(gate.reason).toBe('not_focal_for_site');
    });

    test('resolveStep1Approvers returns Fayyaz for Bhakkar', () => {
        const approvers = resolveStep1Approvers(bhakkarBill, rules);
        expect(approvers).toHaveLength(1);
        expect(approvers[0].email).toBe('fayyaz.f.ahmed@wafi-energy.com');
    });

    test('isStepComplete requires all step 1 approvers approved', () => {
        const steps = [
            { step_number: 1, status: 'approved' },
            { step_number: 1, status: 'pending' },
        ];
        expect(isStepComplete(steps, 1)).toBe(false);
        steps[1].status = 'approved';
        expect(isStepComplete(steps, 1)).toBe(true);
    });

    test('billAmountPkr prefers total over amount', () => {
        expect(billAmountPkr({ total: 120, amount: 90 })).toBe(120);
        expect(billAmountPkr({ amount: 90 })).toBe(90);
    });
});