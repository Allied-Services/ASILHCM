'use strict';

/**
 * Export CTR-PSO-NORTH-ZONE location / unit rates to Excel for record keeping.
 *
 *   node backend/scripts/export_nz_so_unit_rates.js
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SEED = path.join(__dirname, '../src/modules/serviceOrders/seedData/pso_sites.json');
const OUT_DIR = path.join(__dirname, '../../audit/cutover');
const OUT = path.join(OUT_DIR, 'PSO_North_Zone_SO_Unit_Rates.xlsx');

const SITE_ORDER = [
    'MORGAH', 'CHAKPIRANA', 'FAQIRABAD', 'SIHALA', 'JUGLOT', 'CHITRAL',
    'TARUJABBA', 'SERAINOURANG', 'KOHAT', 'KUNDIAN', 'DGM_OPS', 'PR_FUELING',
];

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

function money(n) {
    return round2(n);
}

function main() {
    const sites = JSON.parse(fs.readFileSync(SEED, 'utf8'));
    const byId = new Map(sites.map((s) => [s.id, s]));

    const rateAoA = [[
        'Location',
        'Service group',
        'Designation',
        'Headcount',
        'Unit rate (Rs / month)',
        'Monthly total (Rs)',
        'Matches employee title',
    ]];
    const otherAoA = [[
        'Location',
        'Item',
        'Quantity',
        'Unit rate (Rs)',
        'Amount (Rs)',
    ]];
    const siteAoA = [[
        'Location',
        'Manpower headcount',
        'Manpower monthly (Rs)',
    ]];

    let grandHc = 0;
    let grandManpower = 0;

    for (const code of SITE_ORDER) {
        const site = byId.get(code);
        if (!site) continue;
        let siteHc = 0;
        let siteManpower = 0;
        let firstOnSite = true;

        for (const line of site.lineItems || []) {
            const roles = Array.isArray(line.roles) ? line.roles : [];
            if (roles.length) {
                for (const role of roles) {
                    const count = num(role.count) || 1;
                    const unit = num(role.rate);
                    const monthly = money(unit * count);
                    siteHc += count;
                    siteManpower += monthly;
                    grandHc += count;
                    grandManpower += monthly;
                    rateAoA.push([
                        firstOnSite ? site.name : '',
                        line.name || '',
                        role.designation || role.role || '',
                        count,
                        unit,
                        monthly,
                        role.keywords || '',
                    ]);
                    firstOnSite = false;
                }
            } else {
                const qty = num(line.quantity) || 1;
                const unit = num(line.rate);
                otherAoA.push([
                    site.name,
                    line.name || '',
                    qty,
                    unit,
                    money(num(line.totalAmount) || unit * qty),
                ]);
            }
        }

        siteAoA.push([site.name, siteHc, money(siteManpower)]);
        rateAoA.push(['', '', '', '', '', '', '']);
    }

    siteAoA.push(['NORTH ZONE TOTAL', grandHc, money(grandManpower)]);

    const notesAoA = [
        ['Field', 'Value'],
        ['Contract', 'CTR-PSO-NORTH-ZONE'],
        ['Client', 'Pakistan State Oil Company Limited'],
        ['As of', '22 Sep 2026'],
        ['What this file is', 'Record of nested Service Order unit rates in HCM after the corrected rate card was applied.'],
        ['Unit rate', 'Per person / per resource, per month (column L on the rate card).'],
        ['Monthly total', 'Headcount × unit rate.'],
        ['Shortage on invoice', 'Unit rate ÷ days in the month × days absent.'],
        ['Example', 'Sihala Sweeping / Cleaning = 52,043. One August day (31 days) = 1,678.81 (Almas, Janitor).'],
        ['Faqirabad Conservancy Supervisory', '60,222'],
        ['Manpower sheet', 'People services used for absence deductions.'],
        ['Other charges sheet', 'Consumables, garbage, sand, gravel, tractor, etc. Quantity is the SO quantity (not people).'],
    ];

    const wb = XLSX.utils.book_new();
    const wsRates = XLSX.utils.aoa_to_sheet(rateAoA);
    const wsOther = XLSX.utils.aoa_to_sheet(otherAoA);
    const wsSites = XLSX.utils.aoa_to_sheet(siteAoA);
    const wsNotes = XLSX.utils.aoa_to_sheet(notesAoA);

    wsRates['!cols'] = [
        { wch: 28 }, { wch: 46 }, { wch: 52 }, { wch: 12 },
        { wch: 22 }, { wch: 20 }, { wch: 28 },
    ];
    wsOther['!cols'] = [{ wch: 28 }, { wch: 70 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    wsSites['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 24 }];
    wsNotes['!cols'] = [{ wch: 36 }, { wch: 100 }];

    XLSX.utils.book_append_sheet(wb, wsRates, 'Manpower unit rates');
    XLSX.utils.book_append_sheet(wb, wsOther, 'Other charges');
    XLSX.utils.book_append_sheet(wb, wsSites, 'Site totals');
    XLSX.utils.book_append_sheet(wb, wsNotes, 'How to read');

    fs.mkdirSync(OUT_DIR, { recursive: true });
    XLSX.writeFile(wb, OUT);
    console.log(JSON.stringify({
        file: OUT,
        manpowerRows: grandHc,
        locations: SITE_ORDER.length,
        monthlyManpower: money(grandManpower),
    }, null, 2));
}

main();
