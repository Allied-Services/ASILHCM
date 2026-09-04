'use strict';

const cutover = require('../../core/cutover');

const LIST_COLS = [
    'e.id',
    'e.name',
    'e.cnic',
    'e.bu',
    'e.client',
    'e.client_bu',
    'e.dept',
    'e.designation',
    'e.location',
    'e.province',
    'e.contract_name',
    'e.contract_id',
    'e.salary',
    'e.active',
    'e.email',
    'e.primary_contact',
    'e.claim_authority',
    'e.line_manager_email',
];

const SORTS = {
    name: 'e.name ASC NULLS LAST, e.id ASC',
    client: 'e.client ASC NULLS LAST, e.name ASC',
    designation: 'e.designation ASC NULLS LAST, e.name ASC',
};

function truthyFlag(v) {
    return v === '1' || v === 'true' || v === true;
}

function parseDirectoryQuery(query = {}) {
    const q = String(query.q || '').trim();
    const bu = String(query.bu || '').trim();
    const client = String(query.client || '').trim();
    const contractId = String(query.contractId || query.contract_id || '').trim();
    const clientBu = String(query.clientBu || query.client_bu || '').trim();
    const location = String(query.location || '').trim();
    const dept = String(query.dept || '').trim();
    const activeRaw = String(query.active || 'yes').trim().toLowerCase();
    const active = ['yes', 'no', 'all'].includes(activeRaw) ? activeRaw : 'yes';
    const browse = truthyFlag(query.browse);
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const sortKey = String(query.sort || 'name').trim().toLowerCase();
    const sort = SORTS[sortKey] ? sortKey : 'name';
    const hasQ = q.length >= 2;
    const hasOrg = !!(bu || client || contractId || clientBu || location || dept);
    return {
        q,
        bu,
        client,
        contractId,
        clientBu,
        location,
        dept,
        active,
        browse,
        page,
        limit,
        sort,
        hasQ,
        hasOrg,
        allowed: hasQ || hasOrg || browse,
        offset: (page - 1) * limit,
    };
}

function eqText(column, value, params) {
    params.push(value);
    return `LOWER(TRIM(${column})) = LOWER(TRIM($${params.length}))`;
}

function buildDirectorySql(parsed, { archive = false } = {}) {
    const vis = cutover.employeeVisibilityClause('e', { archive });
    const where = [vis];
    const params = [];

    if (parsed.hasQ) {
        params.push(`%${parsed.q}%`);
        const like = `$${params.length}`;
        const digits = parsed.q.replace(/[^0-9]/g, '');
        if (digits.length >= 4) {
            params.push(`${digits}%`);
            const cnicLike = `$${params.length}`;
            where.push(`(
                e.name ILIKE ${like}
                OR e.id ILIKE ${like}
                OR COALESCE(e.cnic, '') ILIKE ${like}
                OR regexp_replace(COALESCE(e.cnic, ''), '[^0-9]', '', 'g') LIKE ${cnicLike}
            )`);
        } else {
            where.push(`(e.name ILIKE ${like} OR e.id ILIKE ${like} OR COALESCE(e.cnic, '') ILIKE ${like})`);
        }
    }

    if (parsed.bu) where.push(eqText('e.bu', parsed.bu, params));
    if (parsed.client) where.push(eqText('e.client', parsed.client, params));
    if (parsed.contractId) {
        params.push(parsed.contractId);
        where.push(`e.contract_id = $${params.length}`);
    }
    if (parsed.clientBu) where.push(eqText('e.client_bu', parsed.clientBu, params));
    if (parsed.location) where.push(eqText('e.location', parsed.location, params));
    if (parsed.dept) where.push(eqText('e.dept', parsed.dept, params));

    if (parsed.active === 'yes') {
        where.push(`(
            e.active IS NULL
            OR LOWER(TRIM(e.active::text)) IN ('yes','true','1','active','')
            OR e.active::text = 'Yes'
        )`);
    } else if (parsed.active === 'no') {
        where.push(`LOWER(TRIM(e.active::text)) IN ('no','false','0','inactive')`);
    }

    params.push(parsed.limit, parsed.offset);
    const sql = `
        SELECT ${LIST_COLS.join(', ')}, COUNT(*) OVER()::int AS total
        FROM employees e
        WHERE ${where.join('\n          AND ')}
        ORDER BY ${SORTS[parsed.sort]}
        LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    return { sql, params };
}

function rowToDirectoryDto(r) {
    return {
        id: r.id,
        name: r.name,
        cnic: r.cnic,
        bu: r.bu,
        client: r.client,
        clientBU: r.client_bu,
        dept: r.dept,
        designation: r.designation,
        location: r.location,
        province: r.province,
        contractName: r.contract_name,
        contractId: r.contract_id,
        salary: parseFloat(r.salary) || 0,
        active: r.active,
        email: r.email,
        primaryContact: r.primary_contact,
        claimAuthority: r.claim_authority,
        lineManagerEmail: r.line_manager_email,
    };
}

const SLIM_KEYS = Object.keys(rowToDirectoryDto({}));

async function searchDirectory(pool, req) {
    const parsed = parseDirectoryQuery(req.query || {});
    if (!parsed.allowed) {
        const err = new Error('Search text (2+ characters), an organisation filter, or browse=1 is required');
        err.status = 400;
        err.code = 'DIRECTORY_QUERY_REQUIRED';
        throw err;
    }
    const { archive } = await cutover.resolveArchiveMode(req, pool);
    const { sql, params } = buildDirectorySql(parsed, { archive });
    const { rows } = await pool.query(sql, params);
    const total = rows[0] ? Number(rows[0].total) || 0 : 0;
    return {
        employees: rows.map(rowToDirectoryDto),
        total,
        page: parsed.page,
        limit: parsed.limit,
        sort: parsed.sort,
        archive_mode: archive,
    };
}

async function getDirectoryRecord(pool, req, empFromDb) {
    const id = decodeURIComponent(String(req.params.id || '').trim());
    if (!id) {
        const err = new Error('Employee id is required');
        err.status = 400;
        throw err;
    }
    const { archive } = await cutover.resolveArchiveMode(req, pool);
    const vis = cutover.employeeVisibilityClause('e', { archive });
    const { rows } = await pool.query(
        `SELECT e.* FROM employees e WHERE e.id = $1 AND ${vis} LIMIT 1`,
        [id]
    );
    if (!rows[0]) return null;
    return empFromDb ? empFromDb(rows[0]) : rowToDirectoryDto(rows[0]);
}

function registerEmployeeDirectoryRoutes(app, deps) {
    const { pool, requireAuth, empFromDb } = deps;

    app.get('/api/employees/directory', requireAuth, async (req, res) => {
        try {
            const result = await searchDirectory(pool, req);
            res.json(result);
        } catch (err) {
            if (err.status === 400) {
                return res.status(400).json({ error: err.message, code: err.code });
            }
            console.error('[GET /api/employees/directory]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/employees/directory/:id', requireAuth, async (req, res) => {
        try {
            const employee = await getDirectoryRecord(pool, req, empFromDb);
            if (!employee) return res.status(404).json({ error: 'Employee not found' });
            res.json({ employee });
        } catch (err) {
            if (err.status === 400) return res.status(400).json({ error: err.message });
            console.error('[GET /api/employees/directory/:id]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

module.exports = {
    parseDirectoryQuery,
    buildDirectorySql,
    rowToDirectoryDto,
    searchDirectory,
    getDirectoryRecord,
    registerEmployeeDirectoryRoutes,
    SLIM_KEYS,
};
