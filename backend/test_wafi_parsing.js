'use strict';
/**
 * test_wafi_parsing.js — standalone validation suite
 * Tests key functions from wafiClaimsService.js using the same logic/data as production.
 * Run: node backend/test_wafi_parsing.js
 */

// ── Functions copied verbatim from wafiClaimsService.js ───────────────────────

function detectDateFormat(rawValues, filename = '') {
    let ddmmEvidence = 0, mmddEvidence = 0;
    const aVals = [], bVals = [];
    for (const raw of rawValues) {
        if (raw == null || raw === '') continue;
        if (typeof raw === 'number') continue;
        const s = String(raw).trim();
        const match = s.match(/^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})$/);
        if (!match) continue;
        const a = parseInt(match[1]), b = parseInt(match[2]);
        aVals.push(a); bVals.push(b);
        if (b > 12) mmddEvidence++;
        if (a > 12) ddmmEvidence++;
    }
    if (ddmmEvidence > 0 && mmddEvidence === 0) return { fmt: 'DD-MM-YYYY', confident: true };
    if (mmddEvidence > 0 && ddmmEvidence === 0) return { fmt: 'MM-DD-YYYY', confident: true };
    return { fmt: 'DD-MM-YYYY', confident: false };
}

function parseDate(raw, fmt = 'DD-MM-YYYY') {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') {
        const d = new Date(new Date(1899, 11, 30).getTime() + raw * 86400000);
        return isNaN(d) ? null : d;
    }
    const s = String(raw).trim();
    const m1 = s.match(/^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})$/);
    if (m1) {
        let day, month;
        const a = parseInt(m1[1]), b = parseInt(m1[2]), c = parseInt(m1[3]);
        const fullYear = c < 100 ? 2000 + c : c;
        if (fmt === 'MM-DD-YYYY') { month = a - 1; day = b; }
        else { day = a; month = b - 1; }
        const d = new Date(fullYear, month, day);
        return isNaN(d.getTime()) || month < 0 || month > 11 || day < 1 || day > 31 ? null : d;
    }
    return null;
}

// Full holiday list — matches production wafiClaimsService.js exactly
const PK_PUBLIC_HOLIDAYS = {
    '2025-02-05': { name: 'Kashmir Solidarity Day', isEid: false },
    '2025-03-23': { name: 'Pakistan Day', isEid: false },
    '2025-03-31': { name: 'Eid-ul-Fitr Day 1 (est.)', isEid: true },
    '2025-04-01': { name: 'Eid-ul-Fitr Day 2 (est.)', isEid: true },
    '2025-04-02': { name: 'Eid-ul-Fitr Day 3 (est.)', isEid: true },
    '2025-05-01': { name: 'International Labour Day', isEid: false },
    '2025-06-06': { name: 'Eid-ul-Adha Day 1 (est.)', isEid: true },
    '2025-06-07': { name: 'Eid-ul-Adha Day 2 (est.)', isEid: true },
    '2025-06-08': { name: 'Eid-ul-Adha Day 3 (est.)', isEid: true },
    '2025-08-14': { name: 'Independence Day', isEid: false },
    '2025-11-09': { name: 'Allama Iqbal Day', isEid: false },
    '2025-12-25': { name: 'Quaid-e-Azam Day / Christmas', isEid: false },
    '2026-02-05': { name: 'Kashmir Solidarity Day', isEid: false },
    '2026-03-20': { name: 'Eid-ul-Fitr Day 1 (est.)', isEid: true },
    '2026-03-21': { name: 'Eid-ul-Fitr Day 2 (est.)', isEid: true },
    '2026-03-22': { name: 'Eid-ul-Fitr Day 3 (est.)', isEid: true },
    '2026-03-23': { name: 'Pakistan Day', isEid: false },
    '2026-05-01': { name: 'International Labour Day', isEid: false },
    '2026-05-27': { name: 'Eid-ul-Adha Day 1 (est.)', isEid: true },
    '2026-05-28': { name: 'Eid-ul-Adha Day 2 (est.)', isEid: true },
    '2026-05-29': { name: 'Eid-ul-Adha Day 3 (est.)', isEid: true },
    '2026-06-16': { name: 'Ashura (Muharram 10) (est.)', isEid: false },
    '2026-08-14': { name: 'Independence Day', isEid: false },
    '2026-11-09': { name: 'Allama Iqbal Day', isEid: false },
    '2026-12-25': { name: 'Quaid-e-Azam Day / Christmas', isEid: false },
};

const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function getPKDateType(date) {
    if (!date || isNaN(date)) return null;
    // Use local date components (not toISOString which is UTC)
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d  = String(date.getDate()).padStart(2, '0');
    const dateStr = `${y}-${mo}-${d}`;
    const holiday = PK_PUBLIC_HOLIDAYS[dateStr];
    if (holiday) return { type: holiday.isEid ? 'EID' : 'HOLIDAY', name: holiday.name };
    const dow = date.getDay();
    if (dow === 0) return { type: 'SUNDAY', name: 'Sunday' };
    return { type: 'WEEKDAY', name: WEEKDAY_NAMES[dow] };
}

function parseTimeHours(raw) {
    if (!raw) return null;
    const s = String(raw).trim().toUpperCase();
    const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (m12) {
        let h = parseInt(m12[1]), min = parseInt(m12[2]);
        if (m12[3] === 'PM' && h !== 12) h += 12;
        if (m12[3] === 'AM' && h === 12) h = 0;
        return h + min / 60;
    }
    const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m24) return parseInt(m24[1]) + parseInt(m24[2]) / 60;
    return null;
}

function checkPakistanLabourLaw(claimDate, otHours, multRaw, timeFromRaw, timeToRaw) {
    const violations = [];
    const dateType = getPKDateType(claimDate);
    if (!dateType) return violations;
    const mult = (multRaw || '').toLowerCase().trim();
    const isHoliday = dateType.type === 'EID' || dateType.type === 'HOLIDAY';
    const maxOtHours = isHoliday ? 6 : 4;

    if ((dateType.type === 'WEEKDAY' || dateType.type === 'SUNDAY') && mult === 'triple')
        violations.push({ severity: 'ERROR', message: '3X not allowed on regular days' });
    if (dateType.type === 'SUNDAY' && mult === 'single')
        violations.push({ severity: 'ERROR', message: '1X not allowed on Sunday' });
    if (dateType.type === 'HOLIDAY' && mult === 'single')
        violations.push({ severity: 'ERROR', message: '1X not allowed on public holiday' });
    if (dateType.type === 'EID' && mult === 'single')
        violations.push({ severity: 'ERROR', message: '1X not allowed on Eid holiday — minimum 2X required' });
    if (otHours > maxOtHours)
        violations.push({ severity: 'WARNING', message: `${otHours}h exceeds ${maxOtHours}h cap` });

    const tFrom = parseTimeHours(timeFromRaw);
    const tTo   = parseTimeHours(timeToRaw);
    if (tFrom !== null && tTo !== null) {
        let diff = tTo - tFrom;
        if (diff < 0) diff += 24;
        if (Math.abs(diff - otHours) > 0.5)
            violations.push({ severity: 'WARNING', message: `Time mismatch: ${diff.toFixed(1)}h vs claimed ${otHours}h` });
    }
    return violations;
}

// ── TEST RUNNER ────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? '✅' : '❌'} ${label}`);
    if (!ok) {
        console.log(`     Expected: ${JSON.stringify(expected)}`);
        console.log(`     Actual  : ${JSON.stringify(actual)}`);
    }
    ok ? passed++ : failed++;
}

// ═══ GROUP 1: Date Separator ══════════════════════════════════════════════════
console.log('\n══ 1. Date Separator (dot / slash / dash) ══════════════════\n');
const d1 = parseDate('01.04.2026', 'DD-MM-YYYY');
test('01.04.2026 → April (month=3)',  d1?.getMonth(),      3);
test('01.04.2026 → day=1',           d1?.getDate(),        1);
test('01.04.2026 → year=2026',       d1?.getFullYear(), 2026);
const d2 = parseDate('18.05.2026', 'DD-MM-YYYY');
test('18.05.2026 → May (month=4)',   d2?.getMonth(),       4);
test('18.05.2026 → day=18',         d2?.getDate(),        18);
test('01/04/2026 → April',          parseDate('01/04/2026','DD-MM-YYYY')?.getMonth(), 3);
test('01-04-2026 → April',          parseDate('01-04-2026','DD-MM-YYYY')?.getMonth(), 3);
test('null → null',                  parseDate(null),      null);
test('empty → null',                 parseDate(''),        null);

// ═══ GROUP 2: detectDateFormat ════════════════════════════════════════════════
console.log('\n══ 2. detectDateFormat ══════════════════════════════════════\n');
const aprilDots = ['01.04.2026','02.04.2026','06.04.2026','07.04.2026',
                   '13.04.2026','14.04.2026','20.04.2026','21.04.2026','28.04.2026'];
const ar = detectDateFormat(aprilDots, 'Overtime_Claims_April_2026.xlsx');
test('April dot dates → DD-MM-YYYY',  ar.fmt,         'DD-MM-YYYY');
test('April dot dates → confident',   ar.confident,    true);

const mayDots = ['01.05.2026','18.05.2026','19.05.2026','20.05.2026','21.05.2026','30.05.2026'];
const mr = detectDateFormat(mayDots, 'Overtime_month_MAY_2026.xlsx');
test('May dot dates → DD-MM-YYYY',   mr.fmt,         'DD-MM-YYYY');
test('May dot dates → confident',     mr.confident,    true);

const usSlash = ['01/15/2026','02/20/2026','03/25/2026'];
const ur = detectDateFormat(usSlash);
test('US slash dates → MM-DD-YYYY',  ur.fmt,         'MM-DD-YYYY');

// ═══ GROUP 3: Pakistan Labour Law ════════════════════════════════════════════
console.log('\n══ 3. Pakistan Labour Law ══════════════════════════════════\n');

// Weekday: Monday April 6, 2026
const mon = new Date(2026, 3, 6);
test('Apr 6 2026 → WEEKDAY',             getPKDateType(mon)?.type,        'WEEKDAY');
test('Triple on weekday → ERROR',        checkPakistanLabourLaw(mon,3,'Triple')[0]?.severity, 'ERROR');
test('Double on weekday → no violation', checkPakistanLabourLaw(mon,3,'Double').length,         0);
test('Single on weekday → no violation', checkPakistanLabourLaw(mon,3,'Single').length,         0);

// Sunday: April 5, 2026
const sun = new Date(2026, 3, 5);
test('Apr 5 2026 → SUNDAY',             getPKDateType(sun)?.type,        'SUNDAY');
test('Single on Sunday → ERROR',        checkPakistanLabourLaw(sun,3,'Single')[0]?.severity, 'ERROR');
test('Double on Sunday → no violation', checkPakistanLabourLaw(sun,3,'Double').length,         0);
test('Triple on Sunday → ERROR',        checkPakistanLabourLaw(sun,3,'Triple')[0]?.severity, 'ERROR');

// Eid-ul-Fitr: March 20, 2026
const eid = new Date(2026, 2, 20);
test('Mar 20 2026 → EID',               getPKDateType(eid)?.type,        'EID');
test('Triple on Eid → no violation',    checkPakistanLabourLaw(eid,3,'Triple').length,         0);
test('Double on Eid → no violation',    checkPakistanLabourLaw(eid,3,'Double').length,         0);
test('Single on Eid → ERROR',           checkPakistanLabourLaw(eid,3,'Single')[0]?.severity, 'ERROR');

// Gazetted holiday (non-Eid): Labour Day May 1, 2026
const labDay = new Date(2026, 4, 1);
test('May 1 2026 → HOLIDAY',            getPKDateType(labDay)?.type,     'HOLIDAY');
test('Single on holiday → ERROR',       checkPakistanLabourLaw(labDay,3,'Single')[0]?.severity, 'ERROR');
test('Double on holiday → no violation',checkPakistanLabourLaw(labDay,3,'Double').length,        0);

// Hours cap: weekday max 4h
test('5h on weekday → WARNING',         checkPakistanLabourLaw(mon,5,'Double')[0]?.severity,  'WARNING');
test('4h on weekday → no violation',    checkPakistanLabourLaw(mon,4,'Double').length,          0);
test('7h on Eid → WARNING (max 6)',     checkPakistanLabourLaw(eid,7,'Triple').some(v => v.severity === 'WARNING'), true);
test('6h on Eid → no violation',        checkPakistanLabourLaw(eid,6,'Triple').length,          0);

// ═══ GROUP 4: Time Parsing ════════════════════════════════════════════════════
console.log('\n══ 4. Time Parsing ══════════════════════════════════════════\n');
test('10:00 PM → 22',    parseTimeHours('10:00 PM'),  22);
test('01:00 AM → 1',     parseTimeHours('01:00 AM'),   1);
test('12:00 PM → 12',    parseTimeHours('12:00 PM'),  12);
test('12:00 AM → 0',     parseTimeHours('12:00 AM'),   0);
test('22:00 (24h) → 22', parseTimeHours('22:00'),      22);
test('9:30 AM → 9.5',    parseTimeHours('9:30 AM'),    9.5);
test('null → null',      parseTimeHours(null),         null);
test('blank → null',     parseTimeHours(''),           null);

// Time arithmetic: 10PM → 1AM = 3h
const ta = checkPakistanLabourLaw(mon, 3, 'Double', '10:00 PM', '01:00 AM');
test('10PM→1AM with 3h claimed → no mismatch', ta.length, 0);
const tb = checkPakistanLabourLaw(mon, 5, 'Double', '10:00 PM', '01:00 AM');
test('10PM→1AM but 5h claimed → WARNING',       tb.some(v => v.severity === 'WARNING'), true);

// ═══ SUMMARY ═════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(54)}`);
const icon = failed === 0 ? '🎉' : '⚠️';
console.log(`  ${icon}  Results: ${passed} ✅ passed   ${failed} ❌ failed`);
console.log(`${'═'.repeat(54)}\n`);
process.exit(failed > 0 ? 1 : 0);
