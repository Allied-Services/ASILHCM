'use strict';

const { deriveCycleCollection } = require('../src/modules/records/cycleCollection');

describe('deriveCycleCollection', () => {
    test('attendance only → absent-days machine file', () => {
        const d = deriveCycleCollection(['ATTENDANCE']);
        expect(d.collection_mode).toBe('machine_file');
        expect(d.attendance_input_mode).toBe('absent_only');
        expect(d.file_headers).toEqual(['employee_id', 'name', 'absent_days']);
        expect(d.uses_portal).toBe(false);
    });

    test('attendance + OT → absent days plus OT columns', () => {
        const d = deriveCycleCollection(['ATTENDANCE', 'OT']);
        expect(d.collection_mode).toBe('machine_file');
        expect(d.file_headers).toEqual(['employee_id', 'name', 'absent_days', 'ot2', 'ot3']);
    });

    test('Wafi expense + medical stays monthly form', () => {
        const d = deriveCycleCollection(['OT', 'EXPENSE', 'MEDICAL']);
        expect(d.collection_mode).toBe('monthly_form');
        expect(d.uses_portal).toBe(true);
        expect(d.uses_file).toBe(false);
        expect(d.file_headers).toEqual([]);
    });

    test('attendance plus expense/medical is mixed', () => {
        const d = deriveCycleCollection(['ATTENDANCE', 'EXPENSE', 'MEDICAL']);
        expect(d.collection_mode).toBe('mixed');
        expect(d.uses_portal).toBe(true);
        expect(d.uses_file).toBe(true);
        expect(d.file_headers).toEqual(['employee_id', 'name', 'absent_days']);
    });
});
