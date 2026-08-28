'use strict';

const ASIL_BUS = [
    'Outsourcing',
    'Facilities Management',
    'Employee of Record',
];

function normalizeAsilBu(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (ASIL_BUS.includes(s)) return s;
    const lc = s.toLowerCase();
    if (lc === 'bpo' || lc === 'wafibpo' || lc.includes('outsourc')) return 'Outsourcing';
    if (lc === 'fm' || lc.includes('facilit')) return 'Facilities Management';
    if (lc.includes('eor') || lc.includes('employee of record')) return 'Employee of Record';
    return s;
}

/**
 * Ensure location / department masters exist for clients.
 * Called once from server boot and via admin sync.
 */
async function ensureOrgMasterTables(pool) {
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS asil_bu TEXT`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS client_locations (
            id SERIAL PRIMARY KEY,
            client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL,
            name VARCHAR(200) NOT NULL,
            province VARCHAR(100),
            region VARCHAR(40),
            is_active BOOLEAN DEFAULT TRUE,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(client_id, name)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS client_departments (
            id SERIAL PRIMARY KEY,
            client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            bu_id INTEGER REFERENCES client_business_units(id) ON DELETE SET NULL,
            location_id INTEGER REFERENCES client_locations(id) ON DELETE SET NULL,
            name VARCHAR(200) NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(client_id, name)
        )
    `);
    await pool.query(`ALTER TABLE client_locations ADD COLUMN IF NOT EXISTS region VARCHAR(40)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_locations_client ON client_locations(client_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_client_departments_client ON client_departments(client_id)`);
}

/** Seed locations from contract.location and employee.location when masters empty. */
async function seedClientOrgFromExisting(pool, clientId) {
    await ensureOrgMasterTables(pool);
    const { rows: locs } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM client_locations WHERE client_id=$1`,
        [clientId]
    );
    if (locs[0].c === 0) {
        await pool.query(
            `INSERT INTO client_locations (client_id, contract_id, name, is_active)
             SELECT DISTINCT ON (LOWER(TRIM(c.location))) c.client_id, c.id, TRIM(c.location), TRUE
             FROM contracts c
             WHERE c.client_id=$1 AND c.location IS NOT NULL AND TRIM(c.location) <> ''
             ON CONFLICT (client_id, name) DO NOTHING`,
            [clientId]
        );
        await pool.query(
            `INSERT INTO client_locations (client_id, name, is_active)
             SELECT DISTINCT ON (LOWER(TRIM(e.location))) $1, TRIM(e.location), TRUE
             FROM employees e
             WHERE LOWER(TRIM(e.client)) = LOWER((SELECT name FROM clients WHERE id=$1))
               AND e.location IS NOT NULL AND TRIM(e.location) <> ''
             ON CONFLICT (client_id, name) DO NOTHING`,
            [clientId]
        );
    }
    const { rows: deps } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM client_departments WHERE client_id=$1`,
        [clientId]
    );
    if (deps[0].c === 0) {
        await pool.query(
            `INSERT INTO client_departments (client_id, name, is_active)
             SELECT DISTINCT ON (LOWER(TRIM(e.dept))) $1, TRIM(e.dept), TRUE
             FROM employees e
             WHERE LOWER(TRIM(e.client)) = LOWER((SELECT name FROM clients WHERE id=$1))
               AND e.dept IS NOT NULL AND TRIM(e.dept) <> ''
             ON CONFLICT (client_id, name) DO NOTHING`,
            [clientId]
        );
    }
}

function registerOrgMasterRoutes(app, { pool, requireAuth, requireRole }) {
    ensureOrgMasterTables(pool).catch(() => {});

    app.get('/api/org/asil-bus', requireAuth, (_req, res) => {
        res.json({ asilBus: ASIL_BUS });
    });

    // ── Locations ────────────────────────────────────────────────────────────
    app.get('/api/clients/:id/locations', requireAuth, async (req, res) => {
        try {
            await ensureOrgMasterTables(pool);
            await seedClientOrgFromExisting(pool, req.params.id);
            const { rows } = await pool.query(
                `SELECT * FROM client_locations WHERE client_id=$1
                 AND ($2::text IS NULL OR contract_id IS NULL OR contract_id=$2)
                 ORDER BY sort_order, name`,
                [req.params.id, req.query.contract_id || null]
            );
            res.json({ locations: rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/clients/:id/locations', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'operations', 'hr_manager'), async (req, res) => {
        try {
            await ensureOrgMasterTables(pool);
            const { name, province, region, contract_id, sort_order } = req.body || {};
            if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
            const { rows } = await pool.query(
                `INSERT INTO client_locations (client_id, contract_id, name, province, region, sort_order)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (client_id, name) DO UPDATE SET
                   province=COALESCE(EXCLUDED.province, client_locations.province),
                   region=COALESCE(EXCLUDED.region, client_locations.region),
                   contract_id=COALESCE(EXCLUDED.contract_id, client_locations.contract_id),
                   is_active=TRUE
                 RETURNING *`,
                [req.params.id, contract_id || null, String(name).trim(), province || null, region || null, sort_order || 0]
            );
            res.json({ location: rows[0] });
        } catch (err) {
            console.error('[POST /api/clients/:id/locations]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.put('/api/clients/:id/locations/:locId', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'operations', 'hr_manager'), async (req, res) => {
        try {
            const { name, province, region, is_active, contract_id, sort_order } = req.body || {};
            const { rows } = await pool.query(
                `UPDATE client_locations SET
                   name=COALESCE($1,name), province=COALESCE($2,province),
                   region=COALESCE($3,region),
                   is_active=COALESCE($4,is_active), contract_id=COALESCE($5,contract_id),
                   sort_order=COALESCE($6,sort_order)
                 WHERE id=$7 AND client_id=$8 RETURNING *`,
                [name || null, province || null, region || null, typeof is_active === 'boolean' ? is_active : null,
                    contract_id === undefined ? null : contract_id, sort_order ?? null, req.params.locId, req.params.id]
            );
            if (!rows.length) return res.status(404).json({ error: 'Not found' });
            res.json({ location: rows[0] });
        } catch (err) {
            console.error('[PUT /api/clients/:id/locations/:locId]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.delete('/api/clients/:id/locations/:locId', requireAuth, requireRole('superadmin', 'finance_manager', 'hr_manager'), async (req, res) => {
        try {
            await pool.query('DELETE FROM client_locations WHERE id=$1 AND client_id=$2', [req.params.locId, req.params.id]);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Departments ──────────────────────────────────────────────────────────
    app.get('/api/clients/:id/departments', requireAuth, async (req, res) => {
        try {
            await ensureOrgMasterTables(pool);
            await seedClientOrgFromExisting(pool, req.params.id);
            const buId = req.query.bu_id ? parseInt(req.query.bu_id, 10) : null;
            const locId = req.query.location_id ? parseInt(req.query.location_id, 10) : null;
            const { rows } = await pool.query(
                `SELECT * FROM client_departments WHERE client_id=$1
                 AND ($2::int IS NULL OR bu_id IS NULL OR bu_id=$2)
                 AND ($3::int IS NULL OR location_id IS NULL OR location_id=$3)
                 ORDER BY sort_order, name`,
                [req.params.id, Number.isFinite(buId) ? buId : null, Number.isFinite(locId) ? locId : null]
            );
            res.json({ departments: rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/clients/:id/departments', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'operations', 'hr_manager'), async (req, res) => {
        try {
            await ensureOrgMasterTables(pool);
            const { name, bu_id, location_id, sort_order } = req.body || {};
            if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
            const { rows } = await pool.query(
                `INSERT INTO client_departments (client_id, bu_id, location_id, name, sort_order)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (client_id, name) DO UPDATE SET
                   bu_id=COALESCE(EXCLUDED.bu_id, client_departments.bu_id),
                   location_id=COALESCE(EXCLUDED.location_id, client_departments.location_id),
                   is_active=TRUE
                 RETURNING *`,
                [req.params.id, bu_id || null, location_id || null, String(name).trim(), sort_order || 0]
            );
            res.json({ department: rows[0] });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.put('/api/clients/:id/departments/:deptId', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'operations', 'hr_manager'), async (req, res) => {
        try {
            const { name, bu_id, location_id, is_active, sort_order } = req.body || {};
            const { rows } = await pool.query(
                `UPDATE client_departments SET
                   name=COALESCE($1,name), bu_id=COALESCE($2,bu_id), location_id=COALESCE($3,location_id),
                   is_active=COALESCE($4,is_active), sort_order=COALESCE($5,sort_order)
                 WHERE id=$6 AND client_id=$7 RETURNING *`,
                [name || null, bu_id ?? null, location_id ?? null,
                    typeof is_active === 'boolean' ? is_active : null, sort_order ?? null,
                    req.params.deptId, req.params.id]
            );
            if (!rows.length) return res.status(404).json({ error: 'Not found' });
            res.json({ department: rows[0] });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.delete('/api/clients/:id/departments/:deptId', requireAuth, requireRole('superadmin', 'finance_manager', 'hr_manager'), async (req, res) => {
        try {
            await pool.query('DELETE FROM client_departments WHERE id=$1 AND client_id=$2', [req.params.deptId, req.params.id]);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/clients/:id/org-seed', requireAuth, requireRole('superadmin', 'hr_manager', 'operations'), async (req, res) => {
        try {
            await seedClientOrgFromExisting(pool, req.params.id);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
}

module.exports = {
    ASIL_BUS,
    normalizeAsilBu,
    ensureOrgMasterTables,
    seedClientOrgFromExisting,
    registerOrgMasterRoutes,
};
