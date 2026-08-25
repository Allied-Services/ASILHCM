'use strict';

const fs = require('fs');
const path = require('path');
const {
    FIELD_MAP,
    isBlank,
    normHeader,
    toNumberOrNull,
    toDateOrNull,
} = require('./masterRoster');
const { isUsableEmail, emailsEqual } = require('./contactEmails');

const WAFI_CLIENT_MARKERS = ['wafi'];
const INSURANCE_FIELDS = [
    'marital_status', 'spouse_name', 'spouse_age', 'spouse_cnic',
    'child1_name', 'child1_age', 'child1_id',
    'child2_name', 'child2_age', 'child2_id',
    'medical_type', 'medical_maternity', 'total_medical_coverage',
];
const ROUTING_FIELDS = ['line_manager_name', 'line_manager_email', 'claim_authority'];
const SALARY_HIGH_DELTA_PCT = 5;

function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
        } else if (c === ',' && !inQ) {
            out.push(cur);
            cur = '';
        } else cur += c;
    }
    out.push(cur);
    return out;
}

function parseCsvText(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { headers: [], rows: [] };
    const headers = parseCsvLine(lines[0]).map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        if (cells.every(c => isBlank(c))) continue;
        const row = {};
        headers.forEach((h, idx) => { row[h] = cells[idx] != null ? cells[idx].trim() : ''; });
        rows.push(row);
    }
    return { headers, rows };
}

function pickCell(row, ...keys) {
    for (const k of keys) {
        if (!isBlank(row[k])) return String(row[k]).trim();
    }
    const normRow = {};
    Object.keys(row).forEach(k => { normRow[normHeader(k)] = row[k]; });
    for (const k of keys) {
        const v = normRow[normHeader(k)];
        if (!isBlank(v)) return String(v).trim();
    }
    return null;
}

/**
 * Employee mailbox for payslips (personal OK). Official is used only when it is
 * not the focal's address — otherwise leave unset so payslips go to focal only
 * and Portal Claims never treat the focal inbox as the employee's.
 *
 * @returns {string|null|undefined} address, null to clear (official == focal),
 *   undefined when the roster has no employee mailbox columns filled.
 */
function resolveEmail(row) {
    const personal = isUsableEmail(pickCell(row, 'Personal Email Address', 'Personal Email'));
    if (personal) return personal.toLowerCase();
    const official = isUsableEmail(pickCell(row, 'Official Email Address', 'Official Email'));
    if (!official) return undefined;
    const focal = isUsableEmail(pickCell(
        row,
        'Focal/ Supervisor Email',
        'Focal/ Supervisor *',
        'Claim Authority',
        'Supervisor Email'
    ));
    if (focal && emailsEqual(official, focal)) return null;
    return official.toLowerCase();
}

function isWafiRow(row) {
    const client = (pickCell(row, 'CLIENT NAME', 'Client Name', 'Client') || '').toLowerCase();
    const contract = (pickCell(row, 'Contract Name', 'Contract') || '').toLowerCase();
    return WAFI_CLIENT_MARKERS.some(m => client.includes(m) || contract.includes(m));
}

function normalizeCnic(v) {
    if (v == null || isBlank(v)) return null;
    let s = String(v).trim();
    if (/e\+/i.test(s)) {
        const n = Number(s);
        if (Number.isFinite(n)) s = String(Math.round(n));
    }
    return s;
}

function isNaToken(v) {
    return /^n\/?a$/i.test(String(v == null ? '' : v).trim());
}

function cleanCell(v) {
    if (isBlank(v) || isNaToken(v)) return null;
    return String(v).trim();
}

function mapCsvRowToDb(row) {
    const asilCode = pickCell(row, 'ASIL Employee Code', 'Employee Code');
    if (!asilCode) return null;

    const mapped = { id: asilCode };
    for (const field of FIELD_MAP) {
        const val = cleanCell(pickCell(row, field.csv, ...(field.aliases || [])));
        if (val == null) continue;
        if (field.db === 'email') continue; // handled separately
        if (field.type === 'number') {
            const n = toNumberOrNull(val);
            if (n != null) mapped[field.db] = n;
        } else if (field.type === 'date') {
            const d = toDateOrNull(val);
            if (d && /^\d{4}-\d{2}-\d{2}/.test(d)) mapped[field.db] = d;
        } else if (field.db === 'cnic' || field.db === 'spouse_cnic' || field.db === 'child1_id' || field.db === 'child2_id') {
            mapped[field.db] = normalizeCnic(val);
        } else mapped[field.db] = val;
    }

    // Wafi-specific header aliases (N/A => null so routing matrix works)
    const lmName = cleanCell(pickCell(row, 'Line Manager(Wafi) Name', 'Line Manager Name', 'Line Manager(Wafi) *'));
    const lmEmail = cleanCell(pickCell(row, 'Line Manager(Wafi) Email', 'Line Manager Email', 'Line Manager(Wafi) *'));
    const focalEmail = cleanCell(pickCell(row, 'Focal/ Supervisor Email', 'Focal/ Supervisor *', 'Claim Authority', 'Supervisor Email'));
    mapped.line_manager_name = lmName;
    mapped.line_manager_email = lmEmail;
    mapped.claim_authority = focalEmail;

    const email = resolveEmail(row);
    if (email !== undefined) mapped.email = email;

    const salaryRaw = cleanCell(pickCell(row, 'Salary', 'Base Salary', 'Gross Salary'));
    if (salaryRaw != null) {
        const n = toNumberOrNull(salaryRaw);
        if (n != null) mapped.salary = n;
    }

    // Focal email → claim_authority only; supervisor_email is legacy non-Wafi portal approver
    if (mapped.claim_authority) {
        mapped.supervisor_email = null;
    }

    return mapped;
}

function compareRow(dbRow, csvMapped) {
    const deltas = [];
    const warnings = [];

    const allFields = new Set([
        ...Object.keys(csvMapped).filter(k => k !== 'id'),
        'salary', 'email', ...INSURANCE_FIELDS, ...ROUTING_FIELDS,
    ]);

    for (const field of allFields) {
        if (csvMapped[field] === undefined) continue;
        const csvVal = csvMapped[field];
        const dbVal = dbRow[field];
        const dbNorm = dbVal == null ? null : (typeof dbVal === 'number' ? dbVal : String(dbVal).trim());
        const csvNorm = csvVal == null ? null : (typeof csvVal === 'number' ? csvVal : String(csvVal).trim());

        if (field === 'salary') {
            const dbN = dbNorm == null ? null : Number(dbNorm);
            const csvN = csvNorm == null ? null : Number(csvNorm);
            if (csvN != null && dbN !== csvN) {
                const delta = { asil_code: csvMapped.id, field, db_value: dbN, csv_value: csvN, action: 'overwrite' };
                if (dbN && Math.abs(csvN - dbN) / dbN * 100 > SALARY_HIGH_DELTA_PCT) {
                    delta.flag = 'HIGH_DELTA';
                }
                deltas.push(delta);
            }
            continue;
        }

        if (String(dbNorm || '') !== String(csvNorm || '')) {
            deltas.push({
                asil_code: csvMapped.id,
                field,
                db_value: dbNorm,
                csv_value: csvNorm,
                action: 'overwrite',
            });
        }
    }

    for (const f of ['cnic', 'spouse_cnic', 'child1_id', 'child2_id']) {
        const v = csvMapped[f];
        if (v && /e\+/i.test(String(v))) {
            warnings.push({ asil_code: csvMapped.id, message: 'scientific_notation_cnic', field: f });
        }
    }

    return { deltas, warnings };
}

function buildDryRunReport({ csvPath, csvRows, dbWafiRows, matched, unmatched_csv, unmatched_db_wafi, deltas, warnings, errors, mode }) {
    const salaryDeltas = deltas.filter(d => d.field === 'salary').length;
    const emailChanges = deltas.filter(d => d.field === 'email').length;
    const routingChanges = deltas.filter(d => ROUTING_FIELDS.includes(d.field)).length;
    const insuranceChanges = deltas.filter(d => INSURANCE_FIELDS.includes(d.field)).length;

    return {
        generated_at: new Date().toISOString(),
        mode,
        csv_path: csvPath,
        csv_rows: csvRows.length,
        summary: {
            matched: matched.length,
            would_update: deltas.length > 0 ? matched.filter(m => m.hasChanges).length : 0,
            would_insert: 0,
            would_delete: 0,
            salary_deltas: salaryDeltas,
            email_changes: emailChanges,
            routing_changes: routingChanges,
            insurance_field_changes: insuranceChanges,
            warnings: warnings.length,
            errors: errors.length,
        },
        unmatched_csv,
        unmatched_db_wafi,
        deltas,
        warnings,
        errors,
    };
}

function formatReportMd(report) {
    const s = report.summary;
    const lines = [
        `# Wafi Roster Dry-Run Report`,
        ``,
        `Generated: ${report.generated_at}`,
        `CSV: ${report.csv_path}`,
        `Mode: ${report.mode}`,
        ``,
        `## Summary`,
        `- Matched: ${s.matched}`,
        `- Would update: ${s.would_update}`,
        `- Would insert: ${s.would_insert} (must be 0)`,
        `- Would delete: ${s.would_delete} (must be 0)`,
        `- Salary deltas: ${s.salary_deltas}`,
        `- Email changes: ${s.email_changes}`,
        `- Routing changes: ${s.routing_changes}`,
        `- Insurance field changes: ${s.insurance_field_changes}`,
        `- Warnings: ${s.warnings}`,
        `- Errors: ${s.errors}`,
        ``,
    ];
    if (report.unmatched_csv.length) {
        lines.push(`## Unmatched CSV (${report.unmatched_csv.length})`);
        report.unmatched_csv.forEach(u => lines.push(`- ${u.asil_code} — ${u.name}: ${u.reason}`));
        lines.push('');
    }
    if (report.unmatched_db_wafi.length) {
        lines.push(`## Unmatched DB Wafi (${report.unmatched_db_wafi.length})`);
        report.unmatched_db_wafi.forEach(u => lines.push(`- ${u.asil_code} — ${u.name}: ${u.reason}`));
        lines.push('');
    }
    if (report.deltas.length) {
        lines.push(`## Deltas (${report.deltas.length})`);
        report.deltas.slice(0, 100).forEach(d => {
            lines.push(`- ${d.asil_code} · ${d.field}: ${JSON.stringify(d.db_value)} → ${JSON.stringify(d.csv_value)}${d.flag ? ` [${d.flag}]` : ''}`);
        });
        if (report.deltas.length > 100) lines.push(`- … and ${report.deltas.length - 100} more`);
    }
    return lines.join('\n');
}

async function runWafiRosterRefresh(pool, { csvText, csvPath, dryRun = true }) {
    const { rows: csvRows } = parseCsvText(csvText);
    const wafiRows = csvRows.filter(isWafiRow);
    const errors = [];

    const { rows: dbEmployees } = await pool.query(`
        SELECT * FROM employees
        WHERE LOWER(COALESCE(client, '')) LIKE '%wafi%'
           OR LOWER(COALESCE(contract_name, '')) LIKE '%wafi%'
    `);
    const dbById = new Map(dbEmployees.map(e => [e.id, e]));

    const matched = [];
    const unmatched_csv = [];
    const allDeltas = [];
    const allWarnings = [];
    const csvIds = new Set();

    for (const row of wafiRows) {
        const mapped = mapCsvRowToDb(row);
        if (!mapped) continue;
        csvIds.add(mapped.id);
        const dbRow = dbById.get(mapped.id);
        if (!dbRow) {
            unmatched_csv.push({
                asil_code: mapped.id,
                name: pickCell(row, 'Employee Name', 'Name') || '',
                reason: 'not_in_db',
            });
            continue;
        }
        const { deltas, warnings } = compareRow(dbRow, mapped);
        allDeltas.push(...deltas);
        allWarnings.push(...warnings);
        matched.push({ id: mapped.id, hasChanges: deltas.length > 0, mapped });
    }

    const unmatched_db_wafi = dbEmployees
        .filter(e => !csvIds.has(e.id))
        .map(e => ({ asil_code: e.id, name: e.name || '', reason: 'not_in_csv' }));

    const report = buildDryRunReport({
        csvPath: csvPath || '(inline)',
        csvRows: wafiRows,
        dbWafiRows: dbEmployees,
        matched,
        unmatched_csv,
        unmatched_db_wafi,
        deltas: allDeltas,
        warnings: allWarnings,
        errors,
        mode: dryRun ? 'dry-run' : 'apply',
    });

    if (!dryRun) {
        const beforeSnapshots = [];
        const applyErrors = [];
        // Map CNIC -> employee id for collision checks
        const cnicOwner = new Map();
        const { rows: allCnicRows } = await pool.query(
            `SELECT id, cnic FROM employees WHERE cnic IS NOT NULL AND TRIM(cnic) <> ''`
        );
        for (const e of allCnicRows) {
            if (e.cnic) cnicOwner.set(String(e.cnic).trim(), e.id);
        }

        for (const m of matched.filter(x => x.hasChanges)) {
            const dbRow = dbById.get(m.id);
            const patch = { ...m.mapped };
            if (patch.cnic) {
                const owner = cnicOwner.get(String(patch.cnic).trim());
                if (owner && owner !== m.id) {
                    applyErrors.push({
                        asil_code: m.id,
                        field: 'cnic',
                        reason: `CNIC already used by ${owner} — skipped cnic update`,
                    });
                    delete patch.cnic;
                } else {
                    cnicOwner.set(String(patch.cnic).trim(), m.id);
                }
            }
            const sets = [];
            const vals = [];
            for (const [col, val] of Object.entries(patch)) {
                if (col === 'id') continue;
                vals.push(val);
                sets.push(`${col} = $${vals.length}`);
            }
            if (!sets.length) continue;
            vals.push(m.id);
            try {
                await pool.query(
                    `UPDATE employees SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`,
                    vals
                );
                beforeSnapshots.push({ asil_code: m.id, before: { ...dbRow } });
            } catch (err) {
                applyErrors.push({
                    asil_code: m.id,
                    reason: err && err.message ? err.message : String(err),
                });
            }
        }
        report.applied = beforeSnapshots.length;
        report.before_snapshots = beforeSnapshots;
        report.apply_errors = applyErrors;
        if (applyErrors.length) {
            report.summary.errors = (report.summary.errors || 0) + applyErrors.length;
        }
    }

    return report;
}

module.exports = {
    parseCsvText,
    pickCell,
    resolveEmail,
    isWafiRow,
    mapCsvRowToDb,
    compareRow,
    buildDryRunReport,
    formatReportMd,
    runWafiRosterRefresh,
    WAFI_CLIENT_MARKERS,
};
