'use strict';

const EPS_HRS = 0.009;
const EPS_PKR = 0.5;

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function portalAmountsFromItems(items) {
    let ot1 = 0;
    let ot2 = 0;
    let ot3 = 0;
    let expense = 0;
    let medical = 0;
    for (const i of items || []) {
        if (i.claim_type === 'OT') {
            const h = num(i.ot_hours);
            const f = num(i.ot_multiplier_factor) || 1;
            if (f >= 3) ot3 += h;
            else if (f >= 2) ot2 += h;
            else ot1 += h;
        } else if (i.claim_type === 'EXPENSE') {
            expense += num(i.amount);
        } else if (i.claim_type === 'MEDICAL') {
            medical += num(i.amount);
        }
    }
    return {
        ot1,
        ot2,
        ot3,
        ot2Write: ot2 + (ot1 * 0.5),
        expense,
        medical,
    };
}

function sheetAmounts(row) {
    return {
        ot2: num(row && row.ot2_hrs),
        ot3: num(row && row.ot3_hrs),
        medical: num(row && row.opd_claim),
        expense: num(row && row.reimbursement),
        locked: !!(row && row.locked),
    };
}

function sheetHasValues(sheet) {
    const s = sheetAmounts(sheet);
    return s.ot2 > EPS_HRS || s.ot3 > EPS_HRS || s.medical > EPS_PKR || s.expense > EPS_PKR;
}

function portalHasValues(portal) {
    const p = portal || {};
    return num(p.ot2Write) > EPS_HRS || num(p.ot3) > EPS_HRS
        || num(p.medical) > EPS_PKR || num(p.expense) > EPS_PKR;
}

function amountsMatch(portal, sheet) {
    const p = portal || {};
    const s = sheetAmounts(sheet);
    return Math.abs(num(p.ot2Write) - s.ot2) <= EPS_HRS
        && Math.abs(num(p.ot3) - s.ot3) <= EPS_HRS
        && Math.abs(num(p.medical) - s.medical) <= EPS_PKR
        && Math.abs(num(p.expense) - s.expense) <= EPS_PKR;
}

/**
 * One status per audience employee. Sample periods never count as on-sheet.
 */
function classifyResponseRow({
    subStatus,
    inviteSent,
    portal,
    sheet,
    sample,
}) {
    const status = String(subStatus || '').toLowerCase();
    const other = sheetHasValues(sheet);
    const hasPortal = portalHasValues(portal);
    const match = amountsMatch(portal, sheet);

    if (!status) return inviteSent ? 'invite_sent' : 'not_invited';
    if (status === 'rejected' || status === 'no_claims') return 'closed';
    if (status === 'submitted') return 'waiting_lm';
    if (status === 'invited') return 'invite_sent';
    if (status === 'draft' || status === 'in_progress') return 'waiting_fill';
    if (status === 'approved' || status === 'in_payroll') {
        if (sample) return hasPortal ? 'ready_import' : 'closed';
        if (hasPortal && match) return 'on_sheet';
        if (hasPortal && other && !match) return 'other_data';
        if (hasPortal && !other) return 'ready_import';
        if (!hasPortal && other) return 'other_data';
        return 'closed';
    }
    return 'waiting_fill';
}

function emptyCounts() {
    return {
        not_invited: 0,
        invite_sent: 0,
        waiting_fill: 0,
        waiting_lm: 0,
        on_sheet: 0,
        other_data: 0,
        ready_import: 0,
        closed: 0,
    };
}

function filterAudience(eligible, { client, contract, location, dept }) {
    return (eligible || []).filter((e) => {
        if (client && String(e.client || '').toLowerCase() !== String(client).toLowerCase()) return false;
        if (contract && String(e.contract_id || '') !== String(contract)
            && String(e.contract_name || '') !== String(contract)) return false;
        if (location && String(e.location || '').toLowerCase() !== String(location).toLowerCase()) return false;
        if (dept && String(e.dept || '').toLowerCase() !== String(dept).toLowerCase()) return false;
        return true;
    });
}

function pickSubmission(rows) {
    if (!rows || !rows.length) return null;
    const actual = rows.filter((r) => String(r.campaign_mode || '').toLowerCase() !== 'sample');
    const pool = actual.length ? actual : rows;
    return pool.sort((a, b) => Number(b.id) - Number(a.id))[0];
}

async function writePortalAmountsToSheet(pool, { employeeId, month, year, portal }) {
    const { rows } = await pool.query(
        `SELECT ot2_hrs, ot3_hrs, opd_claim, reimbursement, locked
         FROM payroll_transactions WHERE employee_id = $1 AND month = $2 AND year = $3`,
        [employeeId, month, year]
    );
    const before = rows[0] || { ot2_hrs: 0, ot3_hrs: 0, opd_claim: 0, reimbursement: 0, locked: false };
    if (before.locked) {
        return { wrotePayroll: false, blocked: 'PAYROLL_LOCKED', before, portal };
    }
    if (sheetHasValues(before)) {
        return { wrotePayroll: false, blocked: 'SHEET_HAS_OTHER_DATA', before, portal };
    }
    const ot2Write = num(portal && portal.ot2Write);
    const ot3 = num(portal && portal.ot3);
    const exp = num(portal && portal.expense);
    const med = num(portal && portal.medical);
    if (!ot2Write && !ot3 && !exp && !med) {
        return { wrotePayroll: false, blocked: null, before, portal };
    }
    await pool.query(
        `INSERT INTO payroll_transactions (employee_id, month, year, ot2_hrs, ot3_hrs, opd_claim, reimbursement)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (employee_id, month, year) DO UPDATE SET
           ot2_hrs = EXCLUDED.ot2_hrs,
           ot3_hrs = EXCLUDED.ot3_hrs,
           opd_claim = EXCLUDED.opd_claim,
           reimbursement = EXCLUDED.reimbursement,
           updated_at = NOW()`,
        [employeeId, month, year, ot2Write, ot3, med, exp]
    );
    return { wrotePayroll: true, blocked: null, before, portal };
}

async function listResponseBoard(pool, countEligibleEmployees, opts) {
    const workMonth = parseInt(opts.workMonth, 10);
    const workYear = parseInt(opts.workYear, 10);
    const payMonth = parseInt(opts.payMonth, 10);
    const payYear = parseInt(opts.payYear, 10);
    if (!workMonth || !workYear || !payMonth || !payYear) {
        return { ok: false, status: 400, error: 'workMonth, workYear, payMonth, payYear required' };
    }

    const { eligible } = await countEligibleEmployees(pool);
    const audience = filterAudience(eligible, opts);
    const ids = audience.map((e) => e.id);

    const { rows: periods } = await pool.query(
        `SELECT id, campaign_mode, claim_month, claim_year, settlement_month, settlement_year,
                campaign_month, campaign_year
         FROM portal_claim_periods
         WHERE (claim_month = $1 AND claim_year = $2)
            OR (campaign_month = $1 AND campaign_year = $2)
            OR (settlement_month = $3 AND settlement_year = $4)
            OR (campaign_month = $3 AND campaign_year = $4)`,
        [workMonth, workYear, payMonth, payYear]
    );
    const periodIds = periods.map((p) => p.id);

    let submissions = [];
    let items = [];
    if (periodIds.length && ids.length) {
        const { rows: subRows } = await pool.query(
            `SELECT s.id, s.employee_id, s.status, s.filler_email, s.approver_email,
                    s.routing_profile, s.channel, s.batch_id, p.campaign_mode
             FROM portal_claim_submissions s
             JOIN portal_claim_periods p ON p.id = s.period_id
             WHERE s.period_id = ANY($1::int[]) AND s.employee_id = ANY($2::text[])`,
            [periodIds, ids]
        );
        submissions = subRows;
        const subIds = submissions.map((s) => s.id);
        if (subIds.length) {
            const { rows: itemRows } = await pool.query(
                `SELECT submission_id, claim_type, ot_hours, ot_multiplier_factor, amount
                 FROM portal_claim_items
                 WHERE submission_id = ANY($1::int[]) AND active = TRUE`,
                [subIds]
            );
            items = itemRows;
        }
    }

    const { rows: batchRows } = periodIds.length
        ? await pool.query(
            `SELECT id, filler_email, invite_sent_at, invite_delivered
             FROM portal_claim_batches WHERE period_id = ANY($1::int[])`,
            [periodIds]
        )
        : { rows: [] };

    const { rows: sheetRows } = ids.length
        ? await pool.query(
            `SELECT employee_id, ot2_hrs, ot3_hrs, opd_claim, reimbursement, locked
             FROM payroll_transactions
             WHERE month = $1 AND year = $2 AND employee_id = ANY($3::text[])`,
            [payMonth, payYear, ids]
        )
        : { rows: [] };

    const subsByEmp = new Map();
    for (const s of submissions) {
        if (!subsByEmp.has(s.employee_id)) subsByEmp.set(s.employee_id, []);
        subsByEmp.get(s.employee_id).push(s);
    }
    const itemsBySub = new Map();
    for (const i of items) {
        if (!itemsBySub.has(i.submission_id)) itemsBySub.set(i.submission_id, []);
        itemsBySub.get(i.submission_id).push(i);
    }
    const sheetByEmp = new Map(sheetRows.map((r) => [r.employee_id, r]));
    const batchById = new Map(batchRows.map((b) => [b.id, b]));

    const counts = emptyCounts();
    const people = audience.map((e) => {
        const sub = pickSubmission(subsByEmp.get(e.id) || []);
        const portal = portalAmountsFromItems(sub ? (itemsBySub.get(sub.id) || []) : []);
        const sheetRow = sheetByEmp.get(e.id) || {};
        const sheet = sheetAmounts(sheetRow);
        const sample = !!(sub && String(sub.campaign_mode || '').toLowerCase() === 'sample');
        const batch = sub && sub.batch_id ? batchById.get(sub.batch_id) : null;
        const inviteSent = !!(batch && (batch.invite_sent_at || batch.invite_delivered));
        const status = classifyResponseRow({
            subStatus: sub && sub.status,
            inviteSent,
            portal,
            sheet: sheetRow,
            sample,
        });
        counts[status] = (counts[status] || 0) + 1;
        return {
            employee_id: e.id,
            name: e.name,
            client: e.client,
            location: e.location,
            dept: e.dept,
            contract_id: e.contract_id,
            contract_name: e.contract_name,
            path: e.claims_category,
            routing_profile: e.routing_profile,
            mailed_to: (sub && sub.filler_email) || e.filler_email || null,
            lm: (sub && sub.approver_email) || e.approver_email || null,
            submission_id: sub ? sub.id : null,
            submission_status: sub ? sub.status : null,
            sample,
            status,
            portal: {
                ot1: portal.ot1,
                ot2: portal.ot2,
                ot3: portal.ot3,
                ot2Write: portal.ot2Write,
                medical: portal.medical,
                expense: portal.expense,
            },
            sheet: {
                ot2: sheet.ot2,
                ot3: sheet.ot3,
                medical: sheet.medical,
                expense: sheet.expense,
                locked: sheet.locked,
            },
            match: amountsMatch(portal, sheetRow),
            sheet_has_values: sheetHasValues(sheetRow),
        };
    });

    people.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    const primary = periods.find((p) => String(p.campaign_mode || '').toLowerCase() !== 'sample') || periods[0] || null;
    const inviteLogged = people.filter((p) => p.status !== 'not_invited').length;
    return {
        ok: true,
        work_month: workMonth,
        work_year: workYear,
        pay_month: payMonth,
        pay_year: payYear,
        audience_count: people.length,
        invite_logged: inviteLogged,
        period_label: primary
            ? `This send is ${primary.claim_month}/${primary.claim_year} work · paid ${primary.settlement_month}/${primary.settlement_year} · ${inviteLogged} invite(s) logged`
            : 'No portal-claims send is logged for this work / pay month pair',
        counts,
        people,
    };
}

module.exports = {
    EPS_HRS,
    EPS_PKR,
    portalAmountsFromItems,
    sheetAmounts,
    sheetHasValues,
    portalHasValues,
    amountsMatch,
    classifyResponseRow,
    filterAudience,
    pickSubmission,
    writePortalAmountsToSheet,
    listResponseBoard,
};
