'use strict';

const REMINDER_INTERVAL_MS = 48 * 60 * 60 * 1000;

function isDueForReminder(lastReminderAt, inviteSentAt, nowMs = Date.now()) {
    const inviteMs = inviteSentAt ? new Date(inviteSentAt).getTime() : 0;
    if (!inviteMs) return true;
    if (inviteMs > nowMs - REMINDER_INTERVAL_MS) return false;
    if (!lastReminderAt) return true;
    return new Date(lastReminderAt).getTime() < nowMs - REMINDER_INTERVAL_MS;
}

function isJuly2026TrialPeriod(period) {
    return Number(period?.claim_month) === 7 && Number(period?.claim_year) === 2026;
}

function deadlineMonthLabel(period) {
    const cm = period?.claim_month;
    const sm = period?.settlement_month;
    const sy = period?.settlement_year;
    const cy = period?.claim_year;
    if (sm && sy && cm && sm !== cm) {
        const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${names[sm - 1] || sm} ${sy}`;
    }
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return cm && cy ? `${names[cm - 1] || cm} ${cy}` : 'this month';
}

function extensionNoticeBanner(period, submitDay, approveDay) {
    const monthLabel = deadlineMonthLabel(period);
    return '<p style="margin:0 0 16px;padding:14px 16px;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;color:#1e3a8a;font-size:15px;line-height:1.55">' +
      '<strong>Trial run — deadline extended to ' + submitDay + ' ' + monthLabel + '.</strong> ' +
      'August is a <strong>test month</strong> to establish the new Portal Claims process so that from September onward there are no surprises. ' +
      'We extended the timeline (submit by <strong>' + submitDay + ' ' + monthLabel + '</strong>, Line Manager approve by <strong>' + approveDay + ' ' + monthLabel + '</strong>) so everyone can test in a few minutes. ' +
      'If an employee has <strong>no claims</strong>, you must still tap <strong>Confirm No Claims</strong>. ' +
      'ASIL Operations will review submissions and ensure alignment with your email responses — reply to this email with any questions.' +
      '</p>';
}

function fillerReminderBanner(period, submitDay) {
    const monthLabel = deadlineMonthLabel(period);
    if (isJuly2026TrialPeriod(period)) {
        return '<p style="margin:0 0 16px;padding:14px 16px;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;color:#1e3a8a;font-size:15px;line-height:1.55">' +
          '<strong>Reminder — please complete the trial test.</strong> Submit or confirm No Claims for <strong>' + period.claim_month + '/' + period.claim_year + '</strong> work by ' +
          '<strong>' + submitDay + ' ' + monthLabel + '</strong>. This takes only a few minutes. Use the same secure link below. ' +
          'Reply to this email if anything looks wrong — ops-support will receive it.</p>';
    }
    return `<p style="margin:0 0 16px;padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:15px;line-height:1.55">
  <strong>Reminder — payroll needs your claims.</strong> Allied monthly operations depend on every Focal and employee completing this form.
  Submit OT / expense / medical for <strong>${period.claim_month}/${period.claim_year}</strong> work by
  <strong>day ${submitDay} of ${monthLabel}</strong> (or confirm No Claims). Use the same secure link below.
  Questions: reply to this email — ops-support will receive it.
</p>`;
}


function approverReminderBanner(period, approveDay) {
    const monthLabel = deadlineMonthLabel(period);
    if (isJuly2026TrialPeriod(period)) {
        return '<p style="margin:0 0 16px;padding:14px 16px;background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;color:#1e3a8a;font-size:15px;line-height:1.55">' +
          '<strong>Trial run — LM approval extended to ' + approveDay + ' ' + monthLabel + '.</strong> ' +
          'Please test the approval pack when your team submits. This establishes the process for September onward.</p>';
    }
    return `<p style="margin:0 0 16px;padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;color:#9a3412;font-size:15px;line-height:1.55">
  <strong>Reminder — claims need your approval.</strong> Focals have submitted; payroll cannot close until you approve or reject.
  Please act by <strong>day ${approveDay} of ${monthLabel}</strong>. Use the link below.
</p>`;
}


function buildSubmitPendingSms(period, submitDay) {
    const monthLabel = deadlineMonthLabel(period);
    if (isJuly2026TrialPeriod(period)) {
        return ('ASIL trial: Test Jul/2026 claims by ' + submitDay + ' ' + monthLabel + '. Confirm claims or No Claims via your link (~few mins).').slice(0, 160);
    }
    return `ASIL: Claims for ${period.claim_month}/${period.claim_year} work are pending. Submit by ${submitDay} ${monthLabel} via your email link. Payroll needs this.`;
}


function buildApprovalPendingSms(period, approveDay, pendingCount) {
    const monthLabel = deadlineMonthLabel(period);
    const n = pendingCount || 0;
    return `ASIL: ${n} claim(s) need your approval by ${approveDay} ${monthLabel}. Use your email link. Payroll needs this.`;
}

function buildSmartReminderSms({ target, period, submitDay, approveDay, pendingCount }) {
    if (target === 'approver') {
        return buildApprovalPendingSms(period, approveDay, pendingCount);
    }
    return buildSubmitPendingSms(period, submitDay);
}

/** Short nudge after email invite/reminder — check inbox, act on claims. */
function buildCheckEmailSms(period, { role } = {}) {
    const cm = period?.claim_month;
    const cy = period?.claim_year;
    const work = cm && cy ? `${cm}/${cy}` : 'this month';
    if (role === 'approver') {
        return (`ASIL: Check your email — Wafi claims (${work}) need your LM approval by 27 Aug. Help: ops-support@asil.com.pk`).slice(0, 160);
    }
    return (`ASIL: Check your email — submit or confirm No Claims for Wafi ${work} work by 27 Aug. Help: ops-support@asil.com.pk`).slice(0, 160);
}

module.exports = {
    REMINDER_INTERVAL_MS,
    isDueForReminder,
    isJuly2026TrialPeriod,
    deadlineMonthLabel,
    extensionNoticeBanner,
    fillerReminderBanner,
    approverReminderBanner,
    buildSubmitPendingSms,
    buildApprovalPendingSms,
    buildSmartReminderSms,
    buildCheckEmailSms,
};
