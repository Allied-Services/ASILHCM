const HUZAIFA = 'huzaifa.rafaqat@asil.com.pk';

function isEmail(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s && s !== 'n/a' && s !== 'na' && s.includes('@');
}

function domainMatches(domain, root) {
  const d = String(domain || '').toLowerCase();
  const r = String(root || '').toLowerCase();
  return d === r || d.endsWith(`.${r}`);
}

function isClaimsWorkMailbox(v) {
  if (!isEmail(v)) return false;
  const d = String(v).trim().toLowerCase().split('@').pop();
  return domainMatches(d, 'wafi-energy.com') || domainMatches(d, 'asil.com.pk');
}

function pick(emp, snake, camel) {
  const a = emp?.[snake];
  if (a != null && String(a).trim() !== '') return a;
  return emp?.[camel];
}

function focalEmail(emp) {
  const a = String(pick(emp, 'claim_authority', 'claimAuthority') || '').trim().toLowerCase();
  if (!a || a === 'self' || a === 'n/a') return null;
  return isEmail(a) ? a : null;
}

function lmEmail(emp) {
  const lm = pick(emp, 'line_manager_email', 'lineManagerEmail');
  return isEmail(lm) ? String(lm).toLowerCase() : null;
}

/** Client-side mirror of backend resolveClaimsCategory (eligibility passed separately). */
export function resolveClaimsCategoryClient(emp, { eligible = true } = {}) {
  if (!eligible) return { category: 'Not eligible', tone: '#94a3b8' };
  const focal = focalEmail(emp);
  const lm = lmEmail(emp);
  const empMail = isClaimsWorkMailbox(emp?.email) ? emp.email.toLowerCase() : null;

  if (focal && lm && focal !== lm) {
    return { category: 'Focal + LM', tone: '#38bdf8', tooltip: `Focal: ${focal} · LM: ${lm}` };
  }
  if (focal) {
    return { category: 'Focal only', tone: '#a78bfa', tooltip: `Focal: ${focal}` };
  }
  if (!focal && empMail && lm) {
    return { category: 'Employee + LM', tone: '#22c55e', tooltip: `Employee · LM: ${lm}` };
  }
  if (!focal && !empMail && lm) {
    return { category: 'LM only', tone: '#fb923c', tooltip: `LM (final): ${lm}` };
  }
  if (empMail) {
    return { category: 'Employee + ASIL', tone: '#f59e0b', tooltip: `Approver: ${HUZAIFA}` };
  }
  return {
    category: 'Setup needed',
    tone: '#ef4444',
    tooltip: 'No Focal, no Wafi/ASIL mailbox, and no Line Manager — emailed to Sadia Komal',
  };
}

export function isFmDept(emp) {
  return String(emp?.dept || '').trim().toLowerCase() === 'facility management';
}

export function isWafiEligibleClient(emp) {
  const client = String(emp?.client || '').toLowerCase();
  return client.includes('wafi') && !isFmDept(emp);
}

export function claimsBadgeStyle(emp) {
  const eligible = isWafiEligibleClient(emp);
  const { category, tone, tooltip } = resolveClaimsCategoryClient(emp, { eligible });
  return { category, tone, tooltip };
}
