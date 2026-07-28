'use strict';

const { parse } = require('csv-parse/sync');
const {
    MONTHLY_HUB_COLUMNS,
    buildMonthlyExportRow,
    mergeMonthlyImportRow,
    isBlankCell,
} = require('./parser');

function csvEscape(v) {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

/** Mon–Fri count in month (matches legacy monthly report). */
function calendarWorkingDays(month, year) {
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
        const d = new Date(year, month - 1, i + 1);
        return d.getDay() !== 0 && d.getDay() !== 6;
    }).filter(Boolean).length;
}

/**
 * Active, non-resigned employees for period — 15 master columns.
 */
async function exportMonthlyHubCsv(pool, { month, year, client }) {
    const params = [month, year];
    let clientFilter = '';
    if (client) {
        params.push(`%${client}%`);
        clientFilter = ` AND LOWER(e.client) LIKE LOWER($${params.length})`;
    }

    const { rows } = await pool.query(
        `SELECT e.id, e.cnic, e.name, e.client, e.contract_name, e.contract_id, e.location, e.bu, e.dept,
                e.active, e.last_working_day,
                o.present_days, o.ot2_hours, o.ot3_hours, o.opd, o.expense, o.arrears,
                o.special_allowance, o.fuel_mobile, o.other_deduction,
                COALESCE((
                    SELECT COUNT(*)::int FROM attendance_records ar
                    WHERE ar.employee_id = e.id
                      AND EXTRACT(MONTH FROM ar.date) = $1
                      AND EXTRACT(YEAR FROM ar.date) = $2
                      AND ar.status IN ('present','ot','leave','half_day')
                ), 0) AS att_present,
                COALESCE((
                    SELECT SUM(COALESCE(ar.ot_hours, 0)) FROM attendance_records ar
                    WHERE ar.employee_id = e.id
                      AND EXTRACT(MONTH FROM ar.date) = $1
                      AND EXTRACT(YEAR FROM ar.date) = $2
                ), 0) AS att_ot
         FROM employees e
         LEFT JOIN monthly_attendance_overrides o
           ON o.employee_id = e.id AND o.period_month = $1 AND o.period_year = $2
         WHERE (e.active IS NULL OR LOWER(TRIM(e.active::text)) IN ('yes','true','1','active','')
                OR e.active::text = 'Yes')
           AND (e.last_working_day IS NULL OR e.last_working_day >= make_date($2, $1, 1))
           ${clientFilter}
         ORDER BY e.client, e.name`,
        params
    );

    const lines = [MONTHLY_HUB_COLUMNS.join(',')];
    for (const r of rows) {
        const exportRow = buildMonthlyExportRow({
            cnic: r.cnic,
            staffCode: r.id,
            month,
            year,
            employeeId: r.id,
            contractName: r.contract_name,
            presentDays: r.present_days != null ? r.present_days : r.att_present,
            ot2: r.ot2_hours != null ? r.ot2_hours : r.att_ot,
            ot3: r.ot3_hours || 0,
            opd: r.opd || 0,
            expense: r.expense || 0,
            arrears: r.arrears || 0,
            specialAllowance: r.special_allowance || 0,
            fuelMobile: r.fuel_mobile || 0,
            otherDeduction: r.other_deduction || 0,
        });
        lines.push(MONTHLY_HUB_COLUMNS.map(c => csvEscape(exportRow[c])).join(','));
    }
    return {
        csv: lines.join('\n'),
        filename: `monthly_hub_${year}_${String(month).padStart(2, '0')}.csv`,
        rowCount: rows.length,
    };
}

/**
 * Import 15-column CSV. Match exclusively on ASIL Employee Code.
 * Blank cells never wipe existing override values.
 */
async function importMonthlyHubCsv(pool, { csvText, month, year, updatedBy }) {
    const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const row of records) {
        const code = row['ASIL Employee Code'] || row['ASIL Employee Code '] || row.employee_id;
        if (isBlankCell(code)) {
            skipped += 1;
            errors.push({ error: 'Missing ASIL Employee Code', row });
            continue;
        }
        const employeeId = String(code).trim();
        const { rows: emp } = await pool.query(`SELECT id FROM employees WHERE id = $1`, [employeeId]);
        if (!emp.length) {
            skipped += 1;
            errors.push({ error: `Employee not found: ${employeeId}` });
            continue;
        }

        const { rows: existingRows } = await pool.query(
            `SELECT * FROM monthly_attendance_overrides
             WHERE employee_id = $1 AND period_month = $2 AND period_year = $3`,
            [employeeId, month, year]
        );
        const existing = existingRows[0] ? {
            presentDays: existingRows[0].present_days,
            ot2: existingRows[0].ot2_hours,
            ot3: existingRows[0].ot3_hours,
            opd: existingRows[0].opd,
            expense: existingRows[0].expense,
            arrears: existingRows[0].arrears,
            specialAllowance: existingRows[0].special_allowance,
            fuelMobile: existingRows[0].fuel_mobile,
            otherDeduction: existingRows[0].other_deduction,
        } : {
            presentDays: null, ot2: 0, ot3: 0, opd: 0, expense: 0,
            arrears: 0, specialAllowance: 0, fuelMobile: 0, otherDeduction: 0,
        };

        const merged = mergeMonthlyImportRow(existing, row);
        await pool.query(
            `INSERT INTO monthly_attendance_overrides
                (employee_id, period_month, period_year, present_days, ot2_hours, ot3_hours,
                 opd, expense, arrears, special_allowance, fuel_mobile, other_deduction, updated_by, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
             ON CONFLICT (employee_id, period_month, period_year) DO UPDATE SET
               present_days = COALESCE(EXCLUDED.present_days, monthly_attendance_overrides.present_days),
               ot2_hours = COALESCE(EXCLUDED.ot2_hours, monthly_attendance_overrides.ot2_hours),
               ot3_hours = COALESCE(EXCLUDED.ot3_hours, monthly_attendance_overrides.ot3_hours),
               opd = COALESCE(EXCLUDED.opd, monthly_attendance_overrides.opd),
               expense = COALESCE(EXCLUDED.expense, monthly_attendance_overrides.expense),
               arrears = COALESCE(EXCLUDED.arrears, monthly_attendance_overrides.arrears),
               special_allowance = COALESCE(EXCLUDED.special_allowance, monthly_attendance_overrides.special_allowance),
               fuel_mobile = COALESCE(EXCLUDED.fuel_mobile, monthly_attendance_overrides.fuel_mobile),
               other_deduction = COALESCE(EXCLUDED.other_deduction, monthly_attendance_overrides.other_deduction),
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
            [
                employeeId, month, year,
                merged.presentDays, merged.ot2, merged.ot3,
                merged.opd, merged.expense, merged.arrears,
                merged.specialAllowance, merged.fuelMobile, merged.otherDeduction,
                updatedBy || null,
            ]
        );
        updated += 1;
    }

    return { updated, skipped, errors, columns: MONTHLY_HUB_COLUMNS };
}

/**
 * Summary rollups by Location, Employee, Contract, BU.
 */
async function getMonthlyHubRollups(pool, { month, year, client }) {
    const params = [month, year];
    let clientFilter = '';
    if (client) {
        params.push(`%${client}%`);
        clientFilter = ` AND LOWER(e.client) LIKE LOWER($${params.length})`;
    }

    const base = `
        FROM attendance_records ar
        JOIN employees e ON e.id = ar.employee_id
        WHERE EXTRACT(MONTH FROM ar.date) = $1 AND EXTRACT(YEAR FROM ar.date) = $2
        ${clientFilter}
    `;

    const [byLocation, byEmployee, byContract, byBu, totals] = await Promise.all([
        pool.query(`SELECT COALESCE(e.location, ar.site, '—') AS key, COUNT(*)::int AS records,
                    COUNT(*) FILTER (WHERE ar.status IN ('present','ot'))::int AS present
                    ${base} GROUP BY 1 ORDER BY records DESC LIMIT 50`, params),
        pool.query(`SELECT e.id AS key, e.name AS label, COUNT(*)::int AS records,
                    COUNT(*) FILTER (WHERE ar.status IN ('present','ot'))::int AS present
                    ${base} GROUP BY e.id, e.name ORDER BY records DESC LIMIT 50`, params),
        pool.query(`SELECT COALESCE(e.contract_name, e.contract_id, '—') AS key, COUNT(*)::int AS records,
                    COUNT(*) FILTER (WHERE ar.status IN ('present','ot'))::int AS present
                    ${base} GROUP BY 1 ORDER BY records DESC LIMIT 50`, params),
        pool.query(`SELECT COALESCE(e.bu, e.dept, '—') AS key, COUNT(*)::int AS records,
                    COUNT(*) FILTER (WHERE ar.status IN ('present','ot'))::int AS present
                    ${base} GROUP BY 1 ORDER BY records DESC LIMIT 50`, params),
        pool.query(`SELECT COUNT(*)::int AS total_records,
                    COUNT(DISTINCT ar.employee_id)::int AS employees,
                    COUNT(*) FILTER (WHERE ar.status IN ('present','ot'))::int AS present,
                    COUNT(*) FILTER (WHERE ar.status IN ('absent','unexcused'))::int AS absent
                    ${base}`, params),
    ]);

    return {
        month, year,
        totals: totals.rows[0] || {},
        byLocation: byLocation.rows,
        byEmployee: byEmployee.rows,
        byContract: byContract.rows,
        byBu: byBu.rows,
    };
}

/**
 * Single-employee monthly hub override (present days, other deduction, etc.).
 * Blank/null fields leave existing override values unchanged.
 */
async function upsertMonthlyHubOverride(pool, {
    employeeId,
    month,
    year,
    presentDays,
    otherDeduction,
    ot2Hours,
    ot3Hours,
    opd,
    expense,
    arrears,
    specialAllowance,
    fuelMobile,
    updatedBy,
}) {
    const id = String(employeeId || '').trim();
    if (!id) {
        const err = new Error('employeeId is required');
        err.code = 'VALIDATION';
        throw err;
    }
    const { rows: emp } = await pool.query(`SELECT id, name FROM employees WHERE id = $1`, [id]);
    if (!emp.length) {
        const err = new Error(`Employee not found: ${id}`);
        err.code = 'NOT_FOUND';
        throw err;
    }

    const { rows: existingRows } = await pool.query(
        `SELECT * FROM monthly_attendance_overrides
         WHERE employee_id = $1 AND period_month = $2 AND period_year = $3`,
        [id, month, year]
    );
    const ex = existingRows[0];
    const pick = (val, fallback) => (val != null && val !== '' ? Number(val) : fallback);
    const merged = {
        presentDays: pick(presentDays, ex?.present_days ?? null),
        ot2: pick(ot2Hours, ex?.ot2_hours ?? 0),
        ot3: pick(ot3Hours, ex?.ot3_hours ?? 0),
        opd: pick(opd, ex?.opd ?? 0),
        expense: pick(expense, ex?.expense ?? 0),
        arrears: pick(arrears, ex?.arrears ?? 0),
        specialAllowance: pick(specialAllowance, ex?.special_allowance ?? 0),
        fuelMobile: pick(fuelMobile, ex?.fuel_mobile ?? 0),
        otherDeduction: pick(otherDeduction, ex?.other_deduction ?? 0),
    };

    await pool.query(
        `INSERT INTO monthly_attendance_overrides
            (employee_id, period_month, period_year, present_days, ot2_hours, ot3_hours,
             opd, expense, arrears, special_allowance, fuel_mobile, other_deduction, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
         ON CONFLICT (employee_id, period_month, period_year) DO UPDATE SET
           present_days = COALESCE(EXCLUDED.present_days, monthly_attendance_overrides.present_days),
           ot2_hours = COALESCE(EXCLUDED.ot2_hours, monthly_attendance_overrides.ot2_hours),
           ot3_hours = COALESCE(EXCLUDED.ot3_hours, monthly_attendance_overrides.ot3_hours),
           opd = COALESCE(EXCLUDED.opd, monthly_attendance_overrides.opd),
           expense = COALESCE(EXCLUDED.expense, monthly_attendance_overrides.expense),
           arrears = COALESCE(EXCLUDED.arrears, monthly_attendance_overrides.arrears),
           special_allowance = COALESCE(EXCLUDED.special_allowance, monthly_attendance_overrides.special_allowance),
           fuel_mobile = COALESCE(EXCLUDED.fuel_mobile, monthly_attendance_overrides.fuel_mobile),
           other_deduction = COALESCE(EXCLUDED.other_deduction, monthly_attendance_overrides.other_deduction),
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [
            id, month, year,
            merged.presentDays, merged.ot2, merged.ot3,
            merged.opd, merged.expense, merged.arrears,
            merged.specialAllowance, merged.fuelMobile, merged.otherDeduction,
            updatedBy || null,
        ]
    );

    return {
        ok: true,
        employeeId: id,
        employeeName: emp[0].name,
        month,
        year,
        ...merged,
    };
}

/**
 * Monthly hub rows for Attendance Management UI — merges daily records + overrides.
 */
async function getMonthlyHubList(pool, {
    month,
    year,
    client,
    contract,
    location,
    employeeId,
    name,
}) {
    const workingDays = calendarWorkingDays(month, year);
    const params = [month, year];
    let filters = '';

    if (client) {
        params.push(client);
        filters += ` AND e.client = $${params.length}`;
    }
    if (contract) {
        params.push(contract);
        filters += ` AND e.contract_name = $${params.length}`;
    }
    if (location) {
        params.push(location);
        filters += ` AND e.location = $${params.length}`;
    }
    if (employeeId) {
        params.push(`%${String(employeeId).trim()}%`);
        filters += ` AND e.id ILIKE $${params.length}`;
    }
    if (name) {
        params.push(`%${String(name).trim()}%`);
        filters += ` AND e.name ILIKE $${params.length}`;
    }

    const activeWhere = `(e.active IS NULL OR LOWER(TRIM(e.active::text)) IN ('yes','true','1','active','')
        OR e.active::text = 'Yes')
        AND (e.last_working_day IS NULL OR e.last_working_day >= make_date($2, $1, 1))`;

    const { rows } = await pool.query(
        `SELECT e.id AS employee_id, e.name, e.client, e.contract_name, e.location AS site,
                o.present_days, o.other_deduction, o.updated_at AS override_updated_at,
                COALESCE((
                    SELECT COUNT(*)::int FROM attendance_records ar
                    WHERE ar.employee_id = e.id
                      AND EXTRACT(MONTH FROM ar.date) = $1
                      AND EXTRACT(YEAR FROM ar.date) = $2
                      AND ar.status IN ('present','ot','leave','half_day')
                ), 0) AS att_present,
                COALESCE((
                    SELECT COUNT(*)::int FROM attendance_records ar
                    WHERE ar.employee_id = e.id
                      AND EXTRACT(MONTH FROM ar.date) = $1
                      AND EXTRACT(YEAR FROM ar.date) = $2
                      AND ar.status IN ('absent','unexcused')
                ), 0) AS att_absent,
                COALESCE((
                    SELECT COUNT(*)::int FROM attendance_records ar
                    WHERE ar.employee_id = e.id
                      AND EXTRACT(MONTH FROM ar.date) = $1
                      AND EXTRACT(YEAR FROM ar.date) = $2
                      AND ar.status = 'half_day'
                ), 0) AS att_half,
                COALESCE((
                    SELECT COUNT(*)::int FROM attendance_records ar
                    WHERE ar.employee_id = e.id
                      AND EXTRACT(MONTH FROM ar.date) = $1
                      AND EXTRACT(YEAR FROM ar.date) = $2
                      AND ar.status = 'leave'
                ), 0) AS att_leave
         FROM employees e
         LEFT JOIN monthly_attendance_overrides o
           ON o.employee_id = e.id AND o.period_month = $1 AND o.period_year = $2
         WHERE ${activeWhere}
           ${filters}
         ORDER BY e.client, e.contract_name, e.name`,
        params
    );

    const employees = rows.map((r) => {
        const attPresent = parseInt(r.att_present, 10) || 0;
        const hasOverride = r.present_days != null;
        const present = hasOverride ? Number(r.present_days) : attPresent;
        const onLeave = hasOverride
            ? Math.max(0, workingDays - present)
            : (parseInt(r.att_leave, 10) || 0);
        const absent = hasOverride ? 0 : (parseInt(r.att_absent, 10) || 0);
        const halfDay = hasOverride ? 0 : (parseInt(r.att_half, 10) || 0);
        const effPres = present + halfDay * 0.5;
        const pct = workingDays > 0 ? Math.round((effPres / workingDays) * 100) : null;
        return {
            employee_id: r.employee_id,
            name: r.name,
            client: r.client,
            contract: r.contract_name,
            site: r.site,
            working_days: workingDays,
            present,
            absent,
            half_day: halfDay,
            on_leave: onLeave,
            attendance_pct: pct,
            other_deduction: Number(r.other_deduction) || 0,
            has_override: hasOverride || (Number(r.other_deduction) || 0) > 0,
            override_updated_at: r.override_updated_at,
        };
    });

    const { rows: optRows } = await pool.query(
        `SELECT DISTINCT e.client, e.contract_name, e.location
         FROM employees e
         WHERE ${activeWhere}
         ORDER BY e.client, e.contract_name, e.location`,
        [month, year]
    );
    const clients = [...new Set(optRows.map((r) => r.client).filter(Boolean))].sort();
    const contracts = [...new Set(optRows.map((r) => r.contract_name).filter(Boolean))].sort();
    const locations = [...new Set(optRows.map((r) => r.location).filter(Boolean))].sort();

    return {
        month,
        year,
        working_days: workingDays,
        employees,
        filterOptions: { clients, contracts, locations },
    };
}

module.exports = {
    exportMonthlyHubCsv,
    importMonthlyHubCsv,
    getMonthlyHubRollups,
    getMonthlyHubList,
    upsertMonthlyHubOverride,
    MONTHLY_HUB_COLUMNS,
    calendarWorkingDays,
};
