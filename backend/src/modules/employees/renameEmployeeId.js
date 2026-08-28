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

function cnicDigits(raw) {
    return String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
}

async function listUniqueEmployeeColumns(client) {
    const { rows } = await client.query(`
        SELECT DISTINCT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = 'public'
           AND tc.table_name = 'employees'
           AND tc.constraint_type = 'UNIQUE'
           AND kcu.column_name <> 'id'
    `);
    return rows.map((r) => r.column_name).filter((c) => IDENT_RE.test(c));
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

        const digits = cnicDigits(row.cnic);
        if (digits) {
            const others = await client.query(
                `SELECT id, name FROM employees
                  WHERE regexp_replace(COALESCE(cnic, ''), '[^0-9]', '', 'g') = $1
                    AND id <> $2
                  LIMIT 5`,
                [digits, from]
            );
            if (others.rows.length) {
                const who = others.rows[0].name
                    ? `${others.rows[0].name} (${others.rows[0].id})`
                    : others.rows[0].id;
                throw httpError(409, `CNIC already belongs to ${who}`, 'CNIC_TAKEN');
            }
        }

        const uniqueCols = await listUniqueEmployeeColumns(client);
        if (Object.prototype.hasOwnProperty.call(row, 'cnic') && !uniqueCols.includes('cnic')) {
            uniqueCols.push('cnic');
        }
        const parked = uniqueCols
            .filter((c) => Object.prototype.hasOwnProperty.call(row, c) && row[c] != null && row[c] !== '')
            .map((c) => ({ column: c, value: row[c] }));

        const cols = Object.keys(row);
        const parkSet = new Set(parked.map((p) => p.column));
        const vals = cols.map((c) => {
            if (c === 'id') return to;
            if (parkSet.has(c)) return null;
            return row[c];
        });
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
        for (const { column, value } of parked) {
            await client.query(
                `UPDATE employees SET ${quoteIdent(column)}=$1 WHERE id=$2`,
                [value, to]
            );
        }
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
    cnicDigits,
    listEmployeeIdTargets,
    listUniqueEmployeeColumns,
    renameEmployeeId,
};
