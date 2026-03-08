// One-time database setup script — run with: node setup-db.js
const { Client } = require('pg');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const schema = `
DROP TABLE IF EXISTS payroll_transactions, bills, contracts, employees, users, clients CASCADE;

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  bu TEXT, active TEXT DEFAULT 'Yes',
  client TEXT, client_bu TEXT,
  dept TEXT, designation TEXT,
  location TEXT, province TEXT,
  name TEXT NOT NULL,
  father_name TEXT, mother_name TEXT,
  cnic TEXT UNIQUE, cnic_issue DATE, cnic_expiry DATE,
  place_of_birth TEXT, eobi_no TEXT,
  religion TEXT, marital_status TEXT,
  dob DATE, doj DATE,
  primary_contact TEXT, emergency_contact TEXT,
  email TEXT, present_address TEXT, permanent_address TEXT,
  salary NUMERIC DEFAULT 0,
  spouse_name TEXT, spouse_age TEXT, spouse_cnic TEXT,
  child1_name TEXT, child1_age TEXT, child1_id TEXT,
  child2_name TEXT, child2_age TEXT, child2_id TEXT,
  medical_type TEXT, medical_maternity TEXT, total_medical_coverage NUMERIC,
  bank_name TEXT, bank_account TEXT, account_title TEXT,
  nok_name TEXT, nok_relation TEXT, nok_contact TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  hq TEXT, ntn TEXT, strn TEXT, industry TEXT,
  contacts JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  contract_name TEXT,
  location TEXT, service_type TEXT,
  headcount INT DEFAULT 0,
  status TEXT DEFAULT 'Active',
  start_date DATE, end_date DATE,
  costs JSONB DEFAULT '{}',
  financials JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payroll_transactions (
  id SERIAL PRIMARY KEY,
  employee_id TEXT REFERENCES employees(id),
  month INT NOT NULL, year INT NOT NULL,
  basic NUMERIC DEFAULT 0, hra NUMERIC DEFAULT 0,
  conv NUMERIC DEFAULT 0, med NUMERIC DEFAULT 0,
  ot NUMERIC DEFAULT 0, opd NUMERIC DEFAULT 0,
  reimb NUMERIC DEFAULT 0, gross NUMERIC DEFAULT 0,
  wht NUMERIC DEFAULT 0, eobi_ee NUMERIC DEFAULT 370,
  eobi_er NUMERIC DEFAULT 1850, sessi_ee NUMERIC DEFAULT 0,
  sessi_er NUMERIC DEFAULT 0, pf_ee NUMERIC DEFAULT 0,
  adv NUMERIC DEFAULT 0, net NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'Draft', paid_on DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, month, year)
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY, type TEXT, vendor TEXT, date DATE,
  client TEXT, contract_id TEXT, site TEXT,
  purpose TEXT, bill_type TEXT,
  amount NUMERIC DEFAULT 0, gst NUMERIC DEFAULT 0, total NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'Draft', note TEXT, items JSONB, image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT, role TEXT DEFAULT 'staff',
  google_id TEXT UNIQUE, avatar TEXT, last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

async function setup() {
  const client = new Client({ connectionString: DATABASE_URL });
  try {
    console.log('Connecting to Neon database...');
    await client.connect();
    console.log('Connected! Recreating schema...');
    await client.query(schema);
    console.log('\n✅ All tables recreated successfully:');
    console.log('   employees, clients, contracts, payroll_transactions, bills, users');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}
setup();
