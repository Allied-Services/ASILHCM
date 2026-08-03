'use strict';

const path = require('path');
const {
    loadJulyBonusAmount,
    loadBonusWorkingMap,
    clearBonusWorkingCache,
    SPL420_OVERRIDE_ID,
    FM_CONTRACT_IDS,
    DEFAULT_BONUS_CSV,
} = require('../src/payroll/julyBonusAccrual');

describe('julyBonusAccrual', () => {
    beforeEach(() => clearBonusWorkingCache());

    test('Muhammad Anees bonus = 83,442 from accrual sheet Total', () => {
        expect(loadJulyBonusAmount('ASIL/SPL-91/21', {
            contractId: 'CTR-1773046722553',
        })).toBe(83442);
    });

    test('ASIL/SPL-420/21 override = 105,000 (not sheet Total 11,250)', () => {
        const map = loadBonusWorkingMap(DEFAULT_BONUS_CSV);
        expect(map.get('ASIL/SPL-420/21')?.total).toBe(11250);
        expect(loadJulyBonusAmount(SPL420_OVERRIDE_ID, {
            contractId: 'CTR-1773046722553',
        })).toBe(105000);
    });

    test('FM contract employees get zero July bonus', () => {
        for (const contractId of FM_CONTRACT_IDS) {
            expect(loadJulyBonusAmount('ASIL/SPL-91/21', { contractId })).toBe(0);
        }
    });

    test('employee not on bonus sheet gets zero', () => {
        expect(loadJulyBonusAmount('ASILFM/SPL/22/72', {
            contractId: 'CTR-1773046722553',
        })).toBe(0);
    });

    test('manual bonus override wins', () => {
        expect(loadJulyBonusAmount('ASIL/SPL-91/21', {
            contractId: 'CTR-1773046722553',
            manualBonusAmount: 99999,
        })).toBe(99999);
    });

    test('bonus working map loads from audit CSV', () => {
        const map = loadBonusWorkingMap(DEFAULT_BONUS_CSV);
        expect(map.size).toBeGreaterThanOrEqual(200);
    });
});
