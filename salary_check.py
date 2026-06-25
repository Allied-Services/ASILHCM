"""
Check if the HCM e.salary matches CSV 'New Salary' for the largest mismatches.
Root cause: if salary not updated in DB, all calculations will be off.
"""
import psycopg2, csv, sys
sys.stdout.reconfigure(encoding='utf-8')

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
CSV_PATH = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\BPO FM Payroll & Invoice File - PR.csv'
EXCLUDE = {'ASIL/SPL-388/21','ASIL/SPL-46/21','ASILFM/SPL/22/125'}

def pn(v):
    try: return float(str(v or '0').replace(',','').strip())
    except: return 0.0

# Load CSV
csv_sal = {}
with open(CSV_PATH, 'r', encoding='utf-8-sig', errors='replace') as f:
    for row in csv.DictReader(f):
        if row.get('Active','').strip().lower() != 'yes': continue
        if 'wafi' not in row.get('Client','').lower(): continue
        code = row.get('ASIL Employee Code','').strip()
        if not code: continue
        csv_sal[code] = {
            'name':    row.get('Employee Name','').strip(),
            'new_sal': pn(row.get('New Salary',0)),
            'net':     pn(row.get('Net Pay for the Month',0)),
            'bu':      row.get('Client BU','').strip(),
        }

# Load HCM
conn = psycopg2.connect(DB)
cur = conn.cursor()
cur.execute("""
    SELECT e.id, e.name, e.salary, e.client_bu,
           pt.net, pt.paid_days, pt.ot2_hrs, pt.ot3_hrs,
           pt.opd_claim, pt.reimbursement, pt.special_allowance, pt.bonus_amount
    FROM payroll_transactions pt
    JOIN employees e ON e.id = pt.employee_id
    WHERE pt.month=4 AND pt.year=2026
      AND e.client ILIKE %s
""", ('%wafi%',))
hcm = {}
for r in cur.fetchall():
    if r[0] in EXCLUDE: continue
    hcm[r[0]] = {
        'name': r[1], 'salary': float(r[2] or 0), 'bu': r[3] or '',
        'net': float(r[4] or 0), 'pd': float(r[5] or 0),
        'ot2': float(r[6] or 0), 'ot3': float(r[7] or 0),
        'opd': float(r[8] or 0), 'reimb': float(r[9] or 0),
        'spl': float(r[10] or 0), 'bonus': float(r[11] or 0),
    }
cur.close(); conn.close()

# Compare salary field
common = set(csv_sal.keys()) & set(hcm.keys())
salary_mismatches = []
for code in common:
    c = csv_sal[code]
    h = hcm[code]
    sal_diff = round(h['salary'] - c['new_sal'])
    net_diff  = round(h['net']    - c['net'])
    if abs(sal_diff) > 100 or abs(net_diff) > 500:
        salary_mismatches.append((code, c['name'], c['bu'], c['new_sal'], h['salary'], sal_diff, c['net'], h['net'], net_diff))

salary_mismatches.sort(key=lambda x: abs(x[8]), reverse=True)

print('WAFI: Employees where DB salary ≠ CSV New Salary (or Net Pay diff > Rs.500)')
print(f'{"Code":<24} {"Name":<28} {"BU":<18} {"CSV_Sal":>10} {"HCM_Sal":>10} {"SalDiff":>8} {"CSV_Net":>10} {"HCM_Net":>10} {"NetDiff":>8}')
print('─' * 130)
sal_wrong = 0
for r in salary_mismatches[:50]:
    sal_flag = ' ← SAL WRONG' if abs(r[5]) > 100 else ''
    print(f'{r[0]:<24} {r[1]:<28} {r[2]:<18} {r[3]:>10,.0f} {r[4]:>10,.0f} {r[5]:>+8,.0f} {r[6]:>10,.0f} {r[7]:>10,.0f} {r[8]:>+8,.0f}{sal_flag}')
    if abs(r[5]) > 100: sal_wrong += 1

print()
print(f'Total salary mismatches (>Rs.100): {sal_wrong}')
print(f'Total with net diff >Rs.500      : {len(salary_mismatches)}')

# How much of the net gap is explained by salary mismatches?
total_sal_impact = sum(h['salary'] - csv_sal[code]['new_sal']
                       for code in common
                       if abs(hcm[code]['salary'] - csv_sal[code]['new_sal']) > 100)
print(f'Total salary gap (DB vs CSV)     : PKR {total_sal_impact:>+,.0f}')
print()

# Summary of employees where salary IS correct but net still differs
correct_sal_net_diff = [(code, csv_sal[code]['name'], csv_sal[code]['net'], hcm[code]['net'])
                        for code in common
                        if abs(hcm[code]['salary'] - csv_sal[code]['new_sal']) <= 100
                        and abs(hcm[code]['net'] - csv_sal[code]['net']) > 500]
print(f'Employees: salary OK but net still off ({len(correct_sal_net_diff)}):')
for code, name, csv_net, hcm_net in sorted(correct_sal_net_diff, key=lambda x: abs(x[2]-x[3]), reverse=True)[:20]:
    print(f'  {code:<24} {name:<28} CSV_Net={csv_net:>10,.0f} HCM_Net={hcm_net:>10,.0f} Diff={hcm_net-csv_net:>+,.0f}')
