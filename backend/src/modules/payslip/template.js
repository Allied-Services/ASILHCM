'use strict';

const fs = require('fs');
const path = require('path');

const TRIAL_END = new Date('2026-11-30T23:59:59+05:00');
const OPS_SUPPORT = 'ops-support@asil.com.pk';

function loadLogoDataUri() {
    const candidates = [
        { file: path.join(__dirname, '../../../assets/allied_logo.png'), mime: 'image/png' },
        { file: path.join(__dirname, '../../../assets/asil-logo.svg'), mime: 'image/svg+xml' },
    ];
    for (const { file, mime } of candidates) {
        try {
            const buf = fs.readFileSync(file);
            return `data:${mime};base64,${buf.toString('base64')}`;
        } catch {
            /* try next */
        }
    }
    const fallback = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 48" width="200" height="48">
  <rect width="200" height="48" rx="6" fill="#ffffff"/>
  <text x="12" y="32" fill="#e11d48" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700">ALLIED</text>
</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(fallback).toString('base64')}`;
}

const logoDataUri = loadLogoDataUri();

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

function money(amount) {
    return Math.round(amount || 0).toLocaleString('en-PK');
}

function rowHtml(label, amount, isDeduction = false) {
    if (amount == null || amount < 0) return '';
    if (!isDeduction && amount <= 0) return '';
    const cls = isDeduction ? ' deduction' : '';
    const prefix = isDeduction ? '- ' : '';
    return `<tr><td>${label}</td><td class="amount${cls}">${prefix}${money(amount)}</td></tr>`;
}

/**
 * Layout: Earnings (OT / reimbursements as line items only) → GROSS TOTAL
 * → Deductions (if any) → Net Salary Payable.
 * No separate Overtime Detail / Reimbursements panels — those duplicated the earnings table.
 */
function renderPayslipHtml(data, { year, month }) {
    const monthName = new Date(2000, parseInt(month, 10) - 1, 1).toLocaleString('en-PK', { month: 'long' });
    const {
        emp, additions, deductions, grossTotal, totalDeductions, netPay,
    } = data;

    const earningsRows = additions.map(r => rowHtml(r.label, r.amount)).join('');
    const deductionRows = deductions.map(r => rowHtml(r.label, r.amount, true)).join('');
    const hasDeductions = deductions.length > 0 && totalDeductions > 0;

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Salary Slip — ${emp.name} — ${monthName} ${year}</title>
<style>
  @media print { body { margin: 0; background: #fff; } .page { box-shadow: none; margin: 0; border-radius: 0; } }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10pt;
    color: #0f172a;
    margin: 0;
    background: linear-gradient(160deg, #e8eef5 0%, #f7f3ea 55%, #eef2f7 100%);
  }
  .page {
    max-width: 740px;
    margin: 18px auto;
    background: #fff;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(15, 35, 60, .14);
    border: 1px solid #dbe4ef;
  }
  .trial {
    background: linear-gradient(90deg, #fff7ed, #fef3c7);
    color: #9a3412;
    padding: 10px 20px;
    font-size: 8.5pt;
    border-bottom: 1px solid #fdba74;
  }
  .trial a { color: #c2410c; font-weight: 700; }
  .hdr {
    background: linear-gradient(135deg, #0f2744 0%, #1e3a5f 55%, #245075 100%);
    color: #fff;
    padding: 22px 26px 20px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    position: relative;
  }
  .hdr::after {
    content: '';
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 4px;
    background: linear-gradient(90deg, #c9a227, #e8d48b, #c9a227);
  }
  .hdr-left { display: flex; align-items: center; gap: 14px; }
  /* White chip so Allied PNG (dark text) stays readable on navy header */
  .hdr-logo {
    background: #ffffff;
    border-radius: 8px;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    box-shadow: 0 1px 0 rgba(255,255,255,.2);
  }
  .hdr img { height: 42px; width: auto; display: block; max-width: 200px; }
  .hdr h1 {
    margin: 0 0 2px;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: .02em;
  }
  .hdr .brand { margin: 0; font-size: 9.5pt; opacity: .92; font-weight: 600; }
  .hdr .meta-line { margin: 2px 0 0; font-size: 8pt; opacity: .72; }
  .hdr-right { text-align: right; }
  .period {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 15pt;
    font-weight: 700;
    margin: 0;
  }
  .generated { margin: 4px 0 0; font-size: 8pt; opacity: .7; }
  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }
  .meta-cell {
    padding: 11px 20px;
    border-right: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
  }
  .meta-cell:nth-child(even) { border-right: none; }
  .meta-cell label {
    font-size: 7pt;
    color: #64748b;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .08em;
    display: block;
    margin-bottom: 3px;
  }
  .meta-cell span { font-size: 10pt; font-weight: 650; color: #0f172a; }
  .body { padding: 6px 0 0; }
  .section { margin: 14px 20px; }
  .section-title {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 11pt;
    font-weight: 700;
    color: #0f2744;
    margin: 0 0 8px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, #cbd5e1, transparent);
  }
  table { width: 100%; border-collapse: collapse; }
  th {
    background: #0f2744;
    color: #fff;
    padding: 9px 12px;
    font-size: 8pt;
    text-align: left;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  th:last-child, td.amount { text-align: right; }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
    font-size: 9.5pt;
    color: #1e293b;
  }
  tr:nth-child(even) td { background: #fafbfc; }
  .amount { font-weight: 700; font-variant-numeric: tabular-nums; }
  .deduction { color: #b91c1c; }
  .total-row td {
    background: #eef2f7 !important;
    font-weight: 800;
    font-size: 10.5pt;
    border-top: 2px solid #94a3b8;
    border-bottom: none;
    color: #0f172a;
  }
  .net-box {
    background: linear-gradient(135deg, #0f2744 0%, #1e3a5f 100%);
    color: #fff;
    padding: 18px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .net-box .label {
    font-size: 9pt;
    opacity: .8;
    text-transform: uppercase;
    letter-spacing: .08em;
    font-weight: 700;
  }
  .net-box .sub {
    margin-top: 4px;
    font-size: 8pt;
    opacity: .65;
  }
  .net-box .amount {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 22pt;
    font-weight: 700;
  }
  .footer {
    padding: 12px 20px 16px;
    font-size: 7.5pt;
    color: #64748b;
    text-align: center;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    line-height: 1.5;
  }
</style></head><body><div class="page">
${trialBannerHtml()}
<div class="hdr">
  <div class="hdr-left">
    <div class="hdr-logo"><img src="${logoDataUri}" alt="Allied Services logo"/></div>
    <div>
      <h1>Salary Slip</h1>
      <p class="brand">Allied Services International (Pvt.) Ltd.</p>
      <p class="meta-line">NTN: 7483900-1 · accounts@asil.com.pk</p>
    </div>
  </div>
  <div class="hdr-right">
    <p class="period">${monthName} ${year}</p>
    <p class="generated">Generated ${new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
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
<div class="body">
  <div class="section">
    <div class="section-title">Earnings &amp; Additions</div>
    <table>
      <thead><tr><th>Description</th><th>Amount (PKR)</th></tr></thead>
      <tbody>${earningsRows}
        <tr class="total-row"><td>GROSS TOTAL</td><td class="amount">${money(grossTotal)}</td></tr>
      </tbody>
    </table>
  </div>

  ${hasDeductions ? `<div class="section">
    <div class="section-title">Deductions</div>
    <table>
      <thead><tr><th>Description</th><th>Amount (PKR)</th></tr></thead>
      <tbody>${deductionRows}
        <tr class="total-row"><td>TOTAL DEDUCTIONS</td><td class="amount deduction">- ${money(totalDeductions)}</td></tr>
      </tbody>
    </table>
  </div>` : ''}
</div>
<div class="net-box">
  <div>
    <div class="label">Net Salary Payable</div>
    <div class="sub">${monthName} ${year}</div>
  </div>
  <div class="amount">Rs. ${money(netPay)}</div>
</div>
<div class="footer">
  Open this PDF with your CNIC number (digits only, no dashes) as the password.<br>
  Payslip queries: ${OPS_SUPPORT} · System-generated — no signature required · Allied Services International (Pvt.) Ltd.
</div>
</div></body></html>`;
}

function renderEmailCoverHtml({ emp, monthName, year, frontendUrl, netPay, testRun }) {
    const trial = isTrialMode()
        ? `<p style="background:#fff7ed;padding:12px 14px;border-radius:8px;color:#9a3412;border:1px solid #fdba74;"><strong>TRIAL MODE</strong> — If anything looks wrong, email <a href="mailto:${OPS_SUPPORT}">${OPS_SUPPORT}</a>.</p>`
        : '';
    const testBanner = testRun
        ? `<p style="background:#eff6ff;padding:12px 14px;border-radius:8px;color:#1e40af;border:1px solid #93c5fd;"><strong>INTERNAL TEST RUN</strong> — Sample July payslip before candidate rollout. Not a live employee payment notice.</p>`
        : '';
    const netLine = netPay != null
        ? `<p style="font-size:15px;"><strong>Net Payable:</strong> Rs. ${money(netPay)}</p>`
        : '';
    return `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;background:#f1f5f9;margin:0;padding:24px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
  <div style="background:linear-gradient(135deg,#0f2744,#1e3a5f);color:#fff;padding:22px 24px;">
    <div style="font-size:12px;opacity:.75;letter-spacing:.08em;text-transform:uppercase;">Allied Services International</div>
    <h2 style="margin:6px 0 0;font-size:22px;">Salary Slip — ${monthName} ${year}</h2>
  </div>
  <div style="padding:22px 24px;">
  ${testBanner}
  ${trial}
  <p>Dear ${emp.name},</p>
  <p>Your salary for <strong>${monthName} ${year}</strong> has been processed. Please find your detailed payslip attached as a password-protected PDF.</p>
  ${netLine}
  <p><strong>Password:</strong> your CNIC number (digits only, no dashes).</p>
  <p>The payslip lists earnings (including overtime and reimbursements), deductions, tax, and net payable.</p>
  <p>Portal: <a href="${frontendUrl}" style="color:#1e3a5f;">${frontendUrl}</a></p>
  <p>Queries: <a href="mailto:${OPS_SUPPORT}">${OPS_SUPPORT}</a></p>
  <p style="margin-top:28px;">Warm regards,<br><strong>HR Department</strong><br>Allied Services International (Pvt.) Ltd.</p>
  </div>
</div></body></html>`;
}

module.exports = {
    TRIAL_END,
    OPS_SUPPORT,
    isTrialMode,
    renderPayslipHtml,
    renderEmailCoverHtml,
};
