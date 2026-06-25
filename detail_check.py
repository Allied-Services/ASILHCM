"""
Detailed breakdown for top mismatch employees:
Compare every earning column between CSV and HCM pt.*
"""
import psycopg2, csv, sys
sys.stdout.reconfigure(encoding='utf-8')

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
CSV_PATH = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\BPO FM Payroll & Invoice File - PR.csv'

# Top mismatches to inspect (mix of + and - diffs)
TARGETS = [
    'ASIL/SPL-34/21',    # Imran Samad        -134,803
    'ASIL/SPL-325/21',   # Waqar Ahmed        -103,587
    'ASIL/SPL-349/21',   # Waqas Ahmed        +99,508
    'ASIL/SPL-97/21',    # Muhammad Faisal    +95,626
    'ASIL/SPL-122/21',   # Imran Khan         -71,557
    'ASILFM/SPL/22/19',  # Kifayat Ullah (FM) -49,414
    'ASIL/SPL-255/21',   # Munawar Hussain    -48,956
]

def pn(v):
    try: return float(str(v or '0').replace(',','').strip())
    except: return 0.0

# Load CSV for targets
csv_data = {}
with open(CSV_PATH, 'r', encoding='utf-8-sig', errors='replace') as f:
    for row in csv.DictReader(f):
        code = row.get('ASIL Employee Code','').strip()
        if code not in TARGETS: continue
        csv_data[code] = {
            'name':     row.get('Employee Name','').strip(),
            'new_sal':  pn(row.get('New Salary',0)),
            'pd':       pn(row.get('Paid Days',0)),
            'wd':       pn(row.get('Working Days',0)),
            'sal_days': pn(row.get('Salary for Days Worked',0)),
            'ot2':      pn(row.get('OT Hrs @ 2X',0)),
            'ot3':      pn(row.get('OT Hrs @ 3X',0)),
            'ot_amt':   pn(row.get('Overtime Amount',0)),
            'opd':      pn(row.get('OPD Claim',0)),
            'reimb':    pn(row.get('Expense Reimbursement',0)),
            'arrears':  pn(row.get('Arrears',0)),
            'spl':      pn(row.get('Special Allowance',0)),
            'fuel':     pn(row.get('Other Allowance Fuel | Mobile',0)),
            'other_d':  pn(row.get('Other Deduction',0)),
            'gross':    pn(row.get('Gross Monthly Salary',0)),
            'tax':      pn(row.get('Income Tax',0)),
            'net':      pn(row.get('Net Pay for the Month',0)),
        }

# Load HCM for targets
conn = psycopg2.connect(DB)
cur = conn.cursor()
cur.execute("""
    SELECT e.id, e.name, e.salary,
           pt.paid_days, pt.ot2_hrs, pt.ot3_hrs, pt.ot,
           pt.opd_claim, pt.reimbursement, pt.arrears,
           pt.special_allowance, pt.fuel_mobile, pt.other_deduction,
           pt.bonus_amount, pt.gross, pt.wht, pt.net, pt.locked
    FROM payroll_transactions pt
    JOIN employees e ON e.id = pt.employee_id
    WHERE pt.month=4 AND pt.year=2026
      AND e.id = ANY(%s)
""", (TARGETS,))
hcm_data = {}
for r in cur.fetchall():
    hcm_data[r[0]] = {
        'name': r[1], 'salary': float(r[2] or 0),
        'pd': float(r[3] or 0), 'ot2': float(r[4] or 0), 'ot3': float(r[5] or 0),
        'ot_amt': float(r[6] or 0),
        'opd': float(r[7] or 0), 'reimb': float(r[8] or 0), 'arrears': float(r[9] or 0),
        'spl': float(r[10] or 0), 'fuel': float(r[11] or 0), 'other_d': float(r[12] or 0),
        'bonus': float(r[13] or 0),
        'gross': float(r[14] or 0), 'tax': float(r[15] or 0), 'net': float(r[16] or 0),
        'locked': r[17],
    }
cur.close(); conn.close()

# Print comparison
for code in TARGETS:
    c = csv_data.get(code, {})
    h = hcm_data.get(code, {})
    if not c or not h:
        print(f'{code}: NOT FOUND in {"CSV" if not c else "HCM"}')
        continue

    print(f'\n{"═"*80}')
    print(f'  {code}  {c["name"]}  (locked={h["locked"]})')
    print(f'{"═"*80}')
    print(f'  {"Field":<22} {"CSV":>14} {"HCM":>14} {"Diff":>10}')
    print(f'  {"─"*22} {"─"*14} {"─"*14} {"─"*10}')
    fields = [
        ('Salary',          c['new_sal'],   h['salary']),
        ('Paid Days',       c['pd'],        h['pd']),
        ('Salary for Days', c['sal_days'],  round(h['salary'] * h['pd'] / (c['wd'] or 26))),
        ('OT @2X hrs',      c['ot2'],       h['ot2']),
        ('OT @3X hrs',      c['ot3'],       h['ot3']),
        ('OT Amount',       c['ot_amt'],    h['ot_amt']),
        ('OPD',             c['opd'],       h['opd']),
        ('Reimbursement',   c['reimb'],     h['reimb']),
        ('Arrears',         c['arrears'],   h['arrears']),
        ('Special Allow.',  c['spl'],       h['spl']),
        ('Fuel/Mobile',     c['fuel'],      h['fuel']),
        ('Other Deduction', c['other_d'],   h['other_d']),
        ('Bonus (HCM col)', 0,              h['bonus']),
        ('GROSS',           c['gross'],     h['gross']),
        ('Tax',             c['tax'],       h['tax']),
        ('NET PAY',         c['net'],       h['net']),
    ]
    for label, cv, hv in fields:
        diff = round(hv - cv)
        flag = ' <<<' if abs(diff) > 100 and label != 'Paid Days' and label != 'Salary for Days' else ''
        print(f'  {label:<22} {cv:>14,.1f} {hv:>14,.1f} {diff:>+10,.0f}{flag}')
