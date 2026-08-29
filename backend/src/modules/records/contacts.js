'use strict';

const CONTACT_ROLES = [
    'client_commercial',
    'client_focal',
    'line_manager',
    'site_supervisor',
    'asil_site_supervisor',
    'asil_contract_focal',
    'dedicated_payroll',
];

function isEmail(v) {
    const s = String(v || '').trim().toLowerCase();
    return s.includes('@') && s !== 'n/a';
}

async function listContacts(pool, q = {}) {
    const params = [];
    const where = ['is_active = TRUE'];
    if (q.client_id) {
        params.push(q.client_id);
        where.push(`client_id = $${params.length}`);
    }
    if (q.contract_id) {
        params.push(q.contract_id);
        where.push(`(contract_id = $${params.length} OR contract_id IS NULL)`);
    }
    if (q.role) {
        params.push(q.role);
        where.push(`role = $${params.length}`);
    }
    if (q.location_id) {
        params.push(Number(q.location_id));
        where.push(`location_id = $${params.length}`);
    }
    const { rows } = await pool.query(
        `SELECT * FROM org_contacts WHERE ${where.join(' AND ')}
         ORDER BY role, name, email`,
        params
    );
    return rows;
}

async function upsertContact(pool, body) {
    const email = String(body.email || '').trim().toLowerCase();
    const role = String(body.role || '').trim();
    if (!isEmail(email) || !CONTACT_ROLES.includes(role)) {
        const err = new Error('Valid email and role are required');
        err.status = 400;
        err.code = 'INVALID_CONTACT';
        throw err;
    }
    const { rows } = await pool.query(
        `INSERT INTO org_contacts
            (name, email, phone, role, client_id, contract_id, bu_id, location_id, employee_id, notes, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)
         RETURNING *`,
        [
            body.name || null, email, body.phone || null, role,
            body.client_id || null, body.contract_id || null, body.bu_id || null,
            body.location_id || null, body.employee_id || null, body.notes || null,
        ]
    );
    return rows[0];
}

async function updateContact(pool, id, body) {
    const { rows } = await pool.query(
        `UPDATE org_contacts SET
            name = COALESCE($2, name),
            email = COALESCE($3, email),
            phone = COALESCE($4, phone),
            role = COALESCE($5, role),
            client_id = COALESCE($6, client_id),
            contract_id = COALESCE($7, contract_id),
            bu_id = COALESCE($8, bu_id),
            location_id = COALESCE($9, location_id),
            is_active = COALESCE($10, is_active),
            notes = COALESCE($11, notes),
            updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [
            id, body.name || null, body.email ? String(body.email).toLowerCase() : null,
            body.phone || null, body.role || null, body.client_id || null,
            body.contract_id || null, body.bu_id ?? null, body.location_id ?? null,
            typeof body.is_active === 'boolean' ? body.is_active : null,
            body.notes || null,
        ]
    );
    if (!rows.length) {
        const err = new Error('Contact not found');
        err.status = 404;
        throw err;
    }
    return rows[0];
}

async function seedContactsFromExisting(pool) {
    const { rows: contracts } = await pool.query(
        `SELECT id, client_id, allied_focal_email, client_focal_email, client_focal_name,
                dedicated_payroll_resource_email
         FROM contracts`
    );
    let inserted = 0;
    for (const c of contracts) {
        const pairs = [
            [c.allied_focal_email, 'asil_contract_focal', c.allied_focal_email],
            [c.dedicated_payroll_resource_email || c.allied_focal_email, 'dedicated_payroll', c.dedicated_payroll_resource_email],
            [c.client_focal_email, 'client_focal', c.client_focal_name],
        ];
        for (const [email, role, name] of pairs) {
            if (!isEmail(email)) continue;
            const { rowCount } = await pool.query(
                `INSERT INTO org_contacts (name, email, role, client_id, contract_id)
                 SELECT $1, $2, $3, $4, $5
                 WHERE NOT EXISTS (
                    SELECT 1 FROM org_contacts
                    WHERE LOWER(email) = LOWER($2) AND role = $3
                      AND contract_id IS NOT DISTINCT FROM $5
                 )`,
                [name || email, String(email).toLowerCase(), role, c.client_id, c.id]
            );
            inserted += rowCount || 0;
        }
    }

    const { rowCount: focals } = await pool.query(
        `INSERT INTO org_contacts (name, email, role, contract_id, employee_id)
         SELECT DISTINCT ON (LOWER(e.claim_authority), e.contract_id)
            e.claim_authority, LOWER(e.claim_authority), 'client_focal', e.contract_id, e.id
         FROM employees e
         WHERE LOWER(TRIM(COALESCE(e.active::text,''))) IN ('','yes','true','1','active')
           AND e.claim_authority ILIKE '%@%'
           AND LOWER(e.claim_authority) NOT IN ('self','n/a','na','none')
           AND NOT EXISTS (
             SELECT 1 FROM org_contacts oc
             WHERE LOWER(oc.email) = LOWER(e.claim_authority) AND oc.role = 'client_focal'
               AND oc.contract_id IS NOT DISTINCT FROM e.contract_id
           )`
    );
    const { rowCount: lms } = await pool.query(
        `INSERT INTO org_contacts (name, email, role, contract_id, employee_id)
         SELECT DISTINCT ON (LOWER(e.line_manager_email), e.contract_id)
            COALESCE(NULLIF(e.line_manager_name,''), e.line_manager_email),
            LOWER(e.line_manager_email), 'line_manager', e.contract_id, e.id
         FROM employees e
         WHERE LOWER(TRIM(COALESCE(e.active::text,''))) IN ('','yes','true','1','active')
           AND e.line_manager_email ILIKE '%@%'
           AND NOT EXISTS (
             SELECT 1 FROM org_contacts oc
             WHERE LOWER(oc.email) = LOWER(e.line_manager_email) AND oc.role = 'line_manager'
               AND oc.contract_id IS NOT DISTINCT FROM e.contract_id
           )`
    );
    const { rowCount: supers } = await pool.query(
        `INSERT INTO org_contacts (name, email, role, contract_id, employee_id)
         SELECT DISTINCT ON (LOWER(e.supervisor_email), e.contract_id)
            e.supervisor_email, LOWER(e.supervisor_email), 'site_supervisor', e.contract_id, e.id
         FROM employees e
         WHERE LOWER(TRIM(COALESCE(e.active::text,''))) IN ('','yes','true','1','active')
           AND e.supervisor_email ILIKE '%@%'
           AND NOT EXISTS (
             SELECT 1 FROM org_contacts oc
             WHERE LOWER(oc.email) = LOWER(e.supervisor_email) AND oc.role = 'site_supervisor'
               AND oc.contract_id IS NOT DISTINCT FROM e.contract_id
           )`
    );
    inserted += (focals || 0) + (lms || 0) + (supers || 0);
    return { inserted };
}

async function resolveAsilSupervisor(pool, emp) {
    const contractId = emp.contract_id || emp.contractId;
    const location = emp.location || emp.site;
    if (contractId) {
        const { rows } = await pool.query(
            `SELECT oc.email FROM org_contacts oc
             LEFT JOIN client_locations loc ON loc.id = oc.location_id
             WHERE oc.role = 'asil_site_supervisor' AND oc.is_active = TRUE
               AND oc.contract_id = $1
               AND ($2::text IS NULL OR loc.name IS NULL OR LOWER(loc.name) = LOWER($2))
             ORDER BY loc.id NULLS LAST
             LIMIT 1`,
            [contractId, location || null]
        );
        if (rows[0]?.email) return String(rows[0].email).toLowerCase();
    }
    return null;
}

async function listRegions(pool) {
    const { rows } = await pool.query(
        `SELECT * FROM region_compliance
         WHERE effective_to IS NULL OR effective_to >= CURRENT_DATE
         ORDER BY region, effective_from DESC`
    );
    return rows;
}

async function upsertRegion(pool, body) {
    const region = String(body.region || '').trim().toLowerCase();
    const rate = Number(body.sales_tax_rate);
    if (!region || !Number.isFinite(rate)) {
        const err = new Error('region and sales_tax_rate required');
        err.status = 400;
        throw err;
    }
    const { rows } = await pool.query(
        `INSERT INTO region_compliance (region, effective_from, min_wage, sales_tax_rate, sessi_scheme, eobi_flat, notes)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7)
         ON CONFLICT (region, effective_from) DO UPDATE SET
            min_wage = EXCLUDED.min_wage,
            sales_tax_rate = EXCLUDED.sales_tax_rate,
            sessi_scheme = EXCLUDED.sessi_scheme,
            eobi_flat = EXCLUDED.eobi_flat,
            notes = EXCLUDED.notes
         RETURNING *`,
        [
            region, body.effective_from || null, body.min_wage || null, rate,
            body.sessi_scheme || 'sessi', body.eobi_flat != null ? body.eobi_flat : 400,
            body.notes || null,
        ]
    );
    return rows[0];
}

async function complianceForRegion(pool, region, asOf = new Date()) {
    const key = String(region || '').trim().toLowerCase();
    if (!key) return null;
    const { rows } = await pool.query(
        `SELECT * FROM region_compliance
         WHERE region = $1 AND effective_from <= $2::date
           AND (effective_to IS NULL OR effective_to >= $2::date)
         ORDER BY effective_from DESC LIMIT 1`,
        [key, asOf.toISOString().slice(0, 10)]
    );
    return rows[0] || null;
}

module.exports = {
    CONTACT_ROLES,
    listContacts,
    upsertContact,
    updateContact,
    seedContactsFromExisting,
    resolveAsilSupervisor,
    listRegions,
    upsertRegion,
    complianceForRegion,
};
