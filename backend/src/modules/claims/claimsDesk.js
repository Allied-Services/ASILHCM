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

const CONTROL_LABEL = {
    waiting_focal: 'Waiting for Focal',
    waiting_lm: 'Waiting for LM',
    final_lm_review: 'Final LM review',
    ready_for_payroll: 'Ready for Payroll',
    sent_to_payroll: 'Sent to Payroll',
    no_claims_confirmed: 'No Claims — Confirmed',
    no_claims_auto_closed: 'No Claims — Auto-closed (no response)',
    no_claims_unverified: 'No Claims — Closed (source unknown)',
    rejected_closed: 'Rejected — Closed',
    needs_review: 'Needs Review — payroll already has different values',
    not_invited: 'Not invited',
    invite_sent: 'Invite sent',
};

const CONTROL_NEEDS_ACTION = new Set(['ready_for_payroll', 'final_lm_review', 'needs_review']);
const CONTROL_WAITING = new Set(['waiting_focal', 'waiting_lm', 'not_invited', 'invite_sent']);
const CONTROL_CLOSED = new Set([
    'sent_to_payroll',
    'no_claims_confirmed',
    'no_claims_auto_closed',
    'no_claims_unverified',
    'rejected_closed',
]);

const ACTION_VIEW_LABEL = {
    needs_action: 'Needs action',
    waiting: 'Waiting',
    closed: 'Closed',
    all: 'All',
};

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

function resolveNoClaimsControl({ submissionStatus, internalStatus, noClaimsKind }) {
    const sub = String(submissionStatus || '').toLowerCase();
    const internal = String(internalStatus || '').toLowerCase();
    if (sub !== 'no_claims' && internal !== 'no_claims') return null;
    const kind = String(noClaimsKind || '').toLowerCase();
    if (kind === 'confirmed') return 'no_claims_confirmed';
    if (kind === 'auto_closed') return 'no_claims_auto_closed';
    return 'no_claims_unverified';
}

function controlStatusFromRow({
    internalStatus,
    submissionStatus,
    sample,
    sheetHasValues,
    amountsMatch,
    portalHasValues,
    lmReopenCount,
    payrollPushedAt,
    noClaimsKind,
}) {
    const sub = String(submissionStatus || '').toLowerCase();
    const internal = String(internalStatus || '').toLowerCase();
    const reopened = num(lmReopenCount) >= 1;

    if (reopened && sub === 'submitted') return 'final_lm_review';
    if (sub === 'in_payroll' || payrollPushedAt) {
        if (portalHasValues && !amountsMatch) return 'ready_for_payroll';
        return 'sent_to_payroll';
    }
    if (internal === 'rejected' || sub === 'rejected') return 'rejected_closed';
    const noClaimsControl = resolveNoClaimsControl({
        submissionStatus,
        internalStatus,
        noClaimsKind,
    });
    if (noClaimsControl) return noClaimsControl;
    if (internal === 'other_data' && !portalHasValues) return 'needs_review';

    if (sub === 'approved' || internal === 'ready_import') {
        if (sample) return 'ready_for_payroll';
        if (internal === 'on_sheet' && amountsMatch) return 'sent_to_payroll';
        if (sheetHasValues && portalHasValues && !amountsMatch) return 'ready_for_payroll';
        if (sheetHasValues && !portalHasValues) return 'needs_review';
        return 'ready_for_payroll';
    }

    if (internal === 'on_sheet') return 'sent_to_payroll';
    if (internal === 'waiting_focal' || internal === 'waiting_employee' || internal === 'waiting_fill') {
        return 'waiting_focal';
    }
    if (internal === 'waiting_lm' || internal === 'waiting_asil') return 'waiting_lm';
    if (internal === 'invite_sent') return 'invite_sent';
    if (internal === 'not_invited') return 'not_invited';
    return 'waiting_focal';
}

function controlLabel(controlStatus) {
    return CONTROL_LABEL[controlStatus] || controlStatus;
}

function actionViewFromControl(controlStatus) {
    if (CONTROL_NEEDS_ACTION.has(controlStatus)) return 'needs_action';
    if (CONTROL_CLOSED.has(controlStatus)) return 'closed';
    if (CONTROL_WAITING.has(controlStatus)) return 'waiting';
    return 'waiting';
}

function emptyControlCounts() {
    return Object.keys(CONTROL_LABEL).reduce((acc, key) => {
        acc[key] = 0;
        return acc;
    }, {});
}

function emptyActionCounts() {
    return { needs_action: 0, waiting: 0, closed: 0 };
}

function canSelectForPayrollPush(controlStatus) {
    return controlStatus === 'ready_for_payroll';
}

function formatClaimSummary(portal, opts = {}) {
    const subStatus = String(opts.submissionStatus || '').toLowerCase();
    const kind = String(opts.noClaimsKind || '').toLowerCase();
    if (subStatus === 'no_claims') {
        if (kind === 'confirmed') return 'No claims — confirmed by filler';
        if (kind === 'auto_closed') return 'No claims — auto-closed (no response)';
        return 'No claims — closed';
    }
    const p = portal || {};
    const parts = [];
    const ot2 = num(p.ot2Write);
    const ot3 = num(p.ot3);
    const med = num(p.medical);
    const exp = num(p.expense);
    if (ot2 > EPS_HRS) parts.push(`OT2 ${(Math.round(ot2 * 100) / 100).toFixed(2)}h`);
    if (ot3 > EPS_HRS) parts.push(`OT3 ${(Math.round(ot3 * 100) / 100).toFixed(2)}h`);
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
        let label = 'Submitted';
        if (String(sub.status || '').toLowerCase() === 'no_claims') {
            const kind = String(sub.no_claims_kind || '').toLowerCase();
            if (kind === 'confirmed') label = 'No Claims confirmed';
            else if (kind === 'auto_closed') label = 'Auto-closed (no response)';
            else label = 'No Claims recorded';
        }
        candidates.push({ at: sub.submitted_at, label });
    }
    if (sub && sub.approved_at) {
        candidates.push({ at: sub.approved_at, label: 'Approved' });
    }
    if (sub && sub.payroll_pushed_at) {
        candidates.push({ at: sub.payroll_pushed_at, label: 'Sent to payroll' });
    }
    if (sub && sub.rejected_at) {
        candidates.push({ at: sub.rejected_at, label: 'Rejected' });
    }
    if (sub && sub.lm_reopen_at) {
        candidates.push({ at: sub.lm_reopen_at, label: 'Reopened for LM' });
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
    if (FILLER_PENDING_INTERNAL.has(internal) || internal === 'not_invited' || internal === 'invite_sent') {
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
    EPS_HRS,
    EPS_PKR,
    DESK_LABEL,
    DESK_FINISHED,
    FILLER_PENDING_INTERNAL,
    APPROVER_PENDING_INTERNAL,
    CONTROL_LABEL,
    ACTION_VIEW_LABEL,
    deskStatusFromInternal,
    deskLabel,
    emptyDeskCounts,
    resolveNoClaimsControl,
    controlStatusFromRow,
    controlLabel,
    actionViewFromControl,
    emptyControlCounts,
    emptyActionCounts,
    canSelectForPayrollPush,
    formatClaimSummary,
    computeLastActivity,
    chaseRouteForPerson,
    resolveReminderMeta,
};
