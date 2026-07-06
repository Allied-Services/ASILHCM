'use strict';

const { parse } = require('csv-parse/sync');
const { formatDate } = require('../../core/dates');

async function getParserProfiles(pool, { contractId, clientId } = {}) {
    let sql = `SELECT * FROM attendance_parser_profiles WHERE active = true`;
    const params = [];
    if (contractId) { params.push(contractId); sql += ` AND contract_id = $${params.length}`; }
    if (clientId) { params.push(clientId); sql += ` AND client_id = $${params.length}`; }
    sql += ` ORDER BY name`;
    const { rows } = await pool.query(sql, params);
    return rows;
}

function normalizeStatus(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (['p', 'present', '1', 'yes'].includes(s)) return 'present';
    if (['a', 'absent', '0', 'no'].includes(s)) return 'absent';
    if (['u', 'unexcused'].includes(s)) return 'unexcused';
    if (['l', 'leave'].includes(s)) return 'leave';
    if (['h', 'half', 'half_day', '½'].includes(s)) return 'half_day';
    if (['ot', 'overtime'].includes(s)) return 'ot';
    return 'present';
}

async function resolveEmployeeId(pool, identifier, strategy = 'exact_id') {
    if (!identifier) return null;
    const id = String(identifier).trim();
    if (strategy === 'exact_id') {
        const { rows } = await pool.query(`SELECT id FROM employees WHERE id = $1 LIMIT 1`, [id]);
        return rows[0]?.id || null;
    }
    const { rows } = await pool.query(
        `SELECT id FROM employees WHERE id = $1 OR LOWER(name) = LOWER($1)
         OR similarity(name, $1) > 0.4 ORDER BY similarity(name, $1) DESC LIMIT 1`,
        [id]
    );
    return rows[0]?.id || null;
}

async function upsertAttendance(pool, { employeeId, date, status, projectId, markedBy = 'intake-hub' }) {
    await pool.query(
        `INSERT INTO attendance_records (employee_id, date, status, marked_by, site, project_id, updated_at)
         VALUES ($1, $2::date, $3, $4, $5, $5, NOW())
         ON CONFLICT (employee_id, date) DO UPDATE SET
           status = EXCLUDED.status,
           site = COALESCE(EXCLUDED.site, attendance_records.site),
           project_id = COALESCE(EXCLUDED.project_id, attendance_records.project_id),
           marked_by = EXCLUDED.marked_by,
           updated_at = NOW()`,
        [employeeId, date, status, markedBy, projectId || null]
    );
}

async function parseCsvAttendance(pool, { csvText, profile, projectId, periodMonth, periodYear }) {
    const map = profile?.column_map || {};
    const idCol = map.employee_id || map.id || 'employee_id';
    const dateCol = map.date || 'date';
    const statusCol = map.status || 'status';
    const strategy = profile?.employee_match_strategy || 'exact_id';
    const inputMode = profile?.input_mode || 'full_ledger';

    const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
    const parsed = [];
    const errors = [];

    for (const row of records) {
        const empKey = row[idCol] || row.employee_id || row['Employee ID'] || row.Name;
        const employeeId = await resolveEmployeeId(pool, empKey, strategy);
        if (!employeeId) {
            errors.push({ row, error: `Employee not matched: ${empKey}` });
            continue;
        }
        const dateVal = row[dateCol] || row.date || `${periodYear}-${String(periodMonth).padStart(2, '0')}-01`;
        const status = normalizeStatus(row[statusCol] || row.status);
        parsed.push({ employeeId, date: dateVal, status });
    }

    if (inputMode === 'absent_only') {
        for (const p of parsed) {
            if (p.status === 'absent' || p.status === 'unexcused') {
                await upsertAttendance(pool, { ...p, projectId, markedBy: 'csv_absent_only' });
            }
        }
    } else if (inputMode === 'present_only') {
        for (const p of parsed) {
            if (p.status === 'present' || p.status === 'ot') {
                await upsertAttendance(pool, { ...p, projectId, markedBy: 'csv_present_only' });
            }
        }
    } else {
        for (const p of parsed) {
            await upsertAttendance(pool, { ...p, projectId, markedBy: 'csv_full' });
        }
    }

    return { parsed: parsed.length, errors };
}

async function manualBulkEntry(pool, { contractId, projectId, records, inputMode = 'full_ledger' }) {
    let inserted = 0;
    const { rows: employees } = await pool.query(
        `SELECT id FROM employees WHERE contract_id = $1 OR site = $2`,
        [contractId, projectId]
    );
    const rosterIds = new Set(employees.map(e => e.id));
    const recordMap = Object.fromEntries((records || []).map(r => [r.employee_id, r]));

    if (inputMode === 'absent_only' || inputMode === 'present_only') {
        for (const empId of rosterIds) {
            const rec = recordMap[empId];
            const date = rec?.date || formatDate();
            if (inputMode === 'absent_only') {
                const status = rec ? normalizeStatus(rec.status) : 'present';
                await upsertAttendance(pool, { employeeId: empId, date, status, projectId, markedBy: 'manual_absent_only' });
                inserted++;
            } else {
                const status = rec ? normalizeStatus(rec.status) : 'absent';
                await upsertAttendance(pool, { employeeId: empId, date, status, projectId, markedBy: 'manual_present_only' });
                inserted++;
            }
        }
    } else {
        for (const rec of records || []) {
            await upsertAttendance(pool, {
                employeeId: rec.employee_id,
                date: rec.date || formatDate(),
                status: normalizeStatus(rec.status),
                projectId,
                markedBy: 'manual_full',
            });
            inserted++;
        }
    }
    return { inserted, rosterSize: rosterIds.size };
}

async function getAlertRules(pool) {
    const { rows } = await pool.query(
        `SELECT ar.*, p.name AS project_name FROM attendance_alert_rules ar
         LEFT JOIN projects p ON p.id = ar.project_id ORDER BY ar.id`
    );
    return rows;
}

async function saveAlertRule(pool, data) {
    if (data.id) {
        const { rows } = await pool.query(
            `UPDATE attendance_alert_rules SET project_id=$1, rule_type=$2, threshold=$3, recipients=$4, channels=$5, active=$6 WHERE id=$7 RETURNING *`,
            [data.project_id, data.rule_type, data.threshold, JSON.stringify(data.recipients || []), JSON.stringify(data.channels || ['email']), data.active !== false, data.id]
        );
        return rows[0];
    }
    const { rows } = await pool.query(
        `INSERT INTO attendance_alert_rules (project_id, rule_type, threshold, recipients, channels, active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [data.project_id, data.rule_type || 'unexcused_leave', data.threshold, JSON.stringify(data.recipients || []), JSON.stringify(data.channels || ['email']), data.active !== false]
    );
    return rows[0];
}

async function runAlertCheck(pool, { sendAppEmail, sendJazzSMS } = {}) {
    const today = formatDate();
    const { rows: rules } = await pool.query(`SELECT * FROM attendance_alert_rules WHERE active = true`);
    const sent = [];

    for (const rule of rules) {
        if (rule.rule_type !== 'unexcused_leave') continue;
        const { rows: hits } = await pool.query(
            `SELECT ar.employee_id, e.name, e.phone, ar.date
             FROM attendance_records ar
             JOIN employees e ON e.id = ar.employee_id
             WHERE (ar.project_id = $1 OR ar.site = $1) AND ar.date = $2::date AND ar.status IN ('unexcused','absent')`,
            [rule.project_id, today]
        );
        for (const hit of hits) {
            const recipients = rule.recipients || [];
            const channels = rule.channels || ['email'];
            for (const ch of channels) {
                if (ch === 'email' && sendAppEmail && recipients.length) {
                    await sendAppEmail({
                        to: recipients.join(','),
                        subject: `[FM Alert] Unexcused absence — ${hit.name}`,
                        html: `<p>${hit.name} (${hit.employee_id}) marked absent/unexcused on ${today} at project ${rule.project_id}.</p>`,
                    }).catch(() => {});
                }
                if (ch === 'sms' && sendJazzSMS && hit.phone) {
                    await sendJazzSMS(hit.phone, `FM Alert: ${hit.name} absent ${today}`).catch(() => {});
                }
                await pool.query(
                    `INSERT INTO attendance_alerts_log (rule_id, employee_id, project_id, alert_date, channel) VALUES ($1,$2,$3,$4::date,$5)`,
                    [rule.id, hit.employee_id, rule.project_id, today, ch]
                );
                sent.push({ employeeId: hit.employee_id, channel: ch });
            }
        }
    }
    return { alertsSent: sent.length, details: sent };
}

module.exports = {
    getParserProfiles,
    parseCsvAttendance,
    manualBulkEntry,
    getAlertRules,
    saveAlertRule,
    runAlertCheck,
};
