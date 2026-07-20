// Renders the Employment Contract template with sample data and saves HTML output
// Run: node render_test.cjs
const fs = require('fs');
const path = require('path');

const ORIGIN = 'http://localhost:5173';
const LOGO_URL = `${ORIGIN}/asil-logo.png`;
const STAMP_URL = `${ORIGIN}/asil-stamp.png`;
const SIGNATURE_URL = `${ORIGIN}/asil-signature.png`;

const CO = {
  nameShort: 'ALLIED SERVICES INTERNATIONAL (PVT) LTD',
  regAddress: 'Hilltop Arcade, 4D/2, Gizri Blvd, Karachi, Pakistan',
  footer1: 'Head Office: Hilltop Arcade, 4D/2, Gizri Blvd, Phase IV, D.H.A, Karachi.    T: +92-337-8034941-45',
  footer2: 'Rawalpindi Office: C73, Opposite Bilal Hospital, Satellite Town.                 T: +92-337-8034944-47',
  footer3: 'Lahore Office: 681, Shadman Town, Opposite Fatima Memorial                T: +92-337-8034948-49',
  footerLine2: 'Email: info@asil.com.pk      Url: www.asil.com.pk      License: 0089-KAR      ISO 9001:2008',
};

function parseLocalDate(str) {
  if (!str) return null;
  const parts = String(str).slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || isNaN(parts[0])) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

const FOOTER_SPACER = `<div style="height:60px;"></div>`;
const FOOTER_PRINT_HTML = `
  <div id="asil-footer" style="border-top:1.2px solid #c0392b; font-size:10pt; color:#444; line-height:1.15; text-align:center; padding:4px 10px 3px;">
    <div>${CO.footer1}</div>
    <div>${CO.footer2}</div>
    <div>${CO.footer3}</div>
    <div>${CO.footerLine2}</div>
  </div>`;

function renderContract(emp) {
  const gross = emp.salary || 0;
  const basic = Math.round(gross * 0.50);
  const hra   = Math.round(gross * 0.40);
  const utility = Math.round(gross * 0.10);
  const fmt = (n) => n.toLocaleString('en-PK');

  const dateStr = emp.contractStartDate || emp.doj || null;
  const agreementDate = parseLocalDate(dateStr);
  const dayStr = agreementDate ? agreementDate.getDate() : '______';
  const monStr = agreementDate ? agreementDate.toLocaleString('en-PK', { month: 'long' }) : '______';
  const yrStr  = agreementDate ? agreementDate.getFullYear() : '______';

  return `<!DOCTYPE html><html><head><title>Contract - ${emp.name}</title>
  <style>
    @media print {
      @page { margin: 12mm 12mm 28mm 12mm; }
      body { margin:0; }
      #asil-footer { position:fixed; bottom:0; left:0; right:0; background:white; }
    }
    body { font-family:'Times New Roman',serif; font-size:11.5pt; line-height:1.85; color:#000; max-width:820px; margin:0 auto; padding:36px; }
    #asil-footer { font-size:10pt; color:#444; line-height:1.15; text-align:center; padding:4px 10px 3px; border-top:1.2px solid #c0392b; }
    h3 { font-size:11.5pt; margin:18px 0 4px; text-decoration:underline; }
  </style></head><body>

  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #c0392b;padding-bottom:12px;margin-bottom:16px;">
    <div style="font-size:18pt;font-weight:bold;color:#c0392b;">ASIL</div>
    <div style="text-align:right;font-size:9pt;">
      <div style="font-size:11pt;font-weight:bold;">Ver 26A | Rev Date: 27 Feb 2026</div>
      <div>Employer Copy</div>
    </div>
  </div>

  <div style="text-align:center;font-size:14pt;font-weight:bold;letter-spacing:2px;margin:14px 0;">EMPLOYMENT CONTRACT</div>

  <!-- DATE CHECK -->
  <p>THIS AGREEMENT is made on this <strong>${dayStr}</strong> day of <strong>${monStr}</strong>, <strong>${yrStr}</strong> BETWEEN:</p>
  <p><strong>${CO.nameShort}</strong>, a company incorporated under the laws of Pakistan, having its registered office at ${CO.regAddress} (hereinafter referred to as the &ldquo;Company&rdquo;).</p>

  <!-- PREAMBLE CHECK: MR., son of, resident of -->
  <p>AND: <strong>MR. ${emp.name || '_____________________________'}</strong>, son of <strong>${emp.fatherName || '___________________________'}</strong>, holder of CNIC No. <strong>${emp.cnic || '_____________________'}</strong>, resident of <strong>${emp.presentAddress || '___________________________'}</strong> (hereinafter referred to as the &ldquo;Employee&rdquo;).</p>

  <h3>1. APPOINTMENT AND SCOPE OF WORK</h3>
  <p>1.1. The Employee is appointed as <strong>${emp.designation || '[Job Title]'}</strong>.</p>

  <h3>3. REMUNERATION</h3>
  <table style="width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:11pt;">
    <tr><td style="padding:6px 10px;border:1px solid #bbb;background:#f5f5f5;font-weight:bold;width:60%;">Basic Salary</td><td style="padding:6px 10px;border:1px solid #bbb;width:10%;text-align:center;">PKR</td><td style="padding:6px 10px;border:1px solid #bbb;text-align:right;">${fmt(basic)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #bbb;background:#f5f5f5;font-weight:bold;">House Rent (40%)</td><td style="padding:6px 10px;border:1px solid #bbb;text-align:center;">PKR</td><td style="padding:6px 10px;border:1px solid #bbb;text-align:right;">${fmt(hra)}</td></tr>
    <tr><td style="padding:6px 10px;border:1px solid #bbb;background:#f5f5f5;font-weight:bold;">Utility Allowance (10%)</td><td style="padding:6px 10px;border:1px solid #bbb;text-align:center;">PKR</td><td style="padding:6px 10px;border:1px solid #bbb;text-align:right;">${fmt(utility)}</td></tr>
    <tr><td style="padding:7px 10px;border:1px solid #bbb;background:#1e3a5f;color:white;font-weight:bold;">Gross Monthly Salary</td><td style="padding:7px 10px;border:1px solid #bbb;background:#1e3a5f;color:white;font-weight:bold;text-align:center;">PKR</td><td style="padding:7px 10px;border:1px solid #bbb;background:#1e3a5f;color:white;font-weight:bold;text-align:right;">${fmt(gross)}</td></tr>
  </table>

  <!-- SIGNATURE BLOCK CHECK -->
  <div style="margin-top:48px;display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:end;">
    <div style="position:relative;padding-top:120px;">
      <div style="position:absolute;top:10px;left:0;width:180px;height:90px;background:#eee;display:flex;align-items:center;justify-content:center;font-size:9pt;color:#999;">[Signature Image]</div>
      <div style="position:absolute;top:0;left:120px;width:130px;height:130px;background:#eef;display:flex;align-items:center;justify-content:center;font-size:9pt;color:#999;border-radius:50%;">[Stamp]</div>
      <div style="border-top:1px solid #000;padding-top:6px;font-size:10.5pt;">
        <strong>For Allied Services International (Pvt) Ltd.</strong><br/>
        Name: <strong>Rabia Bhutto</strong><br/>
        Designation: Contracts Executive<br/>
        Date: ${dayStr} ${monStr} ${yrStr}
      </div>
    </div>
    <div style="padding-top:120px;font-size:10.5pt;">
      <div style="border-top:1px solid #000;padding-top:8px;">
        Employee Name: <strong>${emp.name || ''}</strong><br/>
        Signature &amp; Thumb Impression: ___________<br/>
        CNIC#: ${emp.cnic || ''}<br/>
        Date: ________________________
      </div>
    </div>
  </div>

  ${FOOTER_SPACER}
  ${FOOTER_PRINT_HTML}
</body></html>`;
}

// ── Test Cases ────────────────────────────────────────────────────────────────

const testCases = [
  {
    label: 'Employee WITH contractStartDate (from SQL subquery) + fatherName + address',
    emp: {
      name: 'Barkatullah Shah', cnic: '11101-1535803-3', designation: 'Office Boy',
      salary: 32000, client: 'Conservancy Services',
      contractStartDate: '2026-03-01',   // ← from backend SQL
      doj: '2001-03-15',                 // ← old DOJ (should NOT be used)
      fatherName: 'Fazal ur Rehman',
      presentAddress: 'House No. 5, Satellite Town, Rawalpindi',
    }
  },
  {
    label: 'Employee with NO contractStartDate + falls back to doj',
    emp: {
      name: 'Noor Zaman Khan', cnic: '11201-9806416-5', designation: 'Field Worker',
      salary: 28000, client: 'Unknown Client',
      contractStartDate: '',        // ← blank, should fall to doj
      doj: '2026-03-01',            // ← should use this
      fatherName: '',               // ← blank → should show blank underline
      presentAddress: '',           // ← blank → should show blank underline
    }
  },
  {
    label: 'Employee with NO dates at all → blanks',
    emp: {
      name: 'Waheed ud Din', cnic: '11201-9999999-9', designation: 'Security Guard',
      salary: 35000, client: '',
      contractStartDate: '', doj: '',
      fatherName: 'Abdul Karim', presentAddress: '',
    }
  }
];

const outputs = testCases.map(({ label, emp }, i) => {
  const html = renderContract(emp);
  const filename = `contract_test_${i + 1}.html`;
  fs.writeFileSync(path.join(__dirname, filename), html, 'utf8');

  // Extract key values for console verification
  const dateMatch = html.match(/made on this <strong>(\w+)<\/strong> day of <strong>(\w+)<\/strong>, <strong>(\w+)<\/strong>/);
  const preambleMatch = html.match(/AND: <strong>([^<]+)<\/strong>, son of <strong>([^<]+)<\/strong>/);
  const residentMatch = html.match(/resident of <strong>([^<]+)<\/strong>/);
  const nameMatch = html.match(/Name: <strong>([^<]+)<\/strong>/);
  const desigMatch = html.match(/Designation: ([^\n<]+)/);

  return {
    label,
    date: dateMatch ? `${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]}` : 'NOT FOUND',
    preamble_sonOf: preambleMatch ? preambleMatch[2] : 'NOT FOUND',
    resident: residentMatch ? residentMatch[1] : 'NOT FOUND',
    signerName: nameMatch ? nameMatch[1] : 'NOT FOUND',
    signerDesig: desigMatch ? desigMatch[1].trim() : 'NOT FOUND',
    savedTo: filename,
  };
});

console.log('\n════════════════════════════════════════════════════════');
console.log('  CONTRACT RENDER TEST RESULTS');
console.log('════════════════════════════════════════════════════════\n');

outputs.forEach(({ label, date, preamble_sonOf, resident, signerName, signerDesig, savedTo }, i) => {
  const PASS = (val, expected) => val === expected ? '✅ PASS' : `❌ FAIL (got: "${val}")`;
  console.log(`Case ${i+1}: ${label}`);
  console.log(`  Date:           ${date} ${date.includes('2026') && !date.includes('2001') ? '✅' : '❌ should be 2026 not 2001'}`);
  console.log(`  Son of:         "${preamble_sonOf}" ${preamble_sonOf && preamble_sonOf !== 'NOT FOUND' ? '✅' : '❌'}`);
  console.log(`  Resident of:    "${resident}" ${resident && resident !== 'NOT FOUND' ? '✅' : '❌'}`);
  console.log(`  Signer name:    ${PASS(signerName, 'Rabia Bhutto')}`);
  console.log(`  Signer desig:   ${desigMatch => desigMatch}${signerDesig.includes('Contracts Executive') ? '✅' : '❌ ' + signerDesig}`);
  console.log(`  Saved to:       ${savedTo}\n`);
});
