/** Client-side mirror of backend OT time parsing for live preview + pre-save checks. */

export function parseTimeToMinutes(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim().toUpperCase()
    .replace(/\./g, ':')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2] || '0', 10);
    if (m[3] === 'PM' && h < 12) h += 12;
    if (m[3] === 'AM' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  m = s.match(/^(\d{3,4})$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const h = Math.floor(n / 100);
    const min = n % 100;
    if (h <= 23 && min <= 59) return h * 60 + min;
  }
  return null;
}

export function hoursBetween(fromMin, toMin) {
  if (fromMin == null || toMin == null) return null;
  let diff = toMin - fromMin;
  if (diff <= 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
}

export function computeOtHoursFromRow(row) {
  const fromMin = parseTimeToMinutes(row.time_from);
  const toMin = parseTimeToMinutes(row.time_to);
  return hoursBetween(fromMin, toMin);
}

export function formatIsoDateDdMmYyyy(iso) {
  if (!iso) return '';
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Live OT rate hint — mirrors backend getPkDateType + validateOtRow defaults. */
export function otRateHintForDate(isoDate, holidayMap = {}) {
  if (!isoDate) return null;
  const m = String(isoDate).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dateStr = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  const holidayName = holidayMap[dateStr];
  if (holidayName) {
    return {
      dateStr,
      label: holidayName,
      rate: 'Triple',
      rateLabel: '3× (Triple)',
      tone: 'holiday',
      message: `${holidayName} — gazetted public holiday. Triple (3×) OT applies.`,
    };
  }
  if (d.getDay() === 0) {
    return {
      dateStr,
      label: 'Sunday',
      rate: 'Double',
      rateLabel: '2× (Double)',
      tone: 'sunday',
      message: 'Sunday — Double (2×) OT applies.',
    };
  }
  return {
    dateStr,
    label: null,
    rate: 'Double',
    rateLabel: '2× (Double)',
    tone: 'weekday',
    message: 'Weekday — Double (2×) OT applies after normal duty.',
  };
}

export function applyOtRatesFromCalendar(otRows, holidayMap = {}) {
  return (otRows || []).map((row) => {
    if (String(row.claim_type || 'OT').toUpperCase() !== 'OT') return row;
    const hint = otRateHintForDate(row.claim_date, holidayMap);
    if (!hint) return row;
    return { ...row, ot_multiplier: hint.rate === 'Triple' ? 'Triple' : 'Double' };
  });
}

export function validateOtRowClient(row, claimMonth, claimYear) {
  const errors = [];
  if (!String(row.claim_date || '').trim()) {
    errors.push('Date is missing — use the date picker or DD/MM/YYYY.');
  } else if (claimMonth && claimYear) {
    const m = String(row.claim_date).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m && (Number(m[1]) !== claimYear || Number(m[2]) !== claimMonth)) {
      errors.push(`Date must be in ${claimMonth}/${claimYear} (claim month).`);
    }
  }
  const tf = String(row.time_from || '').trim();
  const tt = String(row.time_to || '').trim();
  if (!tf || !tt) {
    errors.push('OT Start and OT End are required (e.g. 5:00 PM and 7:00 PM, or 1700 and 1900).');
  } else {
    if (parseTimeToMinutes(tf) == null) {
      errors.push(`OT Start "${tf}" could not be read. Try 5:00 PM, 5PM, 5 PM, or 1700.`);
    }
    if (parseTimeToMinutes(tt) == null) {
      errors.push(`OT End "${tt}" could not be read. Try 7:00 PM, 7PM, or 1900.`);
    }
    const hrs = computeOtHoursFromRow(row);
    if (hrs == null || hrs <= 0) {
      errors.push('OT hours could not be calculated — check Start is before End.');
    }
  }
  return errors;
}
