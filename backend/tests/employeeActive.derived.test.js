'use strict';

const {
    isEmployeeCurrentlyActive,
    applyLastWorkingDayToActive,
    derivedActiveStatusLabel,
} = require('../src/core/employeeActive');

describe('derived employee active', () => {
    const asOf = new Date('2026-09-18T08:00:00.000Z');

    test('past last working day is inactive even if flag is Yes', () => {
        const emp = { active: 'Yes', last_working_day: '2026-07-30' };
        expect(isEmployeeCurrentlyActive(emp, asOf)).toBe(false);
        expect(derivedActiveStatusLabel(emp, asOf)).toBe('Inactive');
    });

    test('future last working day stays active', () => {
        const emp = { active: 'Yes', lastWorkingDay: '2026-12-31' };
        expect(isEmployeeCurrentlyActive(emp, asOf)).toBe(true);
    });

    test('saving a past LWD persists Inactive; clearing LWD does not reactivate', () => {
        expect(applyLastWorkingDayToActive('Yes', '2026-07-30', asOf)).toBe('No');
        expect(applyLastWorkingDayToActive('No', '', asOf)).toBe('No');
        expect(applyLastWorkingDayToActive('Yes', '2026-12-31', asOf)).toBe('Yes');
    });
});
