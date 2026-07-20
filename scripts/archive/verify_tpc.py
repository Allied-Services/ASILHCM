"""
Verify the TPC formula in the CSV to ensure HCM service charges match.
"""
import csv, sys
sys.stdout.reconfigure(encoding='utf-8')

def pn(v):
    try: return float(str(v or '0').replace(',','').strip() or 0)
    except: return 0.0

CSV_PATH = r'G:\My Drive\Experiments\BPOFMSystem\frontend\public\BPO FM Payroll & Invoice File - PR.csv'
with open(CSV_PATH, encoding='utf-8-sig', errors='replace') as f:
    rows = list(csv.DictReader(f))

print(f"{'Code':<24} {'Gross':>10} {'EOBIer':>7} {'Bonus':>9} {'Grat':>9} {'Life':>6} {'Med':>7} {'SESSI':>6} {'PF_ded':>7} {'TPC_CSV':>10} {'SVC_CSV':>9} {'Svc%':>5}  {'BU'}")
print('-' * 130)

total_csv_tpc = 0; total_csv_svc = 0; total_csv_stax = 0; total_csv_inv = 0
mismatches = 0

for r in rows:
    code = r.get('ASIL Employee Code','').strip()
    if not code: continue
    gross = pn(r.get('Gross Monthly Salary'))
    eobi_er = pn(r.get('EOBI\n(Employer)'))
    bonus   = pn(r.get('Bonus Amount'))
    grat    = pn(r.get('Gratuity'))
    life    = pn(r.get('Life Insurance  Employee Only'))
    med     = pn(r.get('Total Medical Coverage (Self & Family)'))
    sessi   = pn(r.get('SESSI'))
    pf_ded  = pn(r.get('PF (Deduction)'))
    tpc_csv = pn(r.get('Total Payroll Cost'))
    svc_csv = pn(r.get('Service Charges'))
    stax    = pn(r.get('Sales Tax'))
    inv     = pn(r.get('Total Cost'))
    bu      = r.get('Client BU','')

    total_csv_tpc  += tpc_csv
    total_csv_svc  += svc_csv
    total_csv_stax += stax
    total_csv_inv  += inv

    # Reconstruct TPC from components
    my_tpc = gross + eobi_er + bonus + grat + life + med + sessi
    diff = round(my_tpc - tpc_csv)
    svc_pct = round(svc_csv / tpc_csv * 100, 2) if tpc_csv else 0

    if abs(diff) > 50 or len(rows) < 20:
        mismatches += 1
        print(f'{code:<24} {gross:>10,.0f} {eobi_er:>7,.0f} {bonus:>9,.0f} {grat:>9,.0f} {life:>6,.0f} {med:>7,.0f} {sessi:>6,.0f} {pf_ded:>7,.0f} {tpc_csv:>10,.0f} {svc_csv:>9,.0f} {svc_pct:>4.1f}%  {bu}')
        if abs(diff) > 50:
            print(f'  myTPC={my_tpc:,.0f} vs CSV={tpc_csv:,.0f}  diff={diff:+,.0f}')

# Totals
print()
print('='*80)
print(f'Total TPC (CSV)     : PKR {total_csv_tpc:>14,.0f}')
print(f'Total Svc (CSV)     : PKR {total_csv_svc:>14,.0f}  rate={total_csv_svc/total_csv_tpc*100:.2f}%')
print(f'Total STax (CSV)    : PKR {total_csv_stax:>14,.0f}')
print(f'Total Invoice (CSV) : PKR {total_csv_inv:>14,.0f}')
print(f'Rows with TPC diff  : {mismatches}')
