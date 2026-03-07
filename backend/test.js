const { calculateEOBI, calculateSESSI, calculateMonthlyIncomeTax, calculateGratuity } = require('./taxEngine');

const gross = 150000;
const eobi = calculateEOBI(gross);
const sessi = calculateSESSI(gross);
const incomeTax = calculateMonthlyIncomeTax(gross);
const gratuity = calculateGratuity(gross, '2020-01-01', new Date());

console.log('eobi:', eobi);
console.log('sessi:', sessi);
console.log('incomeTax:', incomeTax);
console.log('gratuity:', gratuity);
