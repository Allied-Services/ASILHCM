'use strict';

async function purgeContract(pool, { contract_id, client_id }, { confirm = false } = {}) {
    const { rows: emps } = await pool.query('SELECT id, name FROM employees WHERE contract_id = $1', [contract_id]);
    const empIds = emps.map(r => r.id);

    if (!confirm) {
        const { rows: c } = await pool.query('SELECT id, contract_name FROM contracts WHERE id = $1', [contract_id]);
        return {
            preview: { contract: c[0] || null, employees: emps },
            message: 'Add ?confirm=yes to actually delete',
        };
    }

    const results = {};
    const del = async (label, sql, params) => {
        try {
            const r = await pool.query(sql, params);
            results[label] = r.rowCount;
        } catch (e) {
            results[label] = 'error: ' + e.message;
        }
    };

    await del('claims', `DELETE FROM employee_claims WHERE contract_id = $1 OR employee_id = ANY($2::text[])`, [contract_id, empIds]);
    await del('cost_allocations', `DELETE FROM cost_allocations WHERE contract_id = $1`, [contract_id]);
    await del('run_rows', `DELETE FROM payroll_run_rows WHERE run_id IN (SELECT id FROM payroll_runs WHERE contract_id = $1)`, [contract_id]);
    await del('runs', `DELETE FROM payroll_runs WHERE contract_id = $1`, [contract_id]);
    await del('invoices', `DELETE FROM client_invoices WHERE contract_id = $1`, [contract_id]);
    await del('rate_cards', `DELETE FROM contract_rate_cards WHERE contract_id = $1`, [contract_id]);
    await del('policies', `DELETE FROM contract_policies WHERE contract_id = $1`, [contract_id]);
    if (empIds.length) await del('attendance', `DELETE FROM attendance_records WHERE employee_id = ANY($1::text[])`, [empIds]);
    await del('employees', `DELETE FROM employees WHERE contract_id = $1`, [contract_id]);
    await del('contract', `DELETE FROM contracts WHERE id = $1`, [contract_id]);
    if (client_id) await del('client', `DELETE FROM clients WHERE id = $1`, [client_id]);

    return { ok: true, results };
}

module.exports = { purgeContract };
