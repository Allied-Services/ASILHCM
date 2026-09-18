'use strict';

const {
    linesFromCycleRows,
    linesFromPortalAmounts,
    upsertLines,
    intervene,
} = require('../src/modules/payrollSheet/inputLedger');

describe('payroll input ledger helpers', () => {
    test('machine-file rows become attendance + OT lines', () => {
        const lines = linesFromCycleRows({
            rows: [{ employeeId: 'ASIL-1', presentDays: 27, absentDays: 4, ot2Hours: 8, ot3Hours: 2 }],
            contractId: 'CTR-PSO-NORTH-ZONE',
            month: 8,
            year: 2026,
            actor: 'ops@asil.com.pk',
        });
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatchObject({
            itemType: 'ATTENDANCE',
            presentDays: 27,
            absentDays: 4,
            source: 'cycle_machine_file',
            status: 'approved',
            approvedVia: 'machine_file',
        });
        expect(lines[1]).toMatchObject({
            itemType: 'OT',
            hours: 10,
        });
    });

    test('portal amounts become typed money lines', () => {
        const lines = linesFromPortalAmounts({
            employeeId: 'ASIL-W',
            workMonth: 7,
            workYear: 2026,
            payMonth: 8,
            payYear: 2026,
            portal: { ot2Write: 9, expense: 2200, medical: 500 },
            actor: 'lm@wafi-energy.com',
            approvedVia: 'lm',
        });
        expect(lines.map((l) => l.itemType)).toEqual(['OT', 'EXPENSE', 'MEDICAL']);
        expect(lines[1].amount).toBe(2200);
        expect(lines[0].payMonth).toBe(8);
    });

    test('upsertLines writes the unique key in one statement', async () => {
        const client = {
            query: jest.fn().mockResolvedValue({ rowCount: 1 }),
        };
        await upsertLines(client, [{
            employeeId: 'ASIL-1',
            contractId: 'CTR-X',
            workMonth: 8,
            workYear: 2026,
            itemType: 'ATTENDANCE',
            presentDays: 27,
            absentDays: 4,
            source: 'cycle_machine_file',
        }], 'ops@asil.com.pk');
        expect(client.query).toHaveBeenCalledTimes(1);
        const [sql, params] = client.query.mock.calls[0];
        expect(sql).toMatch(/ON CONFLICT \(employee_id, work_year, work_month, item_type, source\)/);
        expect(params[0]).toBe('ASIL-1');
        expect(params[7]).toBe(27);
    });

    test('intervene requires a reason', async () => {
        await expect(intervene({}, {
            employeeId: 'ASIL-1',
            itemType: 'OT',
            hours: 4,
        })).rejects.toMatchObject({ status: 400 });
    });
});
