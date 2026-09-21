'use strict';

const cutover = require('../../core/cutover');
const { currentlyActiveSqlClause, currentlyInactiveSqlClause } = require('../../core/employeeActive');

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
    'e.last_working_day',
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
    const designation = String(query.designation || '').trim();
    const activeRaw = String(query.active || 'all').trim().toLowerCase();
    const active = ['yes', 'no', 'all'].includes(activeRaw) ? activeRaw : 'all';
    const browse = truthyFlag(query.browse);
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 50));
    const sortKey = String(query.sort || 'name').trim().toLowerCase();
    const sort = SORTS[sortKey] ? sortKey : 'name';
    const hasQ = q.length >= 2;
    const hasOrg = !!(bu || client || contractId || clientBu || location || dept || designation);
    const scoped = !!(client && contractId);
    return {
        q,
        bu,
        client,
        contractId,
        clientBu,
        location,
        dept,
        designation,
        active,
        browse,
        page,
        limit,
        sort,
        hasQ,
        hasOrg,
        scoped,
        allowed: hasQ || hasOrg || browse,
        offset: (page - 1) * limit,
    };
}

function eqText(column, value, params) {
    params.push(value);
    return `LOWER(TRIM(${column})) = LOWER(TRIM($${params.length}))`;
}

function buildDirectoryWhere(parsed, { archive = false, includeSearch = true, includeDesignation = true } = {}) {
    const where = [];
    const params = [];
    // Do not reuse employeeVisibilityClause here — that is "employed today".
    // Keep the Jul-2026 LWD floor for browse/filter lists; a name/code search
    // skips it so a person can be found. Active/Inactive mean employed today
    // vs already left (last working day), not only the stored flag.
    if (!archive && !(includeSearch && parsed.hasQ)) {
        where.push(`(e.last_working_day IS NULL OR e.last_working_day >= '${cutover.CUTOVER_DATE}'::date)`);
    }

    if (includeSearch && parsed.hasQ) {
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
    if (includeDesignation && parsed.designation) where.push(eqText('e.designation', parsed.designation, params));

    if (parsed.active === 'yes') {
        where.push(currentlyActiveSqlClause('e'));
    } else if (parsed.active === 'no') {
        where.push(currentlyInactiveSqlClause('e'));
    }

    if (!where.length) where.push('TRUE');
    return { where, params };
}

function buildDirectorySql(parsed, { archive = false } = {}) {
    const { where, params } = buildDirectoryWhere(parsed, { archive });
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
        lastWorkingDay: r.last_working_day ? String(r.last_working_day).slice(0, 10) : '',
    };
}

const SLIM_KEYS = Object.keys(rowToDirectoryDto({}));

function buildDirectoryDesignationsSql(parsed, { archive = false } = {}) {
    const { where, params } = buildDirectoryWhere(parsed, {
        archive,
        includeSearch: false,
        includeDesignation: false,
    });
    const sql = `
        SELECT DISTINCT e.designation
        FROM employees e
        WHERE ${where.join('\n          AND ')}
          AND e.designation IS NOT NULL
          AND TRIM(e.designation) <> ''
        ORDER BY e.designation ASC
        LIMIT 500
    `;
    return { sql, params };
}

async function listDirectoryFilterOptions(pool, req) {
    const parsed = parseDirectoryQuery(req.query || {});
    if (!parsed.client && !parsed.contractId && !parsed.clientBu && !parsed.location && !parsed.dept && !parsed.bu) {
        return { designations: [] };
    }
    const { archive } = await cutover.resolveArchiveMode(req, pool);
    const { sql, params } = buildDirectoryDesignationsSql(parsed, { archive });
    const { rows } = await pool.query(sql, params);
    return { designations: rows.map((r) => r.designation).filter(Boolean) };
}

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

async function getDirectoryFacets(pool, query = {}) {
    const client = String(query.client || '').trim();
    const contractId = String(query.contractId || query.contract_id || '').trim();
    if (!client || !contractId) {
        const err = new Error('Client and Contract are required');
        err.status = 400;
        err.code = 'DIRECTORY_QUERY_REQUIRED';
        throw err;
    }
    const params = [client, contractId];
    const { rows } = await pool.query(
        `SELECT e.client_bu, e.location, e.dept, e.designation
         FROM employees e
         WHERE LOWER(TRIM(e.client)) = LOWER(TRIM($1))
           AND e.contract_id = $2`,
        params
    );
    const uniq = (key) => [...new Set(rows.map((r) => r[key]).filter((v) => v != null && String(v).trim() !== ''))]
        .sort((a, b) => String(a).localeCompare(String(b)));
    return {
        clientBus: uniq('client_bu'),
        locations: uniq('location'),
        departments: uniq('dept'),
        designations: uniq('designation'),
    };
}

async function getDirectoryRecord(pool, req, empFromDb) {
    const id = decodeURIComponent(String(req.params.id || '').trim());
    if (!id) {
        const err = new Error('Employee id is required');
        err.status = 400;
        throw err;
    }
    const { rows } = await pool.query(
        `SELECT e.* FROM employees e WHERE e.id = $1 LIMIT 1`,
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

    app.get('/api/employees/directory/facets', requireAuth, async (req, res) => {
        try {
            res.json(await getDirectoryFacets(pool, req.query || {}));
        } catch (err) {
            if (err.status === 400) {
                return res.status(400).json({ error: err.message, code: err.code });
            }
            console.error('[GET /api/employees/directory/facets]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/employees/directory/filter-options', requireAuth, async (req, res) => {
        try {
            const result = await listDirectoryFilterOptions(pool, req);
            res.json(result);
        } catch (err) {
            console.error('[GET /api/employees/directory/filter-options]', err);
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
    buildDirectoryDesignationsSql,
    rowToDirectoryDto,
    searchDirectory,
    getDirectoryFacets,
    listDirectoryFilterOptions,
    getDirectoryRecord,
    registerEmployeeDirectoryRoutes,
    SLIM_KEYS,
};
