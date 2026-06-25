const { readFileSync } = require('fs');
const files = [
  'frontend/src/PayrollSheet.jsx',
  'frontend/src/EmployeeProfile.jsx',
  'frontend/src/EmployeeInformation.jsx',
  'frontend/src/payrollUtils.js'
];
files.forEach(f => {
  try {
    const content = readFileSync(f, 'utf8');
    let curly = 0, paren = 0, bracket = 0;
    let inStr = false, strChar = '';
    for (let i = 0; i < content.length; i++) {
      const c = content[i];
      if (inStr) {
        if (c === strChar && content[i-1] !== '\\') inStr = false;
      } else {
        if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; }
        else if (c === '{') curly++;
        else if (c === '}') curly--;
        else if (c === '(') paren++;
        else if (c === ')') paren--;
        else if (c === '[') bracket++;
        else if (c === ']') bracket--;
      }
    }
    const lines = content.split('\n').length;
    const status = (curly === 0 && paren === 0 && bracket === 0) ? 'OK' : 'UNBALANCED';
    console.log(f + ': ' + lines + ' lines | braces=' + curly + ' parens=' + paren + ' brackets=' + bracket + ' [' + status + ']');
  } catch(e) { console.log(f + ': READ ERROR ' + e.message); }
});

// Also check for common Vite/ESM build issue: import statements after non-import code in EmployeeProfile
const ep = readFileSync('frontend/src/EmployeeProfile.jsx', 'utf8');
const importLines = ep.split('\n').map((l,i) => ({line: i+1, content: l})).filter(l => l.content.trim().startsWith('import '));
console.log('\nImport statements in EmployeeProfile.jsx:');
importLines.forEach(l => console.log('  Line ' + l.line + ': ' + l.content.substring(0, 80)));
