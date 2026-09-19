import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitial,
  formToPayload,
  lineRateWarning,
  roleRateSum,
  siteLineTotals,
} from './fvContractForm.js';

describe('fvContractForm role rates', () => {
  it('round-trips role rates from API detail', () => {
    const form = buildInitial({
      id: 'CTR-PSO-NORTH-ZONE',
      service_orders: [{
        id: 'SO-PSO-MORGAH',
        site_code: 'MORGAH',
        name: 'Morgah Installation',
        lines: [{
          line_number: '1',
          name: 'Office/Misc Services',
          rate: 331248,
          is_manpower_dependent: true,
          roles: [
            { designation: 'Conservancy Supervisory Services', count: 1, rate: 60246 },
            { designation: 'Gardening Services', count: 2, rate: 52183 },
          ],
        }],
      }],
    });
    assert.equal(form.sites[0].lines[0].roles[0].rate, 60246);
    const payload = formToPayload(form);
    assert.equal(payload.sites[0].lines[0].roles[0].rate, 60246);
    assert.equal(roleRateSum(form.sites[0].lines[0].roles), 60246 + 52183 * 2);
  });

  it('warns when role rates do not match the line total', () => {
    const warn = lineRateWarning({
      is_manpower_dependent: true,
      rate: 331248,
      roles: [{ designation: 'Gardener', count: 1, rate: 52183 }],
    });
    assert.match(warn, /Role rates sum/);
  });

  it('splits manpower and non-manpower site totals', () => {
    const totals = siteLineTotals({
      lines: [
        { rate: 331248, is_manpower_dependent: true },
        { rate: 10988, is_manpower_dependent: false },
      ],
    });
    assert.equal(totals.manpower, 331248);
    assert.equal(totals.nonManpower, 10988);
    assert.equal(totals.total, 342236);
  });
});
