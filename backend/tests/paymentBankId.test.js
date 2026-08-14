'use strict';

const { coercePaymentBatchBankId, resolvePaymentBatchBankId } = require('../src/core/paymentBankId');

describe('coercePaymentBatchBankId', () => {
    test('keeps integer bank ids from World A / disbursement', () => {
        expect(coercePaymentBatchBankId(12)).toBe(12);
        expect(coercePaymentBatchBankId('12')).toBe(12);
    });

    test('rejects AP modal slugs that would 22P02 on payment_batches.bank_id', () => {
        expect(coercePaymentBatchBankId('hbl')).toBeNull();
        expect(coercePaymentBatchBankId('nbp')).toBeNull();
        expect(coercePaymentBatchBankId('Habib Bank Limited (HBL)')).toBeNull();
    });

    test('treats empty as null', () => {
        expect(coercePaymentBatchBankId(null)).toBeNull();
        expect(coercePaymentBatchBankId('')).toBeNull();
        expect(coercePaymentBatchBankId(undefined)).toBeNull();
    });
});

describe('resolvePaymentBatchBankId', () => {
    test('returns numeric ids without querying banks', async () => {
        const pool = { query: jest.fn() };
        await expect(resolvePaymentBatchBankId(pool, 7, 'HBL')).resolves.toBe(7);
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('maps hbl slug to banks.is_hbl row', async () => {
        const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 3 }] }) };
        await expect(resolvePaymentBatchBankId(pool, 'hbl', 'Habib Bank Limited (HBL)')).resolves.toBe(3);
        expect(pool.query).toHaveBeenCalledTimes(1);
        expect(pool.query.mock.calls[0][0]).toMatch(/is_hbl/i);
    });

    test('maps nbp slug to NBP row', async () => {
        const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 9 }] }) };
        await expect(resolvePaymentBatchBankId(pool, 'nbp', 'National Bank of Pakistan (NBP)')).resolves.toBe(9);
        expect(pool.query.mock.calls[0][0]).toMatch(/NBP/);
    });

    test('falls back to null when banks lookup misses', async () => {
        const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await expect(resolvePaymentBatchBankId(pool, 'hbl', 'HBL')).resolves.toBeNull();
    });
});
