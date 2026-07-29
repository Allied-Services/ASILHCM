'use strict';

const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmt2 = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function baseStyles(letterhead) {
    const headerBg = letterhead ? '#0f172a' : '#1e293b';
    return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; padding: 24px; background: #fff; }
  .wrap { max-width: 820px; margin: 0 auto; }
  .letterhead { background: ${headerBg}; color: #fff; padding: 20px 24px; border-radius: 8px 8px 0 0; }
  .letterhead h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: 0.5px; }
  .letterhead p { margin: 0; opacity: 0.85; font-size: 12px; }
  .panel { border: 1px solid #cbd5e1; border-top: none; padding: 20px 24px; }
  .meta { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
  th { background: #f1f5f9; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-top: 16px; width: 100%; max-width: 420px; margin-left: auto; }
  .totals td { border: none; padding: 4px 8px; }
  .grand { font-weight: 700; font-size: 15px; border-top: 2px solid #0f172a !important; }
  .receivable { margin-top: 20px; padding: 12px; background: #f8fafc; border: 1px dashed #94a3b8; font-size: 12px; }
  .note { margin-top: 12px; font-size: 11px; color: #64748b; }
  .stamp { margin-top: 24px; font-size: 12px; }
</style>`;
}

function renderInvoiceHtml(invoice, { format = 'invoice' } = {}) {
    const letterhead = format === 'invoice_letterhead' || format === 'sales_tax_letterhead';
    const salesTaxLayout = format === 'sales_tax' || format === 'sales_tax_letterhead';
    const data = invoice.computed || invoice;
    const lines = data.lineItems || [];
    const net = Number(data.netTaxable ?? data.subtotal ?? 0);
    const pst = Number(data.provincialSt ?? data.salesTax ?? 0);
    const grand = Number(data.grandTotal ?? net + pst);
    const incomeWht = Number(data.incomeWht ?? data.wht ?? 0);
    const stWithholding = Number(data.stWithholding ?? 0);
    const receivable = Number(data.netReceivable ?? grand - incomeWht - stWithholding);

    const lineRows = lines.map(l => `
      <tr>
        <td>${l.description || l.name || ''}</td>
        <td class="num">${l.quantity ?? 1}</td>
        <td class="num">${fmt(l.rate ?? l.amount)}</td>
        <td class="num">${fmt(l.amount ?? Number(l.rate || 0))}</td>
      </tr>`).join('');

    const deductionRows = (data.deductions || []).map(d => `
      <tr>
        <td colspan="3">${d.label || d.type || 'Deduction'}${d.employee_id ? ` (${d.employee_id})` : ''}</td>
        <td class="num">-${fmt2(d.amount)}</td>
      </tr>`).join('');

    const header = letterhead ? `
      <div class="letterhead">
        <h1>ALLIED SERVICES INTERNATIONAL (PVT.) LTD.</h1>
        <p>Proforma Invoice — Fixed Value / Conservancy Services</p>
      </div>` : '';

    const title = salesTaxLayout ? 'Sales Tax Invoice' : 'Proforma Invoice';

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} ${data.invoiceNumber || ''}</title>${baseStyles(letterhead)}</head><body>
<div class="wrap">
  ${header}
  <div class="panel">
    <h2 style="margin-top:0">${title}</h2>
    <div class="meta">
      <div>
        <div><strong>Invoice #:</strong> ${data.invoiceNumber || 'DRAFT'}</div>
        <div><strong>Client:</strong> ${data.clientName || ''}</div>
        <div><strong>Contract:</strong> ${data.contractName || ''}</div>
        <div><strong>Site:</strong> ${data.siteName || data.siteCode || '—'}${data.siteCode && data.siteName && data.siteName !== data.siteCode ? ` (${data.siteCode})` : ''}</div>
        ${data.resources != null && data.resources !== '' ? `<div><strong>Resources (billed manpower):</strong> ${data.resources}</div>` : ''}
      </div>
      <div style="text-align:right">
        <div><strong>Period:</strong> ${data.periodMonth}/${data.periodYear}</div>
        <div><strong>Province:</strong> ${data.province || '—'}</div>
        ${data.taxRate != null && data.taxRate !== '' ? `<div><strong>ST rate:</strong> ${((Number(data.taxRate) || 0) * 100).toFixed(0)}%</div>` : ''}
        ${data.poNumber ? `<div><strong>PO:</strong> ${data.poNumber}</div>` : ''}
      </div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
      <tbody>${lineRows}${deductionRows ? `<tr><td colspan="4"><strong>Deductions</strong></td></tr>${deductionRows}` : ''}</tbody>
    </table>
    <table class="totals">
      <tr><td>Net Taxable</td><td class="num">${fmt(net)}</td></tr>
      <tr><td>Provincial Sales Tax (${((Number(data.taxRate || 0)) * 100).toFixed(0)}%)</td><td class="num">${fmt(pst)}</td></tr>
      <tr class="grand"><td>Stamped Grand Total</td><td class="num">${fmt(grand)}</td></tr>
    </table>
    <div class="receivable">
      <strong>Receivable (withholdings — not deducted from stamped grand):</strong>
      <table style="margin-top:8px">
        <tr><td>Income Tax WHT</td><td class="num">${fmt(incomeWht)}</td></tr>
        <tr><td>Sales Tax Withholding (~20%)</td><td class="num">${fmt(stWithholding)}</td></tr>
        <tr><td><strong>Net Receivable</strong></td><td class="num"><strong>${fmt(receivable)}</strong></td></tr>
      </table>
    </div>
    <div class="note">Stamped grand total = net taxable + provincial ST only. WHT and ST withholding appear in receivable section for client deduction at payment.</div>
    ${salesTaxLayout ? `<div class="stamp"><strong>STRN:</strong> ${data.strn || '—'} &nbsp;|&nbsp; <strong>NTN:</strong> ${data.ntn || '—'}</div>` : ''}
  </div>
</div></body></html>`;
}

module.exports = { renderInvoiceHtml, fmt, fmt2 };
