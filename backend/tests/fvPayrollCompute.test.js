'use strict';

const { computeRunForContract } = require('../src/modules/payrollrun/service');

function makePolicy() {
    return {
        id: 1,
        contract_id: 'CTR-PSO-NORTH-ZONE',
        ot_allowed: false,
        ot_monthly_cap_hours: null,
        attendance_input_mode: 'full_ledger',
        standard_month_days: 30,
        ot_divisor_days: 30,
        ot_divisor_hours: 8,
        service_charge_pct: 0,
        sales_tax_rate: 0.15,
        sales_tax_exempt: false,
        bonus_accrual_months: 0,
        gratuity_accrual_months: 12,
        use_calendar_working_days: true,
    };
}

function makeEmployee(id, overrides = {}) {
    return {
        id,
        name: `Employee ${id}`,
        salary: 48000,
        doj: '2020-01-01',
        designation: 'Sweeping',
        site: 'TARUJABBA',
        location: 'Tarujabba Depot',
        spouse_name: null,
        child1_name: null,
        child2_name: null,
        ...overrides,
    };
}

function buildMockPool(state) {
    const policy = makePolicy();
    return {
        query: jest.fn(async (sql, params = []) => {
            const q = String(sql).replace(/\s+/g, ' ').trim();

            if (q.includes('FROM contract_policies')) {
                return { rows: [policy] };
            }
            if (q.includes('SELECT costs FROM contracts')) {
                return { rows: [{ costs: { eobi: 400, life_insurance: 150, bonus_months: 0, eosb_type: 'Gratuity' } }] };
            }
            if (q.includes('FROM public_holidays')) {
                return { rows: [] };
            }
            if (q.includes('FROM employees e') && q.includes('contract_id = $1')) {
                return { rows: state.employees };
            }
            if (q.includes('FROM contract_rate_cards')) {
                return { rows: [] };
            }
            if (q.includes('INSERT INTO payroll_runs')) {
                state.runId += 1;
                const run = {
                    id: state.runId,
                    contract_id: params[0],
                    period_month: params[1],
                    period_year: params[2],
                    status: state.runStatus || 'draft',
                };
                state.run = run;
                return { rows: [run] };
            }
            if (q.includes('UPDATE employee_claims SET status = \'focal_approved\'')) {
                return { rows: [], rowCount: 0 };
            }
            if (q.includes('FROM attendance_records') && q.includes('employee_id = ANY')) {
                return { rows: state.attendance || [] };
            }
            if (q.includes('FROM monthly_attendance_overrides') && q.includes('employee_id = ANY')) {
                return { rows: state.overrides || [] };
            }
            if (q.includes('FROM so_deductions') && q.includes('employee_id = ANY')) {
                return { rows: state.deductions || [] };
            }
            if (q.includes('FROM employee_claims') && q.includes('employee_id = ANY')) {
                return { rows: state.claims || [] };
            }
            if (q.includes('DELETE FROM payroll_run_rows')) {
                return { rows: [], rowCount: state.insertedRows.length };
            }
            if (q.includes('INSERT INTO payroll_run_rows')) {
                state.insertedRows.push({ run_id: params[0], employee_id: params[1] });
                return { rows: [] };
            }
            if (q.includes('UPDATE employee_claims SET status = \'in_payroll_run\'')) {
                return { rows: [], rowCount: 0 };
            }

            throw new Error(`Unhandled query: ${q.slice(0, 120)}`);
        }),
    };
}

describe('FV PSO payroll compute', () => {
    test('computes July run from fv_conservancy_attendance overrides with explicit absent days', async () => {
        const emp = makeEmployee('ASIL-PSO-NZ-001');
        const state = {
            employees: [emp],
            overrides: [{
                employee_id: emp.id,
                period_month: 7,
                period_year: 2026,
                present_days: 25,
                absent_days: 5,
                working_days: 27,
                source: 'fv_conservancy_attendance',
            }],
            deductions: [],
            claims: [],
            attendance: [],
            runId: 0,
            insertedRows: [],
        };
        const pool = buildMockPool(state);

        const result = await computeRunForContract(pool, {
            contractId: 'CTR-PSO-NORTH-ZONE',
            month: 7,
            year: 2026,
        });

        expect(result.ok).toBe(true);
        expect(result.headcount).toBe(1);
        expect(result.rows[0].inputs.absent_days).toBe(5);
        expect(result.rows[0].computed.salaryForDays).toBe(Math.round(48000 * (25 / 30)));
    });

    test('uses zero absent when fv override has absent_days=0 and no so_deduction', async () => {
        const emp = makeEmployee('ASIL-PSO-NZ-002');
        const state = {
            employees: [emp],
            overrides: [{
                employee_id: emp.id,
                period_month: 7,
                period_year: 2026,
                present_days: 27,
                absent_days: 0,
                source: 'fv_conservancy_attendance',
            }],
            deductions: [],
            claims: [],
            attendance: [],
            runId: 0,
            insertedRows: [],
        };
        const pool = buildMockPool(state);

        const result = await computeRunForContract(pool, {
            contractId: 'CTR-PSO-NORTH-ZONE',
            month: 7,
            year: 2026,
        });

        expect(result.ok).toBe(true);
        expect(result.rows[0].inputs.absent_days).toBe(0);
        expect(result.rows[0].computed.salaryForDays).toBe(48000);
    });

    test('falls back to so_deduction absent when override lacks absent_days column value', async () => {
        const emp = makeEmployee('ASIL-PSO-NZ-003');
        const state = {
            employees: [emp],
            overrides: [{
                employee_id: emp.id,
                period_month: 7,
                period_year: 2026,
                present_days: 24,
                absent_days: null,
                source: 'fv_conservancy_attendance',
            }],
            deductions: [{ employee_id: emp.id, days_absent: 6 }],
            claims: [],
            attendance: [],
            runId: 0,
            insertedRows: [],
        };
        const pool = buildMockPool(state);

        const result = await computeRunForContract(pool, {
            contractId: 'CTR-PSO-NORTH-ZONE',
            month: 7,
            year: 2026,
        });

        expect(result.ok).toBe(true);
        expect(result.rows[0].inputs.absent_days).toBe(6);
        expect(result.rows[0].computed.salaryForDays).toBe(Math.round(48000 * (24 / 30)));
    });

    test('handles July bonus disbursement when contract sets bonus_disbursement_month=7', async () => {
        const emp = makeEmployee('ASIL-PSO-NZ-004');
        const state = {
            employees: [emp],
            overrides: [],
            deductions: [],
            claims: [{ id: 99, employee_id: emp.id, claim_type: 'medical', claimed_items: { amount: 800 } }],
            attendance: [],
            runId: 0,
            insertedRows: [],
        };
        const pool = buildMockPool(state);
        const baseQuery = pool.query.getMockImplementation();
        pool.query.mockImplementation(async (sql, params = []) => {
            const q = String(sql).replace(/\s+/g, ' ').trim();
            if (q.includes('SELECT costs FROM contracts')) {
                return {
                    rows: [{
                        costs: {
                            eobi: 400,
                            life_insurance: 150,
                            bonus_months: 1,
                            bonus_disbursement_month: 7,
                            bonus_min_months: 0,
                        },
                    }],
                };
            }
            return baseQuery(sql, params);
        });

        const result = await computeRunForContract(pool, {
            contractId: 'CTR-PSO-NORTH-ZONE',
            month: 7,
            year: 2026,
        });

        expect(result.ok).toBe(true);
        expect(result.rows[0].computed.bonusDisbursed).toBe(48000);
        expect(result.rows[0].inputs.opd).toBe(800);
    });
});
