'use strict';

const { getPolicy } = require('../constraints/service');
const { provinceSalesTaxRate } = require('../../core/regionTax');
const { parseConfigValue } = require('../../core/jsonConfig');
const { getServiceOrder } = require('./crud');
const { siteProvince, roleCount } = require('./sitesMeta');
const { renderInvoiceHtml } = require('./invoiceHtml');
const {
    assertPeriodReviewed,
    loadConfirmationMap,
    mapLinesForInvoice,
    buildBillableSnapshot,
} = require('./billableConfirmations');

const ST_WITHHOLDING_RATE = 0.20;

/** FV invoices in these statuses may regenerate line_items/totals (preserve invoice_number). */
const FV_REGENERATABLE_STATUSES = new Set(['draft', 'raised', 'sent']);

function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

/** client_invoices.notes is TEXT — always parse before reading fields. */
function parseInvoiceNotes(notes) {
    if (!notes) return {};
    if (typeof notes === 'object') return notes;
    try {
        return JSON.parse(notes);
    } catch {
        return {};
    }
}

/** Billed manpower = sum of role counts on manpower-dependent SO lines. */
function resourcesFromLines(lines) {
    let n = 0;
    for (const l of lines || []) {
        if (!(l.is_manpower_dependent || l.isManpowerDependent)) continue;
        n += roleCount(l.roles);
    }
    return n;
}

function siteCodeFromSoId(soId) {
    const m = String(soId || '').match(/^SO-PSO-(.+)$/i);
    return m ? m[1].toUpperCase() : null;
}

function enrichInvoiceRow(row, soById = new Map()) {
    const notes = parseInvoiceNotes(row.notes);
    const soId = notes.service_order_id || notes.serviceOrderId || null;
    const so = soId ? soById.get(soId) : null;

    let siteCode = notes.site_code || notes.siteCode || so?.site_code || siteCodeFromSoId(soId) || null;
    let siteName = notes.site_name || notes.siteName || so?.name || null;
    let siteId = notes.site_id || notes.siteId || siteCode || so?.site_code || null;
    let resources = notes.resources != null ? Number(notes.resources)
        : (notes.headcount != null ? Number(notes.headcount) : null);
    if (resources == null && so) resources = resourcesFromLines(so.lines);
    let province = notes.province || (siteCode ? siteProvince(siteCode) : null) || null;

    const enrichedNotes = {
        ...notes,
        service_order_id: soId || notes.service_order_id || null,
        site_id: siteId,
        site_code: siteCode,
        site_name: siteName,
        resources,
        province,
        gross: notes.gross != null ? Number(notes.gross) : notes.gross,
        total_deductions: notes.total_deductions != null ? Number(notes.total_deductions) : notes.total_deductions,
        tax_rate: notes.tax_rate != null ? Number(notes.tax_rate) : notes.tax_rate,
        st_withholding: notes.st_withholding != null ? Number(notes.st_withholding) : notes.st_withholding,
        net_receivable: notes.net_receivable != null ? Number(notes.net_receivable) : notes.net_receivable,
    };

    return {
        ...row,
        notes: enrichedNotes,
        site_id: siteId,
        site_code: siteCode,
        site_name: siteName,
        resources,
        province,
        service_order_id: soId,
    };
}

async function loadServiceOrdersByIds(pool, ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (!unique.length) return new Map();
    const { rows } = await pool.query(
        `SELECT so.id, so.site_code, so.name,
                (SELECT COALESCE(json_agg(l ORDER BY l.id), '[]'::json)
                 FROM service_order_lines l WHERE l.service_order_id = so.id) AS lines
         FROM service_orders so
         WHERE so.id = ANY($1::text[])`,
        [unique]
    );
    return new Map(rows.map((r) => [r.id, r]));
}

async function listDeductions(pool, serviceOrderId, month, year) {
    const { rows } = await pool.query(
        `SELECT d.*, e.name AS employee_name, e.designation AS employee_designation
         FROM so_deductions d
         LEFT JOIN employees e ON e.id = d.employee_id
         WHERE d.service_order_id = $1 AND d.period_month = $2 AND d.period_year = $3
         ORDER BY d.id`,
        [serviceOrderId, month, year]
    );
    return rows;
}

async function addManualDeduction(pool, payload, actor) {
    const {
        service_order_id,
        period_month,
        period_year,
        type = 'manual',
        employee_id,
        days_absent,
        amount,
        line_id,
        note,
    } = payload;
    if (!service_order_id || !period_month || !period_year || amount == null) {
        const err = new Error('service_order_id, period_month, period_year, and amount are required');
        err.status = 400;
        throw err;
    }
    const { rows } = await pool.query(
        `INSERT INTO so_deductions
         (service_order_id, line_id, period_month, period_year, type, employee_id, days_absent, amount, source, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9)
         RETURNING *`,
        [
            service_order_id,
            line_id || null,
            period_month,
            period_year,
            type,
            employee_id || null,
            days_absent != null ? Number(days_absent) : null,
            round2(amount),
            actor || null,
        ]
    );
    return rows[0];
}

async function resolveTaxRate(pool, so, contract) {
    const meta = typeof so.meta === 'string' ? JSON.parse(so.meta || '{}') : (so.meta || {});
    if (meta.taxRate != null) return Number(meta.taxRate);
    const policy = await getPolicy(pool, contract.id);
    if (policy?.sales_tax_exempt) return 0;
    if (policy?.sales_tax_rate != null) return Number(policy.sales_tax_rate);
    const province = siteProvince(so.site_code, { soMeta: meta, contract }) || contract.region_province;
    const { rows: taxCfg } = await pool.query(`SELECT value FROM system_config WHERE key = 'region_tax'`);
    const regionRatesRaw = taxCfg.length ? parseConfigValue(taxCfg[0].value) : [];
    return provinceSalesTaxRate(province, Array.isArray(regionRatesRaw) ? regionRatesRaw : []);
}

async function computeSoInvoice(pool, { serviceOrderId, month, year, requireConfirmations = true }) {
    const so = await getServiceOrder(pool, serviceOrderId);
    if (!so) {
        const err = new Error('Service order not found');
        err.status = 404;
        throw err;
    }

    if (requireConfirmations) {
        await assertPeriodReviewed(pool, serviceOrderId, month, year);
    }

    const { rows: contractRows } = await pool.query(
        `SELECT c.*, cl.name AS client_name, cl.ntn, cl.strn
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         WHERE c.id = $1`,
        [so.contract_id]
    );
    const contract = contractRows[0];
    if (!contract) {
        const err = new Error('Contract not found');
        err.status = 404;
        throw err;
    }

    const policy = await getPolicy(pool, contract.id);
    const whtPct = Number(policy?.income_tax_wht_pct ?? contract.financials?.wht_pct ?? 15) / 100;

    const confirmationMap = await loadConfirmationMap(pool, serviceOrderId, month, year);
    const allLines = so.lines || [];
    const billableSnapshot = buildBillableSnapshot(allLines, confirmationMap);
    // All lines listed; unchecked non-manpower → qty 0 / amount 0 (still visible on invoice).
    // SO seed JSON often stores quantity=12 (contract months) with monthly `rate`.
    // A period invoice always stamps one month = rate (not rate * contractMonths) when billable.
    const grossLines = mapLinesForInvoice(allLines, confirmationMap).map(({ line: l, billable, quantity, rate, amount }) => ({
        lineId: l.id,
        description: l.name,
        quantity,
        rate,
        amount: round2(amount),
        billable,
        isManpowerDependent: !!(l.is_manpower_dependent || l.isManpowerDependent),
        roles: l.roles || [],
        contractQuantity: l.quantity != null ? Number(l.quantity) : null,
    }));
    const gross = round2(grossLines.reduce((s, l) => s + l.amount, 0));

    const deductions = await listDeductions(pool, serviceOrderId, month, year);
    const totalDeductions = round2(deductions.reduce((s, d) => s + Number(d.amount || 0), 0));
    const netTaxable = round2(Math.max(0, gross - totalDeductions));

    const taxRate = await resolveTaxRate(pool, so, contract);
    const provincialSt = round2(netTaxable * taxRate);
    const grandTotal = round2(netTaxable + provincialSt);
    const incomeWht = round2(netTaxable * whtPct);
    const stWithholding = round2(provincialSt * ST_WITHHOLDING_RATE);
    const netReceivable = round2(grandTotal - incomeWht - stWithholding);
    const resources = resourcesFromLines(allLines);
    const soMeta = typeof so.meta === 'string' ? JSON.parse(so.meta || '{}') : (so.meta || {});
    const province = siteProvince(so.site_code, { soMeta, contract }) || contract.region_province || null;

    return {
        serviceOrderId,
        siteId: so.site_code || so.id,
        siteCode: so.site_code,
        siteName: so.name,
        resources,
        contractId: contract.id,
        contractName: contract.contract_name,
        clientName: contract.client_name,
        province,
        periodMonth: month,
        periodYear: year,
        lineItems: grossLines,
        billableSnapshot,
        deductions,
        gross,
        totalDeductions,
        netTaxable,
        taxRate,
        provincialSt,
        salesTax: provincialSt,
        subtotal: netTaxable,
        grandTotal,
        incomeWht,
        wht: incomeWht,
        stWithholding,
        netReceivable,
        whtPct,
        receivableNote: 'Income WHT and ST withholding are receivable-only — not deducted from stamped grand.',
    };
}

async function generateInvoiceNumber(pool, year, month) {
    const monthAbbr = new Date(2000, parseInt(month, 10) - 1, 1).toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const yr2 = String(year).slice(-2);
    const prefix = `INV-${monthAbbr}${yr2}`;
    const { rows } = await pool.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '(\\d+)$') AS INT)), 0) AS max_seq
         FROM client_invoices WHERE invoice_number LIKE $1`,
        [`${prefix}-%`]
    );
    const seq = Number(rows[0]?.max_seq || 0) + 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
}

async function findExistingSoInvoice(pool, { contractId, serviceOrderId, month, year }) {
    const { rows } = await pool.query(
        `SELECT *
         FROM client_invoices
         WHERE contract_id = $1
           AND period_month = $2
           AND period_year = $3
           AND (notes::jsonb->>'service_order_id') = $4
         ORDER BY id DESC
         LIMIT 1`,
        [contractId, month, year, serviceOrderId]
    );
    return rows[0] || null;
}

async function persistSoInvoice(pool, { serviceOrderId, month, year, generatedBy, poNumber }) {
    const computed = await computeSoInvoice(pool, { serviceOrderId, month, year, requireConfirmations: true });
    const policy = await getPolicy(pool, computed.contractId);
    const creditDays = Number(policy?.credit_days) || Number(computed.creditDays) || 30;

    const lineItems = computed.lineItems.map(l => ({
        lineId: l.lineId,
        description: `${l.description} — ${month}/${year}`,
        name: l.description,
        amount: l.amount,
        quantity: l.quantity,
        rate: l.rate,
        billable: l.billable !== false && Number(l.quantity) > 0,
        isManpowerDependent: !!l.isManpowerDependent,
        roles: l.roles || [],
    }));

    const notesObj = {
        source: 'fixed_value_service_order',
        service_order_id: serviceOrderId,
        site_id: computed.siteId || computed.siteCode,
        site_code: computed.siteCode,
        site_name: computed.siteName,
        resources: computed.resources,
        province: computed.province,
        gross: computed.gross,
        total_deductions: computed.totalDeductions,
        income_wht: computed.incomeWht,
        st_withholding: computed.stWithholding,
        net_receivable: computed.netReceivable,
        receivable_note: computed.receivableNote,
        tax_rate: computed.taxRate,
        billable_confirmations: computed.billableSnapshot || [],
        deductions: (computed.deductions || []).map(d => ({
            id: d.id,
            line_id: d.line_id,
            type: d.type,
            employee_id: d.employee_id,
            employee_name: d.employee_name,
            employee_designation: d.employee_designation,
            days_absent: d.days_absent,
            amount: Number(d.amount) || 0,
            note: d.note,
        })),
    };

    const existing = await findExistingSoInvoice(pool, {
        contractId: computed.contractId,
        serviceOrderId,
        month,
        year,
    });

    if (existing) {
        const status = String(existing.status || '');
        if (!FV_REGENERATABLE_STATUSES.has(status.toLowerCase())) {
            const err = new Error(
                `Invoice ${existing.invoice_number} is ${status} — regenerate is blocked for Paid/Voided. Void and re-stamp, or edit while Draft/Raised/Sent.`
            );
            err.status = 409;
            err.code = 'INVOICE_NOT_EDITABLE';
            err.details = { invoiceId: existing.id, status, invoiceNumber: existing.invoice_number };
            throw err;
        }

        // Regenerate line_items + totals; preserve invoice_number (user may have edited it).
        const { rows } = await pool.query(
            `UPDATE client_invoices
             SET line_items = $2,
                 subtotal = $3,
                 sales_tax = $4,
                 wht = $5,
                 grand_total = $6,
                 notes = $7,
                 po_number = COALESCE($8, po_number),
                 due_date = (CURRENT_DATE + ($9 || ' days')::interval)::date,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
                existing.id,
                JSON.stringify(lineItems),
                computed.netTaxable,
                computed.provincialSt,
                computed.incomeWht,
                computed.grandTotal,
                JSON.stringify(notesObj),
                poNumber || null,
                String(creditDays),
            ]
        );
        return { invoice: rows[0], computed, updated: true };
    }

    const invNo = await generateInvoiceNumber(pool, year, month);
    const { rows } = await pool.query(
        `INSERT INTO client_invoices
         (invoice_number, client, contract, contract_id, period_month, period_year,
          line_items, subtotal, service_charges, sales_tax, wht, grand_total, notes, status, created_by, due_date, po_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12,'Draft',$13,(CURRENT_DATE + ($14 || ' days')::interval)::date,$15)
         RETURNING *`,
        [
            invNo,
            computed.clientName,
            computed.contractName,
            computed.contractId,
            month,
            year,
            JSON.stringify(lineItems),
            computed.netTaxable,
            computed.provincialSt,
            computed.incomeWht,
            computed.grandTotal,
            JSON.stringify(notesObj),
            generatedBy,
            String(creditDays),
            poNumber || null,
        ]
    );

    const invoice = rows[0];
    return { invoice, computed, updated: false };
}

async function listRegistry(pool, { contractId, month, year, siteCode } = {}) {
    const params = [];
    const where = [`(ci.notes::text LIKE '%fixed_value_service_order%' OR ci.notes::text LIKE '%service_order_id%')`];
    if (contractId) {
        params.push(contractId);
        where.push(`ci.contract_id = $${params.length}`);
    }
    if (month) {
        params.push(month);
        where.push(`ci.period_month = $${params.length}`);
    }
    if (year) {
        params.push(year);
        where.push(`ci.period_year = $${params.length}`);
    }
    if (siteCode) {
        params.push(`%"site_code":"${siteCode}"%`);
        where.push(`ci.notes ILIKE $${params.length}`);
        // Also match SO id pattern when older stamps omitted site_code
        params.push(`%"service_order_id":"SO-PSO-${siteCode}"%`);
        where[where.length - 1] = `(${where[where.length - 1]} OR ci.notes ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
        `SELECT ci.* FROM client_invoices ci
         WHERE ${where.join(' AND ')}
         ORDER BY ci.period_year DESC, ci.period_month DESC, ci.id DESC`,
        params
    );

    // Backfill site_name / resources from service_orders when July stamps only stored SO id / site_code.
    const soIds = rows.map((r) => parseInvoiceNotes(r.notes).service_order_id).filter(Boolean);
    const soById = await loadServiceOrdersByIds(pool, soIds);
    return rows.map((r) => enrichInvoiceRow(r, soById));
}

/**
 * Update invoice_number on an FV client_invoice. Prints read stored number.
 * Uniqueness enforced against client_invoices.invoice_number.
 */
async function updateFvInvoiceNumber(pool, invoiceId, invoiceNumber) {
    const id = parseInt(invoiceId, 10);
    const next = String(invoiceNumber || '').trim();
    if (!id || !next) {
        const err = new Error('invoice id and invoice_number are required');
        err.status = 400;
        err.code = 'INVALID_INVOICE_NUMBER';
        throw err;
    }
    if (next.length > 64) {
        const err = new Error('invoice_number is too long (max 64)');
        err.status = 400;
        err.code = 'INVALID_INVOICE_NUMBER';
        throw err;
    }

    const { rows: existing } = await pool.query(
        `SELECT id, invoice_number, status, notes FROM client_invoices WHERE id = $1`,
        [id]
    );
    if (!existing.length) {
        const err = new Error('Invoice not found');
        err.status = 404;
        err.code = 'INVOICE_NOT_FOUND';
        throw err;
    }
    const inv = existing[0];
    const notes = parseInvoiceNotes(inv.notes);
    const isFv = notes.source === 'fixed_value_service_order'
        || !!notes.service_order_id
        || String(inv.notes || '').includes('fixed_value_service_order');
    if (!isFv) {
        const err = new Error('Only Fixed Value invoices can be renumbered from this registry');
        err.status = 400;
        err.code = 'NOT_FV_INVOICE';
        throw err;
    }
    if (String(inv.status || '').toLowerCase() === 'voided') {
        const err = new Error('Cannot edit invoice number on a Voided invoice');
        err.status = 409;
        err.code = 'INVOICE_NOT_EDITABLE';
        throw err;
    }

    if (String(inv.invoice_number) === next) {
        return inv;
    }

    const { rows: clash } = await pool.query(
        `SELECT id FROM client_invoices WHERE invoice_number = $1 AND id <> $2 LIMIT 1`,
        [next, id]
    );
    if (clash.length) {
        const err = new Error(`Invoice number ${next} is already in use`);
        err.status = 409;
        err.code = 'INVOICE_NUMBER_TAKEN';
        err.details = { invoiceNumber: next, existingId: clash[0].id };
        throw err;
    }

    const { rows } = await pool.query(
        `UPDATE client_invoices
         SET invoice_number = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, next]
    );
    return rows[0];
}

async function printInvoiceHtml(pool, invoiceRow, format) {
    const soId = parseInvoiceNotes(invoiceRow.notes).service_order_id;
    const soById = await loadServiceOrdersByIds(pool, soId ? [soId] : []);
    const inv = enrichInvoiceRow(invoiceRow, soById);
    const notes = inv.notes || {};
    const so = soId ? soById.get(soId) : null;

    // Prefer live SO deductions (absence shortages) so reprints stay accurate after attendance re-apply.
    let deductions = Array.isArray(notes.deductions) ? notes.deductions : [];
    if (soId && inv.period_month && inv.period_year) {
        try {
            deductions = await listDeductions(pool, soId, inv.period_month, inv.period_year);
        } catch (_) { /* keep stamped notes */ }
    }

    let lineItems = typeof inv.line_items === 'string'
        ? (() => { try { return JSON.parse(inv.line_items); } catch { return []; } })()
        : (inv.line_items || []);

    // Attach SO line roles / ids when persisted invoice rows only stored amount/description.
    if (so?.lines?.length) {
        lineItems = lineItems.map((li, idx) => {
            const match = so.lines.find((l) => l.id === li.lineId || l.id === li.line_id)
                || so.lines[idx]
                || null;
            return {
                ...li,
                lineId: li.lineId || li.line_id || match?.id,
                name: li.name || match?.name,
                description: li.description || match?.name,
                roles: li.roles || match?.roles || [],
                isManpowerDependent: li.isManpowerDependent ?? match?.is_manpower_dependent,
                soLineNumber: li.soLineNumber || match?.meta?.so_line || match?.so_line_number || (idx + 1),
            };
        });
    }

    const payload = {
        invoiceNumber: inv.invoice_number,
        clientName: inv.client,
        contractName: inv.contract,
        siteCode: inv.site_code || notes.site_code,
        siteName: inv.site_name || notes.site_name,
        resources: inv.resources != null ? inv.resources : notes.resources,
        province: inv.province || notes.province,
        periodMonth: inv.period_month,
        periodYear: inv.period_year,
        lineItems,
        deductions,
        netTaxable: inv.subtotal,
        provincialSt: inv.sales_tax,
        grandTotal: inv.grand_total,
        incomeWht: inv.wht,
        stWithholding: notes.st_withholding,
        netReceivable: notes.net_receivable,
        taxRate: notes.tax_rate,
        gross: notes.gross,
        totalDeductions: notes.total_deductions != null
            ? notes.total_deductions
            : deductions.reduce((s, d) => s + Number(d.amount || 0), 0),
        poNumber: inv.po_number,
        ntn: notes.ntn,
        strn: notes.strn,
    };
    return renderInvoiceHtml({ computed: payload }, { format });
}

module.exports = {
    ST_WITHHOLDING_RATE,
    FV_REGENERATABLE_STATUSES,
    listDeductions,
    addManualDeduction,
    computeSoInvoice,
    persistSoInvoice,
    updateFvInvoiceNumber,
    listRegistry,
    printInvoiceHtml,
    resolveTaxRate,
    parseInvoiceNotes,
    resourcesFromLines,
    enrichInvoiceRow,
};
