"""
Final definitive comparison:
CSV col AJ = Net Pay for the Month  → compare to HCM pt.net
CSV col AT = Total Payroll Cost     → compare to HCM (pt.gross + employer costs from contract)
The gap exists because CSV 'Gross Monthly Salary' includes employer costs for FM staff.
This script compares the RIGHT columns.
"""
import psycopg2, csv, sys
sys.stdout.reconfigure(encoding='utf-8')

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
CSV_PATH = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\BPO FM Payroll & Invoice File - PR.csv'
SKIP = {'ASIL/SPL-360/21','ASIL/SPL-388/21','ASIL/SPL-46/21','ASILFM/SPL/22/125'}

def pn(v):
    try: return float(str(v or '0').replace(',','').strip())
    except: return 0.0

# Load CSV
master = {}
with open(CSV_PATH, 'r', encoding='utf-8-sig', errors='replace') as f:
    for row in csv.DictReader(f):
        if row.get('Active','').strip().lower() != 'yes': continue
        code = row.get('ASIL Employee Code','').strip()
        if not code or code in SKIP: continue
        master[code] = {
            'name':      row.get('Employee Name','').strip(),
            'client':    row.get('Client','').strip(),
            'bu':        row.get('Client BU','').strip(),
            'net':       pn(row.get('Net Pay for the Month',0)),
            'total_cost':pn(row.get('Total Payroll Cost',0)),
            'svc_chg':   pn(row.get('Service Charges',0)),
            'sales_tax': pn(row.get('Sales Tax',0)),
            'total_inv': pn(row.get('Total Cost',0)),
        }

# Load HCM
conn = psycopg2.connect(DB)
cur = conn.cursor()
cur.execute("""
    SELECT e.id, e.client,
           pt.net, pt.service_charges, pt.sales_tax, pt.total_invoice
    FROM payroll_transactions pt
    JOIN employees e ON e.id = pt.employee_id
    WHERE pt.month=4 AND pt.year=2026
""")
hcm = {}
for r in cur.fetchall():
    if r[0] in SKIP: continue
    hcm[r[0]] = {
        'client': r[1] or '',
        'net':    float(r[2] or 0),
        'svc':    float(r[3] or 0),
        'stax':   float(r[4] or 0),
        'tinv':   float(r[5] or 0),
    }
cur.close(); conn.close()

common = set(master.keys()) & set(hcm.keys())

# ── Net Pay comparison ──────────────────────────────────────────────────────
csv_net   = sum(master[c]['net']       for c in common)
hcm_net   = sum(hcm[c]['net']         for c in common)
csv_cost  = sum(master[c]['total_cost'] for c in common)
csv_svc   = sum(master[c]['svc_chg']   for c in common)
csv_stax  = sum(master[c]['sales_tax'] for c in common)
csv_inv   = sum(master[c]['total_inv'] for c in common)
hcm_svc   = sum(hcm[c]['svc']         for c in common)
hcm_stax  = sum(hcm[c]['stax']        for c in common)
hcm_tinv  = sum(hcm[c]['tinv']        for c in common)

print('=' * 80)
print('  APRIL 2026 FINAL PAYROLL TALLY (excl. 4 exited employees)')
print('=' * 80)
print(f'  {"Metric":<35} {"CSV":>15} {"HCM":>15} {"Diff":>10}')
print(f'  {"─"*35} {"─"*15} {"─"*15} {"─"*10}')
print(f'  {"Net Pay to Employees":<35} {csv_net:>15,.0f} {hcm_net:>15,.0f} {hcm_net-csv_net:>+10,.0f}')
print(f'  {"Service Charges":<35} {csv_svc:>15,.0f} {hcm_svc:>15,.0f} {hcm_svc-csv_svc:>+10,.0f}')
print(f'  {"Sales Tax":<35} {csv_stax:>15,.0f} {hcm_stax:>15,.0f} {hcm_stax-csv_stax:>+10,.0f}')
print(f'  {"Total Invoice to Client":<35} {csv_inv:>15,.0f} {hcm_tinv:>15,.0f} {hcm_tinv-csv_inv:>+10,.0f}')
print()

# Per-employee net diff > Rs 500
print(f'  Employees with Net Pay diff > Rs.500:')
print(f'  {"Code":<24} {"Name":<28} {"CSV Net":>10} {"HCM Net":>10} {"Diff":>8}')
print('  ' + '─' * 85)
big_diffs = []
for code in sorted(common):
    diff = round(hcm[code]['net'] - master[code]['net'])
    if abs(diff) > 500:
        big_diffs.append((code, master[code]['name'], master[code]['net'], hcm[code]['net'], diff))
big_diffs.sort(key=lambda x: abs(x[4]), reverse=True)
for code, name, csv_n, hcm_n, diff in big_diffs[:40]:
    print(f'  {code:<24} {name:<28} {csv_n:>10,.0f} {hcm_n:>10,.0f} {diff:>+8,.0f}')
if len(big_diffs) > 40:
    print(f'  ... and {len(big_diffs)-40} more ...')
print()
print(f'  Total employees with diff > Rs.500: {len(big_diffs)}')
print('=' * 80)
