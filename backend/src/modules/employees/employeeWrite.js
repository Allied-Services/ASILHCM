'use strict';

const { CUTOVER_DATE } = require('../../core/cutover');
const { isEmployeeActive } = require('../../core/employeeActive');

function normalizeCnic(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    return s.replace(/[^0-9]/g, '');
}

function toDay(d) {
    if (!d) return '';
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return String(d).slice(0, 10);
}

function hiddenFromDirectory(row) {
    if (!row) return false;
    if (!isEmployeeActive(row.active)) return true;
    const lwd = toDay(row.last_working_day);
    return !!(lwd && lwd < CUTOVER_DATE);
}

function summarizeEmployee(row) {
    if (!row) return null;
    const hidden = hiddenFromDirectory(row);
    return {
        id: row.id,
        name: row.name || '',
        cnic: row.cnic || '',
        active: row.active || '',
        lastWorkingDay: toDay(row.last_working_day),
        hiddenFromList: hidden,
    };
}

function cnicTakenMessage(existing, incomingCnic) {
    const who = existing.name ? `${existing.name} (${existing.id})` : existing.id;
    const hidden = existing.hiddenFromList
        ? ' They are hidden from the Employee Information list (inactive, or last working day before Jul 2026) — turn on Show pre-Jul 2026 archive to open that record.'
        : '';
    return `CNIC ${incomingCnic} already belongs to ${who}.${hidden} Update the existing employee instead of adding a new one.`;
}

function idExistsMessage(existing) {
    const who = existing.name ? `${existing.name} (${existing.id})` : existing.id;
    const hidden = existing.hiddenFromList
        ? ' They are hidden from the Employee Information list (inactive, or last working day before Jul 2026) — turn on Show pre-Jul 2026 archive to see them.'
        : '';
    return `Employee code ${existing.id} already exists as ${who}.${hidden}`;
}

/**
 * Find existing rows by exact employee code and/or digit-normalized CNIC.
 * Ignores cutover visibility — leavers must still block a duplicate add.
 */
async function findEmployeeConflicts(pool, { id, cnic } = {}) {
    const empId = String(id || '').trim() || null;
    const digits = normalizeCnic(cnic);
    const { rows } = await pool.query(
        `SELECT id, name, cnic, active, last_working_day
         FROM employees
         WHERE ($1::text IS NOT NULL AND id = $1)
            OR ($2::text <> '' AND regexp_replace(COALESCE(cnic, ''), '[^0-9]', '', 'g') = $2)
         LIMIT 20`,
        [empId, digits]
    );
    const byId = empId ? rows.find((r) => r.id === empId) || null : null;
    const byCnic = digits
        ? rows.find((r) => r.id !== empId && normalizeCnic(r.cnic) === digits) || null
        : null;
    return {
        byId: summarizeEmployee(byId),
        byCnic: summarizeEmployee(byCnic),
    };
}

function mapEmployeeWriteError(err, { id, cnic } = {}) {
    if (!err) return null;
    if (err.code === '23505') {
        const constraint = String(err.constraint || '');
        if (/cnic/i.test(constraint)) {
            return {
                status: 409,
                body: {
                    error: `CNIC ${cnic || ''} is already registered to another employee. Search by CNIC (including the pre-Jul 2026 archive) instead of adding a new record.`,
                    code: 'CNIC_TAKEN',
                },
            };
        }
        if (/employees_pkey|_pkey/i.test(constraint)) {
            return {
                status: 409,
                body: {
                    error: `Employee code ${id || ''} already exists.`,
                    code: 'ID_TAKEN',
                },
            };
        }
        return {
            status: 409,
            body: {
                error: 'This employee already exists (duplicate ID or CNIC).',
                code: 'DUPLICATE',
            },
        };
    }
    if (err.code === '22007' || err.code === '22008') {
        return {
            status: 400,
            body: {
                error: 'One of the dates is not a valid calendar date. Use the date picker (YYYY-MM-DD).',
                code: 'INVALID_DATE',
            },
        };
    }
    return null;
}

module.exports = {
    normalizeCnic,
    hiddenFromDirectory,
    summarizeEmployee,
    cnicTakenMessage,
    idExistsMessage,
    findEmployeeConflicts,
    mapEmployeeWriteError,
};
