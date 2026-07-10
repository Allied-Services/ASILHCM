'use strict';

async function upsertProjectClientFocals(pool, data) {
    const emails = (data.focal_emails || data.focalEmails || [])
        .map(e => String(e).trim().toLowerCase())
        .filter(e => e && e.includes('@'));
    const supervisor = (data.supervisor_email || data.supervisorEmail || '').trim().toLowerCase() || null;
    const site = data.site || null;
    const client = data.client || null;
    const contractId = data.contract_id || data.contractId || null;
    const department = data.department || data.dept || null;
    const projectId = data.project_id || data.projectId || site || null;

    // Prefer update by supervisor+site+contract if exists
    const { rows: existing } = await pool.query(
        `SELECT id FROM project_client_focals
         WHERE COALESCE(supervisor_email,'') = COALESCE($1,'')
           AND COALESCE(site,'') = COALESCE($2,'')
           AND COALESCE(contract_id,'') = COALESCE($3,'')
         LIMIT 1`,
        [supervisor, site, contractId]
    );

    if (existing.length) {
        const { rows } = await pool.query(
            `UPDATE project_client_focals SET
                focal_emails = $1, project_id = $2, department = $3, client = $4,
                active = true, updated_at = NOW()
             WHERE id = $5 RETURNING *`,
            [emails, projectId, department, client, existing[0].id]
        );
        return rows[0];
    }

    const { rows } = await pool.query(
        `INSERT INTO project_client_focals
            (project_id, site, department, client, contract_id, focal_emails, supervisor_email, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true) RETURNING *`,
        [projectId, site, department, client, contractId, emails, supervisor]
    );
    return rows[0];
}

async function listProjectClientFocals(pool, { supervisorEmail, site, contractId } = {}) {
    const params = [];
    let sql = `SELECT * FROM project_client_focals WHERE active = true`;
    if (supervisorEmail) {
        params.push(supervisorEmail.toLowerCase());
        sql += ` AND LOWER(supervisor_email) = $${params.length}`;
    }
    if (site) {
        params.push(site);
        sql += ` AND site = $${params.length}`;
    }
    if (contractId) {
        params.push(contractId);
        sql += ` AND contract_id = $${params.length}`;
    }
    sql += ` ORDER BY updated_at DESC`;
    const { rows } = await pool.query(sql, params);
    return rows;
}

/**
 * Resolve client focal emails for an employee leave request.
 * Priority: project_client_focals (site/contract/dept) → contracts.client_focal_email
 */
async function resolveClientFocalEmails(pool, { employeeId, contractId, site, department }) {
    const emails = new Set();

    const { rows: emp } = await pool.query(
        `SELECT id, contract_id, location, site, dept, bu, client FROM employees WHERE id = $1`,
        [employeeId]
    );
    const e = emp[0] || {};
    const cid = contractId || e.contract_id;
    const siteKey = site || e.location || e.site;
    const dept = department || e.dept || e.bu;

    const { rows: focals } = await pool.query(
        `SELECT focal_emails FROM project_client_focals
         WHERE active = true
           AND (
             (contract_id IS NOT NULL AND contract_id = $1)
             OR (site IS NOT NULL AND site = $2)
             OR (department IS NOT NULL AND department = $3)
           )
         ORDER BY
           CASE WHEN contract_id = $1 THEN 0 ELSE 1 END,
           CASE WHEN site = $2 THEN 0 ELSE 1 END,
           updated_at DESC
         LIMIT 5`,
        [cid || null, siteKey || null, dept || null]
    );
    for (const f of focals) {
        for (const em of f.focal_emails || []) {
            if (em && em.includes('@')) emails.add(String(em).toLowerCase());
        }
    }

    if (!emails.size && cid) {
        const { rows: cRows } = await pool.query(
            `SELECT client_focal_email FROM contracts WHERE id = $1`,
            [cid]
        );
        const legacy = cRows[0]?.client_focal_email;
        if (legacy) emails.add(String(legacy).toLowerCase());
    }

    return [...emails];
}

module.exports = {
    upsertProjectClientFocals,
    listProjectClientFocals,
    resolveClientFocalEmails,
};
