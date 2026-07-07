const { xeroCancelTargetStatus } = require('../src/modules/ar/xeroCancelInvoice');

describe('xeroCancelTargetStatus', () => {
    test('DRAFT maps to DELETED', () => {
        expect(xeroCancelTargetStatus('DRAFT')).toBe('DELETED');
    });
    test('AUTHORISED maps to VOIDED', () => {
        expect(xeroCancelTargetStatus('AUTHORISED')).toBe('VOIDED');
    });
    test('already cancelled returns null', () => {
        expect(xeroCancelTargetStatus('VOIDED')).toBeNull();
        expect(xeroCancelTargetStatus('DELETED')).toBeNull();
    });
});