"""
Deep comparison: April 2026
- Master CSV (source of truth): Net Pay, Gross, OT, etc.
- Import template: what was submitted to HCM
- HCM DB: what was actually computed

Goal: find exactly WHERE the numbers diverge.
"""
import psycopg2, csv, sys
sys.stdout.reconfigure(encoding='utf-8')

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
MASTER_CSV = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\BPO FM Payroll & Invoice File - PR.csv'
IMPORT_CSV = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\payroll_import_template April 2026.csv'

SKIP_CODES = {'ASIL/SPL-360/21','ASIL/SPL-388/21','ASIL/SPL-46/21','ASILFM/SPL/22/125'}

def pn(v):
    try: return float(str(v or '0').replace(',','').strip())
    except: return 0.0

# ── Load master CSV ──────────────────────────────────────────────────────────
master = {}
with open(MASTER_CSV, 'r', encoding='utf-8-sig', errors='replace') as f:
    for row in csv.DictReader(f):
        if row.get('Active','').strip().lower() != 'yes': continue
        code = row.get('ASIL Employee Code','').strip()
        if not code: continue
        master[code] = {
            'name':       row.get('Employee Name','').strip(),
            'client':     row.get('Client','').strip(),
            'bu':         row.get('Client BU','').strip(),
            'salary':     pn(row.get('New Salary',0)),
            'pd':         pn(row.get('Paid Days',0)),
            'ot2':        pn(row.get('OT Hrs @ 2X',0)),
            'ot3':        pn(row.get('OT Hrs @ 3X',0)),
            'ot_amt':     pn(row.get('Overtime Amount',0)),
            'opd':        pn(row.get('OPD Claim',0)),
            'reimb':      pn(row.get('Expense Reimbursement',0)),
            'arrears':    pn(row.get('Arrears',0)),
            'spl':        pn(row.get('Special Allowance',0)),
            'fuel':       pn(row.get('Other Allowance Fuel | Mobile',0)),
            'other_ded':  pn(row.get('Other Deduction',0)),
            'gross':      pn(row.get('Gross Monthly Salary',0)),
            'tax':        pn(row.get('Income Tax',0)),
            'net':        pn(row.get('Net Pay for the Month',0)),
            'total_cost': pn(row.get('Total Payroll Cost',0)),
            'svc_chg':    pn(row.get('Service Charges',0)),
            'sales_tax':  pn(row.get('Sales Tax',0)),
            'total_inv':  pn(row.get('Total Cost',0)),
        }

# ── Load import template ─────────────────────────────────────────────────────
imp = {}
with open(IMPORT_CSV, 'r', encoding='utf-8-sig', errors='replace') as f:
    for row in csv.DictReader(f):
        code = row.get('ASIL Employee Code','').strip() or row.get('Staff Code','').strip()
        if not code: continue
        imp[code] = {
            'pd':        pn(row.get('Present Days',0)),
            'ot2':       pn(row.get('OT Hrs @ 2X',0)),
            'ot3':       pn(row.get('OT Hrs @ 3X',0)),
            'opd':       pn(row.get('OPD',0)),
            'reimb':     pn(row.get('Expense Reimbursement',0)),
            'arrears':   pn(row.get('Arrears',0)),
            'spl':       pn(row.get('Special Allowance',0)),
            'fuel':      pn(row.get('Other Allowance Fuel | Mobile',0)),
            'other_ded': pn(row.get('Other Deduction',0)),
        }

# ── Load HCM DB ──────────────────────────────────────────────────────────────
conn = psycopg2.connect(DB)
cur = conn.cursor()
cur.execute('''
    SELECT e.id, e.salary, e.client,
           pt.paid_days, pt.ot2_hrs, pt.ot3_hrs, pt.opd_claim,
           pt.reimbursement, pt.arrears, pt.special_allowance,
           pt.fuel_mobile, pt.other_deduction,
           pt.gross, pt.net, pt.locked
    FROM payroll_transactions pt
    JOIN employees e ON e.id = pt.employee_id
    WHERE pt.month = 4 AND pt.year = 2026
''')
hcm = {}
for r in cur.fetchall():
    hcm[r[0]] = {
        'salary':     float(r[1] or 0),
        'client':     r[2] or '',
        'pd':         float(r[3] or 0),
        'ot2':        float(r[4] or 0),
        'ot3':        float(r[5] or 0),
        'opd':        float(r[6] or 0),
        'reimb':      float(r[7] or 0),
        'arrears':    float(r[8] or 0),
        'spl':        float(r[9] or 0),
        'fuel':       float(r[10] or 0),
        'other_ded':  float(r[11] or 0),
        'gross':      float(r[12] or 0),
        'net':        float(r[13] or 0),
        'locked':     r[14],
    }
cur.close(); conn.close()

# ── Per-employee comparison ──────────────────────────────────────────────────
print('=' * 130)
print(f'APRIL 2026 DEEP AUDIT: CSV vs IMPORT TEMPLATE vs HCM DB')
print('=' * 130)

THRESH = 50  # flag if diff > Rs 50
net_diffs = []
gross_diffs = []
input_diffs = []  # cases where import != CSV

for code, m in sorted(master.items()):
    if code in SKIP_CODES: continue
    h = hcm.get(code)
    i = imp.get(code)
    if not h: continue  # not in HCM payroll this month

    # Check import vs master CSV (input fields)
    inp_issues = []
    if i:
        for field in ['ot2','ot3','opd','reimb','arrears','spl','fuel','other_ded']:
            csv_val = m[field]
            imp_val = i[field]
            if abs(csv_val - imp_val) > 1:
                inp_issues.append(f'{field}: CSV={csv_val:.0f} IMP={imp_val:.0f}')

    # Net and gross diff
    net_diff   = round(h['net']   - m['net'])
    gross_diff = round(h['gross'] - m['gross'])

    if inp_issues:
        input_diffs.append((code, m['name'], inp_issues))

    if abs(net_diff) > THRESH or abs(gross_diff) > THRESH:
        net_diffs.append((code, m['name'], m['client'][:30], m['net'], h['net'], net_diff, m['gross'], h['gross'], gross_diff, inp_issues))

# ── Report: Import mismatches ────────────────────────────────────────────────
print(f'\n[A] IMPORT TEMPLATE DIFFERS FROM MASTER CSV ({len(input_diffs)} employees)')
print(f'    These are cases where wrong values were uploaded to HCM:')
print('-' * 110)
if input_diffs:
    for code, name, issues in input_diffs[:30]:
        print(f'  {code:<24} {name:<30}  Issues: {"; ".join(issues)}')
else:
    print('  None — import template matches master CSV perfectly.')

# ── Report: Net pay differences ──────────────────────────────────────────────
print(f'\n[B] NET PAY MISMATCHES >Rs.{THRESH} ({len(net_diffs)} employees)')
print(f'    {"Code":<24} {"Name":<28} {"Client":<22} {"CSV_Net":>10} {"HCM_Net":>10} {"Diff":>8} {"CSV_Gross":>10} {"HCM_Gross":>10} {"GDiff":>8}')
print('  ' + '-' * 130)
total_csv_net = total_hcm_net = 0
for r in net_diffs:
    code,name,client,csv_net,hcm_net,net_diff,csv_gross,hcm_gross,gross_diff,_ = r
    total_csv_net += csv_net
    total_hcm_net += hcm_net
    flag = ' <<<' if abs(net_diff) > 5000 else ''
    print(f'  {code:<24} {name:<28} {client:<22} {csv_net:>10,.0f} {hcm_net:>10,.0f} {net_diff:>+8,.0f} {csv_gross:>10,.0f} {hcm_gross:>10,.0f} {gross_diff:>+8,.0f}{flag}')

print(f'\n  SUBTOTAL of mismatched rows:')
print(f'    CSV Net  = {total_csv_net:>12,.0f}')
print(f'    HCM Net  = {total_hcm_net:>12,.0f}')
print(f'    Diff     = {total_hcm_net-total_csv_net:>+12,.0f}')

# ── Grand totals ─────────────────────────────────────────────────────────────
active_codes = set(master.keys()) - SKIP_CODES
csv_total_net   = sum(master[c]['net']   for c in active_codes if c in hcm)
hcm_total_net   = sum(hcm[c]['net']     for c in active_codes if c in hcm)
csv_total_gross = sum(master[c]['gross'] for c in active_codes if c in hcm)
hcm_total_gross = sum(hcm[c]['gross']   for c in active_codes if c in hcm)
csv_total_inv   = sum(master[c]['total_inv'] for c in active_codes if c in hcm)

print(f'\n[C] GRAND TOTALS (excluding {len(SKIP_CODES)} skipped employees, matched codes only)')
print(f'    {"Metric":<25} {"CSV":>15} {"HCM":>15} {"Diff":>12}')
print(f'    {"─"*25} {"─"*15} {"─"*15} {"─"*12}')
print(f'    {"Gross Pay":<25} {csv_total_gross:>15,.0f} {hcm_total_gross:>15,.0f} {hcm_total_gross-csv_total_gross:>+12,.0f}')
print(f'    {"Net Pay":<25} {csv_total_net:>15,.0f} {hcm_total_net:>15,.0f} {hcm_total_net-csv_total_net:>+12,.0f}')
print(f'    {"Total Invoice (CSV)":<25} {csv_total_inv:>15,.0f} {"N/A":>15} {"":>12}')
print('=' * 130)
