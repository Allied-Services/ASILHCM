const fs = require('fs');
const src = fs.readFileSync('G:/My Drive/Experiments/BPOFMSystem/frontend/src/BillingProcurement.jsx','utf8');
const lines = src.split('\n');

const openBraces = (src.match(/\{/g)||[]).length;
const closeBraces = (src.match(/\}/g)||[]).length;
console.log('Brace balance:', openBraces, 'open vs', closeBraces, 'close ->', openBraces === closeBraces ? 'BALANCED' : 'MISMATCH diff=' + (openBraces - closeBraces));

const terms = [
    "id: 'Standard'",
    "billCategory: 'official'",
    "isUnofficial",
    "whtAmount",
    "paymentModal",
    "doPayment",
    "HBL",
    "NBP",
    "Cash",
    "Confirm Payment via",
    "created_by === user"
];
terms.forEach(t => {
    console.log(src.includes(t) ? '  OK ' : '  MISSING ', t);
});
console.log('File:', (src.length/1024).toFixed(1)+'KB, Lines:', lines.length);
