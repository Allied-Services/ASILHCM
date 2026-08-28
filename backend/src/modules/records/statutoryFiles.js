'use strict';

const { readPayrollSnapshot } = require('../../payroll/snapshotView');

function csvEscape(v) {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

async function loadLockedSnapshots(pool, year, month, contractId) {
    const params = [year, month];
    let extra = '';
    if (contractId) {
        params.push(contractId);
        extra = ' AND e.contract_id::text = $3';
    }
    const { rows } = await pool.query(
        `SELECT pt.*, e.name, e.cnic, e.contract_id
         FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE pt.year = $1 AND pt.month = $2 AND pt.locked = TRUE ${extra}
         ORDER BY e.name`,
        params
    );
    return rows.map((r) => {
        let snap = {};
        try {
            snap = readPayrollSnapshot(r) || r.computed_json || {};
        } catch {
            snap = r.computed_json || {};
        }
        return { row: r, snap: snap && typeof snap === 'object' ? snap : {} };
    });
}

function buildCsv(headers, lines) {
    return [headers.join(','), ...lines.map((l) => l.map(csvEscape).join(','))].join('\n');
}

async function statutoryFilesFromSnapshot(pool, { year, month, contractId }) {
    const rows = await loadLockedSnapshots(pool, year, month, contractId);
    const wht = buildCsv(
        ['employee_id', 'name', 'cnic', 'wht'],
        rows.map(({ row, snap }) => [row.employee_id, row.name, row.cnic, snap.wht != null ? snap.wht : row.wht])
    );
    const eobi = buildCsv(
        ['employee_id', 'name', 'cnic', 'eobi'],
        rows.map(({ row, snap }) => [row.employee_id, row.name, row.cnic, snap.eobiEmployee != null ? snap.eobiEmployee : row.eobi_ee])
    );
    const sessi = buildCsv(
        ['employee_id', 'name', 'cnic', 'sessi'],
        rows.map(({ row, snap }) => [row.employee_id, row.name, row.cnic, snap.sessiEmployee != null ? snap.sessiEmployee : 0])
    );
    return {
        year,
        month,
        contract_id: contractId || null,
        files: {
            wht: { filename: `wht_${year}_${month}.csv`, csv: wht },
            eobi: { filename: `eobi_${year}_${month}.csv`, csv: eobi },
            sessi: { filename: `sessi_${year}_${month}.csv`, csv: sessi },
        },
    };
}

module.exports = { statutoryFilesFromSnapshot };
