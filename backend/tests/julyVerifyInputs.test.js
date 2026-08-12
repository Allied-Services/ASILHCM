'use strict';

const {
    loadJulyVerifyInputsMap,
    clearJulyVerifyCache,
    DEFAULT_VERIFY_CSV,
} = require('../src/payroll/julyVerifyInputs');

describe('julyVerifyInputs', () => {
    beforeEach(() => clearJulyVerifyCache());

    test('loads SPL-385 with multiline bank field', () => {
        const map = loadJulyVerifyInputsMap(DEFAULT_VERIFY_CSV);
        const row = map.get('ASIL/SPL-385/21');
        expect(row).toBeDefined();
        expect(row.excelNet).toBe(435468);
        expect(row.ot2).toBe(0);
    });

    test('Subhan Ud Din OT from Excel verify', () => {
        const map = loadJulyVerifyInputsMap(DEFAULT_VERIFY_CSV);
        const row = map.get('ASIL/SPL-47/21');
        expect(row.ot2).toBeCloseTo(106.5, 1);
        expect(row.ot3).toBeCloseTo(17, 1);
        expect(row.excelNet).toBe(253787);
    });

    test('map has 304+ Wafi July rows', () => {
        const map = loadJulyVerifyInputsMap(DEFAULT_VERIFY_CSV);
        expect(map.size).toBeGreaterThanOrEqual(304);
    });
});
