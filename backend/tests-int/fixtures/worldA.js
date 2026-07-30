'use strict';

/**
 * World A fixture: client, contract, bank, employees with bank details,
 * and payroll_transactions rows for a given month (unlocked by default).
 */
async function buildWorldAFixture(pool, opts = {}) {
  const year = opts.year ?? 2026;
  const month = opts.month ?? 7;
  const employeeCount = opts.employeeCount ?? 3;
  const nets = opts.nets ?? [45000, 52000, 48000];
  const grosses = opts.grosses ?? nets.map(n => Math.round(n * 1.15));

  const clientId = opts.clientId ?? 'CLI-WA-TEST';
  const clientName = opts.clientName ?? 'World A Test Client';
  const contractId = String(opts.contractId ?? '99100');
  const contractName = opts.contractName ?? 'WA-TEST-CONTRACT';

  await pool.query(
    `INSERT INTO clients (id, name, is_active)
     VALUES ($1, $2, true)
     ON CONFLICT (id) DO NOTHING`,
    [clientId, clientName]
  );

  await pool.query(
    `INSERT INTO contracts (id, client_id, contract_name, status)
     VALUES ($1, $2, $3, 'Active')
     ON CONFLICT (id) DO NOTHING`,
    [contractId, clientId, contractName]
  );

  const { rows: bankRows } = await pool.query(
    `INSERT INTO banks (name, short_name, is_active)
     VALUES ('HBL Test Branch', 'HBL', true)
     RETURNING id, name`
  );
  const bank = bankRows[0];

  const employees = [];
  for (let i = 0; i < employeeCount; i++) {
    const empId = `ASIL-WA-${String(i + 1).padStart(3, '0')}`;
    const net = nets[i] ?? 50000;
    const gross = grosses[i] ?? Math.round(net * 1.15);
    await pool.query(
      `INSERT INTO employees
         (id, name, client, contract_name, contract_id, active, salary, bank_name, bank_account, account_title)
       VALUES ($1, $2, $3, $4, $5, 'Yes', $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        empId,
        `World A Emp ${i + 1}`,
        clientName,
        contractName,
        contractId,
        gross,
        'HBL',
        `PK00HABB${1000000 + i}`,
        `World A Emp ${i + 1}`,
      ]
    );

    await pool.query(
      `INSERT INTO payroll_transactions
         (month, year, employee_id, paid_days, ot2_hrs, ot3_hrs, opd_claim,
          reimbursement, arrears, bonus_amount, special_allowance, fuel_mobile,
          other_deduction, advance_deduction, loan_deduction,
          medical_ee, medical_sp, medical_ch1, medical_ch2,
          gross, net, wht, eobi_ee, service_charges, sales_tax, total_invoice,
          created_by, locked)
       VALUES ($1,$2,$3,26,0,0,0,0,0,0,0,0,0,0,0,NULL,NULL,NULL,NULL,$4,$5,0,400,0,0,$4,'fixture',FALSE)
       ON CONFLICT (employee_id, month, year) DO UPDATE SET
         gross=EXCLUDED.gross, net=EXCLUDED.net, total_invoice=EXCLUDED.total_invoice, locked=FALSE`,
      [month, year, empId, gross, net]
    );

    employees.push({ id: empId, name: `World A Emp ${i + 1}`, net, gross, bank_name: 'HBL', bank_account: `PK00HABB${1000000 + i}` });
  }

  const totalNet = employees.reduce((s, e) => s + e.net, 0);

  return {
    clientId,
    clientName,
    contractId,
    contractName,
    year,
    month,
    bank,
    employees,
    totalNet,
    employeeCount: employees.length,
  };
}

async function buildApprovedBill(pool, opts = {}) {
  const billId = opts.id ?? `BILL-WA-${Date.now()}`;
  const vendor = opts.vendor ?? 'Test Vendor Ltd';
  const total = opts.total ?? 125000;

  await pool.query(
    `INSERT INTO bills (id, vendor, total, amount, status, purpose, bill_type, created_by)
     VALUES ($1, $2, $3, $3, 'Approved', 'Integration test bill', 'Official', 'fixture')
     ON CONFLICT (id) DO NOTHING`,
    [billId, vendor, total]
  );

  return { id: billId, vendor, total };
}

module.exports = { buildWorldAFixture, buildApprovedBill };
