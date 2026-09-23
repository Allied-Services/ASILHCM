#!/usr/bin/env node
'use strict';

/**
 * Put live PSO CORO OPS SS94 (CTR-1785569435995) on the same Service Order
 * shape as North Conservancy: line.rate = monthly invoice amount, role.rate =
 * per-person unit, Cash Management not manpower.
 *
 * Does not write client_invoices and does not change employee salaries.
 *
 *   node backend/scripts/update_coro_ss94_service_order.js
 *   node backend/scripts/update_coro_ss94_service_order.js --apply --allow-production
 */

const fs = require('fs');
const path = require('path');

function loadModule(name) {
    const extras = [
        path.join(__dirname, '../node_modules', name),
        path.join(__dirname, '../../node_modules', name),
    ];
    for (const p of extras) {
        try { return require(p); } catch { /* next */ }
    }
    return require(name);
}

function loadEnv() {
    const p = path.join(__dirname, '../.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (!m) continue;
        const k = m[1].trim();
        if (!process.env[k]) process.env[k] = m[2].trim().replace(/^["']|["']$/g, '');
    }
}

const CONTRACT_ID = 'CTR-1785569435995';
const SO_ID = 'SO-PSO-CORO-SS94';
const EXPECTED_GROSS = 4136919.94;
const SITE_NAME = 'PSO CORO SS94 Masood Anwari';

function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

function isProdUrl(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (u.includes('ci-test') || u.includes('staging') || u.includes('restore-test') || u.includes('asil_hcm_dev')) return false;
    if (u.includes('localhost') || u.includes('127.0.0.1')) return false;
    return true;
}

function seedLines() {
    const file = path.join(__dirname, '../src/modules/serviceOrders/seedData/pso_coro_ss94.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.sites[0].lines;
}

function dateOnly(v) {
    if (!v) return null;
    const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}

async function main() {
    loadEnv();
    const apply = process.argv.includes('--apply');
    const allowProd = process.argv.includes('--allow-production');
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL is not set');
        process.exit(2);
    }
    if (isProdUrl(url) && apply && !allowProd) {
        console.error('Refusing production apply without --allow-production');
        process.exit(2);
    }

    const { Pool } = loadModule('pg');
    const { updateFixedValueContract } = require('../src/modules/serviceOrders/contractCrud');
    const { upsertClaimsPolicy } = require('../src/modules/claims/claimsPolicy');
    const { getServiceOrder } = require('../src/modules/serviceOrders/crud');
    const { mapLinesForInvoice, confirmationMapFromRows } = require('../src/modules/serviceOrders/billableConfirmations');
    const { renderInvoiceHtml } = require('../src/modules/serviceOrders/invoiceHtml');
    const { resourcesFromLines, ST_WITHHOLDING_RATE } = require('../src/modules/serviceOrders/billing');

    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
    const lines = seedLines();
    const gross = round2(lines.reduce((s, l) => s + Number(l.rate || 0), 0));
    if (gross !== EXPECTED_GROSS) {
        throw new Error(`Line rates sum to ${gross}, expected ${EXPECTED_GROSS}`);
    }

    const { rows: contracts } = await pool.query(
        `SELECT id, contract_name, client_id, headcount, service_type, status, location,
                to_char(start_date, 'YYYY-MM-DD') AS start_date,
                to_char(end_date, 'YYYY-MM-DD') AS end_date,
                region_province, credit_days, costs, financials, meta,
                end_of_service, client_focal_name, client_focal_email
         FROM contracts WHERE id = $1`,
        [CONTRACT_ID]
    );
    const contract = contracts[0];
    if (!contract) throw new Error(`Contract ${CONTRACT_ID} not found`);

    const { rows: locs } = await pool.query(
        `SELECT id, name, contract_id FROM client_locations
         WHERE client_id = $1 AND (name ILIKE '%CORO%' OR name ILIKE '%SS94%' OR name ILIKE '%Masood%')`,
        [contract.client_id]
    );

    const startDate = dateOnly(contract.start_date) || '2026-07-01';
    const endDate = dateOnly(contract.end_date) || '2027-06-30';
    const financials = {
        ...(contract.financials || {}),
        wht_pct: 15,
        service_charges_pct: 0,
        credit_cycle_days: Number(contract.credit_days) || Number(contract.financials?.credit_cycle_days) || 30,
    };
    const meta = {
        ...(contract.meta || {}),
        fv_product: 'coro_retail_ops',
        external_so_number: '4110036239',
        vendor_code: '7771004670',
        indent_no: '1180001910',
        tender_ref: 'CS-A4832-SZR',
        contract_months: 12,
        expected_monthly_gross: EXPECTED_GROSS,
        security_deposit: {
            amount: 900000,
            currency: 'PKR',
            notes: 'PO/DD 28570303 dated 19.05.2026 Rs.900,000 (1.5%) + 8.5% from running bills → 10% retention',
        },
        sla: {
            summary: 'CORO OPS SS94 Masood Anwari — Agreement for Operating Company Owned Retail Outlets',
            tat_penalties_text: 'TAT non-compliance: 1st warning; 2nd 2%; 3rd 3%; thereafter max 5% of monthly service charge. HSE LD min 5% of monthly bill. Delivery LD 0.1%/day capped 10%.',
            retention_pct: 10,
        },
        invoice_notes_default: 'SO 4110036239 — Operational Services Required for Company Operated Outlets at SS 94 (Masood Anwari) – Lahore Division',
    };

    const plan = {
        contract_id: CONTRACT_ID,
        contract_name: contract.contract_name,
        service_type: 'Fixed Value / Conservancy',
        headcount: 64,
        region_province: contract.region_province || 'Punjab',
        start_date: startDate,
        end_date: endDate,
        so_id: SO_ID,
        site_name: SITE_NAME,
        existing_locations: locs,
        gross,
        lines: lines.map((l) => ({
            line_number: l.line_number,
            name: l.name,
            monthly: l.rate,
            manpower: !!l.is_manpower_dependent,
            count: l.roles[0].count,
            unit: l.roles[0].rate,
            keywords: l.roles[0].keywords || '',
        })),
        mode: apply ? 'apply' : 'dry-run',
    };
    console.log(JSON.stringify(plan, null, 2));
    if (!apply) {
        await pool.end();
        return;
    }

    await updateFixedValueContract(pool, CONTRACT_ID, {
        contract_name: contract.contract_name,
        location: contract.location || 'Lahore',
        service_type: 'Fixed Value / Conservancy',
        headcount: 64,
        start_date: startDate,
        end_date: endDate,
        region_province: contract.region_province || 'Punjab',
        credit_days: Number(contract.credit_days) || 30,
        costs: contract.costs || {},
        financials,
        meta,
        status: contract.status || 'Active',
        client_id: contract.client_id,
        end_of_service: contract.end_of_service || 'Gratuity',
        client_focal_name: contract.client_focal_name,
        client_focal_email: contract.client_focal_email,
        policy: {
            billing_model: 'service_order_deduction',
            attendance_input_mode: 'absent_only',
            income_tax_wht_pct: 15,
            sales_tax_rate: 0.16,
            sales_tax_exempt: false,
            credit_days: Number(contract.credit_days) || 30,
            bonus_accrual_months: 0,
            gratuity_accrual_months: 12,
            effective_from: startDate,
            effective_to: endDate,
        },
        sites: [{
            site_code: 'SS94',
            name: SITE_NAME,
            province: 'Punjab',
            so_id: SO_ID,
            so_number: '4110036239',
            meta: {
                siteCode: 'SS94',
                province: 'Punjab',
                taxRate: 0.16,
                requiredAt: 'PSO SS 94 (Masood Anwari) Lahore',
                contractMonths: 12,
                focalEnabled: false,
                focalEmail: '',
            },
            lines,
        }],
    }, 'coro-so-north-zone-shape');

    await pool.query(
        `UPDATE contract_policies
            SET commercial_type = 'fixed_value',
                billing_model = 'service_order_deduction',
                sales_tax_rate = 0.16,
                sales_tax_exempt = FALSE
          WHERE id = (
            SELECT id FROM contract_policies
             WHERE contract_id = $1
             ORDER BY effective_from DESC NULLS LAST, id DESC
             LIMIT 1
          )`,
        [CONTRACT_ID]
    );

    await upsertClaimsPolicy(pool, CONTRACT_ID, {
        enabled_types: ['ATTENDANCE', 'OT'],
        claims_pay_timing: 'following_month',
        reviewer_required: false,
    });

    const so = await getServiceOrder(pool, SO_ID);
    if (!so) throw new Error('Service order missing after update');
    const storedGross = round2((so.lines || []).reduce((s, l) => s + Number(l.rate || 0), 0));
    const manpowerHeads = (so.lines || [])
        .filter((l) => l.is_manpower_dependent)
        .reduce((n, l) => n + (l.roles || []).reduce((a, r) => a + Number(r.count || 0), 0), 0);
    const cash = (so.lines || []).find((l) => /cash management/i.test(l.name || ''));
    if (storedGross !== EXPECTED_GROSS) throw new Error(`Stored gross ${storedGross}`);
    if (manpowerHeads !== 64) throw new Error(`Manpower headcount ${manpowerHeads}`);
    if (!cash || cash.is_manpower_dependent) throw new Error('Cash Management must be not manpower');
    if ((so.lines || []).length !== 5) throw new Error('Expected 5 lines');

    const confirmationRows = (so.lines || [])
        .filter((l) => !l.is_manpower_dependent)
        .map((l) => ({ line_id: l.id, billable: true }));
    const confirmationMap = confirmationMapFromRows(confirmationRows);
    const grossLines = mapLinesForInvoice(so.lines, confirmationMap).map(({ line: l, billable, quantity, rate, amount }) => ({
        lineId: l.id,
        description: l.name,
        quantity,
        rate,
        amount: round2(amount),
        billable,
        isManpowerDependent: !!(l.is_manpower_dependent || l.isManpowerDependent),
        roles: l.roles || [],
        soLineNumber: l.line_number,
    }));
    const invoiceGross = round2(grossLines.reduce((s, l) => s + l.amount, 0));
    const pst = round2(invoiceGross * 0.16);
    const grand = round2(invoiceGross + pst);
    const incomeWht = round2(invoiceGross * 0.15);
    const stWithholding = round2(pst * ST_WITHHOLDING_RATE);
    const netReceivable = round2(grand - incomeWht - stWithholding);
    if (invoiceGross !== EXPECTED_GROSS || pst !== 661907.19 || grand !== 4798827.13) {
        throw new Error(`Sample totals ${invoiceGross} / ${pst} / ${grand}`);
    }

    const { rows: clients } = await pool.query(`SELECT name, ntn, strn FROM clients WHERE id = $1`, [contract.client_id]);
    const computed = {
        invoiceNumber: 'SAMPLE-AUG26-CORO',
        periodMonth: 8,
        periodYear: 2026,
        siteName: SITE_NAME,
        siteCode: 'SS94',
        resources: resourcesFromLines(so.lines),
        poNumber: '4110036239',
        province: 'Punjab',
        clientName: clients[0]?.name || 'Pakistan State Oil Company Limited',
        contractName: contract.contract_name,
        ntn: '0520872-6',
        lineItems: grossLines,
        deductions: [],
        gross: invoiceGross,
        totalShortages: 0,
        totalAdjustments: 0,
        totalDeductions: 0,
        netTaxable: invoiceGross,
        taxRate: 0.16,
        provincialSt: pst,
        salesTax: pst,
        subtotal: invoiceGross,
        grandTotal: grand,
        incomeWht,
        wht: incomeWht,
        stWithholding,
        netReceivable,
        whtPct: 0.15,
    };
    const html = renderInvoiceHtml({ computed }, { format: 'invoice' });
    const outDir = path.join(__dirname, '../../audit/cutover');
    fs.mkdirSync(outDir, { recursive: true });
    const htmlPath = path.join(outDir, 'coro_ss94_aug2026_sample_invoice.html');
    fs.writeFileSync(htmlPath, html);

    let pdfPath = null;
    const chromeCandidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ].filter(Boolean);
    const chrome = chromeCandidates.find((p) => fs.existsSync(p));
    if (chrome) {
        process.env.PUPPETEER_EXECUTABLE_PATH = chrome;
        const { htmlToPdf } = require('../src/core/htmlToPdf');
        const pdf = await htmlToPdf(html);
        if (pdf) {
            pdfPath = path.join(outDir, 'coro_ss94_aug2026_sample_invoice.pdf');
            fs.writeFileSync(pdfPath, pdf);
        }
    }

    const proof = {
        contract_id: CONTRACT_ID,
        so_id: SO_ID,
        gross: invoiceGross,
        provincial_st: pst,
        grand,
        income_wht: incomeWht,
        st_withholding: stWithholding,
        net_receivable: netReceivable,
        resources: computed.resources,
        cash_management_manpower: false,
        sample_includes_cash_management: true,
        persisted_invoice: false,
        html: htmlPath,
        pdf: pdfPath,
        lines: (so.lines || []).map((l) => ({
            line_number: l.line_number,
            name: l.name,
            rate: Number(l.rate),
            is_manpower_dependent: !!l.is_manpower_dependent,
            roles: l.roles,
        })),
    };
    const proofPath = path.join(outDir, 'coro_ss94_so_update_report.json');
    fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof, null, 2));
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
