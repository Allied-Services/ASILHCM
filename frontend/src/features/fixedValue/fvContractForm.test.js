import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInitial,
  formToPayload,
  mapRole,
  rolePayload,
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
    assert.equal(payload.sites[0].lines[0].roles[1].rate, 52183);
    assert.equal(payload.sites[0].lines[0].roles[1].count, 2);
  });

  it('keeps explicit role rates and manpower flags on payload', () => {
    const mapped = mapRole({
      designation: 'Sweeping / Cleaning Services',
      count: 1,
      rate: 52040,
    }, true);
    assert.equal(mapped.rate, 52040);
    const payload = rolePayload(mapped, true);
    assert.equal(payload.rate, 52040);
    assert.equal(payload.is_manpower_dependent, true);
  });
});
