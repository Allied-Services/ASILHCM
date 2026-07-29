'use strict';

const { absenceDeductionAmount } = require('./sitesMeta');
const { getServiceOrder } = require('./crud');

/**
 * Strip punctuation / trailing "service(s)" so sheet labels and SO role
 * titles compare on the same keyspace.
 */
function normalizeDesignation(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/[/_.,\-]+/g, ' ')
        .replace(/\b(services?|svc)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Expand a normalized designation into match keys (aliases + self).
 * Pump Room has no dedicated Tarujabba SO role — Habibabad/Faqirabad bill it
 * under "Filling Pumproom / Invoicing Room"; Tarujabba has "Invoicing Room"
 * on the same Office/Misc line, so we alias there.
 */
function designationMatchKeys(designation) {
    const key = normalizeDesignation(designation);
    if (!key) return [];

    const ALIASES = {
        lab: ['lab', 'laboratory'],
        laboratory: ['lab', 'laboratory'],
        'pump room': ['pump room', 'pumproom', 'filling pumproom', 'invoicing room'],
        pumproom: ['pump room', 'pumproom', 'filling pumproom', 'invoicing room'],
        'filling pumproom': ['pump room', 'pumproom', 'filling pumproom', 'invoicing room'],
        'filling pumproom invoicing room': ['pump room', 'pumproom', 'filling pumproom', 'invoicing room'],
        'invoicing room': ['invoicing room', 'pump room', 'pumproom', 'filling pumproom'],
    };

    return ALIASES[key] || [key];
}

function designationsMatch(a, b) {
    const na = normalizeDesignation(a);
    const nb = normalizeDesignation(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;

    const keysA = designationMatchKeys(a);
    const keysB = designationMatchKeys(b);
    for (const ka of keysA) {
        for (const kb of keysB) {
            if (ka === kb) return true;
            if (ka.includes(kb) || kb.includes(ka)) return true;
        }
        if (nb.includes(ka) || ka.includes(nb)) return true;
    }
    for (const kb of keysB) {
        if (na.includes(kb) || kb.includes(na)) return true;
    }
    return false;
}

function findLineForDesignation(lines, designation) {
    const target = normalizeDesignation(designation);
    if (!target) return null;
    for (const line of lines || []) {
        if (!line.is_manpower_dependent) continue;
        const roles = Array.isArray(line.roles)
            ? line.roles
            : (typeof line.roles === 'string' ? JSON.parse(line.roles || '[]') : []);
        if (roles.some(r => designationsMatch(designation, r.designation))) {
            return { line, roles };
        }
    }
    return null;
}

async function resolveEmployeeId(pool, empCode, contractId, siteCode) {
    const code = String(empCode || '').trim();
    if (!code) return null;

    const attempts = [
        [`SELECT id FROM employees WHERE id = $1`, [code]],
        [`SELECT id FROM employees WHERE id LIKE $1`, [`%${code}`]],
        [`SELECT id FROM employees WHERE contract_id = $1 AND (site = $2 OR location ILIKE $3) AND (id ILIKE $4 OR cnic ILIKE $4)`,
            [contractId, siteCode, `%${siteCode}%`, `%${code}%`]],
    ];

    for (const [sql, params] of attempts) {
        const { rows } = await pool.query(sql, params);
        if (rows[0]?.id) return rows[0].id;
    }

    const { rows: metaRows } = await pool.query(
        `SELECT id FROM employees
         WHERE contract_id = $1
           AND (
             id = $2
             OR cnic = $2
             OR id ILIKE $3
           )
         LIMIT 1`,
        [contractId, code, `%${code.replace(/^W-/i, '')}%`]
    );
    return metaRows[0]?.id || null;
}

async function applyAttendance(pool, { serviceOrderId, month, year, rows, actor, monthDays = 30 }) {
    const so = await getServiceOrder(pool, serviceOrderId);
    if (!so) {
        const err = new Error('Service order not found');
        err.status = 404;
        throw err;
    }

    const lines = so.lines || [];
    const client = await pool.connect();
    const summary = { overrides: 0, deductions: 0, skipped: [], errors: [] };

    try {
        await client.query('BEGIN');
        await client.query(
            `DELETE FROM so_deductions
             WHERE service_order_id = $1 AND period_month = $2 AND period_year = $3 AND source = 'attendance_ledger'`,
            [serviceOrderId, month, year]
        );

        for (const row of rows || []) {
            const employeeId = await resolveEmployeeId(client, row.empCode, so.contract_id, so.site_code);
            if (!employeeId) {
                summary.skipped.push({ empCode: row.empCode, reason: 'employee_not_found' });
                continue;
            }

            await client.query(
                `INSERT INTO monthly_attendance_overrides
                 (employee_id, period_month, period_year, present_days, source, updated_by, updated_at)
                 VALUES ($1,$2,$3,$4,'fv_conservancy_attendance',$5,NOW())
                 ON CONFLICT (employee_id, period_month, period_year)
                 DO UPDATE SET present_days = EXCLUDED.present_days, source = EXCLUDED.source,
                               updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
                [employeeId, month, year, Number(row.presentDays) || 0, actor || null]
            );
            summary.overrides += 1;

            const absentDays = Number(row.absentDays) || 0;
            if (absentDays <= 0) continue;

            const match = findLineForDesignation(lines, row.designation);
            if (!match) {
                summary.errors.push({ empCode: row.empCode, reason: 'no_matching_line', designation: row.designation });
                continue;
            }

            const amount = absenceDeductionAmount(match.line.rate, match.roles, absentDays, monthDays);
            if (amount <= 0) continue;

            await client.query(
                `INSERT INTO so_deductions
                 (service_order_id, line_id, period_month, period_year, type, employee_id, days_absent, amount, source, approved_by)
                 VALUES ($1,$2,$3,$4,'absence',$5,$6,$7,'attendance_ledger',$8)`,
                [
                    serviceOrderId,
                    match.line.id,
                    month,
                    year,
                    employeeId,
                    absentDays,
                    amount,
                    actor || null,
                ]
            );
            summary.deductions += 1;
        }

        await client.query('COMMIT');
        return summary;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = {
    applyAttendance,
    findLineForDesignation,
    resolveEmployeeId,
    normalizeDesignation,
    designationsMatch,
};
