# July 2026 WAFI Payroll Gap Report — FINAL

Generated: 2026-08-03T12:11:38.147Z
Scope: **Wafi Energy Pakistan Pvt Ltd** only
Excel source: `audit/july_inputs/july_verify.csv`
Target: 7/2026 net pay ± PKR 1 per employee

## Population

| Metric | Count |
|--------|------:|
| Excel active WAFI rows | 304 |
| HCM employee master (WAFI) | 305 |
| HCM payroll_transactions July 2026 | 305 |
| Net pay matches (±1) | 2 |
| Net pay mismatches | 302 |
| Bonus matches (Excel AB > 0, ±1) | 217 / 217 |
| Bonus mismatches (Excel AB > 0) | 0 |
| Excel-only (not in HCM master) | 0 |
| HCM payroll-only (not in Excel) | 1 |

## Totals

| | Excel | HCM | Delta |
|---|------:|----:|------:|
| Net pay | 43,517,805 | 39,674,483 | 3,843,322 |
| Bonus (Excel AB / HCM bonus_amount) | 17,385,973 | 17,385,973 | 0 |

**Bonus alignment:** 217/217 employees with Excel AB > 0 match within ±1 PKR. Total bonus delta: 0.

## Explained gap summary (net pay)

| Category | Count |
|----------|------:|
| Net mismatches (total) | 302 |
| Bonus OK, base/engine gap | 218 |
| FM staffing (ASILFM/*) partial-month | 84 |
| Net matches (±1) | 2 |

_July 2026 bonus uses 12-month accrual sheet Total (+ SPL-420 override 105,000). FM contracts Apr disbursement = zero July bonus. Wafi BPO contract month 8 = payment timing only — bonus still on July payroll sheet._

## By contract (Client BU)

| Contract | Employees | Excel Net | HCM Net | Net Δ | Mismatches | Excel Bonus | HCM Bonus |
|----------|----------:|----------:|--------:|------:|-----------:|------------:|----------:|
| Trading & Supply | 208 | 26,226,182 | 24,139,507 | 2,086,675 | 208 | 10,864,551 | 10,864,551 |
| Lubes | 18 | 5,063,726 | 4,424,015 | 639,711 | 16 | 1,913,834 | 1,913,834 |
| Retail | 18 | 4,417,726 | 3,901,582 | 516,144 | 18 | 1,846,260 | 1,846,260 |
| IT | 7 | 2,392,014 | 2,070,729 | 321,285 | 7 | 1,119,330 | 1,119,330 |
| LSC | 34 | 1,526,117 | 1,630,052 | -103,935 | 34 | 41,883 | 41,883 |
| LSC Logistics | 5 | 1,134,735 | 955,837 | 178,898 | 5 | 469,433 | 469,433 |
| LSC Production | 4 | 926,067 | 783,595 | 142,472 | 4 | 336,696 | 336,696 |
| Finance | 3 | 670,448 | 604,248 | 66,200 | 3 | 313,290 | 313,290 |
| Real Estate | 4 | 660,663 | 690,760 | -30,097 | 4 | 276,330 | 276,330 |
| Human Resources | 1 | 240,287 | 221,456 | 18,831 | 1 | 102,917 | 102,917 |
| OTC | 1 | 140,765 | 136,182 | 4,583 | 1 | 41,665 | 41,665 |
| Doctor | 1 | 119,075 | 116,520 | 2,555 | 1 | 59,784 | 59,784 |

## Top mismatches (by |net Δ|)

| Employee | Contract | Excel Net | HCM Net | Δ Net | Excel Bonus | HCM Bonus | Δ Bonus | Notes |
|----------|----------|----------:|--------:|------:|------------:|----------:|--------:|-------|
| ASIL/SPL-363/21 | IT | 539,520 | 442,333 | 97,187 | 259,878 | 259,878 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-147/21 | Lubes | 507,129 | 420,954 | 86,175 | 215,220 | 215,220 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-328/21 | Lubes | 331,110 | 249,080 | 82,030 | 90,090 | 90,090 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-63/21 | Lubes | 413,256 | 334,423 | 78,833 | 201,402 | 201,402 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-412/21 | Real Estate | 111,850 | 190,244 | -78,394 | 37,500 | 37,500 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-364/21 | IT | 436,906 | 365,471 | 71,435 | 202,128 | 202,128 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-406/21 | LSC Logistics | 174,369 | 103,349 | 71,020 | 64,169 | 64,169 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASILFM/SPL/22/72 | LSC | 37,933 | 108,000 | -70,067 | 0 | 0 | 0 | FM staffing row: Excel uses FM partial-month rate; HCM master salary/engine differs |
| ASIL/SPL-19/21 | Retail | 449,767 | 379,850 | 69,917 | 210,000 | 210,000 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-62/21 | Retail | 367,804 | 301,392 | 66,412 | 174,924 | 174,924 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-222/21 | Trading & Supply | 375,525 | 311,074 | 64,451 | 170,634 | 170,634 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-349/21 | Lubes | 400,700 | 336,367 | 64,333 | 180,000 | 180,000 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-402/21 | Lubes | 379,390 | 316,140 | 63,250 | 150,000 | 150,000 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-15/21 | Retail | 329,267 | 270,368 | 58,899 | 147,000 | 147,000 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASILFM/SPL/22/128 | LSC | 37,933 | 95,140 | -57,207 | 0 | 0 | 0 | FM staffing row: Excel uses FM partial-month rate; HCM master salary/engine differs |
| ASIL/SPL-341/21 | Finance | 391,789 | 334,837 | 56,952 | 188,748 | 188,748 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-43/21 | Trading & Supply | 331,542 | 276,054 | 55,488 | 152,940 | 152,940 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-129/21 | Retail | 448,167 | 394,797 | 53,370 | 131,970 | 131,970 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-10/21 | Retail | 354,474 | 301,133 | 53,341 | 157,512 | 157,512 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-115/21 | Trading & Supply | 321,295 | 269,104 | 52,191 | 145,434 | 145,434 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-67/21 | Trading & Supply | 314,667 | 262,799 | 51,868 | 149,298 | 149,298 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-34/21 | LSC Logistics | 290,675 | 239,039 | 51,636 | 125,040 | 125,040 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASILFM/SPL/22/103 | LSC | 91,140 | 39,600 | 51,540 | 0 | 0 | 0 | FM staffing row: Excel uses FM partial-month rate; HCM master salary/engine differs |
| ASIL/SPL-294/21 | Lubes | 394,997 | 343,914 | 51,083 | 153,732 | 153,732 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASILFM/SPL/22/73 | LSC | 35,352 | 86,230 | -50,878 | 0 | 0 | 0 | FM staffing row: Excel uses FM partial-month rate; HCM master salary/engine differs |
| ASIL/SPL-397/21 | LSC Production | 147,792 | 97,511 | 50,281 | 56,664 | 56,664 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-419/21 | LSC | 101,852 | 51,662 | 50,190 | 7,083 | 7,083 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-416/21 | LSC | 119,200 | 69,400 | 49,800 | 30,000 | 30,000 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASILFM/SPL/22/36 | Trading & Supply | 37,933 | 84,250 | -46,317 | 0 | 0 | 0 | FM staffing row: Excel uses FM partial-month rate; HCM master salary/engine differs |
| ASIL/SPL-131/21 | Trading & Supply | 281,441 | 235,567 | 45,874 | 140,418 | 140,418 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-183/21 | Trading & Supply | 300,443 | 255,396 | 45,047 | 129,060 | 129,060 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-383/21 | Retail | 290,693 | 246,109 | 44,584 | 140,418 | 140,418 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-39/21 | Trading & Supply | 170,423 | 127,143 | 43,280 | 84,564 | 84,564 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-365/21 | IT | 330,995 | 288,502 | 42,493 | 144,372 | 144,372 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASILFM/SPL/22/70 | LSC | 43,301 | 84,250 | -40,949 | 0 | 0 | 0 | FM staffing row: Excel uses FM partial-month rate; HCM master salary/engine differs |
| ASIL/SPL-329/21 | Trading & Supply | 291,202 | 250,421 | 40,781 | 126,000 | 126,000 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-75/21 | Trading & Supply | 273,971 | 234,328 | 39,643 | 129,024 | 129,024 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-47/21 | Trading & Supply | 253,787 | 214,208 | 39,579 | 102,624 | 102,624 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-103/21 | Trading & Supply | 320,792 | 281,221 | 39,571 | 160,782 | 160,782 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-138/21 | LSC Production | 303,169 | 265,364 | 37,805 | 102,924 | 102,924 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-121/21 | Trading & Supply | 263,681 | 226,820 | 36,861 | 127,056 | 127,056 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-41/21 | Trading & Supply | 307,927 | 271,622 | 36,305 | 154,776 | 154,776 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-53/21 | LSC Production | 297,882 | 261,580 | 36,302 | 99,930 | 99,930 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-275/21 | Trading & Supply | 260,792 | 224,640 | 36,152 | 120,120 | 120,120 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-104/21 | Trading & Supply | 254,085 | 218,830 | 35,255 | 119,610 | 119,610 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-202/21 | Trading & Supply | 264,729 | 229,896 | 34,833 | 114,738 | 114,738 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-77/21 | Trading & Supply | 132,067 | 166,816 | -34,749 | 79,254 | 79,254 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-37/21 | LSC Logistics | 293,839 | 259,350 | 34,489 | 96,570 | 96,570 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-366/21 | IT | 300,247 | 265,982 | 34,265 | 150,150 | 150,150 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |
| ASIL/SPL-367/21 | IT | 300,247 | 265,982 | 34,265 | 150,150 | 150,150 | 0 | Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify |

_…and 252 more mismatches_
