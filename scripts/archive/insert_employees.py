import psycopg2

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

employees = [
    {'id':'ASIL/SPL-407/21','name':'Zeeshan Idrees','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'Retail','bu':'BPO','dept':'Retail','designation':'Business Analyst','location':'Shell House','province':'Sindh','cnic':'42301-2888235-9','bank_name':'Standard Chartered','bank_account':'PK55SCBL0000001171505601','account_title':'Zeeshan Idrees','doj':'2026-01-20','salary':150000,'email':'zee.i.shaheen@gmail.com'},
    {'id':'ASIL/SPL-408/21','name':'Kashif Yazdani','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'Lubes','bu':'BPO','dept':'Lubes','designation':'Asrea Sales Executive','location':'Multan','province':'Punjab','cnic':'36302-5879844-9','bank_name':'HBL','bank_account':'PK28HABB0050077900424161','account_title':'Kashif Yazdani','doj':'2026-01-11','salary':110000,'email':'kashif.yazdani@gmail.com'},
    {'id':'ASIL/SPL-409/21','name':'Numair Ahmed Qureshi','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'IT','bu':'BPO','dept':'IT','designation':'IT Support','location':'Shell House','province':'Sindh','cnic':'42401-9278331-7','bank_name':'Bank Al Habib','bank_account':'PK05BAHL1088009500355101','account_title':'Numair Ahmed Qureshi','doj':'2026-01-12','salary':125000,'email':'numair786@gmail.com'},
    {'id':'ASIL/SPL-410/21','name':'Muhammad Hamza Arif','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'Retail','bu':'BPO','dept':'Retail','designation':'Admin','location':'Gujranwala','province':'Punjab','cnic':'34101-5329552-1','bank_name':'Meezan Bank','bank_account':'PK93MEZN0009200105680266','account_title':'Muhammad Hamza Arif','doj':'2025-12-01','salary':65000,'email':None},
    {'id':'ASIL/SPL-411/21','name':'Muhammad Safyan','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'Trading & Supply','bu':'BPO','dept':'Trading & Supply','designation':'Senior GW','location':'Gatti - FSD','province':'Punjab','cnic':'33103-8763556-3','bank_name':'Bank Al-Habib','bank_account':'PK13BAHL5523008100549501','account_title':'Muhammad Safyan','doj':'2026-01-09','salary':60000,'email':'muhammadsafyan462@gmail.com'},
    {'id':'ASIL/SPL-412/21','name':'Ali Sheikh','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'Real Estate','bu':'BPO','dept':'Real Estate','designation':'Project Lead','location':'Shell House','province':'Sindh','cnic':'42201-2279553-5','bank_name':'Meezan Bank','bank_account':'PK78MEZN0001890114123054','account_title':'Ali Sheikh','doj':'2026-01-15','salary':75000,'email':'muhammadaliahmedsheikh3@gmail.com'},
    {'id':'ASIL/SPL-413/21','name':'Muhammad Zain Bin Ahsan','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'Retail','bu':'BPO','dept':'Retail','designation':'KAM Executive','location':'Lahore','province':'Punjab','cnic':'35200-5807789-9','bank_name':'HBL','bank_account':'PK65HABB0001977901308503','account_title':'Muhammad Zain Bin Ahsan','doj':'2026-02-10','salary':120000,'email':'mzn64151@gmail.com'},
    {'id':'ASIL/SPL-414/21','name':'Muhammad Abdullah Baig','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'OTC','bu':'BPO','dept':'OTC','designation':'Sales Support Officer','location':'Lahore','province':'Punjab','cnic':'38405-4261854-9','bank_name':'JS Bank','bank_account':'PK33JSBL9561000002483718','account_title':'Muhammad Abdullah Baig','doj':'2026-02-16','salary':100000,'email':'abdullahmirza400@gmail.com'},
    {'id':'ASIL/SPL-415/21','name':'Saqlain Qadir','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'Retail','bu':'BPO','dept':'Retail','designation':'HSE Data Analyst','location':'Shell House','province':'Sindh','cnic':'42201-7301890-7','bank_name':'Meezan Bank','bank_account':'PK40MEZN0001140114443342','account_title':'Saqlain Qadir','doj':'2026-03-09','salary':100000,'email':'saqlainqadir9@gmail.com'},
    {'id':'ASIL/SPL-416/21','name':'Syed Jahanzeb Raza','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'LSC','bu':'BPO','dept':'LSC','designation':'Filling Operator','location':'LOBP Keamari','province':'Sindh','cnic':'45504-6740842-9','bank_name':'Bank Islami','bank_account':'PK52BKIP0111400292700201','account_title':'Syed Jahanzeb Raza','doj':'2026-03-09','salary':90000,'email':'syedjahanzeeb@gmail.com'},
    {'id':'ASIL/SPL-417/21','name':'Syed Haris Ali','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'Lubes','bu':'BPO','dept':'Lubes','designation':'Area Sales Executive','location':'Shell House','province':'Sindh','cnic':'42101-7014849-9','bank_name':'Bank Islami','bank_account':'PK58BKIP0110800262550001','account_title':'Syed Haris Ali','doj':'2026-03-05','salary':130000,'email':'haris18980@gmail.com'},
    {'id':'ASILFM/SPL/22/161','name':'Shehzad Ahmed','active':'Yes','client':'Wafi Energy Pakistan Limited','client_bu':'Facility Management','bu':'FM','dept':'Facility Management','designation':'Gardener','location':'LOBP Keamari','province':'Sindh','cnic':'42401-9830916-3','bank_name':'MCB Bank Limited','bank_account':'PK49MUCB1682419651004446','account_title':'Shehzad Ahmed','doj':'2026-02-11','salary':40000,'email':'obaid.rana@asil.com.pk'},
]

SQL = """
INSERT INTO employees
  (id, bu, active, client, client_bu, dept, designation, location, province, name,
   cnic, doj, salary, bank_name, bank_account, account_title, email,
   father_name, mother_name, cnic_issue, cnic_expiry, place_of_birth, eobi_no,
   religion, marital_status, dob, last_working_day, primary_contact,
   emergency_contact, present_address, permanent_address,
   spouse_name, spouse_age, spouse_cnic, child1_name, child1_age, child1_id,
   child2_name, child2_age, child2_id, medical_type, medical_maternity,
   total_medical_coverage, nok_name, nok_relation, nok_contact,
   contract_date, contract_name, contract_id, region)
VALUES
  (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
   NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
   NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
   NULL,NULL,NULL,NULL)
ON CONFLICT (id) DO UPDATE SET
  bu=EXCLUDED.bu, active=EXCLUDED.active, client=EXCLUDED.client,
  client_bu=EXCLUDED.client_bu, dept=EXCLUDED.dept, designation=EXCLUDED.designation,
  location=EXCLUDED.location, province=EXCLUDED.province, name=EXCLUDED.name,
  cnic=EXCLUDED.cnic, doj=EXCLUDED.doj, salary=EXCLUDED.salary,
  bank_name=EXCLUDED.bank_name, bank_account=EXCLUDED.bank_account,
  account_title=EXCLUDED.account_title, email=EXCLUDED.email,
  updated_at=NOW()
RETURNING id, name, salary, doj
"""

conn = psycopg2.connect(DB)
cur = conn.cursor()
inserted = 0
errors = []

print(f'Inserting {len(employees)} employees into Neon DB...')
print()

for e in employees:
    vals = (
        e['id'], e['bu'], e['active'], e['client'], e['client_bu'],
        e['dept'], e['designation'], e['location'], e['province'], e['name'],
        e['cnic'], e['doj'], e['salary'], e['bank_name'], e['bank_account'],
        e['account_title'], e['email']
    )
    try:
        cur.execute(SQL, vals)
        r = cur.fetchone()
        sal = int(r[2]) if r[2] else 0
        print(f'  OK  {str(r[0]):<24} | {str(r[1]):<30} | PKR {sal:>10,} | DOJ: {r[3]}')
        inserted += 1
    except Exception as ex:
        conn.rollback()
        print(f'  ERR {e["id"]} -> {ex}')
        errors.append({'id': e['id'], 'error': str(ex)})
        # Reconnect after rollback
        conn = psycopg2.connect(DB)
        cur = conn.cursor()

conn.commit()

print()
print('=' * 60)
print(f'Inserted/Updated : {inserted}')
if errors:
    print(f'Errors           : {len(errors)}')
    for err in errors:
        print(f'  - {err["id"]}: {err["error"]}')

# Verification totals
cur.execute("""
    SELECT COUNT(*), COALESCE(SUM(salary), 0)
    FROM employees
    WHERE client ILIKE '%wafi%' AND active = 'Yes'
""")
count, total_sal = cur.fetchone()
print()
print(f'Wafi Active Employees in HCM : {count}')
print(f'Wafi Total Salary Roll        : PKR {int(total_sal):,}')

cur.close()
conn.close()
