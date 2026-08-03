'use strict';

const { parseDateOrNull } = require('../../core/dateParse');

/**
 * Full employee master roster — aligned with frontend MASTER_COLUMNS + operational fields.
 * Import: match on ASIL Employee Code; blank CSV cells NEVER overwrite existing DB values.
 */

const MASTER_ROSTER_COLUMNS = [
    'ASIL Employee Code',
    'ASIL BU',
    'Contract Name',
    'Contract ID',
    'Active',
    'CLIENT NAME',
    'Client Business Unit',
    'Department',
    'Designation',
    'Client Location',
    'Site',
    'Province',
    'Employee Name',
    "Father's Name",
    "Mother's Name",
    'CNIC Number',
    'CNIC Issue',
    'CNIC Expiry',
    'Place of Birth',
    'EOBI No',
    'Religion',
    'Salary',
    'Marital Status',
    'Primary Contact',
    'Emergency Contact',
    'Email Address',
    'Present Address',
    'Permanent Address',
    'Date of Birth',
    'Date of Joining',
    'Last Working Day',
    'Spouse Name',
    'Spouse Age',
    'Spouse CNIC',
    'Child 1 Name',
    'Child 1 Age',
    'Child 1 CNIC/Bay Form',
    'Child 2 Name',
    'Child 2 Age',
    'Child 2 CNIC/Bay Form',
    'Medical Coverage (Type)',
    'Medical Coverage Maternity',
    'Total Medical Coverage (Self & Family)',
    'Bank Name',
    'Bank Account',
    'Account Title',
    'NEXT OF KIN NAME',
    'NEXT OF KIN RELATION',
    'NEXT OF KIN CONTACT',
    'SESSI Number',
    'Shirt Size',
    'Trouser Size',
    'Safety Shoe Size',
    'Last Uniform Issue Date',
    'Last PPE Issue Date',
    'Gate Pass Expiry',
    'Payroll Cycle Type',
    'Region',
    'Line Manager Name',
    'Line Manager Email',
    'Supervisor Email',
    'Client Focal Email(s)',
    'Claim Authority',
];

/** csvHeader → db column + header aliases for import */
const FIELD_MAP = [
    { csv: 'ASIL Employee Code', db: 'id', aliases: ['Employee Code', 'Emp ID', 'ASIL Employee Code'] },
    { csv: 'ASIL BU', db: 'bu', aliases: ['Business Unit', 'BU'] },
    { csv: 'Contract Name', db: 'contract_name', aliases: ['Contract'] },
    { csv: 'Contract ID', db: 'contract_id', aliases: ['ContractId'] },
    { csv: 'Active', db: 'active', aliases: ['Status'] },
    { csv: 'CLIENT NAME', db: 'client', aliases: ['Client Name', 'Client'] },
    { csv: 'Client Business Unit', db: 'client_bu', aliases: ['Client BU', 'ClientBU'] },
    { csv: 'Department', db: 'dept', aliases: ['Dept'] },
    { csv: 'Designation', db: 'designation', aliases: ['Position', 'Job Title'] },
    { csv: 'Client Location', db: 'location', aliases: ['Location Name', 'Location', 'Client Location'] },
    { csv: 'Site', db: 'site', aliases: ['Work Site', 'Site Name'] },
    { csv: 'Province', db: 'province', aliases: [] },
    { csv: 'Employee Name', db: 'name', aliases: ['Name', 'Full Name'] },
    { csv: "Father's Name", db: 'father_name', aliases: ['Father Name', 'Fathers Name'] },
    { csv: "Mother's Name", db: 'mother_name', aliases: ['Mother Name', 'Mothers Name'] },
    { csv: 'CNIC Number', db: 'cnic', aliases: ['CNIC', 'CNIC No', 'NIC'] },
    { csv: 'CNIC Issue', db: 'cnic_issue', aliases: ['CNIC Issue Date'], type: 'date' },
    { csv: 'CNIC Expiry', db: 'cnic_expiry', aliases: ['CNIC Expiry Date'], type: 'date' },
    { csv: 'Place of Birth', db: 'place_of_birth', aliases: ['Birth Place', 'POB'] },
    { csv: 'EOBI No', db: 'eobi_no', aliases: ['EOBI Number', 'EOBI'] },
    { csv: 'Religion', db: 'religion', aliases: [] },
    { csv: 'Salary', db: 'salary', aliases: ['Base Salary', 'Basic Salary', 'Gross Salary'], type: 'number' },
    { csv: 'Marital Status', db: 'marital_status', aliases: ['Marital'] },
    { csv: 'Primary Contact', db: 'primary_contact', aliases: ['Phone', 'Mobile', 'Contact'] },
    { csv: 'Emergency Contact', db: 'emergency_contact', aliases: ['Emergency Phone'] },
    { csv: 'Email Address', db: 'email', aliases: ['Email', 'Personal Email Address', 'Official Email Address'] },
    { csv: 'Present Address', db: 'present_address', aliases: ['Current Address', 'Address'] },
    { csv: 'Permanent Address', db: 'permanent_address', aliases: ['Home Address'] },
    { csv: 'Date of Birth', db: 'dob', aliases: ['DOB', 'Birth Date'], type: 'date' },
    { csv: 'Date of Joining', db: 'doj', aliases: ['DOJ', 'Joining Date'], type: 'date' },
    { csv: 'Last Working Day', db: 'last_working_day', aliases: ['LWD', 'Exit Date'], type: 'date' },
    { csv: 'Spouse Name', db: 'spouse_name', aliases: ['Spouse'] },
    { csv: 'Spouse Age', db: 'spouse_age', aliases: [] },
    { csv: 'Spouse CNIC', db: 'spouse_cnic', aliases: ['Spouse NIC'] },
    { csv: 'Child 1 Name', db: 'child1_name', aliases: ['Child1 Name'] },
    { csv: 'Child 1 Age', db: 'child1_age', aliases: ['Child1 Age'] },
    { csv: 'Child 1 CNIC/Bay Form', db: 'child1_id', aliases: ['Child1 CNIC', 'Child 1 ID'] },
    { csv: 'Child 2 Name', db: 'child2_name', aliases: ['Child2 Name'] },
    { csv: 'Child 2 Age', db: 'child2_age', aliases: ['Child2 Age'] },
    { csv: 'Child 2 CNIC/Bay Form', db: 'child2_id', aliases: ['Child2 CNIC', 'Child 2 ID'] },
    { csv: 'Medical Coverage (Type)', db: 'medical_type', aliases: ['Medical Type'] },
    { csv: 'Medical Coverage Maternity', db: 'medical_maternity', aliases: ['Maternity'] },
    { csv: 'Total Medical Coverage (Self & Family)', db: 'total_medical_coverage', aliases: ['Total Medical Coverage'], type: 'number' },
    { csv: 'Bank Name', db: 'bank_name', aliases: ['Bank'] },
    { csv: 'Bank Account', db: 'bank_account', aliases: ['Bank Account No', 'Account Number'] },
    { csv: 'Account Title', db: 'account_title', aliases: ['Account Name'] },
    { csv: 'NEXT OF KIN NAME', db: 'nok_name', aliases: ['NOK Name', 'Next of Kin'] },
    { csv: 'NEXT OF KIN RELATION', db: 'nok_relation', aliases: ['NOK Relation'] },
    { csv: 'NEXT OF KIN CONTACT', db: 'nok_contact', aliases: ['NOK Contact'] },
    { csv: 'SESSI Number', db: 'sessi_no', aliases: ['SESSI No', 'SESSI'] },
    { csv: 'Shirt Size', db: 'shirt_size', aliases: [] },
    { csv: 'Trouser Size', db: 'trouser_size', aliases: [] },
    { csv: 'Safety Shoe Size', db: 'safety_shoe_size', aliases: ['Shoe Size'] },
    { csv: 'Last Uniform Issue Date', db: 'last_uniform_issue_date', aliases: ['Uniform Issue Date'], type: 'date' },
    { csv: 'Last PPE Issue Date', db: 'last_ppe_issue_date', aliases: ['PPE Issue Date'], type: 'date' },
    { csv: 'Gate Pass Expiry', db: 'gate_pass_expiry', aliases: ['Gate Pass Expiry Date'], type: 'date' },
    { csv: 'Payroll Cycle Type', db: 'payroll_cycle_type', aliases: ['Payroll Cycle'] },
    { csv: 'Region', db: 'region', aliases: [] },
    { csv: 'Line Manager Name', db: 'line_manager_name', aliases: ['Line Manager(Wafi) Name', 'Line Manager(Wafi) *'] },
    { csv: 'Line Manager Email', db: 'line_manager_email', aliases: ['Line Manager(Wafi) Email', 'Line Manager(Wafi) *'] },
    { csv: 'Supervisor Email', db: 'supervisor_email', aliases: ['supervisor_email', 'Approver', 'Approver Email', 'Focal/ Supervisor Email', 'Focal/ Supervisor *'] },
    { csv: 'Client Focal Email(s)', db: 'client_focal_emails', aliases: ['Client Focal Emails', 'Client Focal Email'] },
    { csv: 'Claim Authority', db: 'claim_authority', aliases: ['claim_authority', 'Claims Authority', 'Claim Filler', 'Focal/ Supervisor Email', 'Focal/ Supervisor *'] },
];

const DB_COLUMNS = [...new Set(FIELD_MAP.map(f => f.db))];

function csvEscape(v) {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function isBlank(v) {
    return v == null || String(v).trim() === '';
}

function normHeader(h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildHeaderIndex(headers) {
    const idx = {};
    headers.forEach((h, i) => {
        idx[normHeader(h)] = i;
    });
    return idx;
}

function pickFromRow(row, field) {
    const keys = [field.csv, ...(field.aliases || [])];
    for (const k of keys) {
        const v = row[k];
        if (!isBlank(v)) return String(v).trim();
    }
    // normalized header lookup
    const normRow = {};
    Object.keys(row).forEach(k => { normRow[normHeader(k)] = row[k]; });
    for (const k of keys) {
        const v = normRow[normHeader(k)];
        if (!isBlank(v)) return String(v).trim();
    }
    return null;
}

const EXPIRY_DATE_FIELDS = new Set(['cnic_expiry', 'gate_pass_expiry']);
const DOB_DATE_FIELDS = new Set(['dob']);

function toDateOrNull(v, fieldDb) {
    let kind = 'default';
    if (EXPIRY_DATE_FIELDS.has(fieldDb)) kind = 'expiry';
    else if (DOB_DATE_FIELDS.has(fieldDb)) kind = 'dob';
    return parseDateOrNull(v, { kind });
}

function toNumberOrNull(v) {
    if (isBlank(v)) return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

function formatExportValue(dbRow, field) {
    const v = dbRow[field.db];
    if (v == null || v === '') return '';
    if (field.type === 'date') {
        const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
        return s === 'Invalid Date' ? '' : s;
    }
    if (field.type === 'number' && field.db === 'salary') {
        return Number(v);
    }
    return v;
}

function rowToExportLine(dbRow) {
    // Supervisor falls back to line manager email for export display
    const enriched = {
        ...dbRow,
        supervisor_email: dbRow.supervisor_email || dbRow.line_manager_email || '',
        line_manager_email: dbRow.line_manager_email || dbRow.supervisor_email || '',
    };
    return MASTER_ROSTER_COLUMNS.map(csvHeader => {
        const field = FIELD_MAP.find(f => f.csv === csvHeader);
        if (!field) return '';
        return csvEscape(formatExportValue(enriched, field));
    }).join(',');
}

function activeEmployeeClause(alias = 'e') {
    return `(
        ${alias}.active IS NULL
        OR LOWER(TRIM(${alias}.active::text)) IN ('yes','true','1','active','')
        OR ${alias}.active::text = 'Yes'
    )
    AND (
        ${alias}.last_working_day IS NULL
        OR ${alias}.last_working_day >= CURRENT_DATE
    )`;
}

async function exportMasterRosterCsv(pool, { scope = 'active' } = {}) {
    const where = scope === 'all' ? 'TRUE' : activeEmployeeClause('e');
    const { rows } = await pool.query(
        `SELECT e.* FROM employees e WHERE ${where} ORDER BY e.client NULLS LAST, e.name`
    );

    const lines = [MASTER_ROSTER_COLUMNS.join(',')];
    for (const r of rows) {
        lines.push(rowToExportLine(r));
    }

    return {
        csv: lines.join('\n'),
        filename: `ASIL_Full_Employee_Master_${new Date().toISOString().slice(0, 10)}.csv`,
        rowCount: rows.length,
        columns: MASTER_ROSTER_COLUMNS,
        columnCount: MASTER_ROSTER_COLUMNS.length,
    };
}

async function loadLookupMaps(pool) {
    const [{ rows: contracts }, { rows: clients }] = await Promise.all([
        pool.query(`
            SELECT c.id, c.contract_name, c.location, cl.name AS client_name
            FROM contracts c LEFT JOIN clients cl ON cl.id = c.client_id
        `),
        pool.query(`SELECT id, name FROM clients`),
    ]);
    const ctByName = new Map();
    const ctById = new Map();
    for (const c of contracts) {
        if (c.id) ctById.set(String(c.id), c);
        if (c.contract_name) ctByName.set(c.contract_name.toLowerCase().trim(), c);
    }
    const clientByName = new Map();
    for (const c of clients) {
        if (c.name) clientByName.set(c.name.toLowerCase().trim(), c);
    }
    return { ctByName, ctById, clientByName };
}

/**
 * Parse CSV row into DB patch — only non-blank cells included.
 */
function csvRowToPatch(row, maps, existing) {
    const patch = {};
    for (const field of FIELD_MAP) {
        if (field.db === 'id') continue;
        const raw = pickFromRow(row, field);
        if (raw == null) continue;

        if (field.type === 'date') {
            patch[field.db] = toDateOrNull(raw, field.db);
        } else if (field.type === 'number') {
            patch[field.db] = toNumberOrNull(raw);
        } else if (field.db === 'supervisor_email' || field.db === 'line_manager_email') {
            patch[field.db] = raw.toLowerCase();
        } else if (field.db === 'claim_authority') {
            const v = raw.trim();
            patch[field.db] = /^self$/i.test(v) ? 'SELF' : v.toLowerCase();
        } else {
            patch[field.db] = raw;
        }
    }

    // Resolve contract by name when provided (never FK-fail)
    const contractName = pickFromRow(row, FIELD_MAP.find(f => f.db === 'contract_name'));
    const contractIdRaw = pickFromRow(row, FIELD_MAP.find(f => f.db === 'contract_id'));
    if (contractName || contractIdRaw) {
        const ct = (contractIdRaw && maps.ctById.get(contractIdRaw))
            || (contractName && maps.ctByName.get(contractName.toLowerCase()));
        if (ct) {
            patch.contract_id = ct.id;
            patch.contract_name = ct.contract_name;
            if (!patch.client && ct.client_name) patch.client = ct.client_name;
        } else if (contractName) {
            patch.contract_name = contractName;
            // keep existing contract_id if unknown name
            if (existing?.contract_id) patch.contract_id = existing.contract_id;
        }
    }

    const clientName = pickFromRow(row, FIELD_MAP.find(f => f.db === 'client'));
    if (clientName && maps.clientByName.has(clientName.toLowerCase())) {
        patch.client = maps.clientByName.get(clientName.toLowerCase()).name;
    }

    // Location Name alias → location + site
    const locName = pickFromRow(row, { csv: 'Location Name', aliases: ['Client Location', 'Location'] });
    if (locName) {
        patch.location = locName;
        if (!pickFromRow(row, FIELD_MAP.find(f => f.db === 'site'))) patch.site = locName;
    }

    if (patch.supervisor_email && !patch.line_manager_email) {
        patch.line_manager_email = patch.supervisor_email;
    }

    return patch;
}

/**
 * Merge patch onto existing — patch keys only (blanks already excluded).
 */
function mergeEmployeePatch(existing, patch) {
    const out = { ...(existing || {}) };
    for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')) {
            out[k] = v;
        }
    }
    return out;
}

/**
 * Master roster import wins on CNIC — clear the same CNIC from any other employee first.
 */
async function releaseCnicForEmployee(pool, cnic, keepEmployeeId) {
    const normalized = cnic == null ? '' : String(cnic).trim();
    if (!normalized || !keepEmployeeId) return [];
    const { rows } = await pool.query(
        `UPDATE employees SET cnic = NULL, updated_at = NOW()
         WHERE cnic = $1 AND id <> $2
         RETURNING id, name`,
        [normalized, keepEmployeeId]
    );
    return rows;
}

async function importMasterRosterCsv(pool, { csvText, updatedBy }) {
    const { parse } = require('csv-parse/sync');
    const records = parse(csvText || '', {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
    });
    const maps = await loadLookupMaps(pool);
    const updated = [];
    const inserted = [];
    const warnings = [];
    const errors = [];

    for (const row of records) {
        const code = pickFromRow(row, FIELD_MAP.find(f => f.db === 'id'));
        if (!code) {
            errors.push({ error: 'Missing ASIL Employee Code' });
            continue;
        }

        const { rows: existingRows } = await pool.query(`SELECT * FROM employees WHERE id = $1`, [code]);
        const existing = existingRows[0] || null;
        const patch = csvRowToPatch(row, maps, existing);

        if (pickFromRow(row, FIELD_MAP.find(f => f.db === 'contract_name'))
            && !maps.ctByName.has(String(pickFromRow(row, FIELD_MAP.find(f => f.db === 'contract_name'))).toLowerCase())
            && !maps.ctById.get(pickFromRow(row, FIELD_MAP.find(f => f.db === 'contract_id')))) {
            warnings.push({
                id: code,
                warning: `Contract not matched in DB — text saved, contract_id unchanged`,
            });
        }

        const merged = mergeEmployeePatch(existing, patch);
        const name = merged.name || existing?.name;

        if (!existing && !name) {
            errors.push({ id: code, error: 'Cannot insert — Employee Name required for new row' });
            continue;
        }

        try {
            if (Object.prototype.hasOwnProperty.call(patch, 'cnic') && merged.cnic) {
                const released = await releaseCnicForEmployee(pool, merged.cnic, code);
                for (const r of released) {
                    warnings.push({
                        id: code,
                        warning: `CNIC reassigned — cleared from ${r.id} (${r.name})`,
                    });
                }
            }
            if (existing) {
                const sets = [];
                const vals = [code];
                let i = 2;
                for (const col of DB_COLUMNS) {
                    if (col === 'id') continue;
                    if (!Object.prototype.hasOwnProperty.call(patch, col)) continue;
                    sets.push(`${col} = $${i++}`);
                    vals.push(merged[col] ?? null);
                }
                if (!sets.length) {
                    warnings.push({ id: code, warning: 'No non-blank fields to update — row skipped' });
                    continue;
                }
                sets.push('updated_at = NOW()');
                const { rows } = await pool.query(
                    `UPDATE employees SET ${sets.join(', ')} WHERE id = $1 RETURNING id, name`,
                    vals
                );
                updated.push(rows[0]);
            } else {
                merged.id = code;
                merged.active = merged.active || 'Yes';
                const cols = ['id'];
                const placeholders = ['$1'];
                const vals = [code];
                let i = 2;
                for (const col of DB_COLUMNS) {
                    if (col === 'id') continue;
                    if (merged[col] == null || merged[col] === '') continue;
                    cols.push(col);
                    placeholders.push(`$${i++}`);
                    vals.push(merged[col]);
                }
                const { rows } = await pool.query(
                    `INSERT INTO employees (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING id, name`,
                    vals
                );
                inserted.push(rows[0]);
            }
        } catch (err) {
            errors.push({ id: code, name, error: err.message });
        }
    }

    return {
        ok: true,
        updated: updated.length,
        inserted: inserted.length,
        warnings,
        errors,
        columns: MASTER_ROSTER_COLUMNS,
        columnCount: MASTER_ROSTER_COLUMNS.length,
        updatedBy: updatedBy || null,
    };
}

module.exports = {
    MASTER_ROSTER_COLUMNS,
    FIELD_MAP,
    exportMasterRosterCsv,
    importMasterRosterCsv,
    csvRowToPatch,
    mergeEmployeePatch,
    releaseCnicForEmployee,
    resolveRosterRefs: csvRowToPatch, // backward compat for tests
    isBlank,
    normHeader,
    toNumberOrNull,
    toDateOrNull,
};
