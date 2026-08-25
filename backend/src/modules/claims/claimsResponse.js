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

function normalizeRouting(profile) {
    return String(profile || 'focal_then_lm').toLowerCase();
}

function isEmployeeFiller(profile) {
    return normalizeRouting(profile).startsWith('employee');
}

function decidedByRole(profile) {
    const p = normalizeRouting(profile);
    if (p === 'focal_only') return 'Focal';
    if (p === 'employee_then_asil') return 'ASIL';
    return 'LM';
}

function fillerWaitStatus(profile) {
    return isEmployeeFiller(profile) ? 'waiting_employee' : 'waiting_focal';
}

function approverWaitStatus(profile) {
    const p = normalizeRouting(profile);
    if (p === 'employee_then_asil') return 'waiting_asil';
    if (p === 'focal_only') return 'waiting_focal';
    return 'waiting_lm';
}

function mailerResult(batch) {
    if (!batch) return { mailer: 'not_sent', sent_at: null };
    const sentAt = batch.invite_sent_at || null;
    if (sentAt && batch.invite_delivered === false) return { mailer: 'send_failed', sent_at: sentAt };
    if (sentAt || batch.invite_delivered) return { mailer: 'sent', sent_at: sentAt };
    return { mailer: 'not_sent', sent_at: null };
}

function shortReminderDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short' });
}

function nowLabel({ status, mailedTo, lm, decidedBy, decidedEmail, lastReminderAt }) {
    const to = mailedTo || '—';
    const approver = lm || decidedEmail || '—';
    let base;
    if (status === 'not_invited') base = 'Not invited';
    else if (status === 'invite_sent') base = `Invite sent · waiting ${to} to start`;
    else if (status === 'waiting_focal') base = `Waiting Focal to fill (${to})`;
    else if (status === 'waiting_employee') base = `Waiting Employee to fill (${to})`;
    else if (status === 'waiting_lm') base = `Waiting LM to approve (${approver})`;
    else if (status === 'waiting_asil') base = `Waiting ASIL to approve (${approver})`;
    else if (status === 'no_claims') base = 'No claims this month';
    else if (status === 'rejected') base = `Rejected by ${decidedBy} (${approver})`;
    else if (status === 'on_sheet' || status === 'other_data' || status === 'ready_import') {
        base = `Approved by ${decidedBy} (${approver})`;
    } else if (status === 'waiting_fill') base = `Waiting fill (${to})`;
    else if (status === 'closed') base = 'Finished · nothing to pay';
    else base = status;

    const remindable = ['invite_sent', 'waiting_focal', 'waiting_employee', 'waiting_fill', 'waiting_lm', 'waiting_asil'];
    if (lastReminderAt && remindable.includes(status)) {
        const when = shortReminderDate(lastReminderAt);
        if (when) return `${base} · reminder ${when}`;
    }
    return base;
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
    routingProfile,
}) {
    const status = String(subStatus || '').toLowerCase();
    const other = sheetHasValues(sheet);
    const hasPortal = portalHasValues(portal);
    const match = amountsMatch(portal, sheet);
    const profile = normalizeRouting(routingProfile);

    if (!status) return inviteSent ? 'invite_sent' : 'not_invited';
    if (status === 'rejected') return 'rejected';
    if (status === 'no_claims') return 'no_claims';
    if (status === 'submitted') return approverWaitStatus(profile);
    if (status === 'invited') return 'invite_sent';
    if (status === 'draft' || status === 'in_progress') return fillerWaitStatus(profile);
    if (status === 'approved' || status === 'in_payroll') {
        if (sample) return hasPortal ? 'ready_import' : 'no_claims';
        if (hasPortal && match) return 'on_sheet';
        if (hasPortal && other && !match) return 'other_data';
        if (hasPortal && !other) return 'ready_import';
        if (!hasPortal && other) return 'other_data';
        return 'no_claims';
    }
    return fillerWaitStatus(profile);
}

function emptyCounts() {
    return {
        not_invited: 0,
        invite_sent: 0,
        waiting_focal: 0,
        waiting_employee: 0,
        waiting_fill: 0,
        waiting_lm: 0,
        waiting_asil: 0,
        no_claims: 0,
        rejected: 0,
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

function isSampleMode(mode) {
    return String(mode || '').toLowerCase() === 'sample';
}

function isPollutedTestEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return !e || e.includes('@test.asil') || e.startsWith('sample.');
}

function resolveMailedTo({ sub, rosterEmp, batch, routingProfile }) {
    const profile = normalizeRouting((sub && sub.routing_profile) || rosterEmp.routing_profile || routingProfile);
    const roster = rosterEmp.filler_email || null;
    const fromSub = sub && sub.filler_email ? String(sub.filler_email).trim() : null;
    const fromBatch = batch && batch.filler_email ? String(batch.filler_email).trim() : null;
    if (isEmployeeFiller(profile)) {
        return roster || fromSub || fromBatch;
    }
    if (isPollutedTestEmail(fromSub)) return roster || fromBatch || fromSub;
    if (isPollutedTestEmail(fromBatch)) return roster || fromSub || fromBatch;
    return fromSub || roster || fromBatch;
}

function pickSubmission(rows, actualPeriodId = null) {
    if (!rows || !rows.length) return null;
    const actual = rows.filter((r) => !isSampleMode(r.campaign_mode));
    if (!actual.length) return null;
    let pool = actual;
    if (actualPeriodId) {
        const onPeriod = actual.filter((r) => Number(r.period_id) === Number(actualPeriodId));
        if (onPeriod.length) pool = onPeriod;
    }
    return pool.sort((a, b) => Number(b.id) - Number(a.id))[0];
}

function pickActualPeriod(periods) {
    if (!periods || !periods.length) return null;
    return periods.find((p) => !isSampleMode(p.campaign_mode))
        || periods.sort((a, b) => Number(b.id) - Number(a.id))[0];
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
                    s.routing_profile, s.channel, s.batch_id, s.period_id, p.campaign_mode
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
            `SELECT id, period_id, filler_email, invite_sent_at, invite_delivered, last_reminder_at, reminder_count
             FROM portal_claim_batches WHERE period_id = ANY($1::int[])`,
            [periodIds]
        )
        : { rows: [] };

    const actualPeriod = pickActualPeriod(periods);
    const actualPeriodId = actualPeriod ? actualPeriod.id : null;

    const batchById = new Map(batchRows.map((b) => [b.id, b]));
    const batchByFocal = new Map();
    for (const b of batchRows) {
        if (!b.period_id || !b.filler_email) continue;
        const periodRow = periods.find((p) => Number(p.id) === Number(b.period_id));
        if (periodRow && isSampleMode(periodRow.campaign_mode)) continue;
        const key = `${b.period_id}:${String(b.filler_email).trim().toLowerCase()}`;
        const existing = batchByFocal.get(key);
        if (!existing || (b.invite_delivered && !existing.invite_delivered)) {
            batchByFocal.set(key, b);
        }
    }

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

    const counts = emptyCounts();
    const people = audience.map((e) => {
        const sub = pickSubmission(subsByEmp.get(e.id) || [], actualPeriodId);
        let batch = sub && sub.batch_id ? batchById.get(sub.batch_id) : null;
        if (!batch && actualPeriodId && e.filler_email) {
            const focalKey = `${actualPeriodId}:${String(e.filler_email).trim().toLowerCase()}`;
            batch = batchByFocal.get(focalKey) || null;
        }
        const portal = portalAmountsFromItems(sub ? (itemsBySub.get(sub.id) || []) : []);
        const sheetRow = sheetByEmp.get(e.id) || {};
        const sheet = sheetAmounts(sheetRow);
        const sample = !!(sub && isSampleMode(sub.campaign_mode));
        const routingProfile = (sub && sub.routing_profile) || e.routing_profile || 'focal_then_lm';
        const inviteSent = !!(batch && (batch.invite_delivered || batch.invite_sent_at));
        const mailedTo = resolveMailedTo({ sub, rosterEmp: e, batch, routingProfile });
        const lm = (sub && sub.approver_email) || e.approver_email || null;
        const decidedBy = decidedByRole(routingProfile);
        const decidedEmail = decidedBy === 'Focal' ? mailedTo : lm;
        const mail = mailerResult(batch);
        const status = classifyResponseRow({
            subStatus: sub && sub.status,
            inviteSent,
            portal,
            sheet: sheetRow,
            sample,
            routingProfile,
        });
        counts[status] = (counts[status] || 0) + 1;
        const lastReminderAt = batch && batch.last_reminder_at ? batch.last_reminder_at : null;
        const reminderCount = batch && batch.reminder_count != null ? Number(batch.reminder_count) : 0;
        return {
            employee_id: e.id,
            name: e.name,
            client: e.client,
            location: e.location,
            dept: e.dept,
            contract_id: e.contract_id,
            contract_name: e.contract_name,
            path: e.claims_category,
            routing_profile: routingProfile,
            mailed_to: mailedTo,
            lm,
            period_id: sub ? sub.period_id : (actualPeriodId || null),
            batch_id: sub ? sub.batch_id : (batch ? batch.id : null),
            submission_id: sub ? sub.id : null,
            submission_status: sub ? sub.status : null,
            sample,
            status,
            mailer: mail.mailer,
            sent_at: mail.sent_at,
            last_reminder_at: lastReminderAt,
            reminder_count: reminderCount,
            decided_by: ['on_sheet', 'other_data', 'ready_import', 'rejected'].includes(status) ? decidedBy : null,
            decided_email: ['on_sheet', 'other_data', 'ready_import', 'rejected'].includes(status) ? decidedEmail : null,
            now_label: nowLabel({
                status, mailedTo, lm, decidedBy, decidedEmail, lastReminderAt,
            }),
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

    const primary = pickActualPeriod(periods) || periods[0] || null;
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
    decidedByRole,
    mailerResult,
    nowLabel,
    filterAudience,
    pickSubmission,
    pickActualPeriod,
    resolveMailedTo,
    isPollutedTestEmail,
    shortReminderDate,
    writePortalAmountsToSheet,
    listResponseBoard,
};
