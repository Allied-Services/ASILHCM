'use strict';

const fs = require('fs');
const path = require('path');

const TRIAL_END = new Date('2026-11-30T23:59:59+05:00');
const OPS_SUPPORT = 'ops-support@asil.com.pk';

let logoDataUri = '';
try {
    const svg = fs.readFileSync(path.join(__dirname, '../../../assets/asil-logo.svg'), 'utf8');
    logoDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
} catch {
    logoDataUri = '';
}

function isTrialMode() {
    return new Date() <= TRIAL_END;
}

function trialBannerHtml() {
    if (!isTrialMode()) return '';
    return `<div class="trial">
      <strong>TRIAL MODE</strong> — This payslip system is being rolled out until November 2026.
      If anything looks wrong, email <a href="mailto:${OPS_SUPPORT}">${OPS_SUPPORT}</a> and a support case will be opened.
    </div>`;
}

function rowHtml(label, amount, isDeduction = false) {
    if (!amount || amount <= 0) return '';
    const cls = isDeduction ? ' deduction' : '';
    const prefix = isDeduction ? '- ' : '';
    return `<tr><td>${label}</td><td class="amount${cls}">${prefix}${amount.toLocaleString('en-PK')}</td></tr>`;
}

/**
 * Payslip HTML layout (no OT / reimbursement detail cards — those lines live in earnings only):
 *   1. Earnings & Additions (incl. OT / reimbursements) → GROSS TOTAL
 *   2. Deductions (only if any)
 *   3. Net Salary Payable
 */
function renderPayslipHtml(data, { year, month }) {
    const monthName = new Date(2000, parseInt(month, 10) - 1, 1).toLocaleString('en-PK', { month: 'long' });
    const { emp, additions, deductions, grossTotal, totalDeductions, netPay, paidDays, workingDays } = data;

    const earningsRows = additions.map(r => rowHtml(r.label, r.amount)).join('');
    const deductionRows = deductions.map(r => rowHtml(r.label, r.amount, true)).join('');
    const hasDeductions = deductions.length > 0 && totalDeductions > 0;

    const deductionsSection = hasDeductions ? `
<div class="section">
  <div class="section-title">Deductions</div>
  <table>
    <thead><tr><th>DESCRIPTION</th><th class="amount">AMOUNT (PKR)</th></tr></thead>
    <tbody>${deductionRows}
      <tr class="total-row"><td>TOTAL DEDUCTIONS</td><td class="amount deduction">- ${totalDeductions.toLocaleString('en-PK')}</td></tr>
    </tbody>
  </table>
</div>` : '';

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Salary Slip — ${emp.name} — ${monthName} ${year}</title>
<style>
  @media print { body { margin: 0; } .page { padding: 16px 20px; } }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; background: #f0f4f8; }
  .page { max-width: 720px; margin: 20px auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.12); }
  .trial { background: #fef3c7; color: #92400e; padding: 10px 18px; font-size: 9pt; border-bottom: 1px solid #fcd34d; }
  .trial a { color: #b45309; }
  .hdr { background: #1e3a5f; color: #fff; padding: 18px 26px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .hdr-left { display: flex; align-items: center; gap: 14px; }
  .hdr img { height: 48px; width: auto; }
  .hdr h2 { margin: 0 0 4px; font-size: 16pt; letter-spacing: .5px; }
  .hdr p { margin: 3px 0; font-size: 9pt; opacity: .85; }
  .hdr-right { text-align: right; font-size: 9pt; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border-bottom: 2px solid #e2e8f0; }
  .meta-cell { padding: 10px 18px; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
  .meta-cell:nth-child(even) { border-right: none; }
  .meta-cell label { font-size: 7.5pt; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; display: block; margin-bottom: 3px; }
  .meta-cell span { font-size: 10pt; font-weight: 600; color: #1e293b; }
  .section { margin: 0 18px 14px; }
  .section-title { font-size: 11pt; font-weight: 800; color: #1e3a5f; margin: 16px 0 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1e3a5f; color: #fff; padding: 8px 12px; font-size: 8.5pt; text-align: left; letter-spacing: .04em; }
  th:last-child { text-align: right; }
  td { padding: 7px 12px; border-bottom: 1px solid #f1f5f9; font-size: 9.5pt; color: #1e293b; }
  .amount { text-align: right; font-weight: 600; }
  .deduction { color: #dc2626; }
  .total-row td { background: #e8eef5; font-weight: 800; font-size: 10.5pt; border-top: 2px solid #cbd5e1; }
  .net-box { background: #1e3a5f; color: #fff; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
  .net-box .label { font-size: 10pt; opacity: .85; letter-spacing: .04em; }
  .net-box .amount { font-size: 20pt; font-weight: 800; }
  .footer { padding: 12px 20px; font-size: 8pt; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; background: #f8fafc; }
  .paid-days-badge { background: rgba(255,255,255,.15); padding: 3px 10px; border-radius: 20px; font-size: 8pt; margin-top: 6px; display: inline-block; }
</style></head><body><div class="page">
${trialBannerHtml()}
<div class="hdr">
  <div class="hdr-left">
    ${logoDataUri ? `<img src="${logoDataUri}" alt="ASIL logo"/>` : ''}
    <div>
      <h2>SALARY SLIP</h2>
      <p>Allied Services International (Pvt.) Ltd.</p>
      <p>NTN: 7483900-1 | accounts@asil.com.pk</p>
    </div>
  </div>
  <div class="hdr-right">
    <p style="font-size:12pt;font-weight:700">${monthName} ${year}</p>
    <p>Generated: ${new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
    <div class="paid-days-badge">Paid Days: ${paidDays} / ${workingDays}</div>
  </div>
</div>
<div class="meta">
  <div class="meta-cell"><label>Employee Name</label><span>${emp.name || '—'}</span></div>
  <div class="meta-cell"><label>Employee Code</label><span>${emp.id || '—'}</span></div>
  <div class="meta-cell"><label>Designation</label><span>${emp.designation || '—'}</span></div>
  <div class="meta-cell"><label>Client / Location</label><span>${emp.client || '—'} / ${emp.location || '—'}</span></div>
  <div class="meta-cell"><label>CNIC</label><span>${emp.cnic || '—'}</span></div>
  <div class="meta-cell"><label>Bank Account</label><span>${emp.bank_name || '—'} — ${emp.bank_account || '—'}</span></div>
</div>
<div class="section">
  <div class="section-title">Earnings &amp; Additions</div>
  <table>
    <thead><tr><th>DESCRIPTION</th><th class="amount">AMOUNT (PKR)</th></tr></thead>
    <tbody>${earningsRows}
      <tr class="total-row"><td>GROSS TOTAL</td><td class="amount">${grossTotal.toLocaleString('en-PK')}</td></tr>
    </tbody>
  </table>
</div>
${deductionsSection}
<div class="net-box">
  <div><div class="label">NET SALARY PAYABLE</div></div>
  <div class="amount">Rs. ${netPay.toLocaleString('en-PK')}</div>
</div>
<div class="footer">
  Open this PDF with your CNIC number (digits only, no dashes) as the password.<br>
  Payslip queries: ${OPS_SUPPORT} | System-generated — no signature required.
</div>
</div></body></html>`;
}

function renderEmailCoverHtml({ emp, monthName, year, frontendUrl }) {
    const trial = isTrialMode()
        ? `<p style="background:#fef3c7;padding:12px;border-radius:8px;color:#92400e;"><strong>TRIAL MODE</strong> — If anything looks wrong, email <a href="mailto:${OPS_SUPPORT}">${OPS_SUPPORT}</a>.</p>`
        : '';
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;">
<div style="max-width:600px;margin:0 auto;padding:24px;">
  <h2 style="color:#1e3a5f;">Salary Slip — ${monthName} ${year}</h2>
  ${trial}
  <p>Dear ${emp.name},</p>
  <p>Your salary for <strong>${monthName} ${year}</strong> has been processed. Please find your payslip attached as a password-protected PDF.</p>
  <p><strong>Password:</strong> your CNIC number (digits only, no dashes).</p>
  <p>You can also download the same payslip from the employee portal: <a href="${frontendUrl}">${frontendUrl}</a></p>
  <p>Queries: <a href="mailto:${OPS_SUPPORT}">${OPS_SUPPORT}</a></p>
  <p>Warm regards,<br><strong>HR Department</strong><br>Allied Services International (Pvt.) Ltd.</p>
</div></body></html>`;
}

module.exports = {
    TRIAL_END,
    OPS_SUPPORT,
    isTrialMode,
    renderPayslipHtml,
    renderEmailCoverHtml,
};
