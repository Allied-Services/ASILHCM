'use strict';

/**
 * Phase 2 operations scheduler — evening report dispatch + CMMS escalation checks.
 * Started from server.js app.listen (same pattern as wafiClaimsService).
 */

function getPktNow() {
    const now = new Date();
    const pkt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
    return { hour: pkt.getHours(), minute: pkt.getMinutes(), dateKey: pkt.toISOString().slice(0, 10) };
}

function startOperationsScheduler({ pool, runReportDispatch, runEscalationCheck, runPaymentStatusSummary }) {
    if (process.env.NODE_ENV === 'test') return;

    let lastReportDate = '';
    let lastPaymentSummaryDate = '';
    let lastEscalationMinute = -1;

    setInterval(async () => {
        try {
            const { hour, minute, dateKey } = getPktNow();

            // Evening dispatch at 18:00 PKT (once per day)
            if (hour === 18 && minute === 0 && lastReportDate !== dateKey) {
                lastReportDate = dateKey;
                await runReportDispatch(pool);
            }

            // MD Mandate §5 — end-of-day payment status summary at 17:55 PKT
            if (hour === 17 && minute === 55 && lastPaymentSummaryDate !== dateKey && typeof runPaymentStatusSummary === 'function') {
                lastPaymentSummaryDate = dateKey;
                await runPaymentStatusSummary(pool);
            }

            // CMMS escalation every 10 minutes
            if (minute % 10 === 0 && lastEscalationMinute !== minute) {
                lastEscalationMinute = minute;
                await runEscalationCheck(pool);
            }
        } catch (err) {
            console.error('[operationsScheduler]', err);
        }
    }, 60 * 1000);

    console.log('Operations scheduler: OK (report 18:00 PKT, payment-status EOD 17:55 PKT, escalation every 10m)');
}

module.exports = { startOperationsScheduler, getPktNow };
