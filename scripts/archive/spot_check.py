import psycopg2, sys
sys.stdout.reconfigure(encoding='utf-8')
DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
conn = psycopg2.connect(DB)
cur = conn.cursor()

# Get payroll_transactions columns
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='payroll_transactions' ORDER BY ordinal_position")
pt_cols = [r[0] for r in cur.fetchall()]
print('payroll_transactions columns:')
print(', '.join(pt_cols))
print()

# Spot check 3 FM employees: salary in employees vs what payroll computed
cur.execute("""
    SELECT e.id, e.name, e.salary, e.contract_name,
           pt.paid_days, pt.ot2_hrs, pt.gross, pt.net
    FROM employees e
    JOIN payroll_transactions pt ON pt.employee_id = e.id AND pt.month=4 AND pt.year=2026
    WHERE e.id IN ('ASILFM/SPL/22/3','ASILFM/SPL/22/1','ASILFM/SPL/22/21','ASILFM/SPL/22/161')
    ORDER BY e.id
""")
print('FM Employee spot check (salary = what HCM engine uses as base):')
print(f'{"ID":<22} {"Name":<22} {"e.salary":>10} {"pd":>4} {"ot2":>5} {"pt.gross":>10} {"pt.net":>10}')
for r in cur.fetchall():
    print(f'{r[0]:<22} {r[1]:<22} {float(r[2] or 0):>10,.0f} {float(r[4] or 0):>4.0f} {float(r[5] or 0):>5.1f} {float(r[6] or 0):>10,.0f} {float(r[7] or 0):>10,.0f}')

print()
# Now check what CSV says for those same employees
import csv
CSV_PATH = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\BPO FM Payroll & Invoice File - PR.csv'
target = {'ASILFM/SPL/22/3','ASILFM/SPL/22/1','ASILFM/SPL/22/21','ASILFM/SPL/22/161'}
with open(CSV_PATH, 'r', encoding='utf-8-sig', errors='replace') as f:
    reader = csv.DictReader(f)
    print('CSV values for same employees:')
    print(f'{"Code":<22} {"Name":<22} {"NewSalary":>10} {"Gross":>12} {"Net":>12}')
    for row in reader:
        code = row.get('ASIL Employee Code','').strip()
        if code in target:
            ns  = row.get('New Salary','0').replace(',','').strip()
            grs = row.get('Gross Monthly Salary','0').replace(',','').strip()
            net = row.get('Net Pay for the Month','0').replace(',','').strip()
            print(f'{code:<22} {row.get("Employee Name","").strip():<22} {float(ns or 0):>10,.0f} {float(grs or 0):>12,.0f} {float(net or 0):>12,.0f}')

cur.close(); conn.close()
