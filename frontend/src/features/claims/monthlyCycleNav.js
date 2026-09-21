const COLLECTION_SECTIONS = new Set(['setup', 'people', 'collect', 'track', 'corrections']);

export function resolveCycleSection(section, { hasContract } = {}) {
  const key = String(section || '').trim();
  if (key === 'payroll' || key === 'close' || key === 'review') return 'track';
  if (COLLECTION_SECTIONS.has(key)) return key;
  return hasContract ? 'setup' : 'track';
}

export const MONTHLY_CYCLE_SECTIONS = [
  { key: 'setup', label: 'Setup' },
  { key: 'people', label: 'People' },
  { key: 'collect', label: 'Collect' },
  { key: 'track', label: 'Track' },
  { key: 'corrections', label: 'Corrections' },
];
