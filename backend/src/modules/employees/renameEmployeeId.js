'use strict';

const MAX_ID_LEN = 64;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

function httpError(status, message, code) {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
}

function quoteIdent(name) {
    const id = String(name || '');
    if (!IDENT_RE.test(id)) throw httpError(500, 'Internal server error', 'BAD_IDENT');
    return `"${id}"`;
}

function normalizeEmployeeId(raw) {
    const id = String(raw == null ? '' : raw).trim();
    if (!id) throw httpError(400, 'Employee code is required', 'INVALID_ID');
    if (id.length > MAX_ID_LEN) throw httpError(400, 'Employee code is too long', 'INVALID_ID');
    if (!ID_RE.test(id)) {
        throw httpError(400, 'Employee code can only use letters, numbers, /, -, _ and .', 'INVALID_ID');
    }
    return id;
}

async function listEmployeeIdTargets(client) {
    const seen = new Set();
    const targets = [];

    const add = (tableName, columnName) => {
        const table = String(tableName || '');
        const column = String(columnName || '');
        if (table === 'employees' && column === 'id') return;
        const key = `${table}.${column}`;
        if (seen.has(key)) return;
        if (!IDENT_RE.test(table) || !IDENT_RE.test(column)) return;
        seen.add(key);
        targets.push({ table, column });
    };

    const cols = await client.query(`
        SELECT c.table_name, c.column_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public'
           AND c.column_name = 'employee_id'
           AND t.table_type = 'BASE TABLE'
    `);
    for (const row of cols.rows) add(row.table_name, row.column_name);

    const fks = await client.query(`
        SELECT kcu.table_name, kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
           AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = 'public'
           AND ccu.table_name = 'employees'
           AND ccu.column_name = 'id'
    `);
    for (const row of fks.rows) add(row.table_name, row.column_name);

    return targets;
}

function existingEmployeeId(raw) {
    const id = String(raw == null ? '' : raw).trim();
    if (!id) throw httpError(400, 'Employee code is required', 'INVALID_ID');
    if (id.length > MAX_ID_LEN) throw httpError(400, 'Employee code is too long', 'INVALID_ID');
    return id;
}

async function renameEmployeeId(pool, oldId, newId) {
    const from = existingEmployeeId(oldId);
    const to = normalizeEmployeeId(newId);
    if (from === to) return { renamed: false, id: from };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existing = await client.query(
            'SELECT id FROM employees WHERE id=$1 FOR UPDATE',
            [from]
        );
        if (!existing.rows.length) throw httpError(404, 'Not found', 'NOT_FOUND');

        const clash = await client.query('SELECT id FROM employees WHERE id=$1', [to]);
        if (clash.rows.length) {
            throw httpError(409, 'That employee code is already in use', 'ID_TAKEN');
        }

        const { rows } = await client.query('SELECT * FROM employees WHERE id=$1', [from]);
        const row = rows[0];
        if (!row) throw httpError(404, 'Not found', 'NOT_FOUND');

        const cols = Object.keys(row);
        const vals = cols.map((c) => (c === 'id' ? to : row[c]));
        await client.query(
            `INSERT INTO employees (${cols.map(quoteIdent).join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
            vals
        );

        const targets = await listEmployeeIdTargets(client);
        for (const { table, column } of targets) {
            await client.query(
                `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)}=$1 WHERE ${quoteIdent(column)}=$2`,
                [to, from]
            );
        }

        await client.query('DELETE FROM employees WHERE id=$1', [from]);
        await client.query('COMMIT');
        return { renamed: true, id: to, from, tables: targets.map((t) => t.table) };
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    httpError,
    quoteIdent,
    normalizeEmployeeId,
    existingEmployeeId,
    listEmployeeIdTargets,
    renameEmployeeId,
};
