'use strict';

const { canAccessClaimsPortal } = require('../src/modules/claims/claimsAccess');

describe('canAccessClaimsPortal', () => {
    test('operations_supervisor can view and send', () => {
        const user = { role: 'operations_supervisor', email: 'rabia.bhutto@asil.com.pk' };
        expect(canAccessClaimsPortal(user, 'view')).toBe(true);
        expect(canAccessClaimsPortal(user, 'campaign')).toBe(true);
    });

    test('operations and monthly_cycle can run the Monthly Cycle claim desk', () => {
        for (const role of ['operations', 'monthly_cycle']) {
            const user = { role };
            expect(canAccessClaimsPortal(user, 'view')).toBe(true);
            expect(canAccessClaimsPortal(user, 'campaign')).toBe(true);
            expect(canAccessClaimsPortal(user, 'claims_manual_override')).toBe(true);
        }
    });

    test('custom claims_portal permission works without a finance role', () => {
        const user = {
            role: 'operations_team',
            permissions: { claims_portal: { access: true, subPerms: ['view', 'campaign'] } },
        };
        expect(canAccessClaimsPortal(user, 'view')).toBe(true);
        expect(canAccessClaimsPortal(user, 'campaign')).toBe(true);
        expect(canAccessClaimsPortal(user, 'claims_manual_override')).toBe(false);
        const withOverride = {
            role: 'operations_team',
            permissions: { claims_portal: { access: true, subPerms: ['view', 'claims_manual_override'] } },
        };
        expect(canAccessClaimsPortal(withOverride, 'claims_manual_override')).toBe(true);
    });

    test('operations_team without permission cannot send', () => {
        expect(canAccessClaimsPortal({ role: 'operations_team' }, 'campaign')).toBe(false);
        expect(canAccessClaimsPortal({ role: 'operations_team' }, 'view')).toBe(false);
    });
});
