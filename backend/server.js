const express = require('express');
const cors = require('cors');
const path = require('path');
const { calculateEOBI, calculateSESSI, calculateMonthlyIncomeTax, calculateGratuity } = require('./taxEngine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Expose a simple HTML interface to test it out visually
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/calculate', (req, res) => {
    const { grossSalary, joiningDate, calcDate } = req.body;

    if (!grossSalary) return res.status(400).json({ error: 'Gross salary required' });

    const gross = parseFloat(grossSalary);
    const join = joiningDate || '2020-01-01';
    const calc = calcDate || new Date().toISOString().split('T')[0];

    const eobi = calculateEOBI(gross);
    const sessi = calculateSESSI(gross);
    const incomeTax = calculateMonthlyIncomeTax(gross);
    const gratuity = calculateGratuity(gross, join, calc);

    // Calculate Net and Cost
    const totalDeductions = eobi.employeeShare + incomeTax;
    const netSalary = gross - totalDeductions;

    const employerCost = eobi.employerShare + sessi;
    const totalCostToCompany = gross + employerCost;

    res.json({
        parameters: { gross, join, calc },
        results: {
            eobi,
            sessi,
            incomeTax,
            gratuity,
            netSalary,
            totalCostToCompany
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
