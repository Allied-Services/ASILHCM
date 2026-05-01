const fs = require('fs');
const content = fs.readFileSync('G:/My Drive/Experiments/BPOFMSystem/backend/server.js', 'utf8');

const start = content.indexOf("if (type === 'payroll')");
const end = content.indexOf("} else if (type === 'hbl_same')");

if(start > -1 && end > -1) {
    const block = content.slice(start, end);
    console.log('BLOCK LENGTH:', block.length);
    console.log('HAS CRLF:', block.includes('\r\n'));
    
    const retStart = block.indexOf("return {");
    console.log('Return block (first 300):', JSON.stringify(block.slice(retStart, retStart+300)));
} else {
    console.log('Payroll block not found. start:', start, 'end:', end);
}
