'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTemplateExampleCode, parseClaimsNumber, parseManualClaimsCsv } from './manualClaimsCsv.js';

const HEADER = 'Code,Emp Name,OT (1X),OT (x2),OT (x3),OPD,Exp,Exp Bills Status,Absents,Work Month,Work Year,Reason,Send to LM?';

describe('parseManualClaimsCsv', () => {
  it('reads the downloaded template including the example row', () => {
    const csv = `${HEADER}\nASIL/SPL-001,Example Employee,0,4,0,0,0,,0,7,2026,Manual upload correction,Y`;
    const parsed = parseManualClaimsCsv(csv);
    assert.equal(parsed.error, null);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].Code, 'ASIL/SPL-001');
    assert.equal(parsed.rows[0]['OT (x2)'], '4');
    assert.equal(parsed.rows[0]['Work Month'], '7');
  });

  it('strips a UTF-8 BOM and quoted Excel headers', () => {
    const csv = `\uFEFF"Code","Emp Name","OT (x2)","Work Month","Work Year","Reason"\n"ASIL/SPL-91/21","Khan, Ali","3","7","2026","Fix July"`;
    const parsed = parseManualClaimsCsv(csv);
    assert.equal(parsed.error, null);
    assert.equal(parsed.rows[0].Code, 'ASIL/SPL-91/21');
    assert.equal(parsed.rows[0]['Emp Name'], 'Khan, Ali');
    assert.equal(parsed.rows[0]['OT (x2)'], '3');
  });

  it('accepts semicolon-delimited Excel CSVs', () => {
    const csv = 'Code;Emp Name;OT (x2);Work Month;Work Year\nASIL/SPL-91/21;Ali;2;7;2026';
    const parsed = parseManualClaimsCsv(csv);
    assert.equal(parsed.error, null);
    assert.equal(parsed.rows[0].Code, 'ASIL/SPL-91/21');
    assert.equal(parsed.rows[0]['OT (x2)'], '2');
  });

  it('recovers a UTF-16 file that decoded with null bytes', () => {
    const csv = 'C\u0000o\u0000d\u0000e\u0000,\u0000O\u0000T\u0000 \u0000(\u0000x\u00002\u0000)\nASIL/SPL-91/21,5';
    const parsed = parseManualClaimsCsv(csv);
    assert.equal(parsed.error, null);
    assert.equal(parsed.rows[0].Code, 'ASIL/SPL-91/21');
  });

  it('explains a header-only file instead of returning zero silent rows', () => {
    const parsed = parseManualClaimsCsv(`${HEADER}\n`);
    assert.equal(parsed.rows.length, 0);
    assert.match(parsed.error, /no data rows/i);
  });

  it('reads Excel thousand-separated amounts as numbers', () => {
    assert.equal(parseClaimsNumber('80,823'), 80823);
    assert.equal(parseClaimsNumber('9,672'), 9672);
    assert.equal(isTemplateExampleCode('ASIL/SPL-001'), true);
    assert.equal(isTemplateExampleCode('ASIL/SPL-400/21'), false);
  });

  it('rejects a file with no Code column', () => {
    const parsed = parseManualClaimsCsv('Name,Hours\nAli,4');
    assert.equal(parsed.rows.length, 0);
    assert.match(parsed.error, /Missing Code column/i);
  });
});
