'use strict';

const {
    fillExperienceFromPack,
    inviteHowToHtml,
    inviteWhyHtml,
} = require('../src/modules/claims/claimsFillExperience');

describe('fillExperienceFromPack', () => {
    test('Wafi monthly form keeps on-screen OT / Expense / Medical', () => {
        const exp = fillExperienceFromPack({
            enabled_types: ['OT', 'EXPENSE', 'MEDICAL'],
            collection_mode: 'monthly_form',
        });
        expect(exp.fileOnly).toBe(false);
        expect(exp.showOnScreen).toBe(true);
        expect(exp.typeList).toBe('Overtime, Expense Reimbursement, Medical reimbursement');
        expect(inviteHowToHtml(exp)).toMatch(/Option B/);
        expect(inviteHowToHtml(exp)).toMatch(/Overtime/);
        expect(inviteWhyHtml(exp)).not.toMatch(/Wafi/i);
    });

    test('PSO machine file is file-only and lists enabled types', () => {
        const exp = fillExperienceFromPack({
            enabled_types: ['ATTENDANCE', 'OT', 'EXPENSE', 'MEDICAL'],
            collection_mode: 'machine_file',
        });
        expect(exp.fileOnly).toBe(true);
        expect(exp.showOnScreen).toBe(false);
        expect(exp.hasAttendance).toBe(true);
        const html = inviteHowToHtml(exp, { fillCloseDay: 18 });
        expect(html).not.toMatch(/Option B/);
        expect(html).toMatch(/Attendance/);
        expect(html).toMatch(/upload the same file/);
    });
});
