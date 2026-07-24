'use strict';

/**
 * World B fixture: contract policy, rate cards, employees, attendance,
 * monthly override, focal_approved claims (incl. wafi provenance), holiday.
 */
async function buildWorldBFixture(pool, opts = {}) {
  const year = opts.year ?? 2026;
  const month = opts.month ?? 6;
  const contractId = String(opts.contractId ?? '99200');
  const clientId = opts.clientId ?? 'CLI-WB-TEST';
  const clientName = opts.clientName ?? 'World B Test Client';
  const contractName = opts.contractName ?? 'WB-TEST-CONTRACT';

  await pool.query(
    `INSERT INTO clients (id, name, is_active) VALUES ($1, $2, true) ON CONFLICT (id) DO NOTHING`,
    [clientId, clientName]
  );
  await pool.query(
    `INSERT INTO contracts (id, client_id, contract_name, status) VALUES ($1, $2, $3, 'Active') ON CONFLICT (id) DO NOTHING`,
    [contractId, clientId, contractName]
  );

  const otAllowed = opts.otAllowed !== false;
  const otCap = opts.otCap ?? 40;
  await pool.query(
    `INSERT INTO contract_policies
       (contract_id, ot_allowed, ot_monthly_cap_hours, ot_divisor_days, ot_divisor_hours,
        service_charge_pct, medical_annual_cap, use_calendar_working_days, effective_from)
     VALUES ($1, $2, $3, 26, 8, 0.18, 50000, true, '2020-01-01')`,
    [contractId, otAllowed, otCap]
  );

  await pool.query(
    `INSERT INTO contract_rate_cards (contract_id, role_title, billing_basis, bill_rate, cost_rate, effective_from)
     VALUES ($1, 'operator', 'monthly', 55000, 48000, '2020-01-01')`,
    [contractId]
  );

  const employees = [];
  for (let i = 0; i < 2; i++) {
    const empId = `ASIL-WB-${String(i + 1).padStart(3, '0')}`;
    await pool.query(
      `INSERT INTO employees
         (id, name, client, contract_name, contract_id, active, salary, designation, province)
       VALUES ($1, $2, $3, $4, $5, 'Yes', $6, 'Operator', 'Sindh')
       ON CONFLICT (id) DO NOTHING`,
      [empId, `World B Emp ${i + 1}`, clientName, contractName, contractId, 48000 + i * 2000]
    );
    employees.push({ id: empId, name: `World B Emp ${i + 1}` });
  }

  const attRows = [
    { emp: employees[0].id, date: '2026-06-02', status: 'present' },
    { emp: employees[0].id, date: '2026-06-03', status: 'present' },
    { emp: employees[0].id, date: '2026-06-04', status: 'present' },
    { emp: employees[0].id, date: '2026-06-05', status: 'present' },
    { emp: employees[0].id, date: '2026-06-06', status: 'present' },
    { emp: employees[1].id, date: '2026-06-08', status: 'ot', ot_hours: 4 },
  ];
  for (const a of attRows) {
    await pool.query(
      `INSERT INTO attendance_records (employee_id, date, status, marked_by, ot_hours)
       VALUES ($1, $2::date, $3, 'fixture', $4)`,
      [a.emp, a.date, a.status, a.ot_hours ?? null]
    );
  }

  await pool.query(
    `INSERT INTO monthly_attendance_overrides
       (employee_id, period_month, period_year, present_days, ot2_hours, opd, expense)
     VALUES ($1, $2, $3, 25, 6, 1200, 800)
     ON CONFLICT (employee_id, period_month, period_year) DO UPDATE SET
       present_days=EXCLUDED.present_days, ot2_hours=EXCLUDED.ot2_hours,
       opd=EXCLUDED.opd, expense=EXCLUDED.expense`,
    [employees[0].id, month, year]
  );

  await pool.query(
    `INSERT INTO public_holidays (holiday_date, name, multiplier)
     VALUES ('2026-06-15', 'Test Holiday', 3)`
  );

  const claimDefs = [
    { emp: employees[0].id, type: 'overtime', items: [{ ot2: 3 }] },
    { emp: employees[0].id, type: 'medical', items: [{ amount: 2500 }] },
    { emp: employees[0].id, type: 'expense', items: [{ amount: 1500 }] },
    { emp: employees[1].id, type: 'medical', items: [{ amount: 900 }], wafi: true },
  ];

  const claims = [];
  for (const c of claimDefs) {
    if (c.wafi) {
      const { rows } = await pool.query(
        `INSERT INTO employee_claims
           (employee_id, claim_type, period_month, period_year, claimed_items, status, contract_id,
            source_kind, source_session_id, source_ref)
         VALUES ($1,$2,$3,$4,$5::jsonb,'focal_approved',$6,'wafi',42,'wafi-med-1')
         RETURNING id`,
        [c.emp, c.type, month, year, JSON.stringify(c.items), contractId]
      );
      claims.push({ id: rows[0].id, ...c });
    } else {
      const { rows } = await pool.query(
        `INSERT INTO employee_claims
           (employee_id, claim_type, period_month, period_year, claimed_items, status, contract_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,'focal_approved',$6)
         RETURNING id`,
        [c.emp, c.type, month, year, JSON.stringify(c.items), contractId]
      );
      claims.push({ id: rows[0].id, ...c });
    }
  }

  return { year, month, contractId, clientName, contractName, employees, claims };
}

module.exports = { buildWorldBFixture };
