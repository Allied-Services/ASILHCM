import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clientContractHref, isFixedValueService, monthlyCycleSetupHref, staffHref } from './navLinks.js';

describe('navLinks', () => {
  it('builds staff tab hrefs', () => {
    assert.equal(staffHref('client', { client: 'CLI-1', contract: 'CTR-1' }), '/?tab=client&client=CLI-1&contract=CTR-1');
    assert.equal(clientContractHref('CLI-1', 'CTR-1'), '/?tab=client&client=CLI-1&contract=CTR-1');
    assert.equal(monthlyCycleSetupHref('CTR-1'), '/?tab=monthly_cycle&section=setup&contract=CTR-1');
  });

  it('recognizes Fixed Value service types', () => {
    assert.equal(isFixedValueService('Fixed Value / Conservancy'), true);
    assert.equal(isFixedValueService('Manpower Services', 'fixed_value'), true);
    assert.equal(isFixedValueService('BPO / Back Office', 'cost_plus'), false);
  });
});
