'use strict';

const { removeAttachment } = require('../src/modules/claims/portalService');

function mockPool({ batch, attachment, policyRow } = {}) {
    return {
        query: jest.fn(async (sql) => {
            const s = String(sql);
            if (s.includes('invite_token_hash')) {
                return { rows: batch ? [batch] : [] };
            }
            if (s.includes('FROM portal_claim_attachments a')) {
                return { rows: attachment ? [attachment] : [] };
            }
            if (s.includes('FROM contract_claim_policies')) {
                return { rows: policyRow ? [policyRow] : [] };
            }
            if (s.includes('DELETE FROM portal_claim_attachments')) {
                return { rows: [], rowCount: 1 };
            }
            return { rows: [] };
        }),
    };
}

const openBatch = {
    id: 10,
    claim_month: 8,
    claim_year: 2026,
    campaign_mode: 'actual',
    fill_close_at: '2026-09-18T18:59:59.000Z',
};

const draftAttachment = {
    id: 77,
    filename: 'wrong-receipt.pdf',
    category: 'expense_support',
    submission_id: 5,
    status: 'draft',
    contract_id: null,
};

describe('removeAttachment', () => {
    test('deletes a support file on an open fill token', async () => {
        const pool = mockPool({ batch: openBatch, attachment: draftAttachment });
        const result = await removeAttachment(pool, { token: 'tok', attachmentId: 77 });
        expect(result).toEqual({
            ok: true,
            id: 77,
            filename: 'wrong-receipt.pdf',
            category: 'expense_support',
        });
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM portal_claim_attachments'),
            [77],
        );
    });

    test('rejects an invalid fill link', async () => {
        const pool = mockPool({});
        const result = await removeAttachment(pool, { token: 'tok', attachmentId: 77 });
        expect(result).toEqual({ ok: false, status: 404, error: 'Invalid link' });
        expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM portal_claim_attachments'))).toBe(false);
    });

    test('rejects a missing or foreign attachment', async () => {
        const pool = mockPool({ batch: openBatch });
        const result = await removeAttachment(pool, { token: 'tok', attachmentId: 99 });
        expect(result).toEqual({ ok: false, status: 404, error: 'Attachment not found' });
    });

    test('blocks remove after approval', async () => {
        const pool = mockPool({
            batch: openBatch,
            attachment: { ...draftAttachment, status: 'approved' },
        });
        const result = await removeAttachment(pool, { token: 'tok', attachmentId: 77 });
        expect(result).toEqual({ ok: false, status: 403, error: 'Locked after approval' });
        expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM portal_claim_attachments'))).toBe(false);
    });

    test('blocks remove after fill close', async () => {
        const pool = mockPool({
            batch: {
                id: 10,
                claim_month: 7,
                claim_year: 2026,
                campaign_mode: 'actual',
                fill_close_at: '2026-08-18T18:59:59.000Z',
            },
            attachment: { ...draftAttachment, contract_id: 'CTR-1' },
            policyRow: {
                calendar_apply: true,
                submit_deadline_day: 18,
                approve_deadline_day: 22,
                claims_pay_timing: 'following_month',
                submit_deadline_month: 'following_month',
                approve_deadline_month: 'following_month',
            },
        });
        const result = await removeAttachment(pool, { token: 'tok', attachmentId: 77 });
        expect(result.ok).toBe(false);
        expect(result.status).toBe(403);
        expect(result.error).toBe('Deadline has expired.');
    });

    test('rejects a missing attachment id', async () => {
        const pool = mockPool({ batch: openBatch });
        const result = await removeAttachment(pool, { token: 'tok', attachmentId: 'x' });
        expect(result).toEqual({ ok: false, status: 400, error: 'attachmentId required' });
    });
});
