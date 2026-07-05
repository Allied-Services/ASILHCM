'use strict';

async function backfillProjectsFromEmployees(pool) {
    const { rows } = await pool.query(`
        SELECT DISTINCT e.contract_id, c.client_id, COALESCE(NULLIF(TRIM(e.site), ''), NULLIF(TRIM(e.location), ''), 'Default Site') AS site_name,
               e.province
        FROM employees e
        JOIN contracts c ON c.id = e.contract_id
        WHERE e.contract_id IS NOT NULL AND e.active = true
    `);

    let created = 0;
    for (const row of rows) {
        const id = `PRJ-${row.contract_id}-${String(row.site_name).replace(/\W+/g, '_').slice(0, 40)}`;
        const { rowCount } = await pool.query(
            `INSERT INTO projects (id, contract_id, client_id, name, province, status)
             VALUES ($1, $2, $3, $4, $5, 'active')
             ON CONFLICT (id) DO NOTHING`,
            [id, row.contract_id, row.client_id, row.site_name, row.province]
        );
        if (rowCount) created += 1;

        await pool.query(
            `UPDATE employees SET project_id = $1
             WHERE contract_id = $2 AND active = true
               AND (site = $3 OR location = $3 OR ($3 = 'Default Site' AND (site IS NULL OR site = '')))`,
            [id, row.contract_id, row.site_name]
        );
    }
    return { scanned: rows.length, created };
}

async function listProjects(pool, { contractId, clientId } = {}) {
    let sql = `SELECT p.*, c.contract_name, cl.name AS client_name FROM projects p
               JOIN contracts c ON c.id = p.contract_id
               JOIN clients cl ON cl.id = p.client_id WHERE 1=1`;
    const params = [];
    if (contractId) { params.push(contractId); sql += ` AND p.contract_id = $${params.length}`; }
    if (clientId) { params.push(clientId); sql += ` AND p.client_id = $${params.length}`; }
    sql += ' ORDER BY p.name';
    const { rows } = await pool.query(sql, params);
    return rows;
}

module.exports = { backfillProjectsFromEmployees, listProjects };
