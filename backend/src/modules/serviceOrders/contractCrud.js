'use strict';

const path = require('path');
const fs = require('fs');
const {
    PSO_CONTRACT_ID,
    PSO_CONTRACT_NAME,
    PSO_SERVICE_TYPE,
    CONTRACT_START,
    CONTRACT_END,
    EMP_ID_PREFIX,
    siteProvince,
} = require('./sitesMeta');
const { soIdForSite, upsertServiceOrder, replaceLines, listServiceOrders, getServiceOrder } = require('./crud');

const PSO_CLIENT_ID = 'CLI-PSO-NORTH-ZONE';
const PSO_CLIENT_NAME = 'Pakistan State Oil Company Limited';
const FOCAL_SITES = new Set(['MORGAH', 'CHAKPIRANA', 'SIHALA']);
const CORO_EXPECTED_GROSS = 4136919.94;

function round2(n) {
    return Math.round(Number(n) * 100) / 100;
}

function loadSeedJson(relPath) {
    const candidates = [
        path.join(__dirname, 'seedData', relPath),
        path.join(__dirname, '../../../../scripts/seeds', relPath),
        path.join(process.cwd(), 'scripts/seeds', relPath),
        path.join(process.cwd(), '../scripts/seeds', relPath),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    throw new Error(`PSO seed file not found: ${relPath}`);
}

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

function notFound(message) {
    const err = new Error(message);
    err.status = 404;
    return err;
}

/**
 * Resolve PSO client id without inventing a second PSO client.
 * Prefer CLI-PSO-NORTH-ZONE when present; else sole PSO name match; else create canonical id.
 */
async function resolvePsoClientId(db, { createIfMissing = true } = {}) {
    const byId = await db.query(`SELECT id, name FROM clients WHERE id = $1`, [PSO_CLIENT_ID]);
    if (byId.rows[0]) return byId.rows[0].id;

    const byName = await db.query(
        `SELECT id, name FROM clients WHERE name ILIKE '%Pakistan State Oil%' ORDER BY id`
    );
    if (byName.rows.length === 1) return byName.rows[0].id;
    if (byName.rows.length > 1) {
        const preferred = byName.rows.find(r => r.id === PSO_CLIENT_ID) || byName.rows[0];
        return preferred.id;
    }
    if (!createIfMissing) return null;

    await db.query(
        `INSERT INTO clients (id, name, industry, ntn, strn)
         VALUES ($1,$2,'Oil & Gas','','')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [PSO_CLIENT_ID, PSO_CLIENT_NAME]
    );
    return PSO_CLIENT_ID;
}

async function upsertFvPolicy(db, contractId, policy = {}, dates = {}) {
    const billingModel = policy.billing_model || 'service_order_deduction';
    const attendanceMode = policy.attendance_input_mode || 'full_ledger';
    const wht = policy.income_tax_wht_pct != null ? Number(policy.income_tax_wht_pct) : 15;
    const creditDays = policy.credit_days != null ? Number(policy.credit_days) : 30;
    const salesTaxRate = policy.sales_tax_rate != null ? Number(policy.sales_tax_rate) : null;
    const salesTaxExempt = !!policy.sales_tax_exempt;
    const bonusMonths = policy.bonus_accrual_months != null ? Number(policy.bonus_accrual_months) : 0;
    const gratuityMonths = policy.gratuity_accrual_months != null ? Number(policy.gratuity_accrual_months) : 12;
    const effectiveFrom = policy.effective_from || dates.start_date || new Date().toISOString().slice(0, 10);
    const effectiveTo = policy.effective_to || dates.end_date || null;

    const { rows: existing } = await db.query(
        `SELECT id FROM contract_policies
         WHERE contract_id = $1
         ORDER BY effective_from DESC, id DESC
         LIMIT 1`,
        [contractId]
    );

    if (existing.length) {
        const { rows } = await db.query(
            `UPDATE contract_policies SET
               billing_model = $2,
               attendance_input_mode = $3,
               income_tax_wht_pct = $4,
               credit_days = $5,
               sales_tax_rate = $6,
               sales_tax_exempt = $7,
               bonus_accrual_months = $8,
               gratuity_accrual_months = $9,
               effective_from = $10,
               effective_to = $11
             WHERE id = $1
             RETURNING *`,
            [
                existing[0].id, billingModel, attendanceMode, wht, creditDays,
                salesTaxRate, salesTaxExempt, bonusMonths, gratuityMonths,
                effectiveFrom, effectiveTo,
            ]
        );
        return rows[0];
    }

    const { rows } = await db.query(
        `INSERT INTO contract_policies
         (contract_id, billing_model, attendance_input_mode, income_tax_wht_pct, service_charge_pct,
          credit_days, sales_tax_rate, sales_tax_exempt, bonus_accrual_months, gratuity_accrual_months,
          effective_from, effective_to)
         VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
            contractId, billingModel, attendanceMode, wht, creditDays,
            salesTaxRate, salesTaxExempt, bonusMonths, gratuityMonths,
            effectiveFrom, effectiveTo,
        ]
    );
    return rows[0];
}

async function upsertSiteAndLines(db, {
    clientId, contractId, site, actor,
}) {
    const siteCode = site.site_code || site.siteCode;
    const name = site.name;
    if (!siteCode || !name) throw badRequest('Each site requires site_code and name');

    const province = site.province
        || site.meta?.province
        || siteProvince(siteCode, { soMeta: site.meta || {} });

    const locRes = await db.query(
        `INSERT INTO client_locations (client_id, contract_id, name, province, is_active)
         VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (client_id, name) DO UPDATE SET
           contract_id = EXCLUDED.contract_id,
           province = EXCLUDED.province,
           is_active = true
         RETURNING id`,
        [clientId, contractId, name, province]
    );
    const locationId = locRes.rows[0]?.id;

    const soId = site.so_id || site.id || soIdForSite(siteCode);
    const meta = {
        siteCode,
        province,
        ...(site.meta || {}),
    };
    if (meta.taxRate == null && site.taxRate != null) meta.taxRate = site.taxRate;

    const lines = (site.lines || []).map((l, idx) => ({
        line_number: l.line_number || String(idx + 1),
        name: l.name,
        unit: l.unit || 'MON',
        quantity: l.quantity != null ? Number(l.quantity) : 1,
        rate: Number(l.rate || 0),
        total_amount: Number(l.total_amount ?? l.rate ?? 0),
        is_manpower_dependent: !!(l.is_manpower_dependent ?? l.isManpowerDependent),
        roles: l.roles || [],
    }));
    const totalValue = lines.reduce((s, l) => s + Number(l.rate || 0), 0);

    await upsertServiceOrder(db, {
        id: soId,
        contract_id: contractId,
        site_code: siteCode,
        name,
        so_number: site.so_number || siteCode,
        location_id: locationId,
        status: site.status || 'active',
        meta,
        total_value: totalValue,
    }, actor);

    await replaceLines(db, soId, lines);
    return { soId, siteCode, locationId, total_value: totalValue, lineCount: lines.length };
}

function validateCoroLineSum(meta, sites) {
    const product = meta?.fv_product;
    if (product !== 'coro_retail_ops') return;
    const expected = Number(meta.expected_monthly_gross != null ? meta.expected_monthly_gross : CORO_EXPECTED_GROSS);
    const sum = (sites || []).reduce((acc, site) => (
        acc + (site.lines || []).reduce((s, l) => s + Number(l.rate || 0), 0)
    ), 0);
    if (round2(sum) !== round2(expected)) {
        throw badRequest(
            `CORO line rates must sum to ${expected.toFixed(2)} (got ${round2(sum).toFixed(2)})`
        );
    }
}

async function getFixedValueContract(pool, contractId) {
    const { rows } = await pool.query(
        `SELECT c.*, cl.name AS client_name, cl.ntn AS client_ntn, cl.strn AS client_strn,
                cp.billing_model, cp.attendance_input_mode, cp.income_tax_wht_pct,
                cp.sales_tax_rate, cp.sales_tax_exempt, cp.credit_days AS policy_credit_days,
                cp.effective_from, cp.effective_to, cp.bonus_accrual_months, cp.gratuity_accrual_months
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN LATERAL (
             SELECT *
             FROM contract_policies
             WHERE contract_id = c.id
             ORDER BY effective_from DESC, id DESC
             LIMIT 1
         ) cp ON true
         WHERE c.id = $1`,
        [contractId]
    );
    if (!rows[0]) return null;
    const contract = rows[0];
    const serviceOrders = await listServiceOrders(pool, { contractId });
    return { ...contract, service_orders: serviceOrders };
}

async function createFixedValueContract(pool, payload = {}, actor) {
    const {
        id,
        client_id: clientIdIn,
        client: clientPayload,
        contract_name: contractName,
        service_type: serviceType = PSO_SERVICE_TYPE,
        location = '',
        start_date: startDate,
        end_date: endDate,
        headcount = 0,
        region_province: regionProvince = 'Punjab',
        credit_days: creditDays = 30,
        costs = {},
        financials = {},
        meta = {},
        policy = {},
        sites = [],
        end_of_service: endOfService = 'Gratuity',
        status = 'Active',
    } = payload;

    if (!id) throw badRequest('contract id is required');
    if (!contractName) throw badRequest('contract_name is required');
    if (!startDate || !endDate) throw badRequest('start_date and end_date are required');
    if (!sites.length) throw badRequest('At least one site/service order is required');

    const billingModel = policy.billing_model || 'service_order_deduction';
    if (billingModel !== 'service_order_deduction' && billingModel !== 'fixed_value') {
        throw badRequest('Fixed Value contracts require billing_model service_order_deduction or fixed_value');
    }

    validateCoroLineSum(meta, sites);

    const db = await pool.connect();
    try {
        await db.query('BEGIN');

        let clientId = clientIdIn || clientPayload?.id;
        if (clientPayload && clientPayload.id && clientPayload.name) {
            await db.query(
                `INSERT INTO clients (id, name, industry, ntn, strn)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (id) DO UPDATE SET
                   name = EXCLUDED.name,
                   ntn = COALESCE(NULLIF(EXCLUDED.ntn, ''), clients.ntn),
                   strn = COALESCE(NULLIF(EXCLUDED.strn, ''), clients.strn)`,
                [
                    clientPayload.id, clientPayload.name, clientPayload.industry || '',
                    clientPayload.ntn || '', clientPayload.strn || '',
                ]
            );
            clientId = clientPayload.id;
        }
        if (!clientId) {
            clientId = await resolvePsoClientId(db, { createIfMissing: true });
        } else {
            const exists = await db.query(`SELECT id FROM clients WHERE id = $1`, [clientId]);
            if (!exists.rows.length) {
                throw badRequest(`client_id ${clientId} not found`);
            }
        }

        await db.query(
            `INSERT INTO contracts
             (id, client_id, contract_name, location, service_type, headcount, status,
              start_date, end_date, costs, financials, end_of_service, region_province, credit_days, meta)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (id) DO UPDATE SET
               client_id = EXCLUDED.client_id,
               contract_name = EXCLUDED.contract_name,
               location = EXCLUDED.location,
               service_type = EXCLUDED.service_type,
               headcount = EXCLUDED.headcount,
               status = EXCLUDED.status,
               start_date = EXCLUDED.start_date,
               end_date = EXCLUDED.end_date,
               costs = EXCLUDED.costs,
               financials = EXCLUDED.financials,
               end_of_service = EXCLUDED.end_of_service,
               region_province = EXCLUDED.region_province,
               credit_days = EXCLUDED.credit_days,
               meta = EXCLUDED.meta`,
            [
                id, clientId, contractName, location, serviceType, Number(headcount) || 0, status,
                startDate, endDate,
                JSON.stringify(costs || {}),
                JSON.stringify(financials || {}),
                endOfService,
                regionProvince,
                Number(creditDays) || 30,
                JSON.stringify(meta || {}),
            ]
        );

        await upsertFvPolicy(db, id, { ...policy, billing_model: billingModel }, {
            start_date: startDate,
            end_date: endDate,
        });

        const soResults = [];
        for (const site of sites) {
            soResults.push(await upsertSiteAndLines(db, {
                clientId, contractId: id, site, actor,
            }));
        }

        await db.query('COMMIT');
        const detail = await getFixedValueContract(pool, id);
        return { ok: true, contract: detail, service_orders: soResults, actor: actor || null };
    } catch (e) {
        await db.query('ROLLBACK');
        throw e;
    } finally {
        db.release();
    }
}

async function updateFixedValueContract(pool, contractId, payload = {}, actor) {
    const existing = await getFixedValueContract(pool, contractId);
    if (!existing) throw notFound('Contract not found');

    const {
        contract_name: contractName = existing.contract_name,
        location = existing.location,
        service_type: serviceType = existing.service_type,
        headcount = existing.headcount,
        start_date: startDate = existing.start_date,
        end_date: endDate = existing.end_date,
        region_province: regionProvince = existing.region_province,
        credit_days: creditDays = existing.credit_days,
        costs = existing.costs || {},
        financials = existing.financials || {},
        meta: metaPatch,
        policy,
        sites,
        status = existing.status,
        client_id: clientId = existing.client_id,
        end_of_service: endOfService = existing.end_of_service,
    } = payload;

    const prevMeta = typeof existing.meta === 'string'
        ? JSON.parse(existing.meta || '{}')
        : (existing.meta || {});
    const meta = metaPatch != null ? { ...prevMeta, ...metaPatch } : prevMeta;

    if (sites) validateCoroLineSum(meta, sites);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `UPDATE contracts SET
               client_id = $2,
               contract_name = $3,
               location = $4,
               service_type = $5,
               headcount = $6,
               status = $7,
               start_date = $8,
               end_date = $9,
               costs = $10,
               financials = $11,
               end_of_service = $12,
               region_province = $13,
               credit_days = $14,
               meta = $15
             WHERE id = $1`,
            [
                contractId, clientId, contractName, location, serviceType,
                Number(headcount) || 0, status, startDate, endDate,
                JSON.stringify(typeof costs === 'string' ? JSON.parse(costs) : (costs || {})),
                JSON.stringify(typeof financials === 'string' ? JSON.parse(financials) : (financials || {})),
                endOfService, regionProvince, Number(creditDays) || 30,
                JSON.stringify(meta || {}),
            ]
        );

        if (policy) {
            await upsertFvPolicy(client, contractId, policy, {
                start_date: startDate,
                end_date: endDate,
            });
        }

        const soResults = [];
        if (Array.isArray(sites)) {
            for (const site of sites) {
                soResults.push(await upsertSiteAndLines(client, {
                    clientId, contractId, site, actor,
                }));
            }
        }

        await client.query('COMMIT');
        const detail = await getFixedValueContract(pool, contractId);
        return { ok: true, contract: detail, service_orders: soResults, actor: actor || null };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

function padEmpNum(n) {
    return String(n).padStart(3, '0');
}

async function syncNorthZoneEmployees(client, sites, workers) {
    await client.query(
        `DELETE FROM employees e
         WHERE e.id LIKE $1
           AND NOT EXISTS (SELECT 1 FROM payroll_transactions pt WHERE pt.employee_id = e.id)
           AND NOT EXISTS (SELECT 1 FROM payment_ledger pl WHERE pl.employee_id = e.id)`,
        [`${EMP_ID_PREFIX}%`]
    );

    let empSeq = 1;
    for (const w of workers) {
        const salary = Number(w.basicSalary || 0) + Number(w.allowance || 0);
        const site = sites.find(s => s.id === w.siteId);
        const bankName = w.bankCode ? `Bank ${w.bankCode}` : null;
        const eobiNo = w.eobi != null ? String(w.eobi) : '400';
        const sessiNo = w.socialSecurity != null ? String(w.socialSecurity) : '400';
        const location = site?.name || w.siteId;
        const province = siteProvince(w.siteId);

        if (w.cnic) {
            const existing = await client.query(
                `SELECT id FROM employees WHERE cnic = $1 LIMIT 1`,
                [w.cnic]
            );
            if (existing.rows[0]) {
                await client.query(
                    `UPDATE employees SET
                       name = $2, designation = $3, client = $4, contract_id = $5, contract_name = $6,
                       location = $7, site = $8, province = $9, salary = $10, active = 'Yes',
                       bank_account = $11, bank_name = $12, eobi_no = $13, sessi_no = $14, dept = 'Conservancy'
                     WHERE id = $1`,
                    [
                        existing.rows[0].id, w.name, w.designation, PSO_CLIENT_NAME, PSO_CONTRACT_ID,
                        PSO_CONTRACT_NAME, location, w.siteId, province, salary,
                        w.bankAccount || null, bankName, eobiNo, sessiNo,
                    ]
                );
                continue;
            }
        }

        const empId = `${EMP_ID_PREFIX}${padEmpNum(empSeq)}`;
        empSeq += 1;
        await client.query(
            `INSERT INTO employees
             (id, name, cnic, designation, client, contract_id, contract_name, location, site, province,
              salary, active, bank_account, bank_name, eobi_no, sessi_no, dept)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Yes',$12,$13,$14,$15,'Conservancy')
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               cnic = EXCLUDED.cnic,
               designation = EXCLUDED.designation,
               client = EXCLUDED.client,
               contract_id = EXCLUDED.contract_id,
               contract_name = EXCLUDED.contract_name,
               location = EXCLUDED.location,
               site = EXCLUDED.site,
               province = EXCLUDED.province,
               salary = EXCLUDED.salary,
               bank_account = EXCLUDED.bank_account,
               bank_name = EXCLUDED.bank_name,
               active = 'Yes'`,
            [
                empId, w.name, w.cnic || null, w.designation, PSO_CLIENT_NAME, PSO_CONTRACT_ID,
                PSO_CONTRACT_NAME, location, w.siteId, province, salary,
                w.bankAccount || null, bankName, eobiNo, sessiNo,
            ]
        );
    }
    return workers.length;
}

/**
 * Re-sync North Zone SO lines/meta from pso_sites.json.
 * Employees synced only when syncEmployees=true or contract was missing.
 */
async function resyncNorthZoneFromSeed(pool, { confirm = false, syncEmployees = false, actor } = {}) {
    if (!confirm) throw badRequest('confirm:true is required to re-sync North Zone from seed JSON');

    const sites = loadSeedJson('pso_sites.json');
    const workers = loadSeedJson('pso_workers.json');

    const existing = await pool.query(`SELECT id FROM contracts WHERE id = $1`, [PSO_CONTRACT_ID]);
    const contractMissing = !existing.rows.length;
    const shouldSyncEmployees = syncEmployees || contractMissing;

    const sitePayload = sites.map((site) => {
        const meta = {
            siteCode: site.id,
            requiredAt: site.requiredAt,
            taxRate: site.taxRate,
            hasEquipment: site.hasEquipment,
            equipmentRequired: site.equipmentRequired || [],
            contractMonths: site.lineItems?.[0]?.quantity || 12,
            province: siteProvince(site.id),
        };
        if (FOCAL_SITES.has(site.id)) {
            meta.focalEnabled = true;
            meta.focalEmail = site.focalEmail || '';
        }
        return {
            site_code: site.id,
            name: site.name,
            province: siteProvince(site.id),
            so_id: soIdForSite(site.id),
            so_number: site.id,
            meta,
            lines: (site.lineItems || []).map((l, idx) => ({
                line_number: String(idx + 1),
                name: l.name,
                unit: l.unit || 'MON',
                quantity: 1,
                rate: l.rate,
                total_amount: l.rate,
                is_manpower_dependent: !!l.isManpowerDependent,
                roles: l.roles || [],
            })),
        };
    });

    const result = await createFixedValueContract(pool, {
        id: PSO_CONTRACT_ID,
        client_id: await resolvePsoClientId(pool, { createIfMissing: true }),
        client: { id: PSO_CLIENT_ID, name: PSO_CLIENT_NAME, industry: 'Oil & Gas' },
        contract_name: PSO_CONTRACT_NAME,
        service_type: PSO_SERVICE_TYPE,
        location: 'North Zone',
        start_date: CONTRACT_START,
        end_date: CONTRACT_END,
        headcount: workers.length,
        region_province: 'Punjab',
        credit_days: 30,
        costs: { eobi: 400, life_insurance: 150, bonus_months: 0, eosb_type: 'Gratuity' },
        financials: { wht_pct: 15, service_charges_pct: 0, credit_cycle_days: 30 },
        meta: {
            fv_product: 'conservancy_multi_site',
            contract_months: 12,
            sla: { summary: 'PSO North Zone Conservancy', retention_pct: 0 },
        },
        policy: {
            billing_model: 'service_order_deduction',
            attendance_input_mode: 'full_ledger',
            income_tax_wht_pct: 15,
            credit_days: 30,
            bonus_accrual_months: 0,
            gratuity_accrual_months: 12,
            effective_from: CONTRACT_START,
            effective_to: CONTRACT_END,
        },
        sites: sitePayload,
    }, actor);

    let employeesSynced = 0;
    if (shouldSyncEmployees) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            employeesSynced = await syncNorthZoneEmployees(client, sites, workers);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    const tarujabba = sites.find(s => s.id === 'TARUJABBA');
    const taruGross = tarujabba.lineItems.reduce((s, l) => s + Number(l.rate || 0), 0);
    const taruSt = Math.round(taruGross * tarujabba.taxRate);
    const taruGrand = taruGross + taruSt;

    return {
        ok: true,
        contractId: PSO_CONTRACT_ID,
        clientId: result.contract?.client_id || PSO_CLIENT_ID,
        sites: sites.length,
        workers: workers.length,
        employeesSynced,
        deprecatedSeedAlias: true,
        tarujabbaCheck: {
            gross: taruGross,
            salesTax: taruSt,
            grand: taruGrand,
            expected: { gross: 2156300, salesTax: 323445, grand: 2479745 },
            pass: taruGross === 2156300 && taruSt === 323445 && taruGrand === 2479745,
        },
    };
}

async function createCoroFromSeed(pool, { actor } = {}) {
    const data = loadSeedJson('pso_coro_ss94.json');
    const clientId = await resolvePsoClientId(pool, { createIfMissing: true });
    return createFixedValueContract(pool, {
        id: data.contractId,
        client_id: clientId,
        client: { id: clientId === PSO_CLIENT_ID ? PSO_CLIENT_ID : clientId, name: PSO_CLIENT_NAME, industry: 'Oil & Gas' },
        contract_name: data.contractName,
        service_type: data.serviceType || PSO_SERVICE_TYPE,
        location: data.location,
        start_date: data.startDate,
        end_date: data.endDate,
        headcount: data.headcount,
        region_province: data.regionProvince,
        credit_days: data.creditDays,
        costs: data.costs,
        financials: data.financials,
        meta: data.meta,
        policy: {
            ...data.policy,
            effective_from: data.startDate,
            effective_to: data.endDate,
        },
        sites: data.sites,
    }, actor);
}

module.exports = {
    getFixedValueContract,
    createFixedValueContract,
    updateFixedValueContract,
    resyncNorthZoneFromSeed,
    createCoroFromSeed,
    resolvePsoClientId,
    loadSeedJson,
    CORO_EXPECTED_GROSS,
    PSO_CLIENT_ID,
    PSO_CLIENT_NAME,
    getServiceOrder,
};
