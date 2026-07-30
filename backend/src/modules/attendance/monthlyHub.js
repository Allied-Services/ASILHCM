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
 * Merge helper for monthly hub override upsert.
 * - undefined / Symbol SENTINEL_OMIT → keep existing (field not sent)
 * - '' / null → clear to 0 for money/hours (or null for day counts when clearDays)
 * - 0 → persist 0 (never COALESCE-keep previous)
 */
const OMIT = Symbol('omit');
function pickOverrideField(val, fallback, { allowNull = false } = {}) {
    if (val === OMIT || val === undefined) return fallback;
    if (val === '' || val === null) return allowNull ? null : 0;
    const n = Number(val);
    return Number.isFinite(n) ? n : (allowNull ? null : 0);
}

/**
 * If a draft World B payroll_run exists for the employee's contract/period,
 * recompute it so Attendance/FV overrides show up in payroll UI without a manual click.
 */
async function recomputeDraftRunForEmployee(pool, { employeeId, month, year }) {
    const { rows: empRows } = await pool.query(
        `SELECT contract_id, contract_name FROM employees WHERE id = $1`,
        [employeeId]
    );
    const contractId = empRows[0]?.contract_id || empRows[0]?.contract_name;
    if (!contractId) return { recomputed: false, reason: 'NO_CONTRACT' };

    const { rows: runs } = await pool.query(
        `SELECT id, status FROM payroll_runs
         WHERE (contract_id = $1 OR contract_id = $2)
           AND period_month = $3 AND period_year = $4
         ORDER BY id DESC LIMIT 1`,
        [empRows[0]?.contract_id || contractId, empRows[0]?.contract_name || contractId, month, year]
    );
    if (!runs.length) return { recomputed: false, reason: 'NO_RUN', contractId };
    const run = runs[0];
    if (['locked', 'invoiced', 'paid'].includes(run.status)) {
        return {
            recomputed: false,
            reason: 'RUN_LOCKED',
            runId: run.id,
            status: run.status,
            contractId,
        };
    }

    // Lazy require avoids circular load at module init.
    const { computeRunForContract } = require('../payrollrun/service');
    const result = await computeRunForContract(pool, {
        contractId: empRows[0]?.contract_id || contractId,
        month,
        year,
    });
    if (!result?.ok) {
        return {
            recomputed: false,
            reason: result?.code || 'RECOMPUTE_FAILED',
            runId: run.id,
            contractId,
            message: result?.message,
        };
    }
    return {
        recomputed: true,
        runId: result.run?.id || run.id,
        contractId,
        rowCount: Array.isArray(result.rows) ? result.rows.length : undefined,
    };
}

/**
 * Single-employee monthly hub override (present days, other deduction, etc.).
 * Omitted fields leave existing override values unchanged.
 * Explicit 0 / empty string persists 0 (clears prior deduction/OT/arrears).
 */
async function upsertMonthlyHubOverride(pool, {
    employeeId,
    month,
    year,
    presentDays = OMIT,
    otherDeduction = OMIT,
    leaveDeduction = OMIT,
    ot2Hours = OMIT,
    ot3Hours = OMIT,
    opd = OMIT,
    expense = OMIT,
    arrears = OMIT,
    specialAllowance = OMIT,
    fuelMobile = OMIT,
    absentDays = OMIT,
    updatedBy,
    recomputeDraft = true,
}) {
    const id = String(employeeId || '').trim();
    if (!id) {
        const err = new Error('employeeId is required');
        err.code = 'VALIDATION';
        throw err;
    }
    const { rows: emp } = await pool.query(`SELECT id, name, contract_id FROM employees WHERE id = $1`, [id]);
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
    const merged = {
        presentDays: pickOverrideField(presentDays, ex?.present_days ?? null, { allowNull: true }),
        absentDays: pickOverrideField(absentDays, ex?.absent_days ?? null, { allowNull: true }),
        ot2: pickOverrideField(ot2Hours, ex?.ot2_hours ?? 0),
        ot3: pickOverrideField(ot3Hours, ex?.ot3_hours ?? 0),
        opd: pickOverrideField(opd, ex?.opd ?? 0),
        expense: pickOverrideField(expense, ex?.expense ?? 0),
        arrears: pickOverrideField(arrears, ex?.arrears ?? 0),
        specialAllowance: pickOverrideField(specialAllowance, ex?.special_allowance ?? 0),
        fuelMobile: pickOverrideField(fuelMobile, ex?.fuel_mobile ?? 0),
        otherDeduction: pickOverrideField(otherDeduction, ex?.other_deduction ?? 0),
        leaveDeduction: pickOverrideField(leaveDeduction, ex?.leave_deduction ?? 0),
    };

    // leave_deduction column may be missing until migration — try full write, fall back.
    try {
        await pool.query(
            `INSERT INTO monthly_attendance_overrides
                (employee_id, period_month, period_year, present_days, absent_days, ot2_hours, ot3_hours,
                 opd, expense, arrears, special_allowance, fuel_mobile, other_deduction, leave_deduction,
                 updated_by, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
             ON CONFLICT (employee_id, period_month, period_year) DO UPDATE SET
               present_days = COALESCE(EXCLUDED.present_days, monthly_attendance_overrides.present_days),
               absent_days = COALESCE(EXCLUDED.absent_days, monthly_attendance_overrides.absent_days),
               ot2_hours = EXCLUDED.ot2_hours,
               ot3_hours = EXCLUDED.ot3_hours,
               opd = EXCLUDED.opd,
               expense = EXCLUDED.expense,
               arrears = EXCLUDED.arrears,
               special_allowance = EXCLUDED.special_allowance,
               fuel_mobile = EXCLUDED.fuel_mobile,
               other_deduction = EXCLUDED.other_deduction,
               leave_deduction = EXCLUDED.leave_deduction,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
            [
                id, month, year,
                merged.presentDays, merged.absentDays, merged.ot2, merged.ot3,
                merged.opd, merged.expense, merged.arrears,
                merged.specialAllowance, merged.fuelMobile, merged.otherDeduction, merged.leaveDeduction,
                updatedBy || null,
            ]
        );
    } catch (err) {
        if (!/leave_deduction/i.test(err.message || '')) throw err;
        // Pre-migration: fold leave deduction into other_deduction so payroll still picks it up.
        const foldedOther = Number(merged.otherDeduction || 0) + Number(merged.leaveDeduction || 0);
        await pool.query(
            `INSERT INTO monthly_attendance_overrides
                (employee_id, period_month, period_year, present_days, absent_days, ot2_hours, ot3_hours,
                 opd, expense, arrears, special_allowance, fuel_mobile, other_deduction, updated_by, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
             ON CONFLICT (employee_id, period_month, period_year) DO UPDATE SET
               present_days = COALESCE(EXCLUDED.present_days, monthly_attendance_overrides.present_days),
               absent_days = COALESCE(EXCLUDED.absent_days, monthly_attendance_overrides.absent_days),
               ot2_hours = EXCLUDED.ot2_hours,
               ot3_hours = EXCLUDED.ot3_hours,
               opd = EXCLUDED.opd,
               expense = EXCLUDED.expense,
               arrears = EXCLUDED.arrears,
               special_allowance = EXCLUDED.special_allowance,
               fuel_mobile = EXCLUDED.fuel_mobile,
               other_deduction = EXCLUDED.other_deduction,
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()`,
            [
                id, month, year,
                merged.presentDays, merged.absentDays, merged.ot2, merged.ot3,
                merged.opd, merged.expense, merged.arrears,
                merged.specialAllowance, merged.fuelMobile, foldedOther,
                updatedBy || null,
            ]
        );
        merged.otherDeduction = foldedOther;
    }

    let payrollSync = { recomputed: false, reason: 'SKIPPED' };
    if (recomputeDraft) {
        try {
            payrollSync = await recomputeDraftRunForEmployee(pool, {
                employeeId: id,
                month,
                year,
            });
        } catch (err) {
            console.error('[monthlyHub.override recompute]', err);
            payrollSync = { recomputed: false, reason: 'RECOMPUTE_ERROR' };
        }
    }

    return {
        ok: true,
        employeeId: id,
        employeeName: emp[0].name,
        month,
        year,
        recomputeRequired: !payrollSync.recomputed,
        payrollSync,
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

    let rows;
    try {
        ({ rows } = await pool.query(
            `SELECT e.id AS employee_id, e.name, e.client, e.contract_name, e.location AS site,
                    o.present_days, o.absent_days, o.other_deduction, o.leave_deduction,
                    o.ot2_hours, o.ot3_hours, o.arrears, o.source, o.updated_at AS override_updated_at,
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
        ));
    } catch (err) {
        if (!/leave_deduction/i.test(err.message || '')) throw err;
        ({ rows } = await pool.query(
            `SELECT e.id AS employee_id, e.name, e.client, e.contract_name, e.location AS site,
                    o.present_days, o.absent_days, o.other_deduction, 0::numeric AS leave_deduction,
                    o.ot2_hours, o.ot3_hours, o.arrears, o.source, o.updated_at AS override_updated_at,
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
        ));
    }

    const employees = rows.map((r) => {
        const attPresent = parseInt(r.att_present, 10) || 0;
        const hasMoneyOverride = (Number(r.other_deduction) || 0) > 0
            || (Number(r.leave_deduction) || 0) > 0
            || (Number(r.arrears) || 0) > 0
            || (Number(r.ot2_hours) || 0) > 0
            || (Number(r.ot3_hours) || 0) > 0;
        const hasOverride = r.present_days != null || r.absent_days != null || hasMoneyOverride;
        const present = r.present_days != null ? Number(r.present_days) : attPresent;
        const sheetAbsent = r.absent_days != null ? Number(r.absent_days) : null;
        const onLeave = r.present_days != null
            ? Math.max(0, workingDays - present)
            : (parseInt(r.att_leave, 10) || 0);
        const absent = sheetAbsent != null
            ? sheetAbsent
            : (r.present_days != null ? 0 : (parseInt(r.att_absent, 10) || 0));
        const halfDay = (r.present_days != null || sheetAbsent != null)
            ? 0
            : (parseInt(r.att_half, 10) || 0);
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
            ot2_hours: Number(r.ot2_hours) || 0,
            ot3_hours: Number(r.ot3_hours) || 0,
            arrears: Number(r.arrears) || 0,
            leave_deduction: Number(r.leave_deduction) || 0,
            other_deduction: Number(r.other_deduction) || 0,
            source: r.source || null,
            has_override: hasOverride,
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

/**
 * Remove monthly hub overrides for a period (optionally scoped to contract/client).
 */
async function clearMonthlyHubOverrides(pool, {
    month,
    year,
    contractId,
    client,
    contract,
}) {
    const params = [month, year];
    let scope = '';
    if (contractId) {
        params.push(contractId);
        scope += ` AND (e.contract_id = $${params.length} OR e.contract_name = $${params.length})`;
    }
    if (client) {
        params.push(client);
        scope += ` AND e.client = $${params.length}`;
    }
    if (contract) {
        params.push(contract);
        scope += ` AND e.contract_name = $${params.length}`;
    }
    const { rowCount } = await pool.query(
        `DELETE FROM monthly_attendance_overrides o
         USING employees e
         WHERE o.employee_id = e.id
           AND o.period_month = $1
           AND o.period_year = $2
           ${scope}`,
        params
    );
    return { ok: true, month, year, deleted: rowCount };
}

module.exports = {
    exportMonthlyHubCsv,
    importMonthlyHubCsv,
    getMonthlyHubRollups,
    getMonthlyHubList,
    upsertMonthlyHubOverride,
    clearMonthlyHubOverrides,
    recomputeDraftRunForEmployee,
    pickOverrideField,
    OMIT,
    MONTHLY_HUB_COLUMNS,
    calendarWorkingDays,
};
