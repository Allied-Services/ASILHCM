/** Parse the Portal Claims manual-override CSV (Excel-safe). */

function stripCell(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

function detectDelimiter(headerLine) {
  const counts = {
    ',': (headerLine.match(/,/g) || []).length,
    ';': (headerLine.match(/;/g) || []).length,
    '\t': (headerLine.match(/\t/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ',';
}

function parseCsvRecords(text) {
  const normalized = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const firstLine = normalized.split('\n')[0] || '';
  const delim = detectDelimiter(firstLine);
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      records.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.trim());
    records.push(row);
  }
  return records.filter((r) => r.some((c) => String(c || '').trim()));
}

const CODE_HEADER = /^(code|asil employee code|employeeid|employee id|employee_id)$/i;

export const TEMPLATE_EXAMPLE_CODE = 'ASIL/SPL-001';

export function isTemplateExampleCode(code) {
  return String(code || '').trim().toUpperCase() === TEMPLATE_EXAMPLE_CODE;
}

/** Excel "80,823" / "9,672" → 80823 / 9672. Blank → 0. */
export function parseClaimsNumber(value) {
  if (value === '' || value == null) return 0;
  const cleaned = String(value).replace(/,/g, '').replace(/["'\s]/g, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function parseManualClaimsCsv(text) {
  const raw = String(text || '');
  if (!raw.replace(/\u0000/g, '').trim()) {
    return { rows: [], headers: [], error: 'File is empty.' };
  }
  const records = parseCsvRecords(raw);
  if (!records.length) {
    return { rows: [], headers: [], error: 'Could not read any CSV rows. Save as CSV (not Excel .xlsx).' };
  }
  const headers = records[0].map((h) => stripCell(h));
  if (!headers.some((h) => CODE_HEADER.test(h))) {
    return {
      rows: [],
      headers,
      error: `Missing Code column. Found: ${headers.join(', ') || '(none)'}. Use Download CSV template.`,
    };
  }
  const rows = [];
  for (const cols of records.slice(1)) {
    if (cols.every((c) => !stripCell(c))) continue;
    const row = {};
    headers.forEach((h, i) => { row[h] = stripCell(cols[i]); });
    rows.push(row);
  }
  if (!rows.length) {
    return { rows: [], headers, error: 'Header found but no data rows. Fill the template, then save as CSV.' };
  }
  return { rows, headers, error: null };
}
