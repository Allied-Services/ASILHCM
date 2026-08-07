'use strict';

const { listServiceOrders, getServiceOrder } = require('./crud');
const { pullAttendanceForSite } = require('./driveAttendance');
const { applyAttendance } = require('./attendanceIngest');
const { computeSoInvoice, persistSoInvoice, listDeductions } = require('./billing');
const { assertContractConfirmations } = require('./billableConfirmations');
const { activeEmployeeSqlClause } = require('../../core/employeeActive');

/**
 * Drive-pull + apply attendance for every service order under a contract.
 * Returns per-site progress rows (frontend can also drive sites one-by-one for live UI).
 */
async function applyAttendanceAllSites(pool, { contractId, month, year, actor, siteCodes }) {
    const orders = await listServiceOrders(pool, { contractId });
    const filtered = Array.isArray(siteCodes) && siteCodes.length
        ? orders.filter((o) => siteCodes.includes(o.site_code))
        : orders;

    const results = [];
    let overrides = 0;
    let deductions = 0;
    let okCount = 0;

    for (const so of filtered) {
        const row = {
            siteCode: so.site_code,
            soId: so.id,
            siteName: so.name,
            ok: false,
            pullOk: false,
            overrides: 0,
            deductions: 0,
            skipped: 0,
            errors: 0,
            code: null,
            fileName: null,
            message: null,
        };
        try {
            const pulled = await pullAttendanceForSite({ siteCode: so.site_code, month, year });
            row.pullOk = !!pulled.ok;
            row.code = pulled.code || null;
            row.fileName = pulled.fileName || null;
            if (!pulled.ok) {
                row.message = pulled.code || 'drive_pull_failed';
                results.push(row);
                continue;
            }
            const parseRows = pulled.parse?.rows || [];
            const summary = await applyAttendance(pool, {
                serviceOrderId: so.id,
                month,
                year,
                rows: parseRows,
                actor,
            });
            row.ok = true;
            row.overrides = summary.overrides || 0;
            row.deductions = summary.deductions || 0;
            row.skipped = (summary.skipped || []).length;
            row.errors = (summary.errors || []).length;
            row.skipReasons = summary.skipped || [];
            row.applyErrors = summary.errors || [];
            overrides += row.overrides;
            deductions += row.deductions;
            okCount += 1;
        } catch (err) {
            console.error('[fixed-value.applyAttendanceAllSites]', so.site_code, err);
            row.message = 'Internal error applying attendance';
        }
        results.push(row);
    }

    return {
        ok: true,
        contractId,
        month,
        year,
        sites: results.length,
        okCount,
        overrides,
        deductions,
        results,
    };
}

async function computeInvoicesAllSites(pool, { contractId, month, year, siteCodes }) {
    await assertContractConfirmations(pool, contractId, month, year, siteCodes);
    const orders = await listServiceOrders(pool, { contractId });
    const filtered = Array.isArray(siteCodes) && siteCodes.length
        ? orders.filter((o) => siteCodes.includes(o.site_code))
        : orders;

    const sites = [];
    let gross = 0;
    let shortage = 0;
    let salesTax = 0;
    let grandTotal = 0;
    let netReceivable = 0;

    for (const so of filtered) {
        const computed = await computeSoInvoice(pool, { serviceOrderId: so.id, month, year });
        sites.push(computed);
        gross += Number(computed.gross || 0);
        shortage += Number(computed.totalDeductions || 0);
        salesTax += Number(computed.provincialSt || 0);
        grandTotal += Number(computed.grandTotal || 0);
        netReceivable += Number(computed.netReceivable || 0);
    }

    return {
        ok: true,
        contractId,
        month,
        year,
        sites,
        totals: {
            sites: sites.length,
            gross: Math.round(gross * 100) / 100,
            shortage: Math.round(shortage * 100) / 100,
            salesTax: Math.round(salesTax * 100) / 100,
            grandTotal: Math.round(grandTotal * 100) / 100,
            netReceivable: Math.round(netReceivable * 100) / 100,
        },
    };
}

async function persistInvoicesAllSites(pool, { contractId, month, year, generatedBy, siteCodes }) {
    await assertContractConfirmations(pool, contractId, month, year, siteCodes);
    const orders = await listServiceOrders(pool, { contractId });
    const filtered = Array.isArray(siteCodes) && siteCodes.length
        ? orders.filter((o) => siteCodes.includes(o.site_code))
        : orders;

    const invoices = [];
    for (const so of filtered) {
        const result = await persistSoInvoice(pool, {
            serviceOrderId: so.id,
            month,
            year,
            generatedBy,
        });
        invoices.push({
            siteCode: so.site_code,
            siteName: so.name,
            invoice: result.invoice,
            computed: result.computed,
        });
    }
    return { ok: true, contractId, month, year, count: invoices.length, invoices };
}

async function attendanceStatusBySite(pool, { contractId, month, year }) {
    const orders = await listServiceOrders(pool, { contractId });
    const out = [];
    for (const so of orders) {
        const deductions = await listDeductions(pool, so.id, month, year);
        const { rows: ovCount } = await pool.query(
            `SELECT COUNT(*)::int AS n
             FROM monthly_attendance_overrides o
             JOIN employees e ON e.id = o.employee_id
             WHERE o.period_month = $1 AND o.period_year = $2
               AND o.source = 'fv_conservancy_attendance'
               AND (e.site = $3 OR e.location ILIKE $4)
               AND ${activeEmployeeSqlClause('e', {
                   lwdFloorSql: `make_date($2::int, $1::int, 1)`,
               })}`,
            [month, year, so.site_code, `%${so.site_code}%`]
        );
        out.push({
            siteCode: so.site_code,
            soId: so.id,
            siteName: so.name,
            overrideCount: ovCount[0]?.n || 0,
            deductionCount: deductions.length,
            status: (ovCount[0]?.n || 0) > 0 ? 'done' : 'not_started',
        });
    }
    return out;
}

module.exports = {
    applyAttendanceAllSites,
    computeInvoicesAllSites,
    persistInvoicesAllSites,
    attendanceStatusBySite,
    getServiceOrder,
};
