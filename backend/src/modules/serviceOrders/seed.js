'use strict';

const path = require('path');
const fs = require('fs');
const {
    EMP_ID_PREFIX,
    PSO_CONTRACT_ID,
    PSO_CONTRACT_NAME,
    PSO_SERVICE_TYPE,
    CONTRACT_START,
    CONTRACT_END,
    siteProvince,
} = require('./sitesMeta');
const { soIdForSite, upsertServiceOrder, replaceLines } = require('./crud');

const PSO_CLIENT_ID = 'CLI-PSO-NORTH-ZONE';
const PSO_CLIENT_NAME = 'Pakistan State Oil Company Limited';
const FOCAL_SITES = new Set(['MORGAH', 'CHAKPIRANA', 'SIHALA']);

function loadJson(relPath) {
    const p = path.join(__dirname, '../../../../scripts/seeds', relPath);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function padEmpNum(n) {
    return String(n).padStart(3, '0');
}

async function seedPsoNorthZone(pool, { actor } = {}) {
    const sites = loadJson('pso_sites.json');
    const workers = loadJson('pso_workers.json');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `INSERT INTO clients (id, name, industry, ntn, strn)
             VALUES ($1,$2,'Oil & Gas','',$3)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
            [PSO_CLIENT_ID, PSO_CLIENT_NAME, '']
        );

        await client.query(
            `INSERT INTO contracts
             (id, client_id, contract_name, location, service_type, headcount, status, start_date, end_date,
              costs, financials, end_of_service, region_province, credit_days)
             VALUES ($1,$2,$3,'North Zone',$4,$5,'Active',$6,$7,$8,$9,'Gratuity','Punjab',30)
             ON CONFLICT (id) DO UPDATE SET
               client_id = EXCLUDED.client_id,
               contract_name = EXCLUDED.contract_name,
               service_type = EXCLUDED.service_type,
               start_date = EXCLUDED.start_date,
               end_date = EXCLUDED.end_date,
               costs = EXCLUDED.costs,
               financials = EXCLUDED.financials,
               end_of_service = EXCLUDED.end_of_service`,
            [
                PSO_CONTRACT_ID,
                PSO_CLIENT_ID,
                PSO_CONTRACT_NAME,
                PSO_SERVICE_TYPE,
                workers.length,
                CONTRACT_START,
                CONTRACT_END,
                JSON.stringify({
                    eobi: 400,
                    life_insurance: 150,
                    bonus_months: 0,
                    eosb_type: 'Gratuity',
                }),
                JSON.stringify({ wht_pct: 15, service_charges_pct: 0, credit_cycle_days: 30 }),
            ]
        );

        const policyCheck = await client.query(
            `SELECT id FROM contract_policies WHERE contract_id = $1 LIMIT 1`,
            [PSO_CONTRACT_ID]
        );
        if (!policyCheck.rows.length) {
            await client.query(
                `INSERT INTO contract_policies
                 (contract_id, billing_model, attendance_input_mode, income_tax_wht_pct, service_charge_pct,
                  credit_days, effective_from, effective_to)
                 VALUES ($1,'service_order_deduction','full_ledger',15,0,30,$2,$3)`,
                [PSO_CONTRACT_ID, CONTRACT_START, CONTRACT_END]
            );
        } else {
            await client.query(
                `UPDATE contract_policies SET billing_model = 'service_order_deduction', income_tax_wht_pct = 15
                 WHERE contract_id = $1`,
                [PSO_CONTRACT_ID]
            );
        }

        for (const site of sites) {
            const locRes = await client.query(
                `INSERT INTO client_locations (client_id, contract_id, name, province, is_active)
                 VALUES ($1,$2,$3,$4,true)
                 ON CONFLICT (client_id, name) DO UPDATE SET contract_id = EXCLUDED.contract_id, province = EXCLUDED.province
                 RETURNING id`,
                [PSO_CLIENT_ID, PSO_CONTRACT_ID, site.name, siteProvince(site.id)]
            );
            const locationId = locRes.rows[0]?.id;

            const soId = soIdForSite(site.id);
            const meta = {
                siteCode: site.id,
                requiredAt: site.requiredAt,
                taxRate: site.taxRate,
                hasEquipment: site.hasEquipment,
                equipmentRequired: site.equipmentRequired || [],
                contractMonths: site.lineItems?.[0]?.quantity || 12,
            };
            if (FOCAL_SITES.has(site.id)) {
                meta.focalEnabled = true;
                meta.focalEmail = site.focalEmail || '';
            }

            await upsertServiceOrder(client, {
                id: soId,
                contract_id: PSO_CONTRACT_ID,
                site_code: site.id,
                name: site.name,
                so_number: site.id,
                location_id: locationId,
                status: 'active',
                meta,
                total_value: site.lineItems.reduce((s, l) => s + Number(l.rate || 0), 0),
            }, actor);

            await replaceLines(client, soId, site.lineItems.map((l, idx) => ({
                line_number: String(idx + 1),
                name: l.name,
                // Bill monthly: keep contract months in meta, store qty=1 + monthly rate on the line.
                unit: l.unit || 'MON',
                quantity: 1,
                rate: l.rate,
                total_amount: l.rate,
                is_manpower_dependent: !!l.isManpowerDependent,
                roles: l.roles || [],
            })));
        }

        // Staging often has a prod-restored ASIL/PSO-* roster with payroll FKs.
        // Never hard-delete those; upsert by CNIC (unique) or by our NZ id prefix.
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

        await client.query('COMMIT');

        const tarujabba = sites.find(s => s.id === 'TARUJABBA');
        const taruGross = tarujabba.lineItems.reduce((s, l) => s + Number(l.rate || 0), 0);
        const taruSt = Math.round(taruGross * tarujabba.taxRate);
        const taruGrand = taruGross + taruSt;

        return {
            ok: true,
            contractId: PSO_CONTRACT_ID,
            clientId: PSO_CLIENT_ID,
            sites: sites.length,
            workers: workers.length,
            tarujabbaCheck: {
                gross: taruGross,
                salesTax: taruSt,
                grand: taruGrand,
                expected: { gross: 2156300, salesTax: 323445, grand: 2479745 },
                pass: taruGross === 2156300 && taruSt === 323445 && taruGrand === 2479745,
            },
        };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = { seedPsoNorthZone, PSO_CLIENT_ID, FOCAL_SITES };
