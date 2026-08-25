'use strict';

const EPS_HRS = 0.009;
const EPS_PKR = 0.5;

const DESK_LABEL = {
    not_invited: 'Not invited',
    invite_sent: 'Invite sent',
    pending_focal: 'Pending at Focal',
    pending_lm: 'Pending at LM',
    verified: 'Verified',
    no_claims: 'No claims',
    rejected: 'Rejected',
    other_data: 'OTHER DATA',
};

const DESK_FINISHED = new Set(['verified', 'no_claims', 'rejected', 'other_data']);

const FILLER_PENDING_INTERNAL = new Set(['invite_sent', 'waiting_focal', 'waiting_employee', 'waiting_fill']);
const APPROVER_PENDING_INTERNAL = new Set(['waiting_lm', 'waiting_asil']);

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function deskStatusFromInternal(internalStatus) {
    const s = String(internalStatus || '').toLowerCase();
    if (s === 'not_invited') return 'not_invited';
    if (s === 'invite_sent') return 'invite_sent';
    if (FILLER_PENDING_INTERNAL.has(s)) return 'pending_focal';
    if (APPROVER_PENDING_INTERNAL.has(s)) return 'pending_lm';
    if (s === 'on_sheet' || s === 'ready_import') return 'verified';
    if (s === 'other_data') return 'other_data';
    if (s === 'no_claims') return 'no_claims';
    if (s === 'rejected') return 'rejected';
    if (s === 'closed') return 'verified';
    return 'not_invited';
}

function deskLabel(deskStatus) {
    return DESK_LABEL[deskStatus] || deskStatus;
}

function emptyDeskCounts() {
    return {
        not_invited: 0,
        invite_sent: 0,
        pending_focal: 0,
        pending_lm: 0,
        verified: 0,
        no_claims: 0,
        rejected: 0,
        other_data: 0,
    };
}

function formatClaimSummary(portal) {
    const p = portal || {};
    const parts = [];
    const ot2 = num(p.ot2Write);
    const ot3 = num(p.ot3);
    const med = num(p.medical);
    const exp = num(p.expense);
    if (ot2 > EPS_HRS) parts.push(`OT2 ${Math.round(ot2 * 10) / 10}h`);
    if (ot3 > EPS_HRS) parts.push(`OT3 ${Math.round(ot3 * 10) / 10}h`);
    if (med > EPS_PKR) parts.push(`Med ${Math.round(med).toLocaleString('en-PK')}`);
    if (exp > EPS_PKR) parts.push(`Exp ${Math.round(exp).toLocaleString('en-PK')}`);
    return parts.length ? parts.join(' · ') : '—';
}

function computeLastActivity({ batch, sub }) {
    const candidates = [];
    if (batch && batch.invite_opened_at) {
        candidates.push({ at: batch.invite_opened_at, label: 'Portal opened' });
    }
    if (sub && sub.submitted_at) {
        candidates.push({ at: sub.submitted_at, label: 'Submitted' });
    }
    if (sub && sub.approved_at) {
        candidates.push({ at: sub.approved_at, label: 'Approved' });
    }
    if (!candidates.length) return { last_activity_at: null, last_activity_label: null };
    candidates.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const top = candidates[0];
    return { last_activity_at: top.at, last_activity_label: top.label };
}

function chaseRouteForPerson(person) {
    const internal = String(person.status || '').toLowerCase();
    const desk = deskStatusFromInternal(internal);
    if (DESK_FINISHED.has(desk)) {
        return { target: null, email: null, reason: 'already_finished' };
    }
    if (APPROVER_PENDING_INTERNAL.has(internal)) {
        const email = person.lm || person.approver_email || null;
        if (!email) return { target: null, email: null, reason: 'no_approver' };
        return { target: 'approver', email, reason: null };
    }
    if (FILLER_PENDING_INTERNAL.has(internal)) {
        const email = person.mailed_to || person.focal_email || null;
        if (!email) return { target: null, email: null, reason: 'no_focal_email' };
        return { target: 'filler', email, reason: null };
    }
    if (internal === 'not_invited') {
        return { target: null, email: null, reason: 'not_invited' };
    }
    return { target: null, email: null, reason: 'not_remindable' };
}

function resolveReminderMeta(person, batch, approverPack) {
    const route = chaseRouteForPerson(person);
    if (route.target === 'approver' && approverPack) {
        return {
            last_reminder_at: approverPack.last_reminder_at || null,
            reminder_count: approverPack.reminder_count != null ? Number(approverPack.reminder_count) : 0,
            reminder_party: 'approver',
        };
    }
    if (batch) {
        return {
            last_reminder_at: batch.last_reminder_at || null,
            reminder_count: batch.reminder_count != null ? Number(batch.reminder_count) : 0,
            reminder_party: 'focal',
        };
    }
    return { last_reminder_at: null, reminder_count: 0, reminder_party: null };
}

module.exports = {
    DESK_LABEL,
    DESK_FINISHED,
    FILLER_PENDING_INTERNAL,
    APPROVER_PENDING_INTERNAL,
    deskStatusFromInternal,
    deskLabel,
    emptyDeskCounts,
    formatClaimSummary,
    computeLastActivity,
    chaseRouteForPerson,
    resolveReminderMeta,
};
