'use strict';

function fmt(v) {
    return Math.round(parseFloat(v) || 0).toLocaleString('en-PK');
}

function renderPayslipHtml({ emp, computed, month, year, paidDays, workingDays }) {
    const monthName = new Date(2000, parseInt(month, 10) - 1, 1).toLocaleString('en-PK', { month: 'long' });
    const grossSalary = parseFloat(emp.salary) || 0;
    const workDays = workingDays || 26;
    const ratio = paidDays / workDays;
    const basicSalary = Math.round(grossSalary * 0.60 * ratio);
    const hra = Math.round(grossSalary * 0.20 * ratio);
    const conveyance = Math.round(grossSalary * 0.10 * ratio);
    const medical = Math.round(grossSalary * 0.07 * ratio);
    const otherAllow = Math.round(grossSalary * 0.03 * ratio);

    const otAmount = Math.round(computed.overtimeAmount || 0);
    const opdClaim = Math.round(computed.opd || computed.medicalCoverage || 0);
    const reimbursement = Math.round(computed.expense || 0);
    const grossTotal = Math.round(computed.gross || 0);
    const incomeTax = Math.round(computed.wht || 0);
    const eobiEE = Math.round(computed.eobiEmployee || 400);
    const totalDeductions = Math.round(computed.totalDeductions || (incomeTax + eobiEE));
    const netPay = Math.round(computed.netPay || 0);

    const row = (label, val, isDeduction = false) =>
        val > 0 ? `<tr><td>${label}</td><td class="amount${isDeduction ? ' deduction' : ''}">
                ${isDeduction ? '- ' : ''}${fmt(val)}</td></tr>` : '';

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Salary Slip — ${emp.name} — ${monthName} ${year}</title>
<style>
  @media print { body { margin: 0; } .page { padding: 16px 20px; } }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; background: #f0f4f8; }
  .page { max-width: 720px; margin: 20px auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.12); }
  .hdr { background: #1e3a5f; color: #fff; padding: 18px 26px; display: flex; justify-content: space-between; align-items: flex-start; }
  .hdr h2 { margin: 0 0 4px; font-size: 16pt; letter-spacing: .5px; }
  .hdr p { margin: 3px 0; font-size: 9pt; opacity: .85; }
  .hdr-right { text-align: right; font-size: 9pt; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border-bottom: 2px solid #e2e8f0; }
  .meta-cell { padding: 10px 18px; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
  .meta-cell:nth-child(even) { border-right: none; }
  .meta-cell label { font-size: 7.5pt; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; display: block; margin-bottom: 3px; }
  .meta-cell span { font-size: 10pt; font-weight: 600; color: #1e293b; }
  .section { margin: 0 18px 14px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th { background: #334155; color: #fff; padding: 8px 12px; font-size: 8.5pt; text-align: left; letter-spacing: .05em; }
  th:last-child { text-align: right; }
  td { padding: 7px 12px; border-bottom: 1px solid #f1f5f9; font-size: 9.5pt; color: #1e293b; }
  .amount { text-align: right; font-weight: 600; }
  .deduction { color: #dc2626; }
  .total-row td { background: #f8fafc; font-weight: 800; font-size: 10.5pt; border-top: 2px solid #cbd5e1; border-bottom: 2px solid #cbd5e1; }
  .net-box { background: #1e3a5f; color: #fff; padding: 16px 24px; margin: 0; display: flex; justify-content: space-between; align-items: center; }
  .net-box .label { font-size: 10pt; opacity: .85; }
  .net-box .sub { font-size: 8pt; opacity: .65; margin-top: 2px; }
  .net-box .amount { font-size: 20pt; font-weight: 800; }
  .footer { padding: 12px 20px; font-size: 8pt; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; background: #f8fafc; }
  .paid-days-badge { background: rgba(255,255,255,.15); padding: 3px 10px; border-radius: 20px; font-size: 8pt; margin-top: 6px; display: inline-block; }
</style></head><body><div class="page">

<div class="hdr">
  <div>
    <h2>SALARY SLIP</h2>
    <p>Allied Services International (Pvt.) Ltd.</p>
    <p>NTN: 7483900-1 | accounts@asil.com.pk</p>
  </div>
  <div class="hdr-right">
    <p style="font-size:12pt;font-weight:700">${monthName} ${year}</p>
    <p>Generated: ${new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
    <div class="paid-days-badge">Paid Days: ${paidDays} / ${workDays}</div>
  </div>
</div>

<div class="meta">
  <div class="meta-cell"><label>Employee Name</label><span>${emp.name}</span></div>
  <div class="meta-cell"><label>Employee Code</label><span>${emp.id}</span></div>
  <div class="meta-cell"><label>Designation</label><span>${emp.designation || '—'}</span></div>
  <div class="meta-cell"><label>Client / Location</label><span>${emp.client || '—'} / ${emp.location || '—'}</span></div>
  <div class="meta-cell"><label>CNIC</label><span>${emp.cnic || '—'}</span></div>
  <div class="meta-cell"><label>Bank Account</label><span>${emp.bank_name || '—'} — ${emp.bank_account || '—'}</span></div>
</div>

<div class="section">
<table>
  <thead><tr><th>EARNINGS</th><th class="amount">Amount (Rs.)</th></tr></thead>
  <tbody>
    <tr><td>Basic Salary</td><td class="amount">${fmt(basicSalary)}</td></tr>
    <tr><td>House Rent Allowance (HRA)</td><td class="amount">${fmt(hra)}</td></tr>
    <tr><td>Conveyance Allowance</td><td class="amount">${fmt(conveyance)}</td></tr>
    <tr><td>Medical Allowance</td><td class="amount">${fmt(medical)}</td></tr>
    ${otherAllow > 0 ? `<tr><td>Other Allowances</td><td class="amount">${fmt(otherAllow)}</td></tr>` : ''}
    ${row('Overtime (OT)', otAmount)}
    ${row('OPD Claim', opdClaim)}
    ${row('Expense Reimbursement', reimbursement)}
    <tr class="total-row"><td>GROSS SALARY</td><td class="amount">${fmt(grossTotal)}</td></tr>
  </tbody>
</table>
</div>

<div class="section">
<table>
  <thead><tr><th>DEDUCTIONS</th><th class="amount">Amount (Rs.)</th></tr></thead>
  <tbody>
    <tr><td class="deduction">Income Tax (WHT)</td><td class="amount deduction">- ${fmt(incomeTax)}</td></tr>
    <tr><td class="deduction">EOBI (Employee Share)</td><td class="amount deduction">- ${fmt(eobiEE)}</td></tr>
    <tr class="total-row"><td>TOTAL DEDUCTIONS</td><td class="amount deduction">- ${fmt(totalDeductions)}</td></tr>
  </tbody>
</table>
</div>

<div class="net-box">
  <div>
    <div class="label">NET SALARY PAYABLE</div>
    <div class="sub">${monthName} ${year} | Gross ${fmt(grossTotal)} — Deductions ${fmt(totalDeductions)}</div>
  </div>
  <div class="amount">Rs. ${fmt(netPay)}</div>
</div>

<div class="footer">
  This is a system-generated salary slip and does not require a signature. | Allied Services International (Pvt.) Ltd.
</div>
</div></body></html>`;
}

function renderInvoiceHtml({ invoice, contract, policy, challanStatus }) {
    const lineItems = typeof invoice.line_items === 'string' ? JSON.parse(invoice.line_items) : (invoice.line_items || []);
    const dueDate = invoice.due_date || (() => {
        const d = new Date(invoice.period_year, invoice.period_month, 0);
        d.setDate(d.getDate() + Number(policy?.credit_days || 30));
        return d.toISOString().slice(0, 10);
    })();

    const challanRows = (challanStatus?.required || []).map(type => {
        const present = (challanStatus.present || []).includes(type);
        const status = present ? 'Present' : 'Missing';
        const cls = present ? 'ok' : 'missing';
        return `<tr><td>${type}</td><td class="${cls}">${status}</td></tr>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Invoice ${invoice.invoice_number}</title>
<style>
  @media print { body { margin: 0; } .page { box-shadow: none; margin: 0; } }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; background: #f5f5f5; margin: 0; }
  .page { max-width: 800px; margin: 24px auto; background: #fff; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,.1); }
  h1 { margin: 0 0 4px; font-size: 20pt; }
  .sub { color: #555; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { padding: 8px 12px; border-bottom: 1px solid #ddd; text-align: left; }
  th { background: #1e3a5f; color: #fff; }
  .amount { text-align: right; }
  .totals td { font-weight: 700; }
  .grand { font-size: 14pt; color: #1e3a5f; }
  .ok { color: #16a34a; font-weight: 600; }
  .missing { color: #dc2626; font-weight: 600; }
</style></head><body><div class="page">
  <h1>Allied Services International</h1>
  <p class="sub">Tax Invoice</p>
  <p><strong>Invoice #:</strong> ${invoice.invoice_number}<br/>
  <strong>Client:</strong> ${invoice.client}<br/>
  <strong>Contract:</strong> ${invoice.contract}<br/>
  <strong>Period:</strong> ${invoice.period_month}/${invoice.period_year}<br/>
  <strong>Due date:</strong> ${dueDate}</p>
  <table>
    <thead><tr><th>Description</th><th class="amount">Amount (PKR)</th></tr></thead>
    <tbody>
      ${lineItems.map(li => `<tr><td>${li.description}</td><td class="amount">${fmt(li.amount)}</td></tr>`).join('')}
      <tr class="totals"><td>Subtotal</td><td class="amount">${fmt(invoice.subtotal)}</td></tr>
      <tr class="totals"><td>Service charges</td><td class="amount">${fmt(invoice.service_charges)}</td></tr>
      <tr class="totals"><td>Sales tax</td><td class="amount">${fmt(invoice.sales_tax)}</td></tr>
      <tr class="totals grand"><td>Grand total</td><td class="amount">${fmt(invoice.grand_total)}</td></tr>
    </tbody>
  </table>
  ${challanRows ? `<h3>Compliance attachments</h3><table><thead><tr><th>Challan</th><th>Status</th></tr></thead><tbody>${challanRows}</tbody></table>` : ''}
</div></body></html>`;
}

module.exports = { renderPayslipHtml, renderInvoiceHtml, fmt };
