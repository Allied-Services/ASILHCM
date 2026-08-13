'use strict';

const { findLineForDesignation, designationsMatch } = require('./designationMatch');

const fmt = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmt2 = (n) => (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function readableMonth(month, year) {
    const m = Number(month) || 1;
    return `${MONTH_NAMES[m - 1] || month} ${year || ''}`.trim();
}

function formatTitle(format) {
    if (format === 'sales_tax' || format === 'sales_tax_letterhead') return 'Sales Tax Invoice';
    return 'Invoice';
}

function lineKey(line) {
    const id = line.lineId ?? line.line_id ?? line.id;
    return id != null ? String(id) : null;
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isManualInvoiceAdjustment(d) {
    const type = String(d?.type || '').toLowerCase();
    const source = String(d?.source || '').toLowerCase();
    return source === 'manual' || type === 'adjustment' || type === 'manual';
}

/** +adjustment adds to the invoice; −adjustment deducts. Absences always deduct. */
function summarizeInvoiceDeductions(deductions) {
    let shortage = 0;
    let adjustment = 0;
    for (const d of deductions || []) {
        const amt = Number(d.amount || 0) || 0;
        if (isManualInvoiceAdjustment(d)) adjustment += amt;
        else shortage += amt;
    }
    shortage = Math.round(shortage * 100) / 100;
    adjustment = Math.round(adjustment * 100) / 100;
    return {
        shortage,
        adjustment,
        totalDeductions: Math.round((shortage - adjustment) * 100) / 100,
    };
}

function signedRs(n) {
    const v = Number(n) || 0;
    if (v > 0) return `+Rs. ${fmt2(v)}`;
    if (v < 0) return `-Rs. ${fmt2(Math.abs(v))}`;
    return `Rs. ${fmt2(0)}`;
}

/** Nest absences and signed manual adjustments under one SO line. */
function lineDeductionHtml(lineDeds) {
    const split = summarizeInvoiceDeductions(lineDeds);
    const absences = (lineDeds || []).filter((d) => !isManualInvoiceAdjustment(d));
    const manuals = (lineDeds || []).filter((d) => isManualInvoiceAdjustment(d));
    const addManuals = manuals.filter((d) => Number(d.amount) > 0);
    const lessManuals = manuals.filter((d) => Number(d.amount) < 0);
    const parts = [];
    if (absences.length) {
        const shortageAmt = absences.reduce((s, d) => s + (Number(d.amount) || 0), 0);
        parts.push(`<div class="less">
                <div class="head">LESS: Services Not Fully Delivered / Shortages:</div>
                ${absences.map((d) => `<div class="row"><span>${shortageLabel(d)}</span><span>-Rs. ${fmt2(d.amount)}</span></div>`).join('')}
                <div class="tot"><span>Adjusted Total Deductions</span><span>-Rs. ${fmt2(shortageAmt)}</span></div>
              </div>`);
    }
    if (lessManuals.length) {
        parts.push(`<div class="less">
                <div class="head">LESS: Invoice Adjustments</div>
                ${lessManuals.map((d) => `<div class="row"><span>${orphanShortageLabel(d)}</span><span>-Rs. ${fmt2(Math.abs(Number(d.amount) || 0))}</span></div>`).join('')}
              </div>`);
    }
    if (addManuals.length) {
        parts.push(`<div class="less add">
                <div class="head">ADD: Invoice Adjustments</div>
                ${addManuals.map((d) => `<div class="row"><span>${orphanShortageLabel(d)}</span><span>+Rs. ${fmt2(Number(d.amount) || 0)}</span></div>`).join('')}
              </div>`);
    }
    return { netOff: split.totalDeductions, html: parts.join('') };
}

function lineRoles(line) {
    return Array.isArray(line?.roles)
        ? line.roles
        : (typeof line?.roles === 'string' ? JSON.parse(line.roles || '[]') : []);
}

function lineMatchesDesignation(line, designation) {
    const desig = String(designation || '').trim();
    if (!line || !desig) return false;
    return lineRoles(line).some((r) => designationsMatch(desig, r.designation || r.role));
}

/**
 * Attribute each deduction to an SO line:
 * 1) matching line_id / lineId when it still matches employee designation
 * 2) employee_designation matched against manpower line roles
 * 3) else orphan (manual / unmatched)
 */
function attributeDeductions(lines, deductions) {
    const byLineId = new Map();
    for (const l of lines || []) {
        const key = lineKey(l);
        if (key != null) byLineId.set(key, l);
    }

    const byLine = new Map();
    const orphans = [];

    for (const d of deductions || []) {
        const dLine = d.line_id ?? d.lineId;
        const desig = d.employee_designation || d.designation || d.employeeDesignation || '';
        let matched = null;
        if (dLine != null && byLineId.has(String(dLine))) {
            const candidate = byLineId.get(String(dLine));
            // Manual adjustments keep the line the user picked. Absences may
            // be re-pointed when stored line_id disagrees with designation (#80).
            if (isManualInvoiceAdjustment(d) || !desig || lineMatchesDesignation(candidate, desig)) {
                matched = candidate;
            }
        }
        if (!matched && desig) {
            const found = findLineForDesignation(lines, desig);
            if (found?.line) matched = found.line;
        }

        if (matched) {
            const key = lineKey(matched);
            if (!byLine.has(key)) byLine.set(key, []);
            byLine.get(key).push(d);
        } else {
            orphans.push(d);
        }
    }

    return { byLine, orphans };
}

function shortageLabel(d) {
    const name = escapeHtml(d.employee_name || d.employeeName || d.employee_id || 'Resource');
    const desig = escapeHtml(d.employee_designation || d.designation || d.employeeDesignation || '');
    const daysRaw = d.days_absent != null ? d.days_absent : d.daysAbsent;
    const days = daysRaw != null && daysRaw !== '' ? Number(daysRaw) : null;
    const amount = Number(d.amount || 0);

    if (days != null && Number.isFinite(days)) {
        const dayWord = Math.abs(days) === 1 ? 'day' : 'days';
        let label = `• ${name}${desig ? ` (${desig})` : ''} — ${days} ${dayWord} absent`;
        if (days > 0 && amount) {
            const daily = Math.round((amount / days) * 100) / 100;
            label += ` (@ Rs. ${fmt2(daily)}/day)`;
        }
        return label;
    }

    const fallback = escapeHtml(d.label || d.note || d.type || 'Shortage');
    const empId = d.employee_id ? ` (${escapeHtml(d.employee_id)})` : '';
    const empName = d.employee_name || d.employeeName
        ? ` — ${escapeHtml(d.employee_name || d.employeeName)}`
        : '';
    return `• ${fallback}${empId}${empName}`;
}

function orphanShortageLabel(d) {
    if (d.note || d.label) {
        return `• ${escapeHtml(d.label || d.note)}`;
    }
    if (d.type === 'adjustment' || d.type === 'manual') {
        return `• Invoice adjustment${d.employee_id ? ` (${escapeHtml(d.employee_id)})` : ''}`;
    }
    const empId = d.employee_id ? ` (${escapeHtml(d.employee_id)})` : '';
    const empName = d.employee_name || d.employeeName
        ? ` — ${escapeHtml(d.employee_name || d.employeeName)}`
        : '';
    return `• ${escapeHtml(d.type || 'Deduction')}${empId}${empName}`;
}

function baseStyles(letterhead) {
    return `
<style>
  @page { size: A4; margin: 12mm 12mm 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; padding: 0; background: #fff; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 18px 22px 28px; }
  .letterhead-spacer { height: 4.5cm; width: 100%; }
  .logo-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 10px; }
  .logo-row.hidden { display: none !important; }
  .addr { text-align: right; font-size: 11px; font-weight: 800; line-height: 1.35; text-transform: uppercase; }
  .addr .ntn { font-size: 12px; font-weight: 900; margin-top: 4px; text-transform: none; }
  .brand { font-size: 20px; font-weight: 900; letter-spacing: -0.3px; margin: 0; }
  .brand span { font-weight: 400; }
  .title { font-size: 20px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; margin: 8px 0 6px; }
  .meta { font-size: 12px; font-weight: 700; line-height: 1.45; margin-bottom: 8px; }
  .rule { border: none; border-top: 2px solid #0f172a; margin: 8px 0 12px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 12px; }
  .box .lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 800; display: block; margin-bottom: 4px; }
  .box .name { font-weight: 800; font-size: 13px; margin: 0 0 4px; }
  .box p { margin: 0; color: #475569; line-height: 1.35; }
  table.lines { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.lines thead th {
    border-bottom: 2px solid #0f172a; text-align: left; padding: 8px 6px;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; background: #f8fafc;
  }
  table.lines td { padding: 10px 6px; vertical-align: top; border-bottom: 1px solid #e2e8f0; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .center { text-align: center; }
  .desc-main { font-weight: 800; font-size: 12.5px; line-height: 1.3; }
  .roles { margin-top: 4px; padding-left: 8px; border-left: 2px solid #e2e8f0; font-size: 10.5px; color: #64748b; font-family: ui-monospace, monospace; }
  .less {
    margin-top: 6px; padding: 6px 8px; background: #f8fafc; border: 1px solid #e2e8f0;
    border-left: 3px solid #64748b; border-radius: 6px; font-size: 10.5px;
  }
  .less.add { border-left-color: #16a34a; }
  .less .head { font-weight: 900; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 3px; }
  .less .row { display: flex; justify-content: space-between; gap: 10px; font-family: ui-monospace, monospace; }
  .less .tot { margin-top: 3px; padding-top: 3px; border-top: 1px solid #cbd5e1; font-weight: 800; display: flex; justify-content: space-between; }
  .summary { display: grid; grid-template-columns: 1.2fr 1fr; gap: 18px; margin-top: 16px; }
  .words .lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 800; }
  .words .boxw { margin-top: 4px; padding: 10px; background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 10px; font-weight: 700; font-size: 12px; }
  .totals { font-size: 12px; font-weight: 700; }
  .totals .r { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f1f5f9; color: #475569; }
  .totals .r.strong { color: #0f172a; }
  .totals .grand { display: flex; justify-content: space-between; padding: 8px 0 0; margin-top: 4px; border-top: 2px solid #0f172a; font-size: 14px; font-weight: 900; color: #0f172a; }
  .stamp { margin-top: 14px; font-size: 11px; font-weight: 700; }
  .sign { margin-top: 36px; padding-top: 12px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #64748b; }
  .sign .line { margin-top: 28px; border-bottom: 1px solid #cbd5e1; width: 180px; }
  .note { margin-top: 10px; font-size: 10px; color: #94a3b8; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .wrap { padding: 0; }
    .letterhead-spacer { height: 4.5cm; }
  }
</style>`;
}

function numberToWords(n) {
    const num = Math.round(Number(n) || 0);
    if (!num) return 'Zero Rupees Only';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const chunk = (x) => {
        if (x < 20) return ones[x];
        if (x < 100) return `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ''}`;
        return `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${chunk(x % 100)}` : ''}`;
    };
    let rem = num;
    const crore = Math.floor(rem / 10000000); rem %= 10000000;
    const lakh = Math.floor(rem / 100000); rem %= 100000;
    const thousand = Math.floor(rem / 1000); rem %= 1000;
    const parts = [];
    if (crore) parts.push(`${chunk(crore)} Crore`);
    if (lakh) parts.push(`${chunk(lakh)} Lakh`);
    if (thousand) parts.push(`${chunk(thousand)} Thousand`);
    if (rem) parts.push(chunk(rem));
    return `${parts.join(' ')} Rupees Only`;
}

function renderInvoiceHtml(invoice, { format = 'invoice' } = {}) {
    const letterhead = format === 'invoice_letterhead' || format === 'sales_tax_letterhead';
    const salesTaxLayout = format === 'sales_tax' || format === 'sales_tax_letterhead';
    const data = invoice.computed || invoice;
    const lines = data.lineItems || [];
    const deductions = data.deductions || [];
    const monthLabel = readableMonth(data.periodMonth, data.periodYear);
    const siteLabel = data.siteName || data.siteCode || '—';
    const taxPct = ((Number(data.taxRate || 0)) * 100).toFixed(0);

    const gross = Number(data.gross != null ? data.gross : lines.reduce((s, l) => s + Number(l.amount || l.rate || 0), 0));
    const split = summarizeInvoiceDeductions(deductions);
    const shortageAmt = Number(data.totalShortages != null ? data.totalShortages : split.shortage);
    const adjustmentAmt = Number(data.totalAdjustments != null ? data.totalAdjustments : split.adjustment);
    const totalDeductions = Number(
        data.totalDeductions != null
            ? data.totalDeductions
            : split.totalDeductions
    );
    const net = Number(data.netTaxable ?? data.subtotal ?? Math.max(0, gross - totalDeductions));
    const pst = Number(data.provincialSt ?? data.salesTax ?? 0);
    const grand = Number(data.grandTotal ?? net + pst);
    const incomeWht = Number(data.incomeWht ?? data.wht ?? 0);
    const stWithholding = Number(data.stWithholding ?? 0);
    const receivable = Number(data.netReceivable ?? grand - incomeWht - stWithholding);
    const title = formatTitle(format);

    const { byLine, orphans: orphanDeds } = attributeDeductions(lines, deductions);

    const lineRows = lines.map((l, idx) => {
        const key = lineKey(l);
        const lineDeds = (key != null && byLine.get(key)) || [];
        const unit = Number(l.rate ?? l.amount ?? 0);
        const qty = Number(l.quantity ?? 1);
        const grossAmt = Number(l.amount != null ? l.amount : unit * qty);
        const { netOff, html: lessHtml } = lineDeductionHtml(lineDeds);
        const netAmt = Math.max(0, grossAmt - netOff);
        const soLine = l.soLineNumber || l.so_line_number || l.lineNumber || (idx + 1);
        const roles = Array.isArray(l.roles) ? l.roles : [];
        const rolesHtml = roles.length
            ? `<div class="roles">${roles.map((r) => `• ${r.designation || r.role || 'Role'} = ${String(Number(r.count) || 0).padStart(2, '0')} per month`).join('<br/>')}</div>`
            : '';

        return `<tr>
          <td class="center" style="font-family:ui-monospace,monospace;font-weight:800">${soLine}</td>
          <td>
            <div class="desc-main">${l.description || l.name || 'Service'} ${soLine ? `(${soLine})` : ''} for the month of ${monthLabel} — ${siteLabel}</div>
            ${rolesHtml}
            ${lessHtml}
          </td>
          <td class="center">${qty.toFixed(2)}</td>
          <td class="num">Rs. ${fmt2(unit)}</td>
          <td class="center">${salesTaxLayout ? `${taxPct}%` : '—'}</td>
          <td class="num"><strong>Rs. ${fmt2(netAmt)}</strong></td>
        </tr>`;
    }).join('');

    const addOrphans = orphanDeds.filter((d) => isManualInvoiceAdjustment(d) && Number(d.amount) > 0);
    const lessOrphans = orphanDeds.filter((d) => !(isManualInvoiceAdjustment(d) && Number(d.amount) > 0));
    const lessOrphanBlock = lessOrphans.length
        ? `<div class="less">
              <div class="head">LESS: Additional Shortages / Adjustments</div>
              ${lessOrphans.map((d) => `<div class="row"><span>${orphanShortageLabel(d)}</span><span>${signedRs(-Math.abs(Number(d.amount) || 0))}</span></div>`).join('')}
            </div>`
        : '';
    const addOrphanBlock = addOrphans.length
        ? `<div class="less add">
              <div class="head">ADD: Invoice Adjustments</div>
              ${addOrphans.map((d) => `<div class="row"><span>${orphanShortageLabel(d)}</span><span>${signedRs(Number(d.amount) || 0)}</span></div>`).join('')}
            </div>`
        : '';
    const orphanRows = (lessOrphans.length || addOrphans.length)
        ? `<tr><td colspan="6">${lessOrphanBlock}${addOrphanBlock}</td></tr>`
        : '';

    const logoBlock = letterhead
        ? `<div class="letterhead-spacer" id="letterhead-spacer-block"></div>`
        : `<div class="logo-row" id="invoice-logo-address-row">
            <div>
              <p class="brand">ALLIED <span>SERVICES</span></p>
              <div style="font-size:12px;font-weight:700;margin-top:2px">International (Pvt.) Limited</div>
            </div>
            <div class="addr">
              Hilltop Arcade, Suite # 06 • 4D/2, Main Gizri Boulevard,<br/>
              DHA Phase 4, Karachi, Pakistan
              <div class="ntn">NTN: ${data.ntn || '0520872-6'}</div>
            </div>
          </div>`;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} ${data.invoiceNumber || ''}</title>${baseStyles(letterhead)}</head><body>
<div class="wrap">
  ${logoBlock}
  <div class="title">${title}</div>
  <div class="meta">
    <div>Invoice No: <strong>${data.invoiceNumber || 'DRAFT'}</strong></div>
    <div>Billed Month: <strong>${monthLabel}</strong></div>
    <div>Site / Location: <strong>${siteLabel}${data.siteCode && data.siteName && data.siteName !== data.siteCode ? ` (${data.siteCode})` : ''}</strong></div>
    ${data.resources != null && data.resources !== '' ? `<div>Resources (billed manpower): <strong>${data.resources}</strong></div>` : ''}
    ${data.poNumber ? `<div>PO / SO Ref: <strong>${data.poNumber}</strong></div>` : ''}
    ${data.province ? `<div>Tax Province: <strong>${data.province}</strong></div>` : ''}
  </div>
  <hr class="rule"/>
  <div class="two-col">
    <div class="box">
      <span class="lbl">Billed To Client</span>
      <p class="name">${data.clientName || 'Pakistan State Oil Company Limited'}</p>
      <p>PSO House, Khayaban-e-Iqbal, Clifton, Karachi-75600, Pakistan</p>
    </div>
    <div class="box">
      <span class="lbl">Contract References</span>
      <p class="name">${data.contractName || 'Annual Contract for Conservancy Services'}</p>
      <p>Work Location: <strong>${siteLabel}</strong><br/>
         Period: ${monthLabel}${data.resources != null ? `<br/>Resources: <strong>${data.resources}</strong>` : ''}</p>
    </div>
  </div>
  <table class="lines">
    <thead>
      <tr>
        <th style="width:70px">S.O. Line</th>
        <th>Description of Service/Material</th>
        <th class="center" style="width:70px">Qty</th>
        <th class="num" style="width:100px">Unit Price</th>
        <th class="center" style="width:50px">Tax</th>
        <th class="num" style="width:110px">Amount PKR</th>
      </tr>
    </thead>
    <tbody>${lineRows}${orphanRows}</tbody>
  </table>
  <div class="summary">
    <div class="words">
      <div class="lbl">Net Amount in Words</div>
      <div class="boxw">${numberToWords(grand)}</div>
      ${salesTaxLayout ? `<div class="stamp"><strong>STRN:</strong> ${data.strn || '—'} &nbsp;|&nbsp; <strong>NTN:</strong> ${data.ntn || '0520872-6'}</div>` : ''}
    </div>
    <div class="totals">
      <div class="r"><span>Gross Total Contract Value</span><span>Rs. ${fmt2(gross)}</span></div>
      ${shortageAmt
        ? `<div class="r"><span>LESS: Shortage / Deductions</span><span>-Rs. ${fmt2(shortageAmt)}</span></div>`
        : (adjustmentAmt === 0 && totalDeductions
            ? `<div class="r"><span>LESS: Shortage / Deductions</span><span>-Rs. ${fmt2(totalDeductions)}</span></div>`
            : '')}
      ${adjustmentAmt > 0 ? `<div class="r"><span>ADD: Invoice Adjustments</span><span>+Rs. ${fmt2(adjustmentAmt)}</span></div>` : ''}
      ${adjustmentAmt < 0 ? `<div class="r"><span>LESS: Invoice Adjustments</span><span>-Rs. ${fmt2(Math.abs(adjustmentAmt))}</span></div>` : ''}
      <div class="r strong"><span>Net Taxable Services Value</span><span>Rs. ${fmt2(net)}</span></div>
      <div class="r"><span>Provincial Sales Tax (${taxPct}%)</span><span>Rs. ${fmt2(pst)}</span></div>
      <div class="grand"><span>Grand Net Invoice Amount</span><span>PKR ${fmt2(grand)}</span></div>
    </div>
  </div>
  <div class="note">Stamped grand = net taxable + provincial ST. Income WHT (Rs. ${fmt(incomeWht)}) and ST withholding (Rs. ${fmt(stWithholding)}) are receivable-only (est. net receivable Rs. ${fmt(receivable)}).</div>
  <div class="sign">
    <div>PREPARED BY (ALLIED SERVICES LTD)</div>
    <div class="line"></div>
    <div style="margin-top:6px">Authorized Signature &amp; Seal</div>
  </div>
</div></body></html>`;
}

module.exports = {
    renderInvoiceHtml,
    fmt,
    fmt2,
    readableMonth,
    numberToWords,
    attributeDeductions,
    shortageLabel,
    escapeHtml,
    isManualInvoiceAdjustment,
    summarizeInvoiceDeductions,
};
