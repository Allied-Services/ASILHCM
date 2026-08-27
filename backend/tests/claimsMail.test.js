'use strict';

const {
    getClaimsMonitorCc,
    getClaimsReplyTo,
    mergeClaimsMonitorCc,
    withClaimsMonitorCc,
    withClaimsPortalMail,
    appendOpsSupportFooter,
    wrapClaimsHtmlFooter,
    shouldSendRecordEmail,
    submitterRoleLabel,
    summarizeSubmitItems,
    buildSubmitRecordEmailHtml,
    buildSubmitRecordMail,
} = require('../src/modules/claims/claimsMail');

describe('claims monitor CC', () => {
    const prevCc = process.env.CLAIMS_MONITOR_CC;
    const prevUntil = process.env.CLAIMS_MONITOR_CC_UNTIL;

    afterEach(() => {
        if (prevCc === undefined) delete process.env.CLAIMS_MONITOR_CC;
        else process.env.CLAIMS_MONITOR_CC = prevCc;
        if (prevUntil === undefined) delete process.env.CLAIMS_MONITOR_CC_UNTIL;
        else process.env.CLAIMS_MONITOR_CC_UNTIL = prevUntil;
    });

    it('defaults to claims@asil.com.pk before the until date', () => {
        delete process.env.CLAIMS_MONITOR_CC;
        delete process.env.CLAIMS_MONITOR_CC_UNTIL;
        expect(getClaimsMonitorCc(new Date('2026-08-15T10:00:00+05:00'))).toEqual(['claims@asil.com.pk']);
    });

    it('stops after CLAIMS_MONITOR_CC_UNTIL', () => {
        delete process.env.CLAIMS_MONITOR_CC;
        process.env.CLAIMS_MONITOR_CC_UNTIL = '2026-11-15';
        expect(getClaimsMonitorCc(new Date('2026-11-16T00:00:01+05:00'))).toEqual([]);
    });

    it('can be disabled with an empty CLAIMS_MONITOR_CC', () => {
        process.env.CLAIMS_MONITOR_CC = '';
        expect(getClaimsMonitorCc(new Date('2026-08-15T10:00:00+05:00'))).toEqual([]);
    });

    it('does not CC an address that is already To', () => {
        delete process.env.CLAIMS_MONITOR_CC;
        delete process.env.CLAIMS_MONITOR_CC_UNTIL;
        expect(mergeClaimsMonitorCc(
            { to: 'claims@asil.com.pk' },
            new Date('2026-08-15T10:00:00+05:00')
        )).toEqual([]);
    });

    it('wraps sendAppEmail with the monitor CC', async () => {
        delete process.env.CLAIMS_MONITOR_CC;
        delete process.env.CLAIMS_MONITOR_CC_UNTIL;
        const send = jest.fn().mockResolvedValue({ ok: true });
        const wrapped = withClaimsMonitorCc(send);
        await wrapped({ to: 'focal@wafi.example', subject: 'x', html: '<p>x</p>' });
        expect(send).toHaveBeenCalledWith({
            to: 'focal@wafi.example',
            subject: 'x',
            html: '<p>x</p>',
            cc: ['claims@asil.com.pk'],
        });
    });

    it('defaults Reply-To to ops-support', () => {
        delete process.env.CLAIMS_REPLY_TO;
        expect(getClaimsReplyTo()).toBe('ops-support@asil.com.pk');
    });

    it('wraps sendAppEmail with CC and Reply-To', async () => {
        delete process.env.CLAIMS_MONITOR_CC;
        delete process.env.CLAIMS_MONITOR_CC_UNTIL;
        delete process.env.CLAIMS_REPLY_TO;
        const send = jest.fn().mockResolvedValue({ ok: true });
        const wrapped = withClaimsPortalMail(send);
        await wrapped({ to: 'focal@wafi.example', subject: 'x', html: '<p>x</p>' });
        expect(send).toHaveBeenCalledWith({
            to: 'focal@wafi.example',
            subject: 'x',
            html: '<p>x</p>',
            cc: ['claims@asil.com.pk'],
            reply_to: 'ops-support@asil.com.pk',
        });
    });

    it('appendOpsSupportFooter injects before body close', () => {
        delete process.env.CLAIMS_REPLY_TO;
        const html = '<html><body><p>Hi</p></body></html>';
        const out = appendOpsSupportFooter(html);
        expect(out).toMatch(/ops-support@asil.com.pk/);
        expect(out.indexOf('ops-support')).toBeLessThan(out.indexOf('</body>'));
    });

    it('wrapClaimsHtmlFooter delegates to appendOpsSupportFooter', () => {
        delete process.env.CLAIMS_REPLY_TO;
        expect(wrapClaimsHtmlFooter('<body></body>')).toMatch(/Reply to this email/);
    });
});

describe('submit record confirmation', () => {
    const prevSample = process.env.CLAIMS_SAMPLE_EMAIL;

    afterEach(() => {
        if (prevSample === undefined) delete process.env.CLAIMS_SAMPLE_EMAIL;
        else process.env.CLAIMS_SAMPLE_EMAIL = prevSample;
    });

    it('sends in SAMPLE as well as ACTUAL (redirect still applies)', () => {
        expect(shouldSendRecordEmail({ campaign_mode: 'sample' })).toBe(true);
        expect(shouldSendRecordEmail({ campaign_mode: 'actual' })).toBe(true);
    });

    it('labels Employee, Focal, and Line Manager from the claims process', () => {
        expect(submitterRoleLabel('employee_then_asil')).toBe('Employee');
        expect(submitterRoleLabel('employee_then_lm')).toBe('Employee');
        expect(submitterRoleLabel('focal_then_lm')).toBe('Focal');
        expect(submitterRoleLabel('focal_only')).toBe('Focal');
        expect(submitterRoleLabel('lm_only')).toBe('Line Manager');
    });

    it('splits overtime into 2X and 3X and totals expense and medical', () => {
        const totals = summarizeSubmitItems([
            { claim_type: 'OT', ot_hours: 4, ot_multiplier_factor: 2 },
            { claim_type: 'OT', ot_hours: 2.5, ot_multiplier_factor: 3 },
            { claim_type: 'OT', ot_hours: 1, ot_multiplier_factor: 1 },
            { claim_type: 'EXPENSE', amount: 1200 },
            { claim_type: 'MEDICAL', amount: 3500.5 },
        ]);
        expect(totals.ot1).toBe(1);
        expect(totals.ot2).toBe(4);
        expect(totals.ot3).toBe(2.5);
        expect(totals.expense).toBe(1200);
        expect(totals.medical).toBe(3500.5);
    });

    it('builds a confirmation with summary and line list, escaping user text', () => {
        const html = buildSubmitRecordEmailHtml({
            period: { claim_month: 7, claim_year: 2026 },
            batch: { routing_profile: 'focal_then_lm', filler_email: 'focal@wafi-energy.com' },
            submissions: [{
                id: 11,
                employee_name: 'Ali <script>',
                employee_id: 'ASIL-1',
                approver_email: 'lm@wafi-energy.com',
            }],
            items: [
                {
                    submission_id: 11,
                    claim_type: 'OT',
                    claim_date: '2026-07-15',
                    ot_hours: 4,
                    ot_multiplier_factor: 2,
                    time_from: '18:00',
                    time_to: '22:00',
                    nature: 'Site cover',
                },
                {
                    submission_id: 11,
                    claim_type: 'EXPENSE',
                    claim_date: '2026-07-16',
                    amount: 1200,
                    expense_type: 'Travel',
                    description: 'Taxi & fuel',
                },
                {
                    submission_id: 11,
                    claim_type: 'MEDICAL',
                    claim_date: '2026-07-17',
                    amount: 3500,
                    patient_name: 'Spouse',
                    description: 'OPD',
                },
            ],
        });
        expect(html).toMatch(/OT 2X: <strong>4 hrs<\/strong>/);
        expect(html).toMatch(/OT 3X: <strong>0 hrs<\/strong>/);
        expect(html).toMatch(/Expense: <strong>PKR 1,200<\/strong>/);
        expect(html).toMatch(/Medical: <strong>PKR 3,500<\/strong>/);
        expect(html).toMatch(/15\/07\/2026/);
        expect(html).toMatch(/4h · 2X/);
        expect(html).toMatch(/Taxi &amp; fuel/);
        expect(html).toMatch(/Ali &lt;script&gt;/);
        expect(html).toMatch(/Submitted to: lm@wafi-energy.com/);
        expect(html).not.toMatch(/<script>/);
    });

    it('SAMPLE mail goes to the test inbox and names the real filler', () => {
        process.env.CLAIMS_SAMPLE_EMAIL = 'shezad.mumtaz@asil.com.pk';
        const mail = buildSubmitRecordMail({
            period: { claim_month: 8, claim_year: 2026, campaign_mode: 'sample' },
            batch: { routing_profile: 'lm_only', filler_email: 'manager@wafi-energy.com' },
            submissions: [{ id: 2, employee_name: 'Imran', employee_id: 'ASIL-2' }],
            items: [{ submission_id: 2, claim_type: 'OT', claim_date: '2026-08-01', ot_hours: 3, ot_multiplier_factor: 3 }],
        });
        expect(mail.to).toBe('shezad.mumtaz@asil.com.pk');
        expect(mail.originalTo).toBe('manager@wafi-energy.com');
        expect(mail.subject).toMatch(/\[SAMPLE · record\]/);
        expect(mail.html).toMatch(/Line Manager/);
        expect(mail.html).toMatch(/This submit is final/);
        expect(mail.html).toMatch(/OT 3X: <strong>3 hrs<\/strong>/);
    });
});
