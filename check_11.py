"""
Check the 11 remaining mismatched employees — look at all CSV columns for deduction clues.
"""
import psycopg2, csv, sys
sys.stdout.reconfigure(encoding='utf-8')

DB = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
CSV_PATH = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\BPO FM Payroll & Invoice File - PR.csv'

TARGETS = [
    'ASIL/SPL-360/21',  # Mehrim Zahoor (+10,220 in HCM vs CSV)
    'ASIL/SPL-392/21','ASIL/SPL-393/21','ASIL/SPL-394/21',
    'ASIL/SPL-400/21','ASIL/SPL-406/21','ASIL/SPL-403/21',
    'ASIL/SPL-399/21','ASIL/SPL-404/21','ASIL/SPL-397/21',
    'ASILFM/SPL/22/161','ASIL/SPL-391/21',
]

def pn(v):
    try: return float(str(v or '0').replace(',','').strip())
    except: return 0.0

conn = psycopg2.connect(DB)
cur = conn.cursor()
cur.execute("""
    SELECT e.id, e.name, pt.ot2_hrs, pt.ot3_hrs, pt.ot,
           pt.opd_claim, pt.reimbursement, pt.arrears, pt.special_allowance,
           pt.bonus_amount, pt.other_deduction, pt.gross, pt.net, pt.wht
    FROM payroll_transactions pt
    JOIN employees e ON e.id = pt.employee_id
    WHERE pt.month=4 AND pt.year=2026 AND e.id = ANY(%s)
""", (TARGETS,))
hcm = {r[0]: r for r in cur.fetchall()}
cur.close(); conn.close()

csv_data = {}
with open(CSV_PATH, 'r', encoding='utf-8-sig', errors='replace') as f:
    for row in csv.DictReader(f):
        code = row.get('ASIL Employee Code','').strip()
        if code not in TARGETS: continue
        csv_data[code] = {
            'name': row.get('Employee Name',''),
            'net': pn(row.get('Net Pay for the Month',0)),
            'gross': pn(row.get('Gross Monthly Salary',0)),
            'ot_amt': pn(row.get('Overtime Amount',0)),
            'spl': pn(row.get('Special Allowance',0)),
            'advance': pn(row.get('Advance Deduction',0)),
            'loan': pn(row.get('Loan Deduction',0)),
            'other_d': pn(row.get('Other Deduction',0)),
            'tax': pn(row.get('Income Tax',0)),
            'client': row.get('Client',''),
            'pd': pn(row.get('Paid Days',0)),
        }

print(f'{"Code":<24} {"Name":<25} {"CSV_Net":>10} {"HCM_Net":>10} {"Diff":>8} | {"CSV_Adv":>8} {"CSV_Loan":>9} {"CSV_OthD":>9} {"CSV_Tax":>8} {"HCM_Tax":>8}')
print('─' * 130)
for code in TARGETS:
    c = csv_data.get(code, {})
    h = hcm.get(code)
    if not c:
        print(f'{code:<24} NOT IN CSV (client filter mismatch?)')
        continue
    hnet = float(h[12] or 0) if h else 0
    htax = float(h[13] or 0) if h else 0
    diff = round(hnet - c['net'])
    print(f'{code:<24} {c["name"][:25]:<25} {c["net"]:>10,.0f} {hnet:>10,.0f} {diff:>+8,.0f} | {c["advance"]:>8,.0f} {c["loan"]:>9,.0f} {c["other_d"]:>9,.0f} {c["tax"]:>8,.0f} {htax:>8,.0f}  client={c["client"]!r}')
