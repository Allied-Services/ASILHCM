'use strict';

const {
    chaseRouteForPerson,
    deskStatusFromInternal,
    DESK_FINISHED,
} = require('./claimsDesk');

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

function planSmartReminder({ people, force }) {
    const send = [];
    const skipped = [];
    const fillerTargets = new Map();
    const approverTargets = new Map();

    for (const p of people || []) {
        const desk = deskStatusFromInternal(p.status);
        if (!force && DESK_FINISHED.has(desk)) {
            skipped.push({
                employee_id: p.employee_id,
                name: p.name,
                status: p.status,
                desk_status: desk,
                reason: 'already_finished',
            });
            continue;
        }
        const route = chaseRouteForPerson(p);
        if (!route.target) {
            skipped.push({
                employee_id: p.employee_id,
                name: p.name,
                status: p.status,
                desk_status: desk,
                reason: route.reason || 'not_remindable',
            });
            continue;
        }
        if (route.target === 'filler' && !p.batch_id) {
            skipped.push({
                employee_id: p.employee_id,
                name: p.name,
                status: p.status,
                reason: 'no_invite_batch',
            });
            continue;
        }
        if (route.target === 'approver' && (!p.period_id || !route.email)) {
            skipped.push({
                employee_id: p.employee_id,
                name: p.name,
                status: p.status,
                reason: 'no_approver',
            });
            continue;
        }
        send.push({ ...p, remind_target: route.target, remind_email: route.email });
        if (route.target === 'filler') {
            const key = String(p.batch_id);
            if (!fillerTargets.has(key)) {
                fillerTargets.set(key, { batch_id: p.batch_id, email: route.email, employees: [] });
            }
            fillerTargets.get(key).employees.push(p.employee_id);
        } else {
            const key = `${p.period_id}:${String(route.email).toLowerCase()}`;
            if (!approverTargets.has(key)) {
                approverTargets.set(key, {
                    period_id: p.period_id,
                    email: route.email,
                    employees: [],
                });
            }
            approverTargets.get(key).employees.push(p.employee_id);
        }
    }

    const targets = [
        ...[...fillerTargets.values()].map((t) => ({
            route: 'filler',
            email: t.email,
            batch_id: t.batch_id,
            employee_count: t.employees.length,
        })),
        ...[...approverTargets.values()].map((t) => ({
            route: 'approver',
            email: t.email,
            period_id: t.period_id,
            employee_count: t.employees.length,
        })),
    ];

    return {
        send,
        skipped,
        targets,
        filler_batches: [...fillerTargets.values()],
        approver_packs: [...approverTargets.values()],
    };
}

module.exports = {
    FINISHED,
    INVITE_OK,
    FILLER_REMIND_OK,
    APPROVER_REMIND_OK,
    uniqueEmails,
    planChase,
    planSmartReminder,
};
