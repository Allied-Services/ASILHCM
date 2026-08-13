/** Keep in sync with backend/src/modules/serviceOrders/parseInvoiceAdjustmentAmount.js */

const ZERO_MSG = 'Enter a non-zero amount. + Add increases the invoice; − Deduct reduces it.';

/**
 * Parse Step 5 adjustment amount.
 * Explicit minus / (n) wins; otherwise apply +add / −deduct.
 * Default −deduct so typing 29523 reduces the invoice (no minus required).
 */
export function parseAdjustmentAmount(raw, signPref = 'deduct') {
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

export function amountLooksNegative(raw) {
    const s = String(raw ?? '').trim();
    return /^[(]/.test(s) || /^[-−–—]/.test(s);
}
