'use strict';

const ZERO_MSG = 'Enter a non-zero amount. + Add increases the invoice; − Deduct reduces it.';

/**
 * Parse a signed Fixed Value invoice-adjustment amount.
 *
 * Explicit minus / unicode dash / accounting (n) always means deduct.
 * Otherwise a positive number is added, unless signPref === 'deduct'
 * (Step 5 − Deduct: type 29523, do not type a minus).
 *
 * @param {unknown} raw
 * @param {'add'|'deduct'|string|null|undefined} [signPref]
 * @returns {{ amount: number } | { error: string }}
 */
function parseInvoiceAdjustmentAmount(raw, signPref) {
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw) || raw === 0) return { error: ZERO_MSG };
        if (raw < 0) return { amount: raw };
        return { amount: signPref === 'deduct' ? -Math.abs(raw) : Math.abs(raw) };
    }

    let s = String(raw ?? '').trim();
    if (!s) return { error: 'Enter an amount' };

    s = s
        .replace(/,/g, '')
        .replace(/\s/g, '')
        .replace(/[−–—]/g, '-')
        .replace(/^(rs\.?|pkr)/i, '');

    const wrapped = /^\((.+)\)$/.exec(s);
    if (wrapped) s = `-${wrapped[1]}`;
    if (s.startsWith('+')) s = s.slice(1);

    const n = Number(s);
    if (!Number.isFinite(n) || n === 0) return { error: ZERO_MSG };
    if (n < 0) return { amount: n };
    return { amount: signPref === 'deduct' ? -Math.abs(n) : Math.abs(n) };
}

module.exports = { parseInvoiceAdjustmentAmount, ZERO_MSG };
