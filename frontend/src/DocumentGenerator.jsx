import React, { useState, useEffect } from 'react';
import { CheckSquare, Square, Printer, X, Eye } from 'lucide-react';
import { api } from './api';

// ─── Company Details (exact from official ASIL letterhead) ───────────────────
const CO = {
  nameShort: 'ALLIED SERVICES INTERNATIONAL (PVT) LTD',
  nameFull: 'Allied Services International (Pvt.) Ltd.',
  regAddress: 'Hilltop Arcade, 4D/2, Gizri Blvd, Karachi, Pakistan',
  footer1: 'Head Office: Hilltop Arcade, 4D/2, Gizri Blvd, Phase IV, D.H.A, Karachi.    T: +92-337-8034941-45',
  footer2: 'Rawalpindi Office: C73, Opposite Bilal Hospital, Satellite Town.                 T: +92-337-8034944-47',
  footer3: 'Lahore Office: 681, Shadman Town, Opposite Fatima Memorial                T: +92-337-8034948-49',
  footerLine2: 'Email: info@asil.com.pk      Url: www.asil.com.pk      License: 0089-KAR      ISO 9001:2008',
};

const LOGO_URL = `${window.location.origin}/asil-logo.png`;
const STAMP_URL = `${window.location.origin}/asil-stamp.png`;
const SIGNATURE_URL = `${window.location.origin}/asil-signature.png`;

const today = () => new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });

// Small breathing room before the table tbody ends
const FOOTER_SPACER = `<div style="height:10px;"></div>`;

// Footer inner HTML — rendered inside <tfoot> which auto-repeats every print page
const FOOTER_HTML_INNER = `
  <div style="border-top:1.2px solid #c0392b; font-size:9pt; color:#444; line-height:1.15; text-align:center; padding:4px 10px 3px;">
    <div>${CO.footer1}</div>
    <div>${CO.footer2}</div>
    <div>${CO.footer3}</div>
    <div>${CO.footerLine2}</div>
  </div>`;

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT 1 — EMPLOYMENT CONTRACT  (ASIL Ver 26A)
// ═══════════════════════════════════════════════════════════════════════════════
// Safe local-date parser: avoids UTC midnight → timezone shift bug
function parseLocalDate(str) {
  if (!str) return null;
  const parts = String(str).slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || isNaN(parts[0])) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]); // local time
}

function renderEmploymentContract(emp) {
  const gross = emp.salary || 0;
  const basic = Math.round(gross * 0.50);
  const hra = Math.round(gross * 0.40);
  const utility = Math.round(gross * 0.10);
  const fmt = (n) => n.toLocaleString('en-PK');
  // Contract start date comes from the backend SQL subquery (most reliable)
  // Falls back to doj if contractStartDate is not set
  const dateStr = emp.contractStartDate || emp.doj || null;
  const agreementDate = parseLocalDate(dateStr);
  const dayStr = agreementDate ? agreementDate.getDate() : '______';
  const monStr = agreementDate ? agreementDate.toLocaleString('en-PK', { month: 'long' }) : '______';
  const yrStr = agreementDate ? agreementDate.getFullYear() : '______';

  return `
<div style="font-family:'Times New Roman',serif; font-size:11.5pt; line-height:1.85; color:#000; max-width:760px; margin:0 auto; padding:36px;">

  <!-- LETTERHEAD -->
  <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #c0392b; padding-bottom:12px; margin-bottom:16px;">
    <img src="${LOGO_URL}" alt="ASIL" style="height:80px; object-fit:contain;" />
    <div style="text-align:right; font-size:9pt; color:#333; line-height:1.7;">
      <div style="font-size:11pt; font-weight:bold; color:#000;">Ver 26A &nbsp;|&nbsp; Rev Date: 27 Feb 2026</div>
      <div>Employer Copy</div>
    </div>
  </div>

  <div style="text-align:center; font-size:14pt; font-weight:bold; letter-spacing:2px; margin:14px 0;">EMPLOYMENT CONTRACT</div>

  <p>THIS AGREEMENT is made on this <strong>${dayStr}</strong> day of <strong>${monStr}</strong>, <strong>${yrStr}</strong> BETWEEN:</p>
  <p><strong>${CO.nameShort}</strong>, a company incorporated under the laws of Pakistan, having its registered office at ${CO.regAddress} (hereinafter referred to as the &ldquo;Company&rdquo;).</p>
  <p>AND: <strong>MR. ${emp.name || '_____________________________'}</strong>, son of <strong>${emp.fatherName || '___________________________'}</strong>, holder of CNIC No. <strong>${emp.cnic || '_____________________'}</strong>, resident of <strong>${emp.presentAddress || '___________________________'}</strong> (hereinafter referred to as the &ldquo;Employee&rdquo;).</p>

  <h3 style="font-size:11.5pt; margin:18px 0 4px; text-decoration:underline;">1. APPOINTMENT AND SCOPE OF WORK</h3>
  <p>1.1. The Employee is appointed as <strong>${emp.designation || '[Job Title]'}</strong>.</p>
  <p>1.2. The Employee may be assigned to any of the Company&rsquo;s offices or deployed at any of the Company&rsquo;s Clients&rsquo; sites as per operational requirements. The Contract assigned to you exists only for the duration of the Company contract with the Client organization.</p>
  <p>1.3. This employment is subject to the satisfactory completion of a three (3) month probation period.</p>

  <h3 style="font-size:11.5pt; margin:18px 0 4px; text-decoration:underline;">2. MANDATORY ONBOARDING DOCUMENTATION</h3>
  <p>Employment is strictly contingent upon the submission and verification of the following documents. Failure to provide these or the discovery of any forged document will lead to immediate termination:</p>
  <ul style="margin:4px 0 8px 24px; line-height:2.1;">
    <li>Employee Information (Signed by Employee as Completed &amp; Verified).</li>
    <li>Signed Employment Contract and Copy of CNIC.</li>
    <li>Copy of Educational Certificates / Technical Trade Certificates.</li>
    <li>Police Clearance Certificate (from the relevant district).</li>
    <li>Medical Fitness Certificate from a Company-authorized medical center.</li>
    <li>Valid LTV/HTV/Specialized License (if applicable to the role).</li>
    <li>Two (2) recent passport-sized photographs.</li>
  </ul>

  <h3 style="font-size:11.5pt; margin:18px 0 4px; text-decoration:underline;">3. REMUNERATION AND STATUTORY BENEFITS</h3>
  <p>3.1. The Company follows a unified compensation structure. The Employee&rsquo;s total monthly package is as follows:</p>
  <table style="width:100%; border-collapse:collapse; margin:8px 0 12px; font-size:11pt;">
    <tr><td style="padding:6px 10px; border:1px solid #bbb; background:#f5f5f5; font-weight:bold; width:60%;">Basic Salary</td><td style="padding:6px 10px; border:1px solid #bbb; width:10%; text-align:center;">PKR</td><td style="padding:6px 10px; border:1px solid #bbb; text-align:right;">${fmt(basic)}</td></tr>
    <tr><td style="padding:6px 10px; border:1px solid #bbb; background:#f5f5f5; font-weight:bold;">House Rent (40% of Gross Salary)</td><td style="padding:6px 10px; border:1px solid #bbb; text-align:center;">PKR</td><td style="padding:6px 10px; border:1px solid #bbb; text-align:right;">${fmt(hra)}</td></tr>
    <tr><td style="padding:6px 10px; border:1px solid #bbb; background:#f5f5f5; font-weight:bold;">Utility Allowance (10% of Gross Salary)</td><td style="padding:6px 10px; border:1px solid #bbb; text-align:center;">PKR</td><td style="padding:6px 10px; border:1px solid #bbb; text-align:right;">${fmt(utility)}</td></tr>
    <tr><td style="padding:7px 10px; border:1px solid #bbb; background:#1e3a5f; color:white; font-weight:bold;">Gross Monthly Salary</td><td style="padding:7px 10px; border:1px solid #bbb; background:#1e3a5f; color:white; font-weight:bold; text-align:center;">PKR</td><td style="padding:7px 10px; border:1px solid #bbb; background:#1e3a5f; color:white; font-weight:bold; text-align:right;">${fmt(gross)}</td></tr>
  </table>
  <p>3.2. <strong>Statutory Contributions:</strong> As per Company SOPs and Provincial Laws, the Company shall register the Employee and make monthly contributions toward EOBI, SESSI / PESSI (Social Security), Group Life Insurance, and Provident Fund (where applicable as per Company Policy).</p>
  <p>3.3. All payments are subject to the deduction of applicable Income Tax and statutory employee-share contributions.</p>

  <h3 style="font-size:11.5pt; margin:18px 0 4px; text-decoration:underline;">4. WORKPLACE DISCIPLINE AND CODE OF CONDUCT</h3>
  <p>4.1. <strong>Uniform &amp; Appearance:</strong> The Employee must wear the prescribed, neat, and clean Company uniform along with the displayed ID Card at all times during duty hours.</p>
  <p>4.2. <strong>Prohibited Substances:</strong> Use of Pan, Gutka, Naswar, or Smoking is strictly prohibited during work hours and within the premises of the Company or its Clients.</p>
  <p>4.3. <strong>Punctuality:</strong> Strict adherence to shift timings is required. Breaks must be kept to the minimum time allowed. Unauthorized absence or chronic lateness will be treated as misconduct.</p>
  <p>4.4. <strong>Professionalism:</strong> The Employee shall maintain a respectful and professional attitude toward colleagues, supervisors, and the Client&rsquo;s staff. Insubordination, use of foul language, or harassment will result in dismissal.</p>
  <p>4.5. <strong>Performance Review:</strong> Satisfactory performance reviews, discipline, and adherence to SOPs may lead to annual increments, bonuses, or career growth opportunities.</p>
  <p>4.6. <strong>Compliance with Instructions:</strong> The Employee shall not act in any manner contrary to the literature, manuals, or verbal instructions provided by the Company or its Clients.</p>
  <p>4.7. <strong>Professional Notification:</strong> The Employee must immediately notify the Company of any matter coming to their knowledge that could affect the business or reputation of the Company or the Client organization.</p>
  <p>4.8. <strong>Training &amp; Qualifications:</strong> The Employee is responsible for attaining and maintaining the requisite qualifications/training required for their role.</p>
  <p>4.9. <strong>Technical Roles (Drivers/Operators):</strong> Drivers and Forklift Operators must maintain a valid LTV/HTV/Heavy Duty license with a minimum of 3 years of experience. Any suspension or expiry of the license must be reported to the Company immediately; failure to do so will result in immediate termination.</p>
  <p>4.10. <strong>Change of Status:</strong> The Employee must notify the Company immediately of any change in residential address, contact details, or civil status.</p>

  <h3 style="font-size:11.5pt; margin:18px 0 4px; text-decoration:underline;">5. HEALTH, SAFETY, AND ENVIRONMENT (HSE)</h3>
  <p>5.1. <strong>Safety First:</strong> The Employee must strictly follow all HSE guidelines provided by the Company and the Client at the work site.</p>
  <p>5.2. <strong>PPE Compliance:</strong> Wearing Personal Protective Equipment (PPE)&mdash;including helmets, safety shoes, and vests&mdash;is mandatory where required. Failure to comply is a serious safety violation and may result in the Employee being marked &ldquo;Absent&rdquo; for the day or terminated.</p>

  <h3 style="font-size:11.5pt; margin:18px 0 4px; text-decoration:underline;">6. JURISDICTION, LEGAL STATUS &amp; NON-REPRESENTATION</h3>
  <p><strong>Non-Agency:</strong> At no time during the currency of this contract shall the Employee represent themselves as an employee, agent, or representative of any Client of the Company.</p>
  <p><strong>Limited Authority:</strong> The Employee has no authority to bind any Client of the Company or incur any liability on their behalf. All dealings with third parties must stay within the instructions provided by the Company.</p>
  <p><strong>Jurisdiction:</strong> This contract is governed by the laws of Pakistan.</p>
  <p><strong>Arbitration:</strong> Any dispute or disagreement arising out of this appointment shall first be settled amicably. Failing an amicable settlement, the dispute shall be settled by arbitration under the Pakistan Arbitration Act 1940.</p>
  <p><strong>Courts:</strong> All legal proceedings shall be subject to the exclusive jurisdiction of the Courts in Karachi.</p>

  <h3 style="font-size:11.5pt; margin:18px 0 4px; text-decoration:underline;">7. DEDUCTIONS AND RECOVERY</h3>
  <p>7.1. <strong>HSE &amp; Performance Penalties:</strong> Failure to wear mandatory PPE or follow site safety protocols will result in the Employee being marked ABSENT for that shift, and the day&rsquo;s salary will be deducted accordingly.</p>
  <p>7.2. <strong>Recovery of Client Fines:</strong> Any financial penalties or fines imposed by a CLIENT on Allied Services due to the Employee&rsquo;s individual negligence shall be directly recoverable from the Employee&rsquo;s monthly salary or any other dues.</p>
  <p>7.3. <strong>Property Damage &amp; Loss:</strong> The Employee is responsible for the safe custody of any property, machinery, tools, or equipment entrusted to them. Any loss, damage, or misappropriation caused by the Employee&rsquo;s negligence will be deducted from the Employee&rsquo;s salary or final settlement.</p>
  <p>7.4. <strong>Statutory Deductions:</strong> The Company shall deduct Income Tax, EOBI/SESSI employee contributions, and any other government-mandated levies from the gross salary as per the law.</p>

  <h3 style="font-size:11.5pt; margin:18px 0 4px; text-decoration:underline;">8. TERMINATION</h3>
  <p>8.1. <strong>By Notice:</strong> During probation, either party may terminate this contract with a minimum of 2 days&rsquo; notice. After confirmation, one (1) month&rsquo;s notice or one month&rsquo;s salary in lieu of notice is required.</p>
  <p>8.2. <strong>Summary Dismissal:</strong> The Company may terminate employment immediately without notice or pay in lieu of notice for &ldquo;Misconduct,&rdquo; which includes theft, fraud, safety violations, use of prohibited substances, or any unlawful act.</p>
  <p>8.3. <strong>End of Site Contract:</strong> Since the Employee is deployed based on Client requirements, if the contract between the Company and the Client for a specific site is terminated or expires, this employment may be rendered redundant without any notice or notice pay.</p>

  <h3 style="font-size:11.5pt; margin:18px 0 4px; text-decoration:underline;">9. CONFIDENTIALITY &amp; PROPERTY</h3>
  <p><strong>Non-Divulgence:</strong> The Employee shall not directly or indirectly divulge any information concerning the affairs, property, or undertakings of the Company&rsquo;s Clients or their associates.</p>
  <p><strong>Data Security:</strong> No data, documents, calculations, or items (in paper or electronic form) may be removed from the Company&rsquo;s or Client&rsquo;s premises without express written consent.</p>
  <p><strong>Return of Property:</strong> Upon termination or request, the Employee must return all property in good condition. The Company reserves the right to deduct the value of any unreturned or damaged items from the Employee&rsquo;s final dues.</p>

  <div style="margin-top:48px; display:grid; grid-template-columns:1fr 1fr; gap:60px; align-items:end;">
    <!-- Employer signature column -->
    <div style="position:relative; padding-top:120px;">
      <img src="${SIGNATURE_URL}" alt="Authorized Signature"
        style="position:absolute; top:10px; left:0; width:180px; height:90px;
               object-fit:contain; mix-blend-mode:multiply; opacity:0.9; pointer-events:none;" />
      <img src="${STAMP_URL}" alt="Company Stamp"
        style="position:absolute; top:0; left:120px; width:130px; height:130px;
               object-fit:contain; mix-blend-mode:multiply; opacity:0.85; pointer-events:none;" />
      <div style="border-top:1px solid #000; padding-top:6px; font-size:10.5pt;">
        <strong>For Allied Services International (Pvt) Ltd.</strong><br/>
        Name: <strong>Rabia Bhutto</strong><br/>
        Designation: Contracts Executive<br/>
        Date: ${dayStr} ${monStr} ${yrStr}
      </div>
    </div>
    <!-- Employee signature column -->
    <div style="padding-top:120px; font-size:10.5pt;">
      <div style="border-top:1px solid #000; padding-top:8px;">
        Employee Name: <strong>${emp.name || ''}</strong><br/>
        Signature &amp; Thumb Impression: ___________<br/>
        CNIC#: ${emp.cnic || ''}<br/>
        Date: ________________________
      </div>
    </div>
  </div>

  ${FOOTER_SPACER}
</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT 2 — EMPLOYEE JOINING REPORT  (ASIL Ver 26A)
// ═══════════════════════════════════════════════════════════════════════════════
function renderJoiningReport(emp) {
  // Use contract start date first (from backend SQL subquery), then doj, then blank
  const dateStr = emp.contractStartDate || emp.doj || null;
  const joinDate = parseLocalDate(dateStr);
  const doj = joinDate
    ? joinDate.toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' })
    : '______________________';
  return `
<div style="font-family:Arial,sans-serif; font-size:11.5pt; line-height:1.85; color:#000; max-width:760px; margin:0 auto; padding:36px;">

  <!-- LETTERHEAD -->
  <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #c0392b; padding-bottom:12px; margin-bottom:16px;">
    <img src="${LOGO_URL}" alt="ASIL" style="height:80px; object-fit:contain;" />
    <div style="text-align:right; font-size:9pt; color:#333; line-height:1.7;">
      <div style="font-size:11pt; font-weight:bold; color:#000;">Ver 26A &nbsp;|&nbsp; Rev Date: 27 Feb 2026</div>
      <div>Employer Copy</div>
    </div>
  </div>

  <div style="text-align:center; font-size:14pt; font-weight:bold; letter-spacing:2px; margin:14px 0;">EMPLOYEE JOINING REPORT</div>

  <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:11pt;">
    <tr>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:bold; background:#f5f5f5; width:22%;">Employee Name</td>
      <td style="padding:7px 10px; border:1px solid #bbb; width:28%;">${emp.name || ''}</td>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:bold; background:#f5f5f5; width:22%;">Employee ID</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">${emp.id || ''}</td>
    </tr>
    <tr>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:bold; background:#f5f5f5;">Designation</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">${emp.designation || ''}</td>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:bold; background:#f5f5f5;">Site</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">${emp.location || ''}</td>
    </tr>
  </table>

  <p>Reference to my Employment Offer Confirmation, I wish to inform you that I have joined duty from <strong>${doj}</strong>.<br/>
  I confirm that I have completed the site safety induction and received my assigned duties.</p>

  <div style="margin-top:40px; font-size:10.5pt;">
    <p style="margin-bottom:48px;">Employee Signature: ____________________________________________</p>
    <p style="margin-bottom:16px;">CNIC: __________________________________________</p>
    <p>Date: ___________________________________________</p>
  </div>

  <hr style="border:none; border-top:1.5px solid #555; margin:36px 0;"/>

  <h3 style="font-size:12pt; margin-bottom:10px;">LINE MANAGER VERIFICATION</h3>
  <p>I, the undersigned Line Manager/Site Supervisor, verify that the employee named above has reported for duty on the date specified at the assigned location. This verification confirms the commencement of their employment.</p>

  <div style="margin-top:30px; font-size:10.5pt;">
    <p style="margin-bottom:20px;">Line Manager / Site Supervisor&rsquo;s Signature: ________________________________________</p>
    <p style="margin-bottom:20px;">Name: ________________________________________</p>
    <p>Date: _________________________________________</p>
  </div>

  ${FOOTER_SPACER}
</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOCUMENT 3 — UNIFORM MEASUREMENT FORM  (ASIL Ver 26A)
// ═══════════════════════════════════════════════════════════════════════════════
function renderUniformForm(emp) {
  const trRows = [['30"', 104, 76, 91, 81, 58, 43], ['32"', 105, 81, 96, 81, 61, 43], ['34"', 107, 86, 101.5, 82.5, 63.5, 46], ['36"', 108, 91, 106, 82.5, 66, 46], ['38"', 108, 96.5, 111, 80, 70, 48], ['40"', 111, 101, 117, 79, 72, 51], ['42"', 111, 106, 122, 75, 73.5, 51]];
  const shRows = [['XS-34', 65.5, 86, 81, 21.5, 55, 33, 35, 21.5], ['S-36', 70, 91, 86, 22, 57, 35, 36, 22], ['M-38', 70, 96, 91, 24, 60, 36, 38, 22], ['L-40', 72, 101, 96, 25, 60, 40, 39, 24], ['XL-42', 75, 106, 101, 26, 62, 43, 40, 25], ['XXL-44', 76, 111, 109, 26, 63, 44, 41, 26], ['XXXL-46', 78, 116, 111, 28, 66, 45, 43, 28]];
  const td = (v) => `<td style="padding:6px 8px; border:1px solid #bbb; text-align:center;">${v}</td>`;
  const th = (v) => `<th style="padding:6px 8px; border:1px solid #bbb; background:#f0f0f0;">${v}</th>`;
  return `
<div style="font-family:Arial,sans-serif; font-size:11pt; line-height:1.7; color:#000; max-width:760px; margin:0 auto; padding:36px;">

  <!-- LETTERHEAD -->
  <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #c0392b; padding-bottom:12px; margin-bottom:16px;">
    <img src="${LOGO_URL}" alt="ASIL" style="height:80px; object-fit:contain;" />
    <div style="text-align:right; font-size:9pt; color:#333; line-height:1.7;">
      <div style="font-size:11pt; font-weight:bold; color:#000;">Ver 26A &nbsp;|&nbsp; Rev Date: 27 Feb 2026</div>
    </div>
  </div>

  <div style="text-align:center; font-size:14pt; font-weight:bold; letter-spacing:2px; margin:14px 0;">UNIFORM MEASUREMENT FORM</div>

  <table style="width:100%; border-collapse:collapse; margin-bottom:16px; font-size:11pt;">
    <tr>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:bold; background:#f5f5f5; width:22%;">Employee Name</td>
      <td style="padding:7px 10px; border:1px solid #bbb; width:28%;">${emp.name || ''}</td>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:bold; background:#f5f5f5; width:22%;">Employee ID</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">${emp.id || ''}</td>
    </tr>
    <tr>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:bold; background:#f5f5f5;">Designation</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">${emp.designation || ''}</td>
      <td style="padding:7px 10px; border:1px solid #bbb; font-weight:bold; background:#f5f5f5;">Site</td>
      <td style="padding:7px 10px; border:1px solid #bbb;">${emp.location || ''}</td>
    </tr>
  </table>

  <p style="background:#fff3cd; border:1px solid #ffc107; padding:8px 14px; border-radius:4px; font-size:10pt; margin-bottom:20px;">
    <strong>NOTE:</strong> Please get exact Measurements through a tailor. We will not be responsible for any changes in size.
  </p>

  <h3 style="background:#1e3a5f; color:white; padding:7px 12px; font-size:11pt; margin:16px 0 0; letter-spacing:1px;">SIZE GUIDE FOR TROUSERS &nbsp;(CIRCLE ONE)</h3>
  <table style="width:100%; border-collapse:collapse; font-size:10pt; margin-bottom:20px;">
    <thead><tr>${[th('Size'), th('Length'), th('Waist'), th('Hip'), th('In Length'), th('Loose'), th('Bottom')].join('')}</tr></thead>
    <tbody>${trRows.map(r => `<tr>${r.map(td).join('')}</tr>`).join('')}</tbody>
  </table>

  <h3 style="background:#1e3a5f; color:white; padding:7px 12px; font-size:11pt; margin:16px 0 0; letter-spacing:1px;">SIZE GUIDE FOR SHIRTS &nbsp;(CIRCLE ONE)</h3>
  <table style="width:100%; border-collapse:collapse; font-size:10pt; margin-bottom:20px;">
    <thead><tr>${[th('Size'), th('Length'), th('Chest'), th('Shoulder'), th('Short Sleeve'), th('Long Sleeve'), th('Sleeve Loose'), th('Collar'), th('Cuff')].join('')}</tr></thead>
    <tbody>${shRows.map(r => `<tr>${r.map(td).join('')}</tr>`).join('')}</tbody>
  </table>

  <p style="font-size:11pt; margin-top:8px;"><strong>SHOE SIZE:</strong> _________________________.</p>

  <div style="margin-top:48px; display:grid; grid-template-columns:1fr 1fr; gap:60px; font-size:10.5pt;">
    <div><div style="border-top:1px solid #000; padding-top:8px; margin-top:48px;">Employee Signature<br/><strong>${emp.name || ''}</strong></div></div>
    <div><div style="border-top:1px solid #000; padding-top:8px; margin-top:48px;">Admin / Store In-charge<br/>Name: ____________</div></div>
  </div>

  ${FOOTER_SPACER}
</div>`;
}

// ─── Document definitions ─────────────────────────────────────────────────────
const DOCS = [
  { key: 'contract', label: 'Employment Contract', render: renderEmploymentContract },
  { key: 'joining', label: 'Employee Joining Report', render: renderJoiningReport },
  { key: 'uniform', label: 'Uniform Measurement Form', render: renderUniformForm },
];

// ─── Print helper ─────────────────────────────────────────────────────────────
function printDocument(htmlContent, filename) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('Please allow popups to print/export documents.'); return; }
  win.document.write(`<!DOCTYPE html><html><head>
    <title>${filename}</title>
    <style>
      @media print { @page { margin: 12mm; } body { margin:0; } }
      body { font-family:'Times New Roman',serif; margin:0; padding:0; }
      /* Table-footer-group: the ONLY reliable way to repeat footer every page without overlap */
      table.doc-wrap { width:100%; border-collapse:collapse; }
      tfoot.doc-footer { display:table-footer-group; }
      tbody.doc-body  { display:table-row-group; }
    </style>
  </head><body>
  <table class="doc-wrap">
    <tfoot class="doc-footer"><tr><td>${FOOTER_HTML_INNER}</td></tr></tfoot>
    <tbody class="doc-body" ><tr><td>${htmlContent}</td></tr></tbody>
  </table>
  <script>
    window.onload = function() {
      document.title = '${filename}';
      setTimeout(function(){ window.print(); }, 500);
    };
  <\/script></body></html>`);
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
    if (propEmp) return;
    api.getEmployees()
      .then(empData => {
        setEmployees((empData.employees || []).filter(e => e.active !== 'No'));
        setLoading(false);
      })
      .catch(err => { setLoadErr(err.message); setLoading(false); });
  }, []);

  const [selectedEmps, setSelectedEmps] = useState(propEmp ? [propEmp.id] : []);
  const [selectedDocs, setSelectedDocs] = useState(['contract', 'joining', 'uniform']);
  const [previewDoc, setPreviewDoc] = useState(null);

  const toggleEmp = (id) => setSelectedEmps(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleDoc = (k) => setSelectedDocs(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);

  const handlePrintSingle = (emp, docKey) => {
    const def = DOCS.find(d => d.key === docKey);
    if (!def) return;
    printDocument(def.render(emp), `${emp.id} - ${emp.name} - ${def.label}`);
  };

  const handleBulkPrint = () => {
    const emps = employees.filter(e => selectedEmps.includes(e.id));
    const docs = DOCS.filter(d => selectedDocs.includes(d.key));
    if (!emps.length) return alert('Select at least one employee.');
    if (!docs.length) return alert('Select at least one document type.');
    emps.forEach(emp => docs.forEach((doc, i) => setTimeout(() =>
      printDocument(doc.render(emp), `${emp.id} - ${emp.name} - ${doc.label}`)
    , i * 350)));
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
        <p>Generate, preview, and print official ASIL documents. Each exports as a separate PDF named by Employee ID + Full Name.</p>
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
          {loadErr && <div style={{ color: '#ef4444', fontSize: '0.85rem', padding: '0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: '8px' }}>⚠ {loadErr}</div>}
          {!loading && !loadErr && employees.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', textAlign: 'center', padding: '1.5rem 0' }}>No active employees found.</div>
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
              {selectedEmps.length} employee{selectedEmps.length !== 1 ? 's' : ''} × {selectedDocs.length} document{selectedDocs.length !== 1 ? 's' : ''} = <strong style={{ color: 'var(--text)' }}>{selectedEmps.length * selectedDocs.length} PDF{selectedEmps.length * selectedDocs.length !== 1 ? 's' : ''}</strong>
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
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{doc.label}</div>
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
