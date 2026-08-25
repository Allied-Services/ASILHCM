'use strict';

/**
 * Contact + Focal / Line Manager updater for Wafi 3P (BPO) employees.
 *
 * Writes only: primary_contact, emergency_contact, email, claim_authority,
 * line_manager_name, line_manager_email, supervisor_email (cleared when focal set).
 * Never touches salary, bank, or insurance.
 *
 * Email mapping: personal if usable; else official only when it is not the
 * focal inbox. Official-equals-focal is stored as email=null so payslips go
 * to the focal and Portal Claims never gather on a personal mailbox.
 */

const fs = require('fs');
const path = require('path');
const {
    parseCsvText,
    pickCell,
    isWafiRow,
    resolveEmail,
} = require('./wafiRosterRefresh');
const { isBlank } = require('./masterRoster');
const { isUsableEmail } = require('./contactEmails');

const CONTACT_FIELDS = [
    'primary_contact',
    'emergency_contact',
    'email',
    'claim_authority',
    'line_manager_name',
    'line_manager_email',
    'supervisor_email',
];

const ROUTING_FIELDS = ['claim_authority', 'line_manager_name', 'line_manager_email', 'supervisor_email'];
const PHONE_FIELDS = ['primary_contact', 'emergency_contact'];

function isDashToken(v) {
    return String(v == null ? '' : v).trim() === '-';
}

function isNaToken(v) {
    return /^n\/?a$/i.test(String(v == null ? '' : v).trim());
}

/** Phone: blank / '-' skip; N/A → null; else the trimmed value. */
function resolvePhoneValue(raw) {
    if (isBlank(raw) || isDashToken(raw)) return undefined;
    if (isNaToken(raw)) return null;
    return String(raw).trim();
}

/**
 * Routing (focal / LM): blank skip (leave DB); '-' and N/A → null (no focal/LM).
 */
function resolveRoutingValue(raw) {
    if (isBlank(raw)) return undefined;
    if (isDashToken(raw) || isNaToken(raw)) return null;
    return String(raw).trim();
}

function employeeCode(row) {
    return String(pickCell(row, 'ASIL Employee Code', 'Employee Code') || '').trim();
}

function isAsilFmCode(code) {
    return /^ASILFM\//i.test(String(code || '').trim());
}

function rowHasContractHint(row) {
    const contract = pickCell(row, 'Contract Name', 'Contract');
    const client = pickCell(row, 'CLIENT NAME', 'Client Name', 'Client');
    return !!(contract || client);
}

function isWafi3pRow(row) {
    // Dedicated contact files (25 Aug Rabia sheet) have no contract column.
    // 3P = ASIL/SPL-* ; ASILFM is Facility Management.
    if (!rowHasContractHint(row)) {
        const code = employeeCode(row);
        return !!code && !isAsilFmCode(code);
    }
    if (!isWafiRow(row)) return false;
    const contract = (pickCell(row, 'Contract Name', 'Contract') || '').toLowerCase();
    return contract.includes('bpo');
}

function isWafi3pEmployee(emp) {
    const client = String(emp.client || '').toLowerCase();
    const contract = String(emp.contract_name || '').toLowerCase();
    if (!client.includes('wafi') && !contract.includes('wafi')) return false;
    return contract.includes('bpo');
}

function scopeFilter(row, scope) {
    const code = employeeCode(row);
    if (scope === 'file') return !!code;
    if (scope === 'wafi') return rowHasContractHint(row) ? isWafiRow(row) : !!code;
    return isWafi3pRow(row) && !!code;
}

function dbScopeFilter(emp, scope) {
    if (scope === 'file') return true;
    if (scope === 'wafi') {
        const client = String(emp.client || '').toLowerCase();
        const contract = String(emp.contract_name || '').toLowerCase();
        return client.includes('wafi') || contract.includes('wafi');
    }
    return isWafi3pEmployee(emp);
}

function mapContactRow(row) {
    const asilCode = pickCell(row, 'ASIL Employee Code', 'Employee Code');
    if (!asilCode) return null;

    const mapped = { id: asilCode };
    const primary = resolvePhoneValue(pickCell(row, 'Primary Contact', 'Phone', 'Mobile', 'Contact'));
    if (primary !== undefined) mapped.primary_contact = primary;
    const emergency = resolvePhoneValue(pickCell(row, 'Emergency Contact', 'Emergency Phone'));
    if (emergency !== undefined) {
        const primaryNorm = mapped.primary_contact == null ? '' : String(mapped.primary_contact).replace(/\D/g, '');
        const emergencyNorm = String(emergency || '').replace(/\D/g, '');
        if (emergency && primaryNorm && emergencyNorm === primaryNorm) {
            // Two distinct numbers required — skip a copy of Primary.
        } else {
            mapped.emergency_contact = emergency;
        }
    }

    const email = resolveEmail(row);
    if (email !== undefined) mapped.email = email;

    const lmName = resolveRoutingValue(pickCell(row, 'Line Manager(Wafi) Name', 'Line Manager Name', 'Line Manager(Wafi) *'));
    if (lmName !== undefined) mapped.line_manager_name = lmName;
    const lmEmailRaw = resolveRoutingValue(pickCell(row, 'Line Manager(Wafi) Email', 'Line Manager Email', 'Line Manager(Wafi) *'));
    if (lmEmailRaw !== undefined) {
        mapped.line_manager_email = lmEmailRaw == null ? null : (isUsableEmail(lmEmailRaw) || null);
    }

    const focalRaw = resolveRoutingValue(pickCell(
        row,
        'Focal/ Supervisor Email',
        'Focal/ Supervisor *',
        'Claim Authority',
        'Supervisor Email'
    ));
    if (focalRaw !== undefined) {
        mapped.claim_authority = focalRaw == null ? null : (isUsableEmail(focalRaw) || null);
    }
    if (mapped.claim_authority) {
        mapped.supervisor_email = null;
    }

    return mapped;
}

function valuesEqual(a, b) {
    const an = a == null || a === '' ? null : String(a).trim();
    const bn = b == null || b === '' ? null : String(b).trim();
    if (an == null && bn == null) return true;
    if (an == null || bn == null) return false;
    return an.toLowerCase() === bn.toLowerCase();
}

function compareContactRow(dbRow, csvMapped) {
    const deltas = [];
    for (const field of CONTACT_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(csvMapped, field)) continue;
        const csvVal = csvMapped[field];
        const dbVal = dbRow[field];
        if (!valuesEqual(dbVal, csvVal)) {
            deltas.push({
                asil_code: csvMapped.id,
                field,
                db_value: dbVal == null ? null : String(dbVal).trim(),
                csv_value: csvVal,
                action: 'overwrite',
            });
        }
    }
    return deltas;
}

function stringifyCell(v) {
    if (v == null) return '';
    if (typeof v === 'number' && Number.isFinite(v)) {
        if (Math.abs(v) >= 1e10) return String(Math.round(v));
        return String(v);
    }
    return String(v).trim();
}

function loadTabularFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.csv' || ext === '.txt') {
        return parseCsvText(fs.readFileSync(filePath, 'utf8'));
    }
    if (ext === '.xlsx' || ext === '.xls') {
        const XLSX = require('xlsx');
        const wb = XLSX.readFile(filePath, { cellDates: false });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
        if (!aoa.length) return { headers: [], rows: [], sheetName };
        const headers = aoa[0].map((h) => String(h == null ? '' : h).trim());
        const rows = [];
        for (let i = 1; i < aoa.length; i++) {
            const cells = aoa[i] || [];
            if (cells.every((c) => stringifyCell(c) === '')) continue;
            const row = {};
            headers.forEach((h, idx) => { row[h] = stringifyCell(cells[idx]); });
            rows.push(row);
        }
        return { headers, rows, sheetName };
    }
    throw new Error(`Unsupported file type: ${ext || '(none)'}`);
}

function buildDryRunReport(opts) {
    const {
        sourcePath, sourceRows, matched, unmatched_csv, unmatched_db,
        deltas, warnings, errors, mode, scope,
    } = opts;
    const phoneChanges = deltas.filter((d) => PHONE_FIELDS.includes(d.field)).length;
    const emailChanges = deltas.filter((d) => d.field === 'email').length;
    const routingChanges = deltas.filter((d) => ROUTING_FIELDS.includes(d.field)).length;
    return {
        generated_at: new Date().toISOString(),
        mode,
        scope,
        source_path: sourcePath,
        source_rows: sourceRows.length,
        summary: {
            matched: matched.length,
            would_update: matched.filter((m) => m.hasChanges).length,
            would_insert: 0,
            would_delete: 0,
            phone_changes: phoneChanges,
            email_changes: emailChanges,
            routing_changes: routingChanges,
            warnings: (warnings || []).length,
            errors: (errors || []).length,
        },
        unmatched_csv,
        unmatched_db,
        deltas,
        warnings: warnings || [],
        errors: errors || [],
    };
}

function formatReportMd(report) {
    const s = report.summary;
    const lines = [
        `# Wafi 3P contact / focal dry-run`,
        ``,
        `Generated: ${report.generated_at}`,
        `Source: ${report.source_path}`,
        `Mode: ${report.mode}`,
        `Scope: ${report.scope}`,
        ``,
        `## Summary`,
        `- Matched: ${s.matched}`,
        `- Would update: ${s.would_update}`,
        `- Would insert: ${s.would_insert} (must be 0)`,
        `- Would delete: ${s.would_delete} (must be 0)`,
        `- Phone changes: ${s.phone_changes}`,
        `- Email changes: ${s.email_changes}`,
        `- Routing (focal / LM) changes: ${s.routing_changes}`,
        `- Warnings: ${s.warnings}`,
        `- Errors: ${s.errors}`,
        ``,
        `Payslip: employee + focal (focal only if the employee has no mailbox).`,
        `Portal Claims: personal Gmail/Yahoo/etc. is never the filler address.`,
        ``,
    ];
    if (report.unmatched_csv.length) {
        lines.push(`## Unmatched source rows (${report.unmatched_csv.length})`);
        report.unmatched_csv.slice(0, 50).forEach((u) => {
            lines.push(`- ${u.asil_code} — ${u.name}: ${u.reason}`);
        });
        if (report.unmatched_csv.length > 50) {
            lines.push(`- … and ${report.unmatched_csv.length - 50} more`);
        }
        lines.push('');
    }
    if (report.unmatched_db.length) {
        lines.push(`## Unmatched DB (${report.unmatched_db.length})`);
        report.unmatched_db.slice(0, 50).forEach((u) => {
            lines.push(`- ${u.asil_code} — ${u.name}: ${u.reason}`);
        });
        if (report.unmatched_db.length > 50) {
            lines.push(`- … and ${report.unmatched_db.length - 50} more`);
        }
        lines.push('');
    }
    if (report.deltas.length) {
        lines.push(`## Deltas (${report.deltas.length})`);
        report.deltas.slice(0, 120).forEach((d) => {
            lines.push(`- ${d.asil_code} · ${d.field}: ${JSON.stringify(d.db_value)} → ${JSON.stringify(d.csv_value)}`);
        });
        if (report.deltas.length > 120) lines.push(`- … and ${report.deltas.length - 120} more`);
    }
    return lines.join('\n');
}

async function runWafiContactUpdate(pool, opts) {
    const {
        sourcePath,
        rows: givenRows,
        dryRun = true,
        scope = 'wafi-3p',
    } = opts;
    let sourceRows = givenRows;
    if (!sourceRows) {
        const loaded = loadTabularFile(sourcePath);
        sourceRows = loaded.rows;
    }
    const scopedRows = sourceRows.filter((row) => scopeFilter(row, scope));
    const errors = [];
    const warnings = [];

    const { rows: dbEmployees } = await pool.query(`
        SELECT id, name, email, primary_contact, emergency_contact,
               claim_authority, line_manager_name, line_manager_email,
               supervisor_email, client, contract_name, dept, active
        FROM employees
        WHERE LOWER(COALESCE(client, '')) LIKE '%wafi%'
           OR LOWER(COALESCE(contract_name, '')) LIKE '%wafi%'
    `);
    const dbById = new Map(dbEmployees.map((e) => [e.id, e]));
    const scopedDb = dbEmployees.filter((e) => dbScopeFilter(e, scope));

    const matched = [];
    const unmatched_csv = [];
    const allDeltas = [];
    const csvIds = new Set();

    for (const row of scopedRows) {
        const mapped = mapContactRow(row);
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
        const deltas = compareContactRow(dbRow, mapped);
        allDeltas.push(...deltas);
        matched.push({ id: mapped.id, hasChanges: deltas.length > 0, mapped });
    }

    const unmatched_db = scopedDb
        .filter((e) => !csvIds.has(e.id))
        .map((e) => ({ asil_code: e.id, name: e.name || '', reason: 'not_in_source' }));

    const report = buildDryRunReport({
        sourcePath: sourcePath || '(inline)',
        sourceRows: scopedRows,
        matched,
        unmatched_csv,
        unmatched_db,
        deltas: allDeltas,
        warnings,
        errors,
        mode: dryRun ? 'dry-run' : 'apply',
        scope,
    });

    if (!dryRun) {
        const beforeSnapshots = [];
        const applyErrors = [];
        for (const m of matched.filter((x) => x.hasChanges)) {
            const dbRow = dbById.get(m.id);
            const patch = {};
            for (const field of CONTACT_FIELDS) {
                if (Object.prototype.hasOwnProperty.call(m.mapped, field)) {
                    patch[field] = m.mapped[field];
                }
            }
            const sets = [];
            const vals = [];
            for (const [col, val] of Object.entries(patch)) {
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
                const before = {};
                CONTACT_FIELDS.forEach((f) => { before[f] = dbRow[f]; });
                beforeSnapshots.push({ asil_code: m.id, before });
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
    CONTACT_FIELDS,
    isWafi3pRow,
    isWafi3pEmployee,
    scopeFilter,
    mapContactRow,
    compareContactRow,
    loadTabularFile,
    buildDryRunReport,
    formatReportMd,
    runWafiContactUpdate,
    resolvePhoneValue,
    resolveRoutingValue,
};
