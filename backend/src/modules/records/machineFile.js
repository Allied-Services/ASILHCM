'use strict';

const INPUT_MODES = ['full_ledger', 'hours', 'days', 'absent_only'];

const TEMPLATE_COLUMNS = {
    full_ledger: ['employee_id', 'name', 'present_days', 'absent_days', 'hours', 'ot2', 'ot3'],
    hours: ['employee_id', 'name', 'hours', 'ot2', 'ot3'],
    days: ['employee_id', 'name', 'present_days', 'absent_days', 'ot2', 'ot3'],
    absent_only: ['employee_id', 'name', 'absent_days', 'ot2', 'ot3'],
};

function normHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

function pick(row, aliases) {
    for (const a of aliases) {
        if (row[a] != null && String(row[a]).trim() !== '') return row[a];
    }
    return null;
}

function splitDelimitedLine(line, delim) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    const s = String(line || '');
    for (let i = 0; i < s.length; i += 1) {
        const ch = s[i];
        if (ch === '"') {
            if (inQuotes && s[i + 1] === '"') {
                cur += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === delim && !inQuotes) {
            cells.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    cells.push(cur);
    return cells;
}

function parseDelimited(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const delim = lines[0].includes('\t') ? '\t' : ',';
    const headers = splitDelimitedLine(lines[0], delim).map(normHeader);
    return lines.slice(1).map((line) => {
        const cells = splitDelimitedLine(line, delim);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = cells[i]; });
        return obj;
    });
}

function mapRow(raw, inputMode) {
    const employee_id = pick(raw, ['employee_id', 'asil_employee_code', 'asil_code', 'code', 'id']);
    const employee_name = pick(raw, ['name', 'employee_name', 'employee']);
    const present_days = num(pick(raw, ['present_days', 'present', 'days_present', 'paid_days']));
    const absent_days = num(pick(raw, ['absent_days', 'absent', 'days_absent', 'deduction_days']));
    const hours = num(pick(raw, ['hours', 'worked_hours', 'total_hours']));
    const ot2_hours = num(pick(raw, ['ot2', 'ot2_hours', 'ot_2', 'overtime_2x']));
    const ot3_hours = num(pick(raw, ['ot3', 'ot3_hours', 'ot_3', 'overtime_3x']));
    return {
        employee_id: employee_id ? String(employee_id).trim() : null,
        employee_name: employee_name ? String(employee_name).trim() : null,
        present_days: inputMode === 'absent_only' ? null : present_days,
        absent_days,
        hours: inputMode === 'hours' ? hours : hours,
        ot2_hours,
        ot3_hours,
        notes: pick(raw, ['notes', 'remark', 'remarks']) || null,
    };
}

function templateColumns(inputMode) {
    const mode = INPUT_MODES.includes(inputMode) ? inputMode : 'full_ledger';
    return TEMPLATE_COLUMNS[mode];
}

function csvEscape(value) {
    const s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function ymd(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const s = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function calendarDaysInMonth(month, year) {
    const m = Number(month);
    const y = Number(year);
    if (!y || !m || m < 1 || m > 12) return 0;
    return new Date(y, m, 0).getDate();
}

/**
 * Person belongs on the month's file if their employment window overlaps
 * the calendar month, and they are still marked active or left during/after it.
 */
function employeeActiveInPeriod(emp, year, month) {
    const dim = calendarDaysInMonth(month, year);
    if (!dim) return false;
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
    const doj = ymd(emp.doj);
    const lwd = ymd(emp.last_working_day);
    if (doj && doj > monthEnd) return false;
    if (lwd && lwd < monthStart) return false;
    const flag = String(emp.active == null ? 'yes' : emp.active).toLowerCase().trim();
    if (['yes', 'true', '1'].includes(flag)) return true;
    return !!(lwd && lwd >= monthStart);
}

function buildTemplateCsv(inputMode, employees) {
    const cols = templateColumns(inputMode);
    const lines = [cols.join(',')];
    for (const e of employees || []) {
        const cells = {
            employee_id: e.id || e.employee_id || '',
            name: e.name || e.employee_name || '',
        };
        lines.push(cols.map((c) => csvEscape(cells[c] ?? '')).join(','));
    }
    return `\uFEFF${lines.join('\n')}\n`;
}

function templateFilename(contractId, year, month, inputMode) {
    const mode = INPUT_MODES.includes(inputMode) ? inputMode : 'full_ledger';
    const mm = String(month).padStart(2, '0');
    const safe = String(contractId || 'contract').replace(/[^a-zA-Z0-9_-]+/g, '_');
    return `cycle_${mode}_${safe}_${year}-${mm}.csv`;
}

async function listActiveEmployeesForPeriod(pool, contractId, year, month) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!contractId || !y || !m || m < 1 || m > 12) {
        const err = new Error('Select a contract, month, and year first');
        err.status = 400;
        err.code = 'INVALID_TEMPLATE_SCOPE';
        throw err;
    }
    const { rows } = await pool.query(
        `SELECT e.id, e.name
         FROM employees e
         WHERE e.contract_id::text = $1
           AND (e.doj IS NULL OR e.doj <= (make_date($2::int, $3::int, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date)
           AND (e.last_working_day IS NULL OR e.last_working_day >= make_date($2::int, $3::int, 1))
           AND (
             COALESCE(LOWER(TRIM(e.active)), 'yes') IN ('yes', 'true', '1')
             OR e.last_working_day >= make_date($2::int, $3::int, 1)
           )
         ORDER BY e.name`,
        [String(contractId), y, m]
    );
    return rows;
}

async function buildCycleFileTemplate(pool, { contractId, year, month, inputMode }) {
    const mode = INPUT_MODES.includes(inputMode) ? inputMode : 'full_ledger';
    const employees = await listActiveEmployeesForPeriod(pool, contractId, year, month);
    return {
        filename: templateFilename(contractId, year, month, mode),
        csv: buildTemplateCsv(mode, employees),
        count: employees.length,
        input_mode: mode,
    };
}

async function matchEmployees(pool, rows, contractId) {
    const ids = rows.map((r) => r.employee_id).filter(Boolean);
    const names = rows.map((r) => r.employee_name).filter(Boolean);
    const { rows: emps } = await pool.query(
        `SELECT id, name FROM employees
         WHERE contract_id::text = $1
           AND (id = ANY($2::text[]) OR LOWER(name) = ANY($3::text[]))`,
        [contractId, ids, names.map((n) => n.toLowerCase())]
    );
    const byId = new Map(emps.map((e) => [e.id, e]));
    const byName = new Map(emps.map((e) => [e.name.toLowerCase(), e]));
    return rows.map((r) => {
        const hit = (r.employee_id && byId.get(r.employee_id))
            || (r.employee_name && byName.get(r.employee_name.toLowerCase()));
        return {
            ...r,
            employee_id: hit?.id || r.employee_id,
            employee_name: hit?.name || r.employee_name,
            matched: !!hit,
        };
    });
}

async function createDraft(pool, { contractId, month, year, inputMode, fileName, text, createdBy }) {
    const mode = INPUT_MODES.includes(inputMode) ? inputMode : 'full_ledger';
    const parsed = parseDelimited(text).map((r) => mapRow(r, mode));
    if (!parsed.length) {
        const err = new Error('No data rows found');
        err.status = 400;
        err.code = 'EMPTY_FILE';
        throw err;
    }
    const mapped = await matchEmployees(pool, parsed, contractId);
    await pool.query(
        `DELETE FROM cycle_file_imports
         WHERE contract_id = $1 AND period_month = $2 AND period_year = $3 AND status = 'draft'`,
        [contractId, month, year]
    );
    const { rows: imp } = await pool.query(
        `INSERT INTO cycle_file_imports
            (contract_id, period_month, period_year, input_mode, file_name, status, created_by)
         VALUES ($1,$2,$3,$4,$5,'draft',$6)
         RETURNING *`,
        [contractId, month, year, mode, fileName || null, createdBy || null]
    );
    const importId = imp[0].id;
    for (let i = 0; i < mapped.length; i += 1) {
        const r = mapped[i];
        await pool.query(
            `INSERT INTO cycle_file_rows
                (import_id, employee_id, employee_name, present_days, absent_days, hours, ot2_hours, ot3_hours, notes, source_line, matched)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [importId, r.employee_id, r.employee_name, r.present_days, r.absent_days, r.hours,
                r.ot2_hours, r.ot3_hours, r.notes, i + 2, r.matched]
        );
    }
    return getImport(pool, importId);
}

async function getImport(pool, importId) {
    const { rows: head } = await pool.query(`SELECT * FROM cycle_file_imports WHERE id = $1`, [importId]);
    if (!head.length) {
        const err = new Error('Import not found');
        err.status = 404;
        throw err;
    }
    const { rows } = await pool.query(
        `SELECT * FROM cycle_file_rows WHERE import_id = $1 ORDER BY id`,
        [importId]
    );
    return { import: head[0], rows };
}

async function listImports(pool, { contractId, month, year }) {
    const { rows } = await pool.query(
        `SELECT * FROM cycle_file_imports
         WHERE contract_id = $1 AND period_month = $2 AND period_year = $3
         ORDER BY id DESC`,
        [contractId, month, year]
    );
    return rows;
}

async function updateRows(pool, importId, edits) {
    const { import: head } = await getImport(pool, importId);
    if (head.status !== 'draft') {
        const err = new Error('Only draft imports can be edited');
        err.status = 409;
        err.code = 'NOT_DRAFT';
        throw err;
    }
    for (const e of edits || []) {
        await pool.query(
            `UPDATE cycle_file_rows SET
                employee_id = COALESCE($2, employee_id),
                present_days = COALESCE($3, present_days),
                absent_days = COALESCE($4, absent_days),
                hours = COALESCE($5, hours),
                ot2_hours = COALESCE($6, ot2_hours),
                ot3_hours = COALESCE($7, ot3_hours),
                notes = COALESCE($8, notes),
                matched = CASE WHEN $2 IS NOT NULL THEN TRUE ELSE matched END
             WHERE id = $1 AND import_id = $9`,
            [e.id, e.employee_id || null, e.present_days ?? null, e.absent_days ?? null,
                e.hours ?? null, e.ot2_hours ?? null, e.ot3_hours ?? null, e.notes || null, importId]
        );
    }
    return getImport(pool, importId);
}

async function submitImport(pool, importId, actor) {
    const pack = await getImport(pool, importId);
    if (pack.import.status !== 'draft') {
        const err = new Error('Already submitted');
        err.status = 409;
        throw err;
    }
    const unmatched = pack.rows.filter((r) => !r.matched || !r.employee_id);
    if (unmatched.length) {
        const err = new Error(`${unmatched.length} rows are unmatched — fix them before submit`);
        err.status = 422;
        err.code = 'UNMATCHED_ROWS';
        err.details = { unmatched: unmatched.slice(0, 30) };
        throw err;
    }
    const month = pack.import.period_month;
    const year = pack.import.period_year;
    const mode = pack.import.input_mode;
    for (const r of pack.rows) {
        let present = r.present_days;
        let absent = r.absent_days;
        if (mode === 'absent_only' && absent != null && present == null) {
            present = 30 - Number(absent);
        }
        if (mode === 'hours' && r.hours != null && present == null) {
            present = Number(r.hours) / 8;
        }
        await pool.query(
            `INSERT INTO monthly_attendance_overrides
                (employee_id, period_month, period_year, present_days, ot2_hours, ot3_hours, source)
             VALUES ($1,$2,$3,$4,$5,$6,'cycle_machine_file')
             ON CONFLICT (employee_id, period_month, period_year) DO UPDATE SET
                present_days = COALESCE(EXCLUDED.present_days, monthly_attendance_overrides.present_days),
                ot2_hours = COALESCE(EXCLUDED.ot2_hours, monthly_attendance_overrides.ot2_hours),
                ot3_hours = COALESCE(EXCLUDED.ot3_hours, monthly_attendance_overrides.ot3_hours),
                source = 'cycle_machine_file'`,
            [r.employee_id, month, year, present, r.ot2_hours, r.ot3_hours]
        ).catch(async () => {
            await pool.query(
                `INSERT INTO monthly_attendance_overrides
                    (employee_id, period_month, period_year, present_days, ot2_hours, ot3_hours)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (employee_id, period_month, period_year) DO UPDATE SET
                    present_days = COALESCE(EXCLUDED.present_days, monthly_attendance_overrides.present_days),
                    ot2_hours = COALESCE(EXCLUDED.ot2_hours, monthly_attendance_overrides.ot2_hours),
                    ot3_hours = COALESCE(EXCLUDED.ot3_hours, monthly_attendance_overrides.ot3_hours)`,
                [r.employee_id, month, year, present, r.ot2_hours, r.ot3_hours]
            );
        });
    }
    await pool.query(
        `UPDATE cycle_file_imports SET status = 'submitted', submitted_at = NOW() WHERE id = $1`,
        [importId]
    );
    return getImport(pool, importId);
}

module.exports = {
    INPUT_MODES,
    TEMPLATE_COLUMNS,
    parseDelimited,
    mapRow,
    templateColumns,
    buildTemplateCsv,
    templateFilename,
    employeeActiveInPeriod,
    listActiveEmployeesForPeriod,
    buildCycleFileTemplate,
    createDraft,
    getImport,
    listImports,
    updateRows,
    submitImport,
};
