"""
Verify Abdul Hafeez invoice calculation - why was 273,616 showing and what will it be after fix.
"""
def tpc_to_invoice(tpc, svc_pct=18, stax_pct=16):
    svc = round(tpc * svc_pct / 100)
    stax = round((tpc + svc) * stax_pct / 100)
    return tpc, svc, stax, tpc + svc + stax

grossM   = 142193
eobi_er  = 2000
bonus_accrual = 9194   # = 110325/12
gratuity = 9194
life_ins = 150
medical  = 3718

print("=== ROOT CAUSE ANALYSIS: Why 273,616 was shown ===")
print()
print("BUG: The CSV import mapped 'Bonus' (empty col) instead of 'Bonus Amount'")
print("=> bonus_amount in DB = 0 for ALL imported employees")
print("=> auto-disburse logic fired: full annual bonus added to TPC in April")
print()

# Scenario A: bug state - bonusAmount=0, auto-disburse fires full bonus
full_bonus = 110325   # 1 × grossSalary
# After MY TPC fix (bonusTPC = bonusDisbursed = full_bonus since > 0):
tpc_A = grossM + eobi_er + full_bonus + gratuity + life_ins + medical
t,s,x,total = tpc_to_invoice(tpc_A)
print(f"Scenario A (bug: full bonus disbursed, single TPC term):")
print(f"  TPC = {t:,.0f}  SVC = {s:,.0f}  Tax = {x:,.0f}  TOTAL = {total:,.0f}")

# Scenario B: bug state - bonusAmount=0, OLD double-count code
tpc_B = grossM + eobi_er + full_bonus + bonus_accrual + gratuity + life_ins + medical
t,s,x,total = tpc_to_invoice(tpc_B)
print(f"Scenario B (old code: full bonus + accrual both added):")
print(f"  TPC = {t:,.0f}  SVC = {s:,.0f}  Tax = {x:,.0f}  TOTAL = {total:,.0f}")

# Find what gives 273,616 exactly
# 273,616 = TPC * (1 + 0.18 + 1.18*0.16) = TPC * 1.3688
target = 273616
tpc_reverse = target / 1.3688
print(f"\nReverse-engineered TPC for 273,616 total: {tpc_reverse:,.0f}")
# Find what extra amount on top of correct 166,449 gives 199,900
extra = tpc_reverse - (grossM + eobi_er + bonus_accrual + gratuity + life_ins + medical)
print(f"Extra above correct TPC: {extra:,.0f}  (= {extra/bonus_accrual:.1f} x bonus_accrual)")

print()
print("=== AFTER FIX: bonus_amount = 9,194 from CSV ===")
tpc_fixed = grossM + eobi_er + bonus_accrual + gratuity + life_ins + medical
t,s,x,total = tpc_to_invoice(tpc_fixed)
print(f"  TPC = {t:,.0f}  SVC = {s:,.0f}  Tax = {x:,.0f}  TOTAL = {total:,.0f}  (CSV target: 227,836)")
print(f"  {'MATCH' if abs(total - 227836) < 2 else 'DIFF: ' + str(total - 227836)}")
