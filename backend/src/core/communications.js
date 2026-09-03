'use strict';

/**
 * Live email/SMS gate.
 *
 * COMMUNICATIONS_ENABLED:
 *   off        — nothing is sent
 *   asil_only  — email only to @asil.com.pk; SMS stays off
 *   on         — unrestricted (still respect CLAIMS_ALLOW_ACTUAL_SEND etc.)
 *
 * Unset: local/staging stay off. Live production (asilhcm.onrender.com) is on
 * after the 2026-09-03 Go-red to send August payslips.
 */

function isLiveProductionHost() {
    const host = `${process.env.APP_BASE_URL || ''} ${process.env.BACKEND_URL || ''}`;
    return host.includes('://asilhcm.onrender.com');
}

function communicationsMode() {
    const raw = String(process.env.COMMUNICATIONS_ENABLED || '').trim().toLowerCase();
    if (raw === 'true' || raw === 'on' || raw === '1' || raw === 'yes') return 'on';
    if (raw === 'asil_only' || raw === 'asil') return 'asil_only';
    if (raw === 'off' || raw === 'false' || raw === '0' || raw === 'no') return 'off';
    if (process.env.NODE_ENV === 'production' && isLiveProductionHost()) return 'on';
    return 'off';
}

function isAsilEmail(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s.includes('@')) return false;
    const domain = s.split('@').pop() || '';
    return domain === 'asil.com.pk' || domain.endsWith('.asil.com.pk');
}

function asList(v) {
    return (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
}

function filterAddressList(list) {
    const arr = asList(list);
    const mode = communicationsMode();
    if (mode === 'off') return { kept: [], dropped: arr, mode };
    if (mode === 'asil_only') {
        return {
            kept: arr.filter(isAsilEmail),
            dropped: arr.filter((e) => !isAsilEmail(e)),
            mode,
        };
    }
    return { kept: arr, dropped: [], mode };
}

function gateEmailPayload(opts = {}) {
    const mode = communicationsMode();
    if (mode === 'off') {
        return { skip: true, reason: 'communications_off', mode, dropped: asList(opts.to) };
    }
    const to = filterAddressList(opts.to);
    const cc = filterAddressList(opts.cc);
    const bcc = filterAddressList(opts.bcc);
    if (!to.kept.length) {
        return {
            skip: true,
            reason: 'no_allowed_recipients',
            mode,
            dropped: [...to.dropped, ...cc.dropped, ...bcc.dropped],
        };
    }
    return {
        skip: false,
        mode,
        dropped: [...to.dropped, ...cc.dropped, ...bcc.dropped],
        payload: {
            ...opts,
            to: to.kept,
            cc: cc.kept.length ? cc.kept : undefined,
            bcc: bcc.kept.length ? bcc.kept : undefined,
        },
    };
}

function gateSms() {
    const mode = communicationsMode();
    if (mode === 'on') return { skip: false, mode };
    return {
        skip: true,
        reason: mode === 'asil_only' ? 'sms_blocked_until_live' : 'communications_off',
        mode,
    };
}

function communicationsStatus() {
    const mode = communicationsMode();
    return {
        mode,
        email: mode === 'off' ? 'blocked' : mode === 'asil_only' ? 'asil.com.pk only' : 'live',
        sms: mode === 'on' ? 'live' : 'blocked',
        claimsActualSend: process.env.CLAIMS_ALLOW_ACTUAL_SEND === 'true',
        focalDigestSend: process.env.FOCAL_DIGEST_SEND === 'true',
    };
}

module.exports = {
    communicationsMode,
    isLiveProductionHost,
    isAsilEmail,
    filterAddressList,
    gateEmailPayload,
    gateSms,
    communicationsStatus,
};
