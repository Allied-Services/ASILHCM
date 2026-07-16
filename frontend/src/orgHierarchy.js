/** Canonical ASIL Business Units (employee + client master). */
export const ASIL_BUS = [
  'Outsourcing',
  'Facilities Management',
  'Employee of Record',
];

/** Map legacy roster values → canonical ASIL BU. */
export function normalizeAsilBu(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (ASIL_BUS.includes(s)) return s;
  const lc = s.toLowerCase();
  if (lc === 'bpo' || lc === 'wafibpo' || lc.includes('outsourc')) return 'Outsourcing';
  if (lc === 'fm' || lc.includes('facilit')) return 'Facilities Management';
  if (lc.includes('eor') || lc.includes('employee of record')) return 'Employee of Record';
  return s; // keep unknown for display until cleaned
}

export default ASIL_BUS;
