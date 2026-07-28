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
                unit: l.unit || 'MON',
                quantity: l.quantity != null ? l.quantity : 1,
                rate: l.rate,
                total_amount: l.totalAmount ?? l.rate,
                is_manpower_dependent: !!l.isManpowerDependent,
                roles: l.roles || [],
            })));
        }

        const cnicList = workers.map(w => w.cnic).filter(Boolean);
        if (cnicList.length) {
            await client.query(
                `DELETE FROM employees
                 WHERE id LIKE $1
                    OR (
                      cnic = ANY($2::text[])
                      AND (
                        client ILIKE '%PSO%'
                        OR contract_name ILIKE '%Conservancy%'
                        OR contract_name ILIKE '%PSO%'
                        OR contract_id = $3
                      )
                    )`,
                [`${EMP_ID_PREFIX}%`, cnicList, PSO_CONTRACT_ID]
            );
        } else {
            await client.query(`DELETE FROM employees WHERE id LIKE $1`, [`${EMP_ID_PREFIX}%`]);
        }

        let empSeq = 1;
        for (const w of workers) {
            const empId = `${EMP_ID_PREFIX}${padEmpNum(empSeq)}`;
            empSeq += 1;
            const salary = Number(w.basicSalary || 0) + Number(w.allowance || 0);
            const site = sites.find(s => s.id === w.siteId);
            await client.query(
                `INSERT INTO employees
                 (id, name, cnic, designation, client, contract_id, contract_name, location, site, province,
                  salary, active, bank_account, bank_name, eobi_no, sessi_no, dept)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Yes',$12,$13,$14,$15,'Conservancy')
                 ON CONFLICT (id) DO UPDATE SET
                   name = EXCLUDED.name,
                   cnic = EXCLUDED.cnic,
                   designation = EXCLUDED.designation,
                   location = EXCLUDED.location,
                   site = EXCLUDED.site,
                   province = EXCLUDED.province,
                   salary = EXCLUDED.salary,
                   bank_account = EXCLUDED.bank_account,
                   active = 'Yes'`,
                [
                    empId,
                    w.name,
                    w.cnic,
                    w.designation,
                    PSO_CLIENT_NAME,
                    PSO_CONTRACT_ID,
                    PSO_CONTRACT_NAME,
                    site?.name || w.siteId,
                    w.siteId,
                    siteProvince(w.siteId),
                    salary,
                    w.bankAccount || null,
                    w.bankCode ? `Bank ${w.bankCode}` : null,
                    w.eobi != null ? String(w.eobi) : '400',
                    w.socialSecurity != null ? String(w.socialSecurity) : '400',
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
