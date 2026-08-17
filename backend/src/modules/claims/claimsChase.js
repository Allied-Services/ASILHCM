'use strict';

const FINISHED = new Set(['on_sheet', 'other_data', 'ready_import', 'no_claims', 'rejected', 'closed']);
const INVITE_OK = new Set(['not_invited']);
const FILLER_REMIND_OK = new Set(['invite_sent', 'waiting_focal', 'waiting_employee', 'waiting_fill']);
const APPROVER_REMIND_OK = new Set(['waiting_lm', 'waiting_asil']);

function uniqueEmails(people, field) {
    const seen = new Set();
    const out = [];
    for (const p of people) {
        const email = String(p[field] || '').trim().toLowerCase();
        if (!email || !email.includes('@') || seen.has(email)) continue;
        seen.add(email);
        out.push({
            email: p[field],
            employee_id: p.employee_id,
            name: p.name,
        });
    }
    return out;
}

function planChase({ people, action, force }) {
    const send = [];
    const skipped = [];
    const act = String(action || '');
    for (const p of people || []) {
        if (!force && FINISHED.has(p.status)) {
            skipped.push({
                employee_id: p.employee_id,
                name: p.name,
                status: p.status,
                reason: 'already_finished',
            });
            continue;
        }
        if (act === 'invite' && !force && !INVITE_OK.has(p.status)) {
            skipped.push({
                employee_id: p.employee_id,
                name: p.name,
                status: p.status,
                reason: 'already_invited',
            });
            continue;
        }
        if (act === 'remind_filler' && !force && !FILLER_REMIND_OK.has(p.status)) {
            skipped.push({
                employee_id: p.employee_id,
                name: p.name,
                status: p.status,
                reason: 'not_waiting_filler',
            });
            continue;
        }
        if (act === 'remind_approver' && !force && !APPROVER_REMIND_OK.has(p.status)) {
            skipped.push({
                employee_id: p.employee_id,
                name: p.name,
                status: p.status,
                reason: 'not_waiting_approver',
            });
            continue;
        }
        if (act === 'remind_filler' && !p.batch_id) {
            skipped.push({
                employee_id: p.employee_id,
                name: p.name,
                status: p.status,
                reason: 'no_invite_batch',
            });
            continue;
        }
        if (act === 'remind_approver' && !p.period_id) {
            skipped.push({
                employee_id: p.employee_id,
                name: p.name,
                status: p.status,
                reason: 'no_period',
            });
            continue;
        }
        send.push(p);
    }

    const toField = act === 'remind_approver' ? 'lm' : 'mailed_to';
    return {
        send,
        skipped,
        targets: uniqueEmails(send, toField),
    };
}

module.exports = {
    FINISHED,
    INVITE_OK,
    FILLER_REMIND_OK,
    APPROVER_REMIND_OK,
    uniqueEmails,
    planChase,
};
