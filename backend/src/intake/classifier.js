'use strict';

const DEFAULT_RULES = [
    { pattern: /overtime|ot\s|extra\s*hours/i, subject: null, classification: 'claim', category: 'overtime', slaHours: 48 },
    { pattern: /medical|opd|reimbursement|expense|claim/i, subject: null, classification: 'claim', category: 'medical', slaHours: 48 },
    { pattern: /attendance|absent|present|timesheet|biometric/i, subject: null, classification: 'attendance', category: 'attendance', slaHours: 72 },
    { pattern: /procurement|purchase|material|supply/i, subject: null, classification: 'procurement', category: 'procurement', slaHours: 48 },
    { pattern: /@wafi-energy\.com|@psopk\.com/i, subject: /leave|amendment|support|ticket/i, classification: 'client_event', category: 'client_inbox', slaHours: 24 },
];

function matchInboxRules(fromAddress, subject, dbRules = []) {
    const from = (fromAddress || '').toLowerCase();
    const subj = subject || '';

    for (const rule of dbRules) {
        if (!rule.active) continue;
        const senderOk = !rule.sender_pattern || from.includes(rule.sender_pattern.toLowerCase().replace(/%/g, ''));
        const subjectOk = !rule.subject_pattern || new RegExp(rule.subject_pattern, 'i').test(subj);
        if (senderOk && subjectOk) {
            return {
                classification: rule.event_type === 'support_ticket' ? 'client_event' : rule.event_type,
                eventType: rule.event_type,
                priority: rule.priority,
                autoAction: rule.auto_action,
                clientId: rule.client_id,
            };
        }
    }

    for (const rule of DEFAULT_RULES) {
        if (rule.pattern.test(from) || rule.pattern.test(subj) || (rule.subject && rule.subject.test(subj))) {
            return {
                classification: rule.classification,
                category: rule.category,
                slaHours: rule.slaHours,
            };
        }
    }

    if (/@wafi-energy\.com|@psopk\.com/i.test(from)) {
        return { classification: 'client_event', category: 'client_inbox', slaHours: 24 };
    }

    return { classification: 'unknown', category: 'general', slaHours: 48 };
}

module.exports = { matchInboxRules, DEFAULT_RULES };
