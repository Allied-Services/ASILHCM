import psycopg2, csv, sys
sys.stdout.reconfigure(encoding='utf-8')

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
CSV_PATH = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\BPO FM Payroll & Invoice File - PR.csv'

def pn(v):
    return float(str(v or '0').replace(',','').strip()) if v else 0.0

conn = psycopg2.connect(DB)
cur = conn.cursor()

# ── Read CSV into dict keyed by Employee Code ───────────────────────────────
csv_emp = {}
with open(CSV_PATH, 'r', encoding='utf-8-sig', errors='replace') as f:
    for row in csv.DictReader(f):
        if row.get('Active','').strip().lower() != 'yes':
            continue
        code = row.get('ASIL Employee Code','').strip()
        if not code:
            continue
        csv_emp[code] = {
            'name':         row.get('Employee Name','').strip(),
            'client':       row.get('Client','').strip(),
            'bu':           row.get('Client BU','').strip(),
            'new_salary':   pn(row.get('New Salary',0)),
            'gross':        pn(row.get('Gross Monthly Salary',0)),
            'net':          pn(row.get('Net Pay for the Month',0)),
            'total_cost':   pn(row.get('Total Payroll Cost',0)),
        }

# ── HCM April 2026 payroll rows ─────────────────────────────────────────────
cur.execute('''
    SELECT e.id, e.name, e.client, e.salary, pt.gross, pt.net
    FROM payroll_transactions pt
    JOIN employees e ON e.id = pt.employee_id
    WHERE pt.month = 4 AND pt.year = 2026
    ORDER BY e.client, e.name
''')
hcm_rows = {r[0]: {'name':r[1],'client':r[2],'salary':float(r[3] or 0),'gross':float(r[4] or 0),'net':float(r[5] or 0)} for r in cur.fetchall()}

# ── Summary totals ───────────────────────────────────────────────────────────
csv_all_emps  = len(csv_emp)
csv_all_net   = sum(v['net']   for v in csv_emp.values())
csv_all_gross = sum(v['gross'] for v in csv_emp.values())
hcm_all_emps  = len(hcm_rows)
hcm_all_net   = sum(v['net']   for v in hcm_rows.values())
hcm_all_gross = sum(v['gross'] for v in hcm_rows.values())

csv_wafi = {k:v for k,v in csv_emp.items() if 'wafi' in v['client'].lower()}
hcm_wafi = {k:v for k,v in hcm_rows.items() if 'wafi' in (v['client'] or '').lower()}


print('╔══════════════════════════════════════════════════════════════════╗')
print('║         APRIL 2026 PAYROLL AUDIT: HCM vs CSV MASTER             ║')
print('╠══════════════════════════════════════════════════════════════════╣')
print(f'  {"":30} {"CSV":>15} {"HCM":>15} {"DIFF":>12}')
print(f'  {"ALL CLIENTS":30} {"---":>15} {"---":>15} {"---":>12}')
print(f'  {"Employee Count":30} {csv_all_emps:>15,} {hcm_all_emps:>15,} {hcm_all_emps-csv_all_emps:>+12,}')
print(f'  {"Total Gross Pay":30} {csv_all_gross:>15,.0f} {hcm_all_gross:>15,.0f} {hcm_all_gross-csv_all_gross:>+12,.0f}')
print(f'  {"Total Net Pay":30} {csv_all_net:>15,.0f} {hcm_all_net:>15,.0f} {hcm_all_net-csv_all_net:>+12,.0f}')
print()
print(f'  {"WAFI ONLY":30} {"---":>15} {"---":>15} {"---":>12}')
print(f'  {"Employee Count":30} {len(csv_wafi):>15,} {len(hcm_wafi):>15,} {len(hcm_wafi)-len(csv_wafi):>+12,}')
print(f'  {"Total Gross Pay":30} {sum(v["gross"] for v in csv_wafi.values()):>15,.0f} {sum(v["gross"] for v in hcm_wafi.values()):>15,.0f} {sum(v["gross"] for v in hcm_wafi.values())-sum(v["gross"] for v in csv_wafi.values()):>+12,.0f}')
print(f'  {"Total Net Pay":30} {sum(v["net"] for v in csv_wafi.values()):>15,.0f} {sum(v["net"] for v in hcm_wafi.values()):>15,.0f} {sum(v["net"] for v in hcm_wafi.values())-sum(v["net"] for v in csv_wafi.values()):>+12,.0f}')

# ── Per-employee mismatches (Wafi) ───────────────────────────────────────────
mismatches = []
only_in_csv = []
only_in_hcm = []

all_codes = set(list(csv_wafi.keys()) + list(hcm_wafi.keys()))
for code in sorted(all_codes):
    c = csv_wafi.get(code)
    h = hcm_wafi.get(code)
    if c and h:
        net_diff  = round(h['net']   - c['net'])
        gross_diff = round(h['gross'] - c['gross'])
        if abs(net_diff) > 100 or abs(gross_diff) > 100:
            mismatches.append((code, c['name'], c['net'], h['net'], net_diff, c['gross'], h['gross'], gross_diff))
    elif c and not h:
        only_in_csv.append((code, c['name'], c['net']))
    elif h and not c:
        only_in_hcm.append((code, h['name'], h['net']))

print()
print(f'╠══ WAFI PER-EMPLOYEE MISMATCHES (Net diff > Rs. 100) ══════════════╣')
if mismatches:
    print(f'  {"Code":<24} {"Name":<28} {"CSV Net":>12} {"HCM Net":>12} {"Diff":>10} {"CSV Gross":>12} {"HCM Gross":>12} {"GDiff":>10}')
    print('  ' + '-'*120)
    for m in mismatches:
        print(f'  {m[0]:<24} {m[1]:<28} {m[2]:>12,.0f} {m[3]:>12,.0f} {m[4]:>+10,} {m[5]:>12,.0f} {m[6]:>12,.0f} {m[7]:>+10,}')
else:
    print('  No significant per-employee mismatches found.')

print()
print(f'╠══ IN CSV BUT NOT IN HCM APRIL PAYROLL ({len(only_in_csv)}) ════════════════╣')
for code, name, net in only_in_csv[:20]:
    print(f'  {code:<24} {name:<28} Net: {net:>10,.0f}')

print()
print(f'╠══ IN HCM BUT NOT IN CSV ({len(only_in_hcm)}) ═════════════════════════════╣')
for code, name, net in only_in_hcm[:20]:
    print(f'  {code:<24} {name:<28} Net: {net:>10,.0f}')

print('╚══════════════════════════════════════════════════════════════════╝')

cur.close(); conn.close()
