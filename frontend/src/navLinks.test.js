import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clientContractHref, isFixedValueService, monthlyCycleSetupHref, normalizeContractChapter, staffHref } from './navLinks.js';

describe('navLinks', () => {
  it('builds staff tab hrefs', () => {
    assert.equal(staffHref('client', { client: 'CLI-1', contract: 'CTR-1' }), '/?tab=client&client=CLI-1&contract=CTR-1');
    assert.equal(clientContractHref('CLI-1', 'CTR-1'), '/?tab=client&client=CLI-1&contract=CTR-1');
    assert.equal(clientContractHref('CLI-1', 'CTR-1', 'so'), '/?tab=client&client=CLI-1&contract=CTR-1&chapter=so');
    assert.equal(monthlyCycleSetupHref('CTR-1'), '/?tab=monthly_cycle&section=setup&contract=CTR-1');
  });

  it('normalizes contract editor chapters', () => {
    assert.equal(normalizeContractChapter('so'), 'so');
    assert.equal(normalizeContractChapter('service_orders'), 'so');
    assert.equal(normalizeContractChapter('so', { hasSo: false }), 'details');
    assert.equal(normalizeContractChapter('costs'), 'costs');
    assert.equal(normalizeContractChapter(''), 'details');
  });

  it('recognizes Fixed Value service types', () => {
    assert.equal(isFixedValueService('Fixed Value / Conservancy'), true);
    assert.equal(isFixedValueService('Manpower Services', 'fixed_value'), true);
    assert.equal(isFixedValueService('BPO / Back Office', 'cost_plus'), false);
  });
});
