/**
 * insert_new_employees.js
 * One-time script: Inserts 12 new Wafi employees identified in the April 2026
 * payroll CSV with blank "Prev Salary" (first appearance = new to HCM system).
 *
 * Safe to re-run — uses ON CONFLICT (id) DO UPDATE.
 * Run: $env:DATABASE_URL="postgres://..."; node insert_new_employees.js
 *   OR: node insert_new_employees.js "postgres://..."
 */
const { Pool } = require('pg');

// Accept DATABASE_URL from env or first CLI arg
const DATABASE_URL = process.env.DATABASE_URL || process.argv[2];
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not set. Pass it as env var or first argument.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});


// Parse "DD/Mon/YY" format e.g. "20/Jan/26" → "2026-01-20"
const parseDOJ = (raw) => {
    if (!raw) return null;
    const months = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
    const [d, m, y] = raw.split('/');
    const mo = months[m];
    if (!d || !mo || !y) return null;
    const yr = parseInt(y) + 2000; // '26' → 2026
    return `${yr}-${String(mo).padStart(2,'0')}-${String(parseInt(d)).padStart(2,'0')}`;
};

// Parse salary string "150,000" → 150000
const parseSal = (s) => parseFloat((s || '0').replace(/,/g, '')) || 0;

const employees = [
    {
        id: 'ASIL/SPL-407/21',
        name: 'Zeeshan Idrees',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'Retail',
        bu: 'BPO',
        dept: 'Retail',
        designation: 'Business Analyst',
        location: 'Shell House',
        province: 'Sindh',
        cnic: '42301-2888235-9',
        bank_name: 'Standard Chartered',
        bank_account: 'PK55SCBL0000001171505601',
        account_title: 'Zeeshan Idrees',
        doj: parseDOJ('20/Jan/26'),
        salary: parseSal('150,000'),
        email: 'zee.i.shaheen@gmail.com',
    },
    {
        id: 'ASIL/SPL-408/21',
        name: 'Kashif Yazdani',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'Lubes',
        bu: 'BPO',
        dept: 'Lubes',
        designation: 'Asrea Sales Executive',
        location: 'Multan',
        province: 'Punjab',
        cnic: '36302-5879844-9',
        bank_name: 'HBL',
        bank_account: 'PK28HABB0050077900424161',
        account_title: 'Kashif Yazdani',
        doj: parseDOJ('11/Jan/26'),
        salary: parseSal('110,000'),
        email: 'kashif.yazdani@gmail.com',
    },
    {
        id: 'ASIL/SPL-409/21',
        name: 'Numair Ahmed Qureshi',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'IT',
        bu: 'BPO',
        dept: 'IT',
        designation: 'IT Support',
        location: 'Shell House',
        province: 'Sindh',
        cnic: '42401-9278331-7',
        bank_name: 'Bank Al Habib',
        bank_account: 'PK05BAHL1088009500355101',
        account_title: 'Numair Ahmed Qureshi',
        doj: parseDOJ('12/Jan/26'),
        salary: parseSal('125,000'),
        email: 'numair786@gmail.com',
    },
    {
        id: 'ASIL/SPL-410/21',
        name: 'Muhammad Hamza Arif',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'Retail',
        bu: 'BPO',
        dept: 'Retail',
        designation: 'Admin',
        location: 'Gujranwala',
        province: 'Punjab',
        cnic: '34101-5329552-1',
        bank_name: 'Meezan Bank',
        bank_account: 'PK93MEZN0009200105680266',
        account_title: 'Muhammad Hamza Arif',
        doj: parseDOJ('01/Dec/25'),
        salary: parseSal('65,000'),
        email: null,
    },
    {
        id: 'ASIL/SPL-411/21',
        name: 'Muhammad Safyan',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'Trading & Supply',
        bu: 'BPO',
        dept: 'Trading & Supply',
        designation: 'Senior GW',
        location: 'Gatti - FSD',
        province: 'Punjab',
        cnic: '33103-8763556-3',
        bank_name: 'Bank Al-Habib',
        bank_account: 'PK13BAHL5523008100549501',
        account_title: 'Muhammad Safyan',
        doj: parseDOJ('09/Jan/26'),
        salary: parseSal('60,000'),
        email: 'muhammadsafyan462@gmail.com',
    },
    {
        id: 'ASIL/SPL-412/21',
        name: 'Ali Sheikh',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'Real Estate',
        bu: 'BPO',
        dept: 'Real Estate',
        designation: 'Project Lead',
        location: 'Shell House',
        province: 'Sindh',
        cnic: '42201-2279553-5',
        bank_name: 'Meezan Bank',
        bank_account: 'PK78MEZN0001890114123054',
        account_title: 'Ali Sheikh',
        doj: parseDOJ('15/Jan/26'),
        salary: parseSal('75,000'),
        email: 'muhammadaliahmedsheikh3@gmail.com',
    },
    {
        id: 'ASIL/SPL-413/21',
        name: 'Muhammad Zain Bin Ahsan',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'Retail',
        bu: 'BPO',
        dept: 'Retail',
        designation: 'KAM Executive',
        location: 'Lahore',
        province: 'Punjab',
        cnic: '35200-5807789-9',
        bank_name: 'HBL',
        bank_account: 'PK65HABB0001977901308503',
        account_title: 'Muhammad Zain Bin Ahsan',
        doj: parseDOJ('10/Feb/26'),
        salary: parseSal('120,000'),
        email: 'mzn64151@gmail.com',
    },
    {
        id: 'ASIL/SPL-414/21',
        name: 'Muhammad Abdullah Baig',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'OTC',
        bu: 'BPO',
        dept: 'OTC',
        designation: 'Sales Support Officer',
        location: 'Lahore',
        province: 'Punjab',
        cnic: '38405-4261854-9',
        bank_name: 'JS Bank',
        bank_account: 'PK33JSBL9561000002483718',
        account_title: 'Muhammad Abdullah Baig',
        doj: parseDOJ('16/Feb/26'),
        salary: parseSal('100,000'),
        email: 'abdullahmirza400@gmail.com',
    },
    {
        id: 'ASIL/SPL-415/21',
        name: 'Saqlain Qadir',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'Retail',
        bu: 'BPO',
        dept: 'Retail',
        designation: 'HSE Data Analyst',
        location: 'Shell House',
        province: 'Sindh',
        cnic: '42201-7301890-7',
        bank_name: 'Meezan Bank',
        bank_account: 'PK40MEZN0001140114443342',
        account_title: 'Saqlain Qadir',
        doj: parseDOJ('09/Mar/26'),
        salary: parseSal('100,000'),
        email: 'saqlainqadir9@gmail.com',
    },
    {
        id: 'ASIL/SPL-416/21',
        name: 'Syed Jahanzeb Raza',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'LSC',
        bu: 'BPO',
        dept: 'LSC',
        designation: 'Filling Operator',
        location: 'LOBP Keamari',
        province: 'Sindh',
        cnic: '45504-6740842-9',
        bank_name: 'Bank Islami',
        bank_account: 'PK52BKIP0111400292700201',
        account_title: 'Syed Jahanzeb Raza',
        doj: parseDOJ('09/Mar/26'),
        salary: parseSal('90,000'),
        email: 'syedjahanzeeb@gmail.com',
    },
    {
        id: 'ASIL/SPL-417/21',
        name: 'Syed Haris Ali',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'Lubes',
        bu: 'BPO',
        dept: 'Lubes',
        designation: 'Area Sales Executive',
        location: 'Shell House',
        province: 'Sindh',
        cnic: '42101-7014849-9',
        bank_name: 'Bank Islami',
        bank_account: 'PK58BKIP0110800262550001',
        account_title: 'Syed Haris Ali',
        doj: parseDOJ('05/Mar/26'),
        salary: parseSal('130,000'),
        email: 'haris18980@gmail.com',
    },
    {
        id: 'ASILFM/SPL/22/161',
        name: 'Shehzad Ahmed',
        active: 'Yes',
        client: 'Wafi Energy Pakistan Limited',
        client_bu: 'Facility Management',
        bu: 'FM',
        dept: 'Facility Management',
        designation: 'Gardener',
        location: 'LOBP Keamari',
        province: 'Sindh',
        cnic: '42401-9830916-3',
        bank_name: 'MCB Bank Limited',
        bank_account: 'PK49MUCB1682419651004446',
        account_title: 'Shehzad Ahmed',
        doj: parseDOJ('11/Feb/26'),
        salary: parseSal('40,000'),
        email: 'obaid.rana@asil.com.pk',
    },
];

const COLS = [
    'id', 'bu', 'active', 'client', 'client_bu', 'dept', 'designation',
    'location', 'province', 'name', 'cnic', 'doj', 'salary',
    'bank_name', 'bank_account', 'account_title', 'email',
    'father_name', 'mother_name', 'cnic_issue', 'cnic_expiry',
    'place_of_birth', 'eobi_no', 'religion', 'marital_status',
    'dob', 'last_working_day', 'primary_contact', 'emergency_contact',
    'present_address', 'permanent_address',
    'spouse_name', 'spouse_age', 'spouse_cnic',
    'child1_name', 'child1_age', 'child1_id',
    'child2_name', 'child2_age', 'child2_id',
    'medical_type', 'medical_maternity', 'total_medical_coverage',
    'nok_name', 'nok_relation', 'nok_contact',
    'contract_date', 'contract_name', 'contract_id', 'region',
];

const placeholders = COLS.map((_, i) => `$${i + 1}`).join(', ');
const updates = COLS.slice(1).map(c => `${c}=EXCLUDED.${c}`).join(', ');
const SQL = `
    INSERT INTO employees (${COLS.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at=NOW()
    RETURNING id, name, salary, doj
`;

async function run() {
    console.log(`\n🚀 Inserting ${employees.length} new employees into HCM...\n`);
    let inserted = 0, updated = 0, errors = [];

    for (const emp of employees) {
        const vals = COLS.map(c => emp[c] ?? null);
        try {
            const { rows } = await pool.query(SQL, vals);
            const r = rows[0];
            console.log(`  ✅ ${r.id.padEnd(22)} | ${r.name.padEnd(30)} | PKR ${r.salary.toLocaleString()} | DOJ: ${r.doj}`);
            inserted++;
        } catch (err) {
            console.error(`  ❌ ${emp.id} | ${emp.name} → ${err.message}`);
            errors.push({ id: emp.id, error: err.message });
        }
    }

    console.log(`\n─────────────────────────────────────────`);
    console.log(`✅ Inserted/Updated: ${inserted}`);
    if (errors.length) console.log(`❌ Errors:           ${errors.length}`, errors);

    // Verify counts
    const { rows: countRow } = await pool.query(`
        SELECT COUNT(*) AS total,
               SUM(salary) AS total_salary
        FROM employees
        WHERE client ILIKE '%wafi%' AND active = 'Yes'
    `);
    console.log(`\n📊 Wafi Active Employees in HCM after insert:`);
    console.log(`   Count: ${countRow[0].total}`);
    console.log(`   Total Salary Roll: PKR ${parseFloat(countRow[0].total_salary || 0).toLocaleString()}`);

    await pool.end();
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
