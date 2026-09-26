'use strict';

const ExcelJS = require('exceljs');
const {
    employeesForPayrollCheck,
    buildPayrollCheckXlsx,
} = require('../src/payroll/payrollCheckWorkbook');

describe('employeesForPayrollCheck', () => {
    const emps = [
        { id: 'A', name: 'Draft person' },
        { id: 'B', name: 'Locked person' },
        { id: 'C', name: 'Not calculated' },
    ];
    const pay = {
        A: { employee_id: 'A', locked: false, net: 1000 },
        B: { employee_id: 'B', locked: true, net: 2000 },
    };

    test('includes unlocked and locked saved rows, skips people with no payroll row', () => {
        const picked = employeesForPayrollCheck(emps, pay);
        expect(picked.map((e) => e.id)).toEqual(['A', 'B']);
    });

    test('empty pay map exports nobody', () => {
        expect(employeesForPayrollCheck(emps, {})).toEqual([]);
    });
});

describe('buildPayrollCheckXlsx', () => {
    const rows = [
        {
            Status: 'Draft',
            Month: 'September 2026',
            'Employee ID': 'ASIL/PSO-398/25',
            Name: 'Draft Person',
            CNIC: '4210112345671',
            Contract: 'PSO North Zone',
            Location: 'Sihala',
            Province: 'Punjab',
            'EOSB Scheme': 'Gratuity',
            'Gross Salary': 52043,
            'Paid Days': 10,
            'OT @2X Hrs': 1.5,
            'OT @3X Hrs': 0,
            'Net Pay to Employee': 16788,
            'Income Tax (WHT)': 50,
        },
        {
            Status: 'Locked',
            Month: 'September 2026',
            'Employee ID': 'ASIL/PSO-180/25',
            Name: 'Locked Person',
            CNIC: '4210198765432',
            Contract: 'PSO North Zone',
            Location: 'Morgah',
            Province: 'Punjab',
            'EOSB Scheme': 'None',
            'Gross Salary': 60000,
            'Paid Days': 30,
            'OT @2X Hrs': 0,
            'OT @3X Hrs': 0,
            'Net Pay to Employee': 54000,
            'Income Tax (WHT)': 200,
        },
    ];

    test('writes a filterable workbook that keeps draft rows and formats amounts', async () => {
        const buf = await buildPayrollCheckXlsx(rows, {
            monthLabel: 'September 2026',
            scope: 'PSO · North Zone',
        });
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.slice(0, 2).toString()).toBe('PK');

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const ws = wb.getWorksheet('Payroll');
        expect(ws).toBeTruthy();
        expect(String(ws.getCell('A1').value)).toContain('Payroll check');
        expect(String(ws.getCell('A2').value)).toContain('1 locked, 1 draft');
        expect(ws.views[0].state).toBe('frozen');
        expect(ws.views[0].ySplit).toBe(4);

        const tables = ws.getTables();
        expect(tables.length).toBe(1);
        const model = tables[0].table;
        expect(model.name).toBe('PayrollCheck');
        expect(model.headerRow).toBe(true);
        expect(model.totalsRow).toBe(true);
        expect(model.columns.every((col) => col.filterButton)).toBe(true);
        expect(model.columns.find((col) => col.name === 'Net Pay to Employee').totalsRowFunction).toBe('sum');

        expect(ws.getCell('A5').value).toBe('Draft');
        expect(ws.getCell('A6').value).toBe('Locked');
        expect(ws.getCell('C5').value).toBe('ASIL/PSO-398/25');
        expect(ws.getCell('E5').value).toBe('4210112345671');
        expect(ws.getCell('E5').numFmt).toBe('@');

        const netCol = 14;
        expect(ws.getCell(5, netCol).value).toBe(16788);
        expect(ws.getCell(5, netCol).numFmt).toBe('#,##0');
        expect(ws.getCell(6, netCol).value).toBe(54000);
    });
});
