'use strict';

const { allowedForDesignation } = require('../src/modules/serviceOrders/rosterCapacity');

describe('SO roster capacity', () => {
    const orders = [
        {
            site_code: 'DEPOT-A',
            lines: [
                {
                    is_manpower_dependent: true,
                    roles: [{ designation: 'Janitor', count: 4 }],
                },
            ],
        },
        {
            site_code: 'DEPOT-B',
            lines: [
                {
                    is_manpower_dependent: true,
                    roles: [{ designation: 'Sweeping / Cleaning Services', count: 2 }],
                },
            ],
        },
    ];

    test('janitor aliases match sweeping/cleaning and prefer site count', () => {
        expect(allowedForDesignation(orders, 'Janitor', 'DEPOT-A')).toEqual({
            allowed: 4,
            scope: 'site',
            site: 'DEPOT-A',
        });
        expect(allowedForDesignation(orders, 'Janitor', 'DEPOT-B').allowed).toBe(2);
    });

    test('no matching role means no cap', () => {
        expect(allowedForDesignation(orders, 'Supervisor', 'DEPOT-A')).toBeNull();
    });

    test('no site uses the contract-wide total', () => {
        expect(allowedForDesignation(orders, 'Janitor', null)).toEqual({
            allowed: 6,
            scope: 'contract',
            site: null,
        });
    });
});
