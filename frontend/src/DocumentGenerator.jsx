import React, { useState, useRef, useEffect } from 'react';
import { FileText, Download, CheckSquare, Square, Printer, X, Eye, ChevronDown, Loader } from 'lucide-react';
import { api } from './api';

// ─── Company Details ──────────────────────────────────────────────────────────
const CO = {
  name: 'Allied Services International (Pvt.) Ltd.',
  address: '301, 3rd Floor, Business Avenue, Shahrah-e-Faisal, Karachi - 75350',
  ntn: '7483900-1',
  phone: '(021) 3456-7890',
  email: 'hr@asil.com.pk',
  website: 'www.asil.com.pk',
};

// Absolute URL for logo — works in both print window and preview
const LOGO_URL = `${window.location.origin}/asil-logo.png`;

const today = () => {
  const d = new Date();
  return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
};

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT 1 — EMPLOYMENT CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════
function renderEmploymentContract(emp) {
  const salary = (emp.salary || 0).toLocaleString('en-PK');
  const doj = emp.doj ? new Date(emp.doj).toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' }) : '_________________';
  return `
<div style="font-family:'Times New Roman',serif; font-size:12pt; line-height:1.8; color:#000; max-width:750px; margin:0 auto; padding:40px;">

  <!-- LETTERHEAD -->
  <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #c0392b; padding-bottom:14px; margin-bottom:18px;">
    <img src="${LOGO_URL}" alt="ASIL Logo" style="height:80px; object-fit:contain;" />
    <div style="text-align:right; font-size:9.5pt; color:#444; line-height:1.7;">
      <div style="font-size:10.5pt; font-weight:bold; color:#000;">${CO.name}</div>
      <div>${CO.address}</div>
      <div>Tel: ${CO.phone} | Email: ${CO.email}</div>
      <div>NTN: ${CO.ntn} | ${CO.website}</div>
    </div>
  </div>

  <div style="margin:16px 0; border-top:2px solid #000; border-bottom:2px solid #000; padding:6px 0; font-size:13pt; font-weight:bold; letter-spacing:2px; text-align:center;">
    EMPLOYMENT CONTRACT
  </div>

  <p>This Employment Contract ("Agreement") is entered into on <strong>${today()}</strong>, between:</p>

  <p><strong>Employer:</strong> ${CO.name}, having its principal office at ${CO.address} (hereinafter referred to as the "Company").</p>
  <p><strong>Employee:</strong> Mr./Ms. <strong>${emp.name || '_____________________'}</strong>, holding CNIC No. <strong>${emp.cnic || '_____________________'}</strong>, Son/Daughter of <strong>${emp.fatherName || '_____________________'}</strong>, residing at ${emp.presentAddress || '_____________________'} (hereinafter referred to as the "Employee").</p>

  <div style="margin:20px 0; padding:14px; border:1px solid #000;">
    <table style="width:100%; border-collapse:collapse; font-size:11pt;">
      <tr><td style="padding:5px 8px; width:40%; font-weight:bold; border:1px solid #ccc;">ASIL Employee Code</td><td style="padding:5px 8px; border:1px solid #ccc;">${emp.id || ''}</td></tr>
      <tr><td style="padding:5px 8px; font-weight:bold; border:1px solid #ccc;">Designation</td><td style="padding:5px 8px; border:1px solid #ccc;">${emp.designation || ''}</td></tr>
      <tr><td style="padding:5px 8px; font-weight:bold; border:1px solid #ccc;">Department</td><td style="padding:5px 8px; border:1px solid #ccc;">${emp.dept || ''}</td></tr>
      <tr><td style="padding:5px 8px; font-weight:bold; border:1px solid #ccc;">Client / Site</td><td style="padding:5px 8px; border:1px solid #ccc;">${emp.client || ''} — ${emp.location || ''}</td></tr>
      <tr><td style="padding:5px 8px; font-weight:bold; border:1px solid #ccc;">Date of Joining</td><td style="padding:5px 8px; border:1px solid #ccc;">${doj}</td></tr>
      <tr><td style="padding:5px 8px; font-weight:bold; border:1px solid #ccc;">Gross Monthly Salary</td><td style="padding:5px 8px; border:1px solid #ccc;">PKR ${salary}/- (${numberToWords(emp.salary || 0)} Rupees Only)</td></tr>
      <tr><td style="padding:5px 8px; font-weight:bold; border:1px solid #ccc;">Province</td><td style="padding:5px 8px; border:1px solid #ccc;">${emp.province || ''}</td></tr>
    </table>
  </div>

  <h3 style="margin-top:20px; font-size:12pt; text-decoration:underline;">1. APPOINTMENT & PROBATION</h3>
  <p>The Employee is hereby appointed as <strong>${emp.designation || '_____'}</strong> with effect from <strong>${doj}</strong>. The Employee shall be on probation for a period of Three (3) months from the date of joining. During the probationary period, the contract may be terminated by either party without notice.</p>

  <h3 style="font-size:12pt; text-decoration:underline;">2. DUTIES AND RESPONSIBILITIES</h3>
  <p>The Employee shall perform all duties assigned by the Company or its clients with diligence, honesty, and professionalism. The Employee agrees to follow the code of conduct, HSEQ policies, and client-specific rules at all times.</p>

  <h3 style="font-size:12pt; text-decoration:underline;">3. SALARY AND BENEFITS</h3>
  <p>a) Gross monthly salary shall be PKR <strong>${salary}/-</strong> payable on the last working day of each month via bank transfer.<br/>
  b) The Employee shall be entitled to all statutory benefits as per the applicable provincial labor laws including EOBI, SESSI (where applicable), and annual leave encashment.<br/>
  c) Overtime, if any, shall be paid at double the hourly rate for weekdays and at triple rate for Sundays and public holidays.</p>

  <h3 style="font-size:12pt; text-decoration:underline;">4. WORKING HOURS</h3>
  <p>Standard working hours are 8 hours per day, 6 days per week (or as per client site requirements). The Company reserves the right to modify working hours based on operational needs.</p>

  <h3 style="font-size:12pt; text-decoration:underline;">5. LEAVE ENTITLEMENT</h3>
  <p>The Employee shall be entitled to annual leave as per applicable labor laws: Casual Leave (10 days), Medical Leave (8 days), and Earned Leave (14 days per year after completion of one year of service).</p>

  <h3 style="font-size:12pt; text-decoration:underline;">6. CODE OF CONDUCT</h3>
  <p>The Employee shall maintain confidentiality of client information, refrain from disclosing trade secrets, and comply with all applicable laws. Violation of the code of conduct may result in immediate termination.</p>

  <h3 style="font-size:12pt; text-decoration:underline;">7. TERMINATION</h3>
  <p>After probation, either party may terminate this contract with <strong>one (1) month's notice</strong> in writing, or by payment of one month's salary in lieu thereof. The Company may terminate immediately in case of gross misconduct, dishonesty, or serious breach of contract terms.</p>

  <h3 style="font-size:12pt; text-decoration:underline;">8. GRATUITY</h3>
  <p>The Employee shall be entitled to gratuity upon completion of one (1) year of continuous service, as per applicable labor laws, calculated at the rate of one month's last drawn gross salary for each completed year of service.</p>

  <h3 style="font-size:12pt; text-decoration:underline;">9. GOVERNING LAW</h3>
  <p>This Agreement shall be governed by the laws of Pakistan. Any dispute arising herein shall be subject to the jurisdiction of courts in Karachi, Pakistan.</p>

  <div style="margin-top:48px; display:grid; grid-template-columns:1fr 1fr; gap:40px;">
    <div>
      <div style="border-top:1px solid #000; padding-top:8px; margin-top:60px;">
        <strong>Authorized Signatory</strong><br/>
        ${CO.name}<br/>
        Name: ________________________<br/>
        Designation: _________________<br/>
        Date: ${today()}
      </div>
    </div>
    <div>
      <div style="border-top:1px solid #000; padding-top:8px; margin-top:60px;">
        <strong>Employee Signature</strong><br/>
        Name: ${emp.name || ''}<br/>
        CNIC: ${emp.cnic || ''}<br/>
        Date: ________________________<br/>
        Thumb Impression: ____________
      </div>
    </div>
  </div>

  <p style="margin-top:24px; font-size:9pt; color:#555; border-top:1px solid #ccc; padding-top:8px;">
    This document is computer-generated. ASIL Employee Code: ${emp.id} | Generated: ${today()}
  </p>
</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT 2 — EMPLOYEE JOINING REPORT
// ═══════════════════════════════════════════════════════════════════════════════
function renderJoiningReport(emp) {
  const doj = emp.doj ? new Date(emp.doj).toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' }) : '_________________';
  const dob = emp.dob ? new Date(emp.dob).toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' }) : '_________________';
  const Row = (label, value) => `
      <tr>
        <td style="padding:6px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5; width:38%; font-size:11pt;">${label}</td>
        <td style="padding:6px 10px; border:1px solid #bbb; font-size:11pt;">${value || '&nbsp;'}</td>
      </tr>`;
  return `
<div style="font-family:Arial,sans-serif; font-size:11pt; line-height:1.7; color:#000; max-width:750px; margin:0 auto; padding:36px;">

  <!-- LETTERHEAD -->
  <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #c0392b; padding-bottom:14px; margin-bottom:18px;">
    <img src="${LOGO_URL}" alt="ASIL Logo" style="height:75px; object-fit:contain;" />
    <div style="text-align:right; font-size:9pt; color:#444; line-height:1.7;">
      <div style="font-weight:bold; font-size:10pt; color:#000;">${CO.name}</div>
      <div>${CO.address}</div>
      <div>NTN: ${CO.ntn} | ${CO.email} | ${CO.website}</div>
    </div>
  </div>

  <div style="background:#1e3a5f; color:white; text-align:center; padding:10px; font-size:14pt; font-weight:bold; letter-spacing:2px; margin-bottom:20px;">
    EMPLOYEE JOINING REPORT
  </div>

  <div style="display:flex; gap:16px; margin-bottom:6px; font-size:10pt;">
    <span><strong>Form No.:</strong> JR-${String(Date.now()).slice(-6)}</span>
    <span><strong>Date:</strong> ${today()}</span>
  </div>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 4px; border-left:4px solid #1e3a5f;">A. EMPLOYMENT INFORMATION</h3>
  <table style="width:100%; border-collapse:collapse;">
    ${Row('ASIL Employee Code', emp.id)}
    ${Row('ASIL Business Unit (BU)', emp.bu)}
    ${Row('Client Name', emp.client)}
    ${Row('Client Business Unit', emp.clientBU)}
    ${Row('Department', emp.dept)}
    ${Row('Designation', emp.designation)}
    ${Row('Site / Location', emp.location)}
    ${Row('Province', emp.province)}
    ${Row('Date of Joining', doj)}
    ${Row('Employment Status', emp.active === 'Yes' ? 'Active' : 'Inactive')}
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 4px; border-left:4px solid #1e3a5f;">B. PERSONAL INFORMATION</h3>
  <table style="width:100%; border-collapse:collapse;">
    ${Row('Full Name', emp.name)}
    ${Row("Father's Name", emp.fatherName)}
    ${Row("Mother's Name", emp.motherName)}
    ${Row('Date of Birth', dob)}
    ${Row('Age', emp.age || '')}
    ${Row('Place of Birth', emp.placeOfBirth)}
    ${Row('Religion', emp.religion)}
    ${Row('Marital Status', emp.maritalStatus)}
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 4px; border-left:4px solid #1e3a5f;">C. CNIC & COMPLIANCE</h3>
  <table style="width:100%; border-collapse:collapse;">
    ${Row('CNIC Number', emp.cnic)}
    ${Row('CNIC Issue Date', emp.cnicIssue)}
    ${Row('CNIC Expiry Date', emp.cnicExpiry)}
    ${Row('EOBI Number', emp.eobiNo)}
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 4px; border-left:4px solid #1e3a5f;">D. CONTACT & ADDRESS</h3>
  <table style="width:100%; border-collapse:collapse;">
    ${Row('Primary Contact', emp.primaryContact)}
    ${Row('Emergency Contact', emp.emergencyContact)}
    ${Row('Email Address', emp.email)}
    ${Row('Present Address', emp.presentAddress)}
    ${Row('Permanent Address', emp.permanentAddress)}
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 4px; border-left:4px solid #1e3a5f;">E. SALARY DETAILS</h3>
  <table style="width:100%; border-collapse:collapse;">
    ${Row('Gross Monthly Salary', emp.salary ? 'PKR ' + emp.salary.toLocaleString('en-PK') + '/-' : '')}
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 4px; border-left:4px solid #1e3a5f;">F. FAMILY DETAILS</h3>
  <table style="width:100%; border-collapse:collapse;">
    ${Row('Spouse Name', emp.spouseName)}
    ${Row('Spouse Age', emp.spouseAge)}
    ${Row('Spouse CNIC', emp.spouseCnic)}
    ${Row('Child 1 Name / Age / ID', [emp.child1Name, emp.child1Age, emp.child1Id].filter(Boolean).join(' | '))}
    ${Row('Child 2 Name / Age / ID', [emp.child2Name, emp.child2Age, emp.child2Id].filter(Boolean).join(' | '))}
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 4px; border-left:4px solid #1e3a5f;">G. BANKING DETAILS</h3>
  <table style="width:100%; border-collapse:collapse;">
    ${Row('Bank Name', emp.bankName)}
    ${Row('Account Number / IBAN', emp.bankAccount)}
    ${Row('Account Title', emp.accountTitle)}
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 4px; border-left:4px solid #1e3a5f;">H. NEXT OF KIN</h3>
  <table style="width:100%; border-collapse:collapse;">
    ${Row('Name', emp.nokName)}
    ${Row('Relation', emp.nokRelation)}
    ${Row('Contact', emp.nokContact)}
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 4px; border-left:4px solid #1e3a5f;">I. MEDICAL COVERAGE</h3>
  <table style="width:100%; border-collapse:collapse;">
    ${Row('Medical Coverage Type', emp.medicalType)}
    ${Row('Maternity Benefit', emp.medicalMaternity)}
    ${Row('Total Medical Coverage', emp.totalMedicalCoverage ? 'PKR ' + Number(emp.totalMedicalCoverage).toLocaleString('en-PK') : '')}
  </table>

  <div style="margin-top:40px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px; font-size:10pt;">
    <div style="text-align:center;">
      <div style="border-top:1px solid #000; padding-top:6px; margin-top:48px;">Employee Signature<br/><strong>${emp.name || ''}</strong></div>
    </div>
    <div style="text-align:center;">
      <div style="border-top:1px solid #000; padding-top:6px; margin-top:48px;">Site Manager / Supervisor<br/>Name: ____________</div>
    </div>
    <div style="text-align:center;">
      <div style="border-top:1px solid #000; padding-top:6px; margin-top:48px;">HR Officer<br/>Name: ____________</div>
    </div>
  </div>
  <p style="margin-top:20px; font-size:9pt; color:#888; border-top:1px solid #ddd; padding-top:6px;">
    ASIL Employee Code: ${emp.id} | Generated: ${today()}
  </p>
</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT 3 — UNIFORM MEASUREMENT FORM
// ═══════════════════════════════════════════════════════════════════════════════
function renderUniformForm(emp) {
  const doj = emp.doj ? new Date(emp.doj).toLocaleDateString('en-PK') : '';
  const MRow = (label) => `
      <tr>
        <td style="padding:8px 10px; border:1px solid #bbb; font-weight:600; width:40%; background:#f9f9f9;">${label}</td>
        <td style="padding:8px 10px; border:1px solid #bbb; text-align:center; width:20%;">XS</td>
        <td style="padding:8px 10px; border:1px solid #bbb; text-align:center; width:20%;">S</td>
        <td style="padding:8px 10px; border:1px solid #bbb; text-align:center; width:10%;">M</td>
        <td style="padding:8px 10px; border:1px solid #bbb; text-align:center; width:10%;">L</td>
        <td style="padding:8px 10px; border:1px solid #bbb; text-align:center;">&nbsp;&nbsp;XL&nbsp;&nbsp;</td>
        <td style="padding:8px 10px; border:1px solid #bbb; text-align:center;">2XL</td>
        <td style="padding:8px 10px; border:1px solid #bbb; text-align:center;">3XL</td>
        <td style="padding:8px 10px; border:1px solid #bbb; width:15%;">Custom Size</td>
      </tr>`;
  const MeasRow = (label) => `
      <tr>
        <td style="padding:8px 10px; border:1px solid #bbb; font-weight:600; background:#f9f9f9;">${label}</td>
        <td style="padding:8px 10px; border:1px solid #bbb;">&nbsp;</td>
      </tr>`;
  const ShoeRow = (size) => `
      <td style="padding:7px 10px; border:1px solid #bbb; text-align:center;">${size}</td>`;
  return `
<div style="font-family:Arial,sans-serif; font-size:11pt; line-height:1.6; color:#000; max-width:750px; margin:0 auto; padding:36px;">

  <!-- LETTERHEAD -->
  <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #c0392b; padding-bottom:14px; margin-bottom:18px;">
    <img src="${LOGO_URL}" alt="ASIL Logo" style="height:75px; object-fit:contain;" />
    <div style="text-align:right; font-size:9pt; color:#444; line-height:1.7;">
      <div style="font-weight:bold; font-size:10pt; color:#000;">${CO.name}</div>
      <div>${CO.address}</div>
      <div>NTN: ${CO.ntn} | ${CO.email}</div>
    </div>
  </div>

  <div style="background:#1e3a5f; color:white; text-align:center; padding:10px; font-size:14pt; font-weight:bold; letter-spacing:2px; margin-bottom:18px;">
    EMPLOYEE UNIFORM MEASUREMENT FORM
  </div>

  <table style="width:100%; border-collapse:collapse; margin-bottom:16px;">
    <tr>
      <td style="padding:6px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5; width:25%;">Employee Code</td>
      <td style="padding:6px 10px; border:1px solid #bbb; width:25%;">${emp.id || ''}</td>
      <td style="padding:6px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5; width:25%;">Date of Joining</td>
      <td style="padding:6px 10px; border:1px solid #bbb;">${doj}</td>
    </tr>
    <tr>
      <td style="padding:6px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5;">Employee Name</td>
      <td style="padding:6px 10px; border:1px solid #bbb;" colspan="3"><strong>${emp.name || ''}</strong></td>
    </tr>
    <tr>
      <td style="padding:6px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5;">Designation</td>
      <td style="padding:6px 10px; border:1px solid #bbb;">${emp.designation || ''}</td>
      <td style="padding:6px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5;">Department</td>
      <td style="padding:6px 10px; border:1px solid #bbb;">${emp.dept || ''}</td>
    </tr>
    <tr>
      <td style="padding:6px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5;">Client / Site</td>
      <td style="padding:6px 10px; border:1px solid #bbb;" colspan="3">${emp.client || ''} — ${emp.location || ''}</td>
    </tr>
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 6px; border-left:4px solid #1e3a5f;">A. UNIFORM SIZES</h3>
  <table style="width:100%; border-collapse:collapse; font-size:10pt;">
    <thead>
      <tr style="background:#1e3a5f; color:white;">
        <th style="padding:8px 10px; border:1px solid #bbb; text-align:left;">Item</th>
        <th style="padding:8px; border:1px solid #bbb;">XS</th>
        <th style="padding:8px; border:1px solid #bbb;">S</th>
        <th style="padding:8px; border:1px solid #bbb;">M</th>
        <th style="padding:8px; border:1px solid #bbb;">L</th>
        <th style="padding:8px; border:1px solid #bbb;">XL</th>
        <th style="padding:8px; border:1px solid #bbb;">2XL</th>
        <th style="padding:8px; border:1px solid #bbb;">3XL</th>
        <th style="padding:8px 10px; border:1px solid #bbb;">Custom</th>
      </tr>
    </thead>
    <tbody>
      ${MRow('Shirt / Kameez')}
      ${MRow('Trouser / Shalwar')}
      ${MRow('Safety Jacket / Vest')}
      ${MRow('Coverall / Overall')}
      ${MRow('Winter Jacket')}
      ${MRow('Polo / T-Shirt')}
      ${MRow('Cap / Helmet Size')}
    </tbody>
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 6px; border-left:4px solid #1e3a5f;">B. SHOE SIZE</h3>
  <table style="width:100%; border-collapse:collapse; font-size:10pt;">
    <tr>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5; width:30%;">Safety Shoes Size (UK)</td>
      ${[5, 6, 7, 8, 9, 10, 11, 12].map(ShoeRow).join('')}
    </tr>
    <tr>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5;">Dress / Formal Shoes (UK)</td>
      ${[5, 6, 7, 8, 9, 10, 11, 12].map(ShoeRow).join('')}
    </tr>
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 6px; border-left:4px solid #1e3a5f;">C. BODY MEASUREMENTS (inches)</h3>
  <table style="width:100%; border-collapse:collapse; font-size:10pt;">
    <colgroup><col style="width:50%"/><col style="width:50%"/></colgroup>
    <tbody>
      <tr>
        <table style="width:100%; border-collapse:collapse;">
          ${MeasRow('Height (ft & inches)')}
          ${MeasRow('Chest (inches)')}
          ${MeasRow('Waist (inches)')}
          ${MeasRow('Neck (inches)')}
          ${MeasRow('Shoulder Width (inches)')}
          ${MeasRow('Sleeve Length (inches)')}
          ${MeasRow('Trouser Length / Inseam')}
        </table>
      </tr>
    </tbody>
  </table>

  <h3 style="background:#f0f0f0; padding:7px 12px; font-size:11pt; margin:16px 0 6px; border-left:4px solid #1e3a5f;">D. PPE REQUIREMENTS</h3>
  <table style="width:100%; border-collapse:collapse; font-size:10pt;">
    <tr>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5; width:35%;">Safety Helmet</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">☐ Yes &nbsp;&nbsp;&nbsp; ☐ No</td>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5;">Safety Gloves</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">☐ Yes &nbsp;&nbsp;&nbsp; ☐ No</td>
    </tr>
    <tr>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5;">Safety Goggles / Glasses</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">☐ Yes &nbsp;&nbsp;&nbsp; ☐ No</td>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5;">Ear Protection</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">☐ Yes &nbsp;&nbsp;&nbsp; ☐ No</td>
    </tr>
    <tr>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5;">High-Vis Vest</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">☐ Yes &nbsp;&nbsp;&nbsp; ☐ No</td>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:600; background:#f5f5f5;">Face Mask / Respirator</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">☐ Yes &nbsp;&nbsp;&nbsp; ☐ No</td>
    </tr>
  </table>

  <div style="margin-top:40px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px; font-size:10pt;">
    <div style="text-align:center;">
      <div style="border-top:1px solid #000; padding-top:6px; margin-top:48px;">Employee Signature<br/><strong>${emp.name || ''}</strong></div>
    </div>
    <div style="text-align:center;">
      <div style="border-top:1px solid #000; padding-top:6px; margin-top:48px;">Admin / Store In-charge<br/>Name: ____________</div>
    </div>
    <div style="text-align:center;">
      <div style="border-top:1px solid #000; padding-top:6px; margin-top:48px;">HR Officer<br/>Name: ____________</div>
    </div>
  </div>
  <p style="margin-top:20px; font-size:9pt; color:#888; border-top:1px solid #ddd; padding-top:6px;">
    ASIL Employee Code: ${emp.id} | Issued: ${today()}
  </p>
</div>`;
}

// ─── Number to words (simplified for PKR) ────────────────────────────────────
function numberToWords(n) {
  if (!n) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const convert = (num) => {
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + convert(num % 100) : '');
    if (num < 100000) return convert(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + convert(num % 1000) : '');
    if (num < 10000000) return convert(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + convert(num % 100000) : '');
    return convert(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 ? ' ' + convert(num % 10000000) : '');
  };
  return convert(Math.round(n));
}

// ─── Document definitions ─────────────────────────────────────────────────────
const DOCS = [
  { key: 'contract', label: 'Employment Contract', render: renderEmploymentContract },
  { key: 'joining', label: 'Employee Joining Report', render: renderJoiningReport },
  { key: 'uniform', label: 'Uniform Measurement Form', render: renderUniformForm },
];

// ─── Print / PDF helper ───────────────────────────────────────────────────────
function printDocument(htmlContent, filename) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('Please allow popups to print/export documents.'); return; }
  win.document.write(`<!DOCTYPE html><html><head>
        <title>${filename}</title>
        <style>
            @media print { @page { margin: 15mm; } body { margin: 0; } }
            body { font-family: 'Times New Roman', serif; }
        </style>
    </head><body>${htmlContent}
    <script>
        window.onload = function() {
            document.title = '${filename}';
            setTimeout(function(){ window.print(); }, 500);
        };
    </script></body></html>`);
  win.document.close();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function DocumentGenerator({ employee: propEmp }) {
  const [employees, setEmployees] = useState(propEmp ? [propEmp] : []);
  const [loading, setLoading] = useState(!propEmp);
  const [loadErr, setLoadErr] = useState(null);

  useEffect(() => {
    if (propEmp) return; // already have data from parent
    api.getEmployees()
      .then(data => {
        const active = (data.employees || []).filter(e => e.active !== 'No');
        setEmployees(active);
        setLoading(false);
      })
      .catch(err => { setLoadErr(err.message); setLoading(false); });
  }, []);

  const [selectedEmps, setSelectedEmps] = useState(propEmp ? [propEmp.id] : []);
  const [selectedDocs, setSelectedDocs] = useState(['contract', 'joining', 'uniform']);
  const [previewDoc, setPreviewDoc] = useState(null); // {html, title}

  const toggleEmp = (id) => setSelectedEmps(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleDoc = (k) => setSelectedDocs(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);

  const handlePrintSingle = (emp, docKey) => {
    const def = DOCS.find(d => d.key === docKey);
    if (!def) return;
    const html = def.render(emp);
    const filename = `${emp.id} - ${emp.name} - ${def.label}`;
    printDocument(html, filename);
  };

  const handleBulkPrint = () => {
    const emps = employees.filter(e => selectedEmps.includes(e.id));
    const docs = DOCS.filter(d => selectedDocs.includes(d.key));
    if (!emps.length) return alert('Select at least one employee.');
    if (!docs.length) return alert('Select at least one document type.');

    emps.forEach(emp => {
      docs.forEach(doc => {
        const html = doc.render(emp);
        const filename = `${emp.id} - ${emp.name} - ${doc.label}`;
        // Small delay to avoid browser popup blocking
        setTimeout(() => printDocument(html, filename), 300);
      });
    });
  };

  const handlePreview = (emp, docKey) => {
    const def = DOCS.find(d => d.key === docKey);
    if (!def) return;
    setPreviewDoc({ html: def.render(emp), title: `${emp.id} - ${emp.name} - ${def.label}` });
  };

  const Cb = ({ checked, onChange, label }) => (
    <div onClick={onChange} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '6px 0' }}>
      {checked ? <CheckSquare size={18} color="var(--primary)" /> : <Square size={18} color="var(--text-muted)" />}
      <span style={{ fontSize: '0.9rem' }}>{label}</span>
    </div>
  );

  return (
    <div className="dashboard">
      <header className="header">
        <h1>Document Generator</h1>
        <p>Generate, preview, and print employee documents. Each exports as a separate PDF named by Employee ID + Full Name.</p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Employee Selection */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Select Employees</span>
            <button onClick={() => setSelectedEmps(selectedEmps.length === employees.length ? [] : employees.map(e => e.id))}
              style={{ fontSize: '0.78rem', color: 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              {selectedEmps.length === employees.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', padding: '1.5rem 0', justifyContent: 'center' }}>
              <div style={{ width: '18px', height: '18px', border: '2px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              Loading employees...
            </div>
          )}
          {loadErr && (
            <div style={{ color: '#ef4444', fontSize: '0.85rem', padding: '0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: '8px', marginBottom: '0.5rem' }}>
              ⚠ Failed to load employees: {loadErr}
            </div>
          )}
          {!loading && !loadErr && employees.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', textAlign: 'center', padding: '1.5rem 0' }}>
              No active employees found in the database.
            </div>
          )}
          {employees.map(emp => (

            <div key={emp.id} style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '0.5rem', background: selectedEmps.includes(emp.id) ? 'rgba(56,189,248,0.07)' : 'transparent' }}>
              <Cb checked={selectedEmps.includes(emp.id)} onChange={() => toggleEmp(emp.id)}
                label={<span><strong>{emp.name}</strong> <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>({emp.id})</span></span>} />
              <div style={{ paddingLeft: '26px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{emp.designation} · {emp.client} · {emp.location}</div>
            </div>
          ))}
        </div>

        {/* Document Selection */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem' }}>Select Document Types</div>
          {DOCS.map(doc => (
            <div key={doc.key} style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '0.5rem', background: selectedDocs.includes(doc.key) ? 'rgba(56,189,248,0.07)' : 'transparent' }}>
              <Cb checked={selectedDocs.includes(doc.key)} onChange={() => toggleDoc(doc.key)} label={doc.label} />
            </div>
          ))}

          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '8px', fontSize: '0.85rem' }}>
            <div style={{ fontWeight: 600, color: '#22c55e', marginBottom: '4px' }}>Bulk Export Preview</div>
            <div style={{ color: 'var(--text-muted)' }}>
              {selectedEmps.length} employee{selectedEmps.length !== 1 ? 's' : ''} × {selectedDocs.length} document{selectedDocs.length !== 1 ? 's' : ''} = <strong style={{ color: 'var(--text)' }}>{selectedEmps.length * selectedDocs.length} PDF file{selectedEmps.length * selectedDocs.length !== 1 ? 's' : ''}</strong>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Files named: <em>ASIL/SPL-91/21 - Muhammad Anees - Employment Contract.pdf</em>
            </div>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={handleBulkPrint}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.9rem 2rem', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '1rem' }}>
          <Printer size={18} /> Print / Export All Selected ({selectedEmps.length * selectedDocs.length} files)
        </button>
      </div>

      {/* Per-Employee Document Table */}
      <div>
        <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>Individual Document Actions</div>
        {employees.map(emp => (
          <div key={emp.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', marginBottom: '1rem', overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'linear-gradient(135deg,var(--primary),#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, flexShrink: 0 }}>
                {emp.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>{emp.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{emp.id} · {emp.designation} · {emp.client}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 0 }}>
              {DOCS.map((doc, i) => (
                <div key={doc.key} style={{ padding: '1rem 1.5rem', borderRight: i < DOCS.length - 1 ? '1px solid var(--border)' : undefined }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.75rem' }}>{doc.label}</div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => handlePreview(emp, doc.key)}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
                      <Eye size={14} /> Preview
                    </button>
                    <button onClick={() => handlePrintSingle(emp, doc.key)}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--primary)', border: 'none', color: 'white', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
                      <Printer size={14} /> Print
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Preview Modal */}
      {previewDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', flexDirection: 'column', zIndex: 2000 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', background: 'var(--bg-dark)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontWeight: 700 }}>{previewDoc.title}</div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => printDocument(previewDoc.html, previewDoc.title)}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)', border: 'none', color: 'white', padding: '7px 16px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600 }}>
                <Printer size={15} /> Print / Export PDF
              </button>
              <button onClick={() => setPreviewDoc(null)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 14px', borderRadius: '7px', cursor: 'pointer' }}>
                <X size={15} /> Close
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', background: '#e5e5e5', padding: '2rem' }}>
            <div style={{ background: 'white', maxWidth: '820px', margin: '0 auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
              dangerouslySetInnerHTML={{ __html: previewDoc.html }} />
          </div>
        </div>
      )}
    </div>
  );
}
