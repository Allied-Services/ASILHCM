import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MONTHLY_CYCLE_SECTIONS, resolveCycleSection } from './monthlyCycleNav.js';

describe('monthly cycle sections', () => {
  it('keeps collection tabs only', () => {
    assert.deepEqual(MONTHLY_CYCLE_SECTIONS.map((s) => s.key), [
      'setup', 'people', 'collect', 'review', 'track', 'corrections',
    ]);
  });

  it('sends stale payroll and close links to Track', () => {
    assert.equal(resolveCycleSection('payroll'), 'track');
    assert.equal(resolveCycleSection('close'), 'track');
  });

  it('defaults to review, or setup when a contract is in the URL', () => {
    assert.equal(resolveCycleSection(''), 'review');
    assert.equal(resolveCycleSection('', { hasContract: true }), 'setup');
    assert.equal(resolveCycleSection('collect'), 'collect');
  });
});
