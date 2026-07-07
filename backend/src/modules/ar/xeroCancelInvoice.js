/**
 * Xero ACCREC cancel: DRAFT invoices must be DELETED; authorised/submitted use VOIDED.
 */
function xeroCancelTargetStatus(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'VOIDED' || s === 'DELETED') return null;
    if (s === 'DRAFT') return 'DELETED';
    return 'VOIDED';
}

const XERO_INVOICES_URL = 'https://api.xero.com/api.xro/2.0/Invoices';

function xeroHeaders(accessToken, tenantId) {
    return {
        Authorization: 'Bearer ' + accessToken,
        'Xero-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
}

async function cancelXeroReceivableInvoice(accessToken, tenantId, invoiceId) {
    const headers = xeroHeaders(accessToken, tenantId);
    const getResp = await fetch(XERO_INVOICES_URL + '/' + invoiceId, { method: 'GET', headers });
    const gd = await getResp.json().catch(() => ({}));
    if (!getResp.ok) {
        return { ok: false, status: getResp.status, detail: gd };
    }
    const current = gd.Invoices?.[0]?.Status;
    const target = xeroCancelTargetStatus(current);
    if (!target) {
        return { ok: true, status: current, alreadyCancelled: true };
    }
    const postResp = await fetch(XERO_INVOICES_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ Invoices: [{ InvoiceID: invoiceId, Status: target }] }),
    });
    const xd = await postResp.json().catch(() => ({}));
    if (!postResp.ok) {
        return { ok: false, status: postResp.status, detail: xd, attemptedStatus: target };
    }
    return {
        ok: true,
        status: xd.Invoices?.[0]?.Status || target,
        attemptedStatus: target,
    };
}

module.exports = { xeroCancelTargetStatus, cancelXeroReceivableInvoice };
