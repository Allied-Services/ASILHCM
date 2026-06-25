const fs = require('fs');
const src = fs.readFileSync('G:/My Drive/Experiments/BPOFMSystem/frontend/src/BillingProcurement.jsx','utf8');
const lines = src.split('\n');

const defsEnd = lines.findIndex(l => l.includes('const BILL_TYPES = BILL_TYPE_DEFS.map'));
console.log('BILL_TYPE_DEFS end:', defsEnd+1, '|', lines[defsEnd]);

const formState = lines.findIndex(l => l.includes("billType: 'Debit Note / Imprest'"));
console.log('Form state:', formState+1);

const totalsCalc = lines.findIndex(l => l.includes('const grandTotal = subtotal + gstAmount'));
console.log('Totals calc:', totalsCalc+1);

const deleteBtn = lines.findIndex(l => l.includes('isSuperAdmin && !isPaid'));
console.log('Delete btn:', deleteBtn+1, '|', lines[deleteBtn]);

const doActionFn = lines.findIndex(l => l.includes('const doAction = async'));
console.log('doAction:', doActionFn+1);

const markPaid = lines.findIndex(l => l.includes("'Mark as Paid': 'Paid'"));
console.log('Mark as Paid:', markPaid+1, '|', lines[markPaid]);

const totalsArr = lines.findIndex(l => l.includes("'Subtotal'") && l.includes('Rs(subtotal)'));
console.log('Totals arr:', totalsArr+1);
