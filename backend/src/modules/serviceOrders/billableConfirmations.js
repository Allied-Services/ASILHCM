'use strict';

const { getServiceOrder, listServiceOrders } = require('./crud');

function nonManpowerLines(lines) {
    return (lines || []).filter((l) => !(l.is_manpower_dependent || l.isManpowerDependent));
}

/** Manpower always billable; non-manpower only when explicitly confirmed billable. */
function confirmationMapFromRows(rows) {
    const map = new Map();
    for (const r of rows || []) {
        map.set(Number(r.line_id), {
            lineId: Number(r.line_id),
            billable: !!r.billable,
            confirmedBy: r.confirmed_by || null,
            confirmedAt: r.confirmed_at || null,
        });
    }
    return map;
}

/** True when the line contributes a charged amount (manpower always; non-manpower when confirmed). */
function isLineIncludedOnInvoice(line, confirmationMap) {
    if (line.is_manpower_dependent || line.isManpowerDependent) return true;
    const c = confirmationMap.get(Number(line.id));
    return !!(c && c.billable);
}

/** Billable qty for a period invoice: 1 when charged, 0 when listed but unchecked. */
function invoiceQuantityForLine(line, confirmationMap) {
    return isLineIncludedOnInvoice(line, confirmationMap) ? 1 : 0;
}

/**
 * All SO lines stay on the invoice (owner: unchecked non-manpower still visible).
 * Charged lines keep qty 1; unchecked non-manpower stamp qty 0.
 * @deprecated name kept for callers — no longer omits lines.
 */
function filterLinesForInvoice(lines, confirmationMap) {
    return (lines || []).slice();
}

/** Map every SO line to invoice stamp fields (qty/amount driven by confirmations). */
function mapLinesForInvoice(lines, confirmationMap) {
    return (lines || []).map((l) => {
        const billable = isLineIncludedOnInvoice(l, confirmationMap);
        const quantity = invoiceQuantityForLine(l, confirmationMap);
        const rate = Number(l.rate || 0);
        return {
            line: l,
            billable,
            quantity,
            rate,
            amount: Math.round(rate * quantity * 100) / 100,
        };
    });
}

function buildBillableSnapshot(lines, confirmationMap) {
    return (lines || []).map((l) => {
        const mp = !!(l.is_manpower_dependent || l.isManpowerDependent);
        const charged = isLineIncludedOnInvoice(l, confirmationMap);
        return {
            lineId: l.id,
            lineNumber: l.line_number || null,
            name: l.name,
            isManpowerDependent: mp,
            billable: mp ? true : charged,
            // Always listed on invoice; charged=false → qty 0 / amount 0.
            includedOnInvoice: true,
            chargedOnInvoice: charged,
            quantity: charged ? 1 : 0,
            rate: Number(l.rate || 0),
        };
    });
}

async function getPeriodReview(pool, serviceOrderId, month, year) {
    const { rows } = await pool.query(
        `SELECT service_order_id, period_year, period_month, reviewed_by, reviewed_at
         FROM so_billable_period_reviews
         WHERE service_order_id = $1 AND period_year = $2 AND period_month = $3`,
        [serviceOrderId, year, month]
    );
    return rows[0] || null;
}

async function listLineConfirmations(pool, serviceOrderId, month, year) {
    const { rows } = await pool.query(
        `SELECT c.*, l.name AS line_name, l.line_number, l.rate, l.is_manpower_dependent
         FROM so_line_billable_confirmations c
         JOIN service_order_lines l ON l.id = c.line_id
         WHERE c.service_order_id = $1 AND c.period_year = $2 AND c.period_month = $3
         ORDER BY l.id`,
        [serviceOrderId, year, month]
    );
    return rows;
}

async function getBillableConfirmationsForSo(pool, serviceOrderId, month, year) {
    const so = await getServiceOrder(pool, serviceOrderId);
    if (!so) {
        const err = new Error('Service order not found');
        err.status = 404;
        err.code = 'SO_NOT_FOUND';
        throw err;
    }
    const review = await getPeriodReview(pool, serviceOrderId, month, year);
    const stored = await listLineConfirmations(pool, serviceOrderId, month, year);
    const byLine = confirmationMapFromRows(stored);
    const nmLines = nonManpowerLines(so.lines);
    const lines = nmLines.map((l) => {
        const saved = byLine.get(Number(l.id));
        return {
            lineId: l.id,
            lineNumber: l.line_number || null,
            name: l.name,
            unit: l.unit,
            rate: Number(l.rate || 0),
            isManpowerDependent: false,
            billable: saved ? !!saved.billable : false,
            saved: !!saved,
            confirmedBy: saved?.confirmedBy || null,
            confirmedAt: saved?.confirmedAt || null,
        };
    });
    return {
        serviceOrderId: so.id,
        siteCode: so.site_code,
        siteName: so.name,
        contractId: so.contract_id,
        periodMonth: month,
        periodYear: year,
        reviewed: !!review,
        reviewedBy: review?.reviewed_by || null,
        reviewedAt: review?.reviewed_at || null,
        billableCount: lines.filter((l) => l.billable).length,
        totalNonManpower: lines.length,
        lines,
    };
}

function validateLineSelections(so, selections) {
    const nm = nonManpowerLines(so.lines);
    const allowed = new Set(nm.map((l) => Number(l.id)));
    const seen = new Set();
    const cleaned = [];
    for (const sel of selections || []) {
        const lineId = Number(sel.lineId ?? sel.line_id);
        if (!Number.isFinite(lineId) || !allowed.has(lineId)) {
            const err = new Error(`Line ${lineId} is not a non-manpower line on this service order`);
            err.status = 400;
            err.code = 'INVALID_LINE';
            throw err;
        }
        if (seen.has(lineId)) continue;
        seen.add(lineId);
        cleaned.push({ lineId, billable: !!sel.billable });
    }
    // Default missing non-manpower lines to OFF
    for (const l of nm) {
        if (!seen.has(Number(l.id))) {
            cleaned.push({ lineId: Number(l.id), billable: false });
        }
    }
    return cleaned;
}

async function saveBillableConfirmations(pool, {
    serviceOrderId, month, year, lines, actor, confirmAll = false,
}) {
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (!serviceOrderId || !m || !y) {
        const err = new Error('serviceOrderId, month, and year are required');
        err.status = 400;
        throw err;
    }
    const so = await getServiceOrder(pool, serviceOrderId);
    if (!so) {
        const err = new Error('Service order not found');
        err.status = 404;
        err.code = 'SO_NOT_FOUND';
        throw err;
    }

    let selections;
    if (confirmAll) {
        selections = nonManpowerLines(so.lines).map((l) => ({ lineId: Number(l.id), billable: true }));
    } else {
        selections = validateLineSelections(so, lines);
    }
    // Never mark a period reviewed with zero tick rows when the SO has
    // non-manpower lines — that is how Sihala Consumables vanished after Save.
    if (!selections.length) {
        selections = nonManpowerLines(so.lines).map((l) => ({ lineId: Number(l.id), billable: false }));
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO so_billable_period_reviews
             (service_order_id, period_year, period_month, reviewed_by, reviewed_at)
             VALUES ($1,$2,$3,$4,NOW())
             ON CONFLICT (service_order_id, period_year, period_month)
             DO UPDATE SET reviewed_by = EXCLUDED.reviewed_by, reviewed_at = NOW()`,
            [serviceOrderId, y, m, actor || null]
        );

        for (const sel of selections) {
            await client.query(
                `INSERT INTO so_line_billable_confirmations
                 (service_order_id, line_id, period_year, period_month, billable, confirmed_by, confirmed_at)
                 VALUES ($1,$2,$3,$4,$5,$6,NOW())
                 ON CONFLICT (service_order_id, line_id, period_year, period_month)
                 DO UPDATE SET billable = EXCLUDED.billable,
                               confirmed_by = EXCLUDED.confirmed_by,
                               confirmed_at = NOW()`,
                [serviceOrderId, sel.lineId, y, m, !!sel.billable, actor || null]
            );
        }

        // Drop stale confirmations for lines that are no longer non-manpower / deleted
        const keepIds = selections.map((s) => s.lineId);
        if (keepIds.length) {
            await client.query(
                `DELETE FROM so_line_billable_confirmations
                 WHERE service_order_id = $1 AND period_year = $2 AND period_month = $3
                   AND NOT (line_id = ANY($4::int[]))`,
                [serviceOrderId, y, m, keepIds]
            );
        } else {
            await client.query(
                `DELETE FROM so_line_billable_confirmations
                 WHERE service_order_id = $1 AND period_year = $2 AND period_month = $3`,
                [serviceOrderId, y, m]
            );
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }

    return getBillableConfirmationsForSo(pool, serviceOrderId, m, y);
}

async function assertPeriodReviewed(pool, serviceOrderId, month, year) {
    const review = await getPeriodReview(pool, serviceOrderId, month, year);
    if (!review) {
        const err = new Error(
            'Confirm billable services for this site/month before generating an invoice (save the checklist even if all unchecked).'
        );
        err.status = 409;
        err.code = 'CONFIRMATIONS_REQUIRED';
        err.details = { serviceOrderId, month, year };
        throw err;
    }
    return review;
}

async function loadConfirmationMap(pool, serviceOrderId, month, year) {
    const rows = await listLineConfirmations(pool, serviceOrderId, month, year);
    return confirmationMapFromRows(rows);
}

async function listContractBillableConfirmations(pool, contractId, month, year, siteCodes) {
    const orders = await listServiceOrders(pool, { contractId });
    const filtered = Array.isArray(siteCodes) && siteCodes.length
        ? orders.filter((o) => siteCodes.includes(o.site_code))
        : orders;
    const sites = [];
    for (const so of filtered) {
        sites.push(await getBillableConfirmationsForSo(pool, so.id, month, year));
    }
    const reviewedCount = sites.filter((s) => s.reviewed).length;
    return {
        contractId,
        periodMonth: month,
        periodYear: year,
        reviewedCount,
        siteCount: sites.length,
        allReviewed: sites.length > 0 && reviewedCount === sites.length,
        sites,
    };
}

async function saveContractBillableConfirmations(pool, {
    contractId, month, year, actor, confirmAll = false, siteCodes, sites,
}) {
    const orders = await listServiceOrders(pool, { contractId });
    const filtered = Array.isArray(siteCodes) && siteCodes.length
        ? orders.filter((o) => siteCodes.includes(o.site_code))
        : orders;
    const bySo = new Map((sites || []).map((s) => [s.serviceOrderId || s.service_order_id, s]));

    const results = [];
    for (const so of filtered) {
        const payload = bySo.get(so.id);
        const result = await saveBillableConfirmations(pool, {
            serviceOrderId: so.id,
            month,
            year,
            actor,
            confirmAll: confirmAll || !!payload?.confirmAll,
            lines: payload?.lines || [],
        });
        results.push(result);
    }
    return {
        contractId,
        periodMonth: month,
        periodYear: year,
        count: results.length,
        sites: results,
        allReviewed: results.length > 0 && results.every((s) => s.reviewed),
    };
}

async function assertContractConfirmations(pool, contractId, month, year, siteCodes) {
    const pack = await listContractBillableConfirmations(pool, contractId, month, year, siteCodes);
    const missing = pack.sites.filter((s) => !s.reviewed).map((s) => ({
        serviceOrderId: s.serviceOrderId,
        siteCode: s.siteCode,
        siteName: s.siteName,
    }));
    if (missing.length) {
        const err = new Error(
            `Confirm billable services for ${missing.length} site(s) before generating invoices.`
        );
        err.status = 409;
        err.code = 'CONFIRMATIONS_REQUIRED';
        err.details = { missing };
        throw err;
    }
    return pack;
}

module.exports = {
    nonManpowerLines,
    confirmationMapFromRows,
    isLineIncludedOnInvoice,
    invoiceQuantityForLine,
    filterLinesForInvoice,
    mapLinesForInvoice,
    buildBillableSnapshot,
    getPeriodReview,
    listLineConfirmations,
    getBillableConfirmationsForSo,
    saveBillableConfirmations,
    assertPeriodReviewed,
    loadConfirmationMap,
    listContractBillableConfirmations,
    saveContractBillableConfirmations,
    assertContractConfirmations,
};
