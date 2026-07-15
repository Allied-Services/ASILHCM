'use strict';

const MASTER_ROSTER_COLUMNS = [
    'ASIL Employee Code',
    'Name',
    'CNIC',
    'Base Salary',
    'Client Name',
    'Contract Name',
    'Location Name',
    'Business Unit',
    'Supervisor Email',
    'Client Focal Email(s)',
];

function csvEscape(v) {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function isBlank(v) {
    return v == null || String(v).trim() === '';
}

function pick(row, ...keys) {
    for (const k of keys) {
        if (row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim();
    }
    return '';
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

async function exportMasterRosterCsv(pool) {
    const { rows } = await pool.query(
        `SELECT id, name, cnic, salary, client, contract_name, location, site, bu,
                supervisor_email, client_focal_emails, line_manager_email
         FROM employees e
         WHERE ${activeEmployeeClause('e')}
         ORDER BY e.client NULLS LAST, e.name`
    );

    const lines = [MASTER_ROSTER_COLUMNS.join(',')];
    for (const r of rows) {
        const loc = r.location || r.site || '';
        lines.push([
            r.id,
            r.name || '',
            r.cnic || '',
            r.salary != null ? Number(r.salary) : '',
            r.client || '',
            r.contract_name || '',
            loc,
            r.bu || '',
            r.supervisor_email || r.line_manager_email || '',
            r.client_focal_emails || '',
        ].map(csvEscape).join(','));
    }

    return {
        csv: lines.join('\n'),
        filename: `ASIL_Master_Roster_${new Date().toISOString().slice(0, 10)}.csv`,
        rowCount: rows.length,
        columns: MASTER_ROSTER_COLUMNS,
    };
}

async function loadLookupMaps(pool) {
    const [{ rows: contracts }, { rows: clients }] = await Promise.all([
        pool.query(`
            SELECT c.id, c.contract_name, c.location, cl.name AS client_name, cl.id AS client_id
            FROM contracts c
            LEFT JOIN clients cl ON cl.id = c.client_id
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
 * Soft-resolve contract/client/location/BU from roster text.
 * Never throws FK errors — unknown refs leave text fields set and contract_id null/unchanged.
 */
function resolveRosterRefs(row, maps, existing) {
    const contractName = pick(row, 'Contract Name', 'contract_name', 'contractName');
    const clientName = pick(row, 'Client Name', 'CLIENT NAME', 'client');
    const locationName = pick(row, 'Location Name', 'Client Location', 'location', 'site');
    const bu = pick(row, 'Business Unit', 'ASIL BU', 'bu');

    let contractId = existing?.contract_id || null;
    let resolvedContractName = contractName || existing?.contract_name || null;
    let resolvedClient = clientName || existing?.client || null;

    if (contractName) {
        const ct = maps.ctById.get(contractName) || maps.ctByName.get(contractName.toLowerCase());
        if (ct) {
            contractId = ct.id;
            resolvedContractName = ct.contract_name;
            if (!clientName && ct.client_name) resolvedClient = ct.client_name;
        } else {
            contractId = existing?.contract_id || null;
        }
    }

    if (clientName && maps.clientByName.has(clientName.toLowerCase())) {
        resolvedClient = maps.clientByName.get(clientName.toLowerCase()).name;
    }

    return {
        contractId,
        contractName: resolvedContractName,
        client: resolvedClient,
        location: locationName || existing?.location || null,
        site: locationName || existing?.site || null,
        bu: bu || existing?.bu || null,
        unknownContract: !!(contractName && !maps.ctByName.has(contractName.toLowerCase()) && !maps.ctById.get(contractName)),
    };
}

/**
 * Import 10-column master roster CSV. Match exclusively on ASIL Employee Code.
 * No automated SMS/email on this path (MD Step 1).
 */
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
        const code = pick(row, 'ASIL Employee Code', 'Employee Code', 'id');
        if (!code) {
            errors.push({ error: 'Missing ASIL Employee Code' });
            continue;
        }

        const { rows: existingRows } = await pool.query(
            `SELECT * FROM employees WHERE id = $1`,
            [code]
        );
        const existing = existingRows[0] || null;
        const refs = resolveRosterRefs(row, maps, existing);
        if (refs.unknownContract) {
            warnings.push({
                id: code,
                warning: `Contract "${pick(row, 'Contract Name')}" not in DB — name saved without contract_id FK`,
            });
        }

        const name = pick(row, 'Name', 'Employee Name') || existing?.name;
        const cnic = pick(row, 'CNIC', 'CNIC Number') || existing?.cnic || null;
        const salaryRaw = pick(row, 'Base Salary', 'Salary');
        const salary = !isBlank(salaryRaw)
            ? parseFloat(String(salaryRaw).replace(/,/g, '')) || (existing?.salary || 0)
            : (existing?.salary || 0);
        const supervisorEmail = pick(row, 'Supervisor Email', 'supervisor_email')
            || existing?.supervisor_email
            || existing?.line_manager_email
            || null;
        const focalEmails = pick(row, 'Client Focal Email(s)', 'Client Focal Emails', 'client_focal_emails')
            || existing?.client_focal_emails
            || null;

        if (!existing && !name) {
            errors.push({ id: code, error: 'Cannot insert — Name required for new employee' });
            continue;
        }

        try {
            if (existing) {
                const { rows } = await pool.query(
                    `UPDATE employees SET
                        name = COALESCE($2, name),
                        cnic = COALESCE($3, cnic),
                        salary = $4,
                        client = COALESCE($5, client),
                        contract_name = COALESCE($6, contract_name),
                        contract_id = $7,
                        location = COALESCE($8, location),
                        site = COALESCE($9, site),
                        bu = COALESCE($10, bu),
                        supervisor_email = $11,
                        client_focal_emails = $12,
                        line_manager_email = COALESCE($11, line_manager_email),
                        updated_at = NOW()
                     WHERE id = $1
                     RETURNING id, name`,
                    [
                        code,
                        name || null,
                        cnic,
                        salary,
                        refs.client,
                        refs.contractName,
                        refs.contractId,
                        refs.location,
                        refs.site,
                        refs.bu,
                        supervisorEmail ? supervisorEmail.toLowerCase() : null,
                        focalEmails || null,
                    ]
                );
                updated.push(rows[0]);
            } else {
                const { rows } = await pool.query(
                    `INSERT INTO employees
                        (id, name, cnic, salary, client, contract_name, contract_id,
                         location, site, bu, supervisor_email, client_focal_emails,
                         line_manager_email, active)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,'Yes')
                     RETURNING id, name`,
                    [
                        code,
                        name,
                        cnic,
                        salary,
                        refs.client,
                        refs.contractName,
                        refs.contractId,
                        refs.location,
                        refs.site,
                        refs.bu,
                        supervisorEmail ? supervisorEmail.toLowerCase() : null,
                        focalEmails || null,
                    ]
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
        updatedBy: updatedBy || null,
    };
}

module.exports = {
    MASTER_ROSTER_COLUMNS,
    exportMasterRosterCsv,
    importMasterRosterCsv,
    resolveRosterRefs,
};
