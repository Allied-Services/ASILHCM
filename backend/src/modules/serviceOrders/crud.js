'use strict';

const {
    PSO_SERVICE_TYPE,
    isSoBillingModel,
} = require('./sitesMeta');

function soIdForSite(siteCode) {
    return `SO-PSO-${siteCode}`;
}

async function listFixedValueContracts(pool) {
    const { rows } = await pool.query(
        `SELECT c.*, cl.name AS client_name,
                cp.billing_model, cp.income_tax_wht_pct, cp.sales_tax_rate, cp.sales_tax_exempt
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN LATERAL (
             SELECT billing_model, income_tax_wht_pct, sales_tax_rate, sales_tax_exempt
             FROM contract_policies
             WHERE contract_id = c.id
             ORDER BY effective_from DESC, id DESC
             LIMIT 1
         ) cp ON true
         WHERE c.service_type = $1
            OR LOWER(COALESCE(cp.billing_model, '')) IN ('service_order_deduction', 'fixed_value')
         ORDER BY c.contract_name`,
        [PSO_SERVICE_TYPE]
    );
    return rows;
}

async function listServiceOrders(pool, { contractId, siteCode, month, year } = {}) {
    const params = [];
    const where = [];
    if (contractId) {
        params.push(contractId);
        where.push(`so.contract_id = $${params.length}`);
    }
    if (siteCode) {
        params.push(siteCode);
        where.push(`so.site_code = $${params.length}`);
    }
    const sql = `
        SELECT so.*,
               (SELECT COALESCE(json_agg(l ORDER BY l.id), '[]'::json)
                FROM service_order_lines l WHERE l.service_order_id = so.id) AS lines
        FROM service_orders so
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY so.site_code NULLS LAST, so.name`;
    const { rows } = await pool.query(sql, params);
    return rows;
}

async function getServiceOrder(pool, id) {
    const { rows } = await pool.query(
        `SELECT so.*,
                (SELECT COALESCE(json_agg(l ORDER BY l.id), '[]'::json)
                 FROM service_order_lines l WHERE l.service_order_id = so.id) AS lines
         FROM service_orders so WHERE so.id = $1`,
        [id]
    );
    return rows[0] || null;
}

async function upsertServiceOrder(pool, payload, actor) {
    const {
        id,
        contract_id,
        site_code,
        name,
        so_number,
        location_id,
        status = 'active',
        meta = {},
        total_value,
    } = payload;
    if (!id || !contract_id || !name) {
        const err = new Error('id, contract_id, and name are required');
        err.status = 400;
        throw err;
    }
    const { rows } = await pool.query(
        `INSERT INTO service_orders
         (id, contract_id, site_code, name, so_number, location_id, status, meta, total_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           contract_id = EXCLUDED.contract_id,
           site_code = EXCLUDED.site_code,
           name = EXCLUDED.name,
           so_number = EXCLUDED.so_number,
           location_id = EXCLUDED.location_id,
           status = EXCLUDED.status,
           meta = EXCLUDED.meta,
           total_value = EXCLUDED.total_value
         RETURNING *`,
        [
            id,
            contract_id,
            site_code || null,
            name,
            so_number || null,
            location_id || null,
            status,
            JSON.stringify(meta || {}),
            total_value != null ? Number(total_value) : null,
        ]
    );
    return rows[0];
}

function normalizeLineName(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Map old SO line ids → new ids after a delete/re-insert.
 * Prefer line_number, fall back to normalized name.
 */
function buildOldToNewLineIdMap(oldLines, newLines) {
    const map = new Map();
    const usedNew = new Set();
    const byNumber = new Map();
    const byName = new Map();
    for (const nl of newLines || []) {
        const num = String(nl.line_number || '').trim();
        if (num) byNumber.set(num, nl);
        const name = normalizeLineName(nl.name);
        if (name && !byName.has(name)) byName.set(name, nl);
    }
    for (const ol of oldLines || []) {
        const num = String(ol.line_number || '').trim();
        let match = num ? byNumber.get(num) : null;
        if (!match || usedNew.has(match.id)) {
            const name = normalizeLineName(ol.name);
            match = name ? byName.get(name) : null;
        }
        if (match && !usedNew.has(match.id)) {
            map.set(Number(ol.id), Number(match.id));
            usedNew.add(match.id);
        }
    }
    return map;
}

async function replaceLines(db, serviceOrderId, lines) {
    const so = await getServiceOrder(db, serviceOrderId);
    if (!so) {
        const err = new Error('Service order not found');
        err.status = 404;
        throw err;
    }

    // Pool has .connect but no .release; a pooled Client has .release.
    // Do not call .connect() on an already-connected Client (seed tx path).
    const isPool = typeof db.connect === 'function' && typeof db.release !== 'function';
    const client = isPool ? await db.connect() : db;
    const startedHere = isPool;
    try {
        if (startedHere) await client.query('BEGIN');

        // Capture deduction→line links BEFORE delete (FK ON DELETE SET NULL).
        const oldLines = so.lines || [];
        const { rows: linkedDeds } = await client.query(
            `SELECT id, line_id FROM so_deductions
             WHERE service_order_id = $1 AND line_id IS NOT NULL`,
            [serviceOrderId]
        );

        await client.query(`DELETE FROM service_order_lines WHERE service_order_id = $1`, [serviceOrderId]);
        const inserted = [];
        let lineNo = 1;
        for (const line of lines || []) {
            const { rows } = await client.query(
                `INSERT INTO service_order_lines
                 (service_order_id, line_number, name, unit, quantity, rate, total_amount, is_manpower_dependent, roles)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 RETURNING *`,
                [
                    serviceOrderId,
                    line.line_number || String(lineNo),
                    line.name,
                    line.unit || 'MON',
                    line.quantity != null ? Number(line.quantity) : 1,
                    Number(line.rate || 0),
                    Number(line.total_amount ?? line.rate ?? 0),
                    !!line.is_manpower_dependent,
                    JSON.stringify(line.roles || []),
                ]
            );
            inserted.push(rows[0]);
            lineNo += 1;
        }

        // Re-point so_deductions.line_id onto the new serial ids.
        if (linkedDeds.length && oldLines.length) {
            const idMap = buildOldToNewLineIdMap(oldLines, inserted);
            const pairs = [];
            for (const d of linkedDeds) {
                const nextId = idMap.get(Number(d.line_id));
                if (nextId != null) pairs.push([Number(d.id), nextId]);
            }
            if (pairs.length) {
                const dedIds = pairs.map((p) => p[0]);
                const newLineIds = pairs.map((p) => p[1]);
                await client.query(
                    `UPDATE so_deductions AS d
                     SET line_id = v.new_line_id
                     FROM (
                       SELECT UNNEST($1::int[]) AS id, UNNEST($2::int[]) AS new_line_id
                     ) AS v
                     WHERE d.id = v.id AND d.service_order_id = $3`,
                    [dedIds, newLineIds, serviceOrderId]
                );
            }
        }

        const total = inserted.reduce((s, l) => s + Number(l.rate || 0), 0);
        await client.query(`UPDATE service_orders SET total_value = $2 WHERE id = $1`, [serviceOrderId, total]);
        if (startedHere) await client.query('COMMIT');
        return { serviceOrderId, lines: inserted, total_value: total };
    } catch (e) {
        if (startedHere) await client.query('ROLLBACK');
        throw e;
    } finally {
        if (startedHere) client.release();
    }
}

module.exports = {
    soIdForSite,
    isSoBillingModel,
    listFixedValueContracts,
    listServiceOrders,
    getServiceOrder,
    upsertServiceOrder,
    replaceLines,
    buildOldToNewLineIdMap,
};
