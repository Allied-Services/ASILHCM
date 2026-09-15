/** Staff-app deep links. Keep contract definition on Clients; month work on Monthly Cycle. */

export function staffHref(tab, extra = {}) {
  const q = new URLSearchParams();
  if (tab) q.set('tab', tab);
  Object.entries(extra).forEach(([key, value]) => {
    if (value == null || value === '') return;
    q.set(key, String(value));
  });
  const qs = q.toString();
  return qs ? `/?${qs}` : '/';
}

export function goStaffTab(tab, extra = {}) {
  window.location.assign(staffHref(tab, extra));
}

export function readStaffQuery() {
  if (typeof window === 'undefined') return {};
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

export function isFixedValueService(serviceType, commercialType) {
  const st = String(serviceType || '').toLowerCase();
  const ct = String(commercialType || '').toLowerCase();
  return ct === 'fixed_value'
    || st.includes('fixed value')
    || st.includes('conservancy')
    || st.includes('coro');
}

export function normalizeContractChapter(raw, { hasSo = true } = {}) {
  const v = String(raw || '').toLowerCase().replace(/_/g, '-');
  if (v === 'so' || v === 'service-orders' || v === 'service-order') return hasSo ? 'so' : 'details';
  if (v === 'costs' || v === 'cost') return 'costs';
  if (v === 'rates' || v === 'rate') return 'rates';
  if (v === 'details' || v === 'detail') return 'details';
  return 'details';
}

export function writeContractChapter(chapter) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (chapter && chapter !== 'details') url.searchParams.set('chapter', chapter);
  else url.searchParams.delete('chapter');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function clientContractHref(clientId, contractId, chapter) {
  return staffHref('client', { client: clientId, contract: contractId, chapter });
}

export function monthlyCycleSetupHref(contractId) {
  return staffHref('monthly_cycle', { section: 'setup', contract: contractId });
}

export function fixedValueMonthHref(contractId) {
  return staffHref('fixed_value', { contract: contractId });
}
