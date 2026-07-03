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

function startOperationsScheduler({ pool, runReportDispatch, runEscalationCheck }) {
    if (process.env.NODE_ENV === 'test') return;

    let lastReportDate = '';
    let lastEscalationMinute = -1;

    setInterval(async () => {
        try {
            const { hour, minute, dateKey } = getPktNow();

            // Evening dispatch at 18:00 PKT (once per day)
            if (hour === 18 && minute === 0 && lastReportDate !== dateKey) {
                lastReportDate = dateKey;
                await runReportDispatch(pool);
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

    console.log('Operations scheduler: OK (report dispatch 18:00 PKT, escalation every 10m)');
}

module.exports = { startOperationsScheduler, getPktNow };
