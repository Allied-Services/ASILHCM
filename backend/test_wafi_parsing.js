'use strict';
// test_wafi_parsing.js - ASIL HCM Wafi Claims Parsing Test Suite
// Run: node test_wafi_parsing.js

// ── Inline the functions (no DB needed) ──────────────────────────────────────

function parseDate(raw, fmt) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') {
        const d = new Date(new Date(1899, 11, 30).getTime() + raw * 86400000);
        return isNaN(d) ? null : d;
    }
    const s = String(raw).trim();
    const m1 = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (m1) {
        let day, month;
        const a = parseInt(m1[1]), b = parseInt(m1[2]), c = parseInt(m1[3]);
        const fullYear = c < 100 ? 2000 + c : c;
        if (fmt === 'MM-DD-YYYY') { month = a - 1; day = b; }
        else { day = a; month = b - 1; }
        const d = new Date(fullYear, month, day);
        return isNaN(d.getTime()) || month < 0 || month > 11 || day < 1 || day > 31 ? null : d;
    }
    const MONTHS_NL = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    const m2 = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\s+(\d{4})$/i);
    if (m2) {
        const day = parseInt(m2[1]);
        const mon = MONTHS_NL[m2[2].toLowerCase().slice(0,3)];
        const year = parseInt(m2[3]);
        if (mon !== undefined) { const d = new Date(year, mon, day); return isNaN(d.getTime()) ? null : d; }
    }
    const m3 = s.match(/^([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
    if (m3) {
        const mon = MONTHS_NL[m3[1].toLowerCase().slice(0,3)];
        const day = parseInt(m3[2]);
        const year = parseInt(m3[3]);
        if (mon !== undefined) { const d = new Date(year, mon, day); return isNaN(d.getTime()) ? null : d; }
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
}

function detectDateFormat(rawValues, filename) {
    let filenameMonth = null;
    if (filename) {
        const monthMap = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
        const fn = String(filename).toLowerCase();
        for (const [abbr, num] of Object.entries(monthMap)) { if (fn.includes(abbr)) { filenameMonth = num; break; } }
    }
    let mmddEvidence = 0, ddmmEvidence = 0;
    const aVals = [], bVals = [];
    for (const raw of rawValues) {
        if (raw == null || raw === '') continue;
        if (typeof raw === 'number' && raw > 1000) continue;
        const s = String(raw).trim();
        const match = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
        if (!match) continue;
        const a = parseInt(match[1]), b = parseInt(match[2]);
        aVals.push(a); bVals.push(b);
        if (b > 12) mmddEvidence++;
        if (a > 12) ddmmEvidence++;
    }
    if (filenameMonth && aVals.length > 0) {
        const aMatchesMonth = aVals.every(v => v === filenameMonth);
        const bMatchesMonth = bVals.every(v => v === filenameMonth);
        if (aMatchesMonth && !bMatchesMonth) return { fmt: 'MM-DD-YYYY', confident: true };
        if (bMatchesMonth && !aMatchesMonth) return { fmt: 'DD-MM-YYYY', confident: true };
    }
    if (mmddEvidence > 0 && ddmmEvidence === 0) return { fmt: 'MM-DD-YYYY', confident: true };
    if (ddmmEvidence > 0 && mmddEvidence === 0) return { fmt: 'DD-MM-YYYY', confident: true };
    if (aVals.length >= 3) {
        const aUnique = new Set(aVals).size;
        const bUnique = new Set(bVals).size;
        const aRange = Math.max(...aVals) - Math.min(...aVals);
        const bRange = Math.max(...bVals) - Math.min(...bVals);
        if (aUnique <= 2 && bRange > aRange && bRange >= 5) return { fmt: 'MM-DD-YYYY', confident: true };
        if (bUnique <= 2 && aRange > bRange && aRange >= 5) return { fmt: 'DD-MM-YYYY', confident: true };
    }
    return { fmt: 'DD-MM-YYYY', confident: false };
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

const PK_PUBLIC_HOLIDAYS = {
    '2026-03-20': { name: 'Eid-ul-Fitr Day 1', isEid: true },
    '2026-03-21': { name: 'Eid-ul-Fitr Day 2', isEid: true },
    '2026-03-22': { name: 'Eid-ul-Fitr Day 3', isEid: true },
    '2026-03-23': { name: 'Pakistan Day', isEid: false },
    '2026-05-01': { name: 'Labour Day', isEid: false },
    '2026-05-27': { name: 'Eid-ul-Adha Day 1', isEid: true },
    '2026-05-28': { name: 'Eid-ul-Adha Day 2', isEid: true },
    '2026-05-29': { name: 'Eid-ul-Adha Day 3', isEid: true },
};

function getPKDateType(date) {
    if (!date || isNaN(date)) return null;
    const dateStr = date.toISOString().slice(0, 10);
    const holiday = PK_PUBLIC_HOLIDAYS[dateStr];
    if (holiday) return { type: holiday.isEid ? 'EID' : 'HOLIDAY', name: holiday.name };
    const dow = date.getDay();
    if (dow === 0) return { type: 'SUNDAY', name: 'Sunday' };
    return { type: 'WEEKDAY', name: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow] };
}

function checkPakistanLabourLaw(claimDate, otHours, multRaw, timeFromRaw, timeToRaw) {
    const violations = [];
    const dateType = getPKDateType(claimDate);
    if (!dateType) return violations;
    const mult = (multRaw || '').toLowerCase().trim();
    switch (dateType.type) {
        case 'WEEKDAY':
        case 'SUNDAY':
            if (mult === 'triple') violations.push({ severity: 'ERROR', message: 'Triple OT not allowed on ' + dateType.type });
            if (mult === 'single' && dateType.type === 'SUNDAY') violations.push({ severity: 'ERROR', message: 'Sunday min 2X' });
            break;
        case 'HOLIDAY':
            if (mult === 'single') violations.push({ severity: 'ERROR', message: 'Holiday min 2X' });
            if (mult === 'triple') violations.push({ severity: 'WARNING', message: 'Triple on non-Eid holiday, verify policy' });
            break;
        case 'EID':
            if (mult === 'single') violations.push({ severity: 'ERROR', message: 'Eid min 2X' });
            break;
    }
    const isHoliday = dateType.type === 'EID' || dateType.type === 'HOLIDAY';
    const maxOtHours = isHoliday ? 6 : 4;
    if (otHours > maxOtHours) violations.push({ severity: 'WARNING', message: 'High OT ' + otHours + 'h exceeds ' + maxOtHours + 'h cap' });
    const tFrom = parseTimeHours(timeFromRaw);
    const tTo = parseTimeHours(timeToRaw);
    if (tFrom !== null && tTo !== null) {
        let diff = tTo - tFrom;
        if (diff < 0) diff += 24;
        if (Math.abs(diff - otHours) > 0.5) violations.push({ severity: 'WARNING', message: 'Time mismatch ' + timeFromRaw + ' to ' + timeToRaw + ' = ' + diff.toFixed(1) + 'h claimed ' + otHours + 'h' });
    }
    return violations;
}

// ── Test Runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log('  PASS: ' + name); passed++; }
    catch(e) { console.log('  FAIL: ' + name); console.log('    -> ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertDate(d, year, month, day, label) {
    assert(d instanceof Date && !isNaN(d), label + ': invalid Date (got ' + d + ')');
    assert(d.getFullYear() === year, label + ': year ' + d.getFullYear() + ' != ' + year);
    assert(d.getMonth()+1 === month, label + ': month ' + (d.getMonth()+1) + ' != ' + month);
    assert(d.getDate() === day, label + ': day ' + d.getDate() + ' != ' + day);
}

console.log('');
console.log('=== ASIL HCM Wafi Claims — Parsing Test Suite ===');
console.log('');

console.log('GROUP 1: parseDate — separator variants');
test('Dot 01.04.2026 DD-MM-YYYY = April 1', () => assertDate(parseDate('01.04.2026','DD-MM-YYYY'), 2026, 4, 1, 'dot-ddmm'));
test('Dot 18.05.2026 DD-MM-YYYY = May 18', () => assertDate(parseDate('18.05.2026','DD-MM-YYYY'), 2026, 5, 18, 'dot-ddmm2'));
test('Dash 01-04-2026 DD-MM-YYYY = April 1', () => assertDate(parseDate('01-04-2026','DD-MM-YYYY'), 2026, 4, 1, 'dash-ddmm'));
test('Slash 18/05/2026 DD-MM-YYYY = May 18', () => assertDate(parseDate('18/05/2026','DD-MM-YYYY'), 2026, 5, 18, 'slash-ddmm'));
test('MM-DD-YYYY 04/01/2026 = April 1', () => assertDate(parseDate('04/01/2026','MM-DD-YYYY'), 2026, 4, 1, 'mmdd'));
test('Dot MM-DD 05.18.2026 = May 18', () => assertDate(parseDate('05.18.2026','MM-DD-YYYY'), 2026, 5, 18, 'dot-mmdd'));
test('Natural: 18th May 2026', () => assertDate(parseDate('18th May 2026'), 2026, 5, 18, 'nl1'));
test('Natural: May 18 2026', () => assertDate(parseDate('May 18 2026'), 2026, 5, 18, 'nl2'));
test('Excel serial April 1 2026', () => {
    const serial = Math.round((new Date(2026,3,1).getTime() - new Date(1899,11,30).getTime()) / 86400000);
    assertDate(parseDate(serial), 2026, 4, 1, 'serial-' + serial);
});
test('Null returns null', () => { assert(parseDate(null)===null,'null'); assert(parseDate('')===null,'empty'); });

console.log('');
console.log('GROUP 2: detectDateFormat — April/May 2026 dot-separated dates');
test('April 2026 dots -> DD-MM-YYYY (confident)', () => {
    const r = detectDateFormat(['01.04.2026','05.04.2026','10.04.2026','15.04.2026','20.04.2026'], 'Wafi_Claims_April_2026.xlsx');
    assert(r.fmt === 'DD-MM-YYYY', 'fmt=' + r.fmt);
    assert(r.confident === true, 'not confident');
});
test('May 2026 dots -> DD-MM-YYYY (confident)', () => {
    const r = detectDateFormat(['01.05.2026','05.05.2026','10.05.2026','15.05.2026','20.05.2026'], 'Wafi_Claims_Shikarpur_May_2026.xlsx');
    assert(r.fmt === 'DD-MM-YYYY', 'fmt=' + r.fmt);
    assert(r.confident === true, 'not confident');
});
test('25.04.2026 hard evidence -> DD-MM-YYYY', () => {
    const r = detectDateFormat(['25.04.2026','26.04.2026','27.04.2026'], null);
    assert(r.fmt === 'DD-MM-YYYY', 'fmt=' + r.fmt);
    assert(r.confident, 'not confident');
});
test('05.25.2026 hard evidence -> MM-DD-YYYY', () => {
    const r = detectDateFormat(['05.25.2026','05.26.2026','05.27.2026'], null);
    assert(r.fmt === 'MM-DD-YYYY', 'fmt=' + r.fmt);
});

console.log('');
console.log('GROUP 3: checkPakistanLabourLaw — day type enforcement');
test('Weekday Triple -> ERROR', () => {
    const v = checkPakistanLabourLaw(new Date(2026,3,6), 3, 'Triple', null, null); // April 6 = Monday
    assert(v.some(x => x.severity==='ERROR'), 'expected ERROR');
});
test('Weekday Double -> no ERROR', () => {
    const v = checkPakistanLabourLaw(new Date(2026,3,6), 3, 'Double', null, null);
    assert(!v.some(x => x.severity==='ERROR'), 'unexpected ERROR');
});
test('Sunday Triple -> ERROR', () => {
    const v = checkPakistanLabourLaw(new Date(2026,3,5), 3, 'Triple', null, null); // April 5 = Sunday
    assert(v.some(x => x.severity==='ERROR'), 'expected ERROR');
});
test('Sunday Single -> ERROR (min 2X)', () => {
    const v = checkPakistanLabourLaw(new Date(2026,3,5), 3, 'Single', null, null);
    assert(v.some(x => x.severity==='ERROR'), 'expected ERROR');
});
test('Eid-ul-Fitr Triple -> no ERROR (3X OK)', () => {
    const v = checkPakistanLabourLaw(new Date(2026,2,20), 3, 'Triple', null, null); // March 20 = Eid Day 1
    assert(!v.some(x => x.severity==='ERROR'), 'unexpected ERROR on Eid triple');
});
test('Eid-ul-Fitr Single -> ERROR (min 2X)', () => {
    const v = checkPakistanLabourLaw(new Date(2026,2,21), 3, 'Single', null, null); // Eid Day 2
    assert(v.some(x => x.severity==='ERROR'), 'expected ERROR');
});
test('Weekday 5h -> WARNING (cap 4h)', () => {
    const v = checkPakistanLabourLaw(new Date(2026,3,6), 5, 'Double', null, null);
    assert(v.some(x => x.severity==='WARNING' && x.message.includes('High OT')), 'expected HIGH OT WARNING');
});
test('Eid 7h -> WARNING (cap 6h)', () => {
    const v = checkPakistanLabourLaw(new Date(2026,2,20), 7, 'Triple', null, null);
    assert(v.some(x => x.severity==='WARNING' && x.message.includes('High OT')), 'expected HIGH OT WARNING');
});
test('Eid 4h Double -> no violation at all', () => {
    const v = checkPakistanLabourLaw(new Date(2026,2,22), 4, 'Double', null, null); // Eid Day 3
    assert(v.length === 0, 'unexpected violations: ' + JSON.stringify(v));
});

console.log('');
console.log('GROUP 4: parseTimeHours — 12h and 24h formats');
test('09:00 -> 9', () => assert(parseTimeHours('09:00') === 9, 'got ' + parseTimeHours('09:00')));
test('22:00 -> 22', () => assert(parseTimeHours('22:00') === 22, 'got ' + parseTimeHours('22:00')));
test('14:30 -> 14.5', () => assert(parseTimeHours('14:30') === 14.5, 'got ' + parseTimeHours('14:30')));
test('10:00 PM -> 22', () => assert(parseTimeHours('10:00 PM') === 22, 'got ' + parseTimeHours('10:00 PM')));
test('9:30 AM -> 9.5', () => assert(parseTimeHours('9:30 AM') === 9.5, 'got ' + parseTimeHours('9:30 AM')));
test('12:00 PM -> 12 (noon)', () => assert(parseTimeHours('12:00 PM') === 12, 'got ' + parseTimeHours('12:00 PM')));
test('12:00 AM -> 0 (midnight)', () => assert(parseTimeHours('12:00 AM') === 0, 'got ' + parseTimeHours('12:00 AM')));
test('null/empty -> null', () => assert(parseTimeHours(null) === null && parseTimeHours('') === null, 'expected null'));

console.log('');
console.log('GROUP 5: Labour law — time arithmetic');
test('09:00 to 13:00 claiming 6h -> mismatch WARNING', () => {
    const v = checkPakistanLabourLaw(new Date(2026,3,6), 6, 'Double', '09:00', '13:00');
    assert(v.some(x => x.severity==='WARNING' && x.message.includes('mismatch')), 'expected mismatch WARNING');
});
test('09:00 to 12:00 claiming 3h -> no mismatch', () => {
    const v = checkPakistanLabourLaw(new Date(2026,3,6), 3, 'Double', '09:00', '12:00');
    assert(!v.some(x => x.message && x.message.includes('mismatch')), 'unexpected mismatch');
});
test('Overnight 10:00 PM to 01:00 claiming 3h -> no mismatch', () => {
    const v = checkPakistanLabourLaw(new Date(2026,3,6), 3, 'Double', '10:00 PM', '01:00');
    assert(!v.some(x => x.message && x.message.includes('mismatch')), 'unexpected mismatch for overnight');
});

console.log('');
console.log('=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
if (failed === 0) {
    console.log('ALL TESTS PASSED - Wafi Claims parsing engine is healthy!');
} else {
    console.log('WARNING: ' + failed + ' test(s) FAILED - review output above');
}
console.log('');
process.exit(failed > 0 ? 1 : 0);
