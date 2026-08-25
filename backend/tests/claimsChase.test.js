'use strict';

const { planChase, planSmartReminder } = require('../src/modules/claims/claimsChase');

function person(partial) {
    return {
        employee_id: 'E1',
        name: 'Ayesha',
        status: 'not_invited',
        mailed_to: 'focal@wafi',
        lm: 'lm@wafi',
        batch_id: 3,
        period_id: 9,
        ...partial,
    };
}

describe('planChase', () => {
    test('invite only not-invited unless force', () => {
        const people = [
            person({ employee_id: 'A', status: 'not_invited' }),
            person({ employee_id: 'B', status: 'invite_sent', mailed_to: 'focal2@wafi' }),
            person({ employee_id: 'C', status: 'on_sheet', mailed_to: 'focal3@wafi' }),
        ];
        const plan = planChase({ people, action: 'invite', force: false });
        expect(plan.send.map((p) => p.employee_id)).toEqual(['A']);
        expect(plan.skipped.map((p) => p.reason)).toEqual(['already_invited', 'already_finished']);
        expect(plan.targets.map((t) => t.email)).toEqual(['focal@wafi']);
    });

    test('filler reminder skips finished and waiting LM', () => {
        const people = [
            person({ employee_id: 'A', status: 'waiting_focal' }),
            person({ employee_id: 'B', status: 'waiting_lm' }),
            person({ employee_id: 'C', status: 'no_claims' }),
        ];
        const plan = planChase({ people, action: 'remind_filler', force: false });
        expect(plan.send.map((p) => p.employee_id)).toEqual(['A']);
        expect(plan.skipped.map((p) => p.reason)).toEqual(['not_waiting_filler', 'already_finished']);
    });

    test('approver reminder targets unique LM emails', () => {
        const people = [
            person({ employee_id: 'A', status: 'waiting_lm', lm: 'lm@wafi' }),
            person({ employee_id: 'B', status: 'waiting_lm', lm: 'lm@wafi', mailed_to: 'other@wafi' }),
            person({ employee_id: 'C', status: 'waiting_asil', lm: 'huzaifa@asil.com.pk' }),
            person({ employee_id: 'D', status: 'waiting_focal', lm: 'skip@wafi' }),
        ];
        const plan = planChase({ people, action: 'remind_approver', force: false });
        expect(plan.send.map((p) => p.employee_id)).toEqual(['A', 'B', 'C']);
        expect(plan.targets.map((t) => t.email)).toEqual(['lm@wafi', 'huzaifa@asil.com.pk']);
        expect(plan.skipped[0].reason).toBe('not_waiting_approver');
    });

    test('force lets superadmin re-mail finished people', () => {
        const people = [person({ employee_id: 'A', status: 'on_sheet' })];
        const blocked = planChase({ people, action: 'invite', force: false });
        expect(blocked.send).toHaveLength(0);
        const forced = planChase({ people, action: 'invite', force: true });
        expect(forced.send).toHaveLength(1);
    });
});

describe('planSmartReminder', () => {
    test('routes filler and approver in one plan', () => {
        const people = [
            person({ employee_id: 'A', status: 'waiting_focal', mailed_to: 'focal@wafi', batch_id: 3 }),
            person({ employee_id: 'B', status: 'waiting_lm', lm: 'lm@wafi', period_id: 9 }),
            person({ employee_id: 'C', status: 'on_sheet' }),
        ];
        const plan = planSmartReminder({ people, force: false });
        expect(plan.send.map((p) => p.employee_id)).toEqual(['A', 'B']);
        expect(plan.targets).toHaveLength(2);
        expect(plan.filler_batches).toHaveLength(1);
        expect(plan.approver_packs).toHaveLength(1);
        expect(plan.skipped[0].reason).toBe('already_finished');
    });
});
