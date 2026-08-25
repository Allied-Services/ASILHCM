const HUZAIFA = 'huzaifa.rafaqat@asil.com.pk';

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'gmail.com.pk',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'mail.com',
  'protonmail.com', 'proton.me', 'pm.me',
]);

function isEmail(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s && s !== 'n/a' && s !== 'na' && s.includes('@');
}

function isPersonalEmail(v) {
  if (!isEmail(v)) return false;
  const d = String(v).trim().toLowerCase().split('@').pop();
  if (!d) return false;
  if (d === 'gmail.com' || d.startsWith('gmail.') || d.endsWith('.gmail.com')) return true;
  return PERSONAL_DOMAINS.has(d);
}

function focalEmail(emp) {
  const a = String(emp?.claim_authority || '').trim().toLowerCase();
  if (!a || a === 'self' || a === 'n/a') return null;
  return isEmail(a) ? a : null;
}

function lmEmail(emp) {
  return isEmail(emp?.line_manager_email) ? emp.line_manager_email.toLowerCase()
    : isEmail(emp?.supervisor_email) ? emp.supervisor_email.toLowerCase() : null;
}

/** Client-side mirror of backend resolveClaimsCategory (eligibility passed separately). */
export function resolveClaimsCategoryClient(emp, { eligible = true } = {}) {
  if (!eligible) return { category: 'Not eligible', tone: '#94a3b8' };
  const focal = focalEmail(emp);
  const lm = lmEmail(emp);
  const empMail = isEmail(emp?.email) && !isPersonalEmail(emp.email)
    ? emp.email.toLowerCase() : null;

  if (focal && lm && focal !== lm) {
    return { category: 'Focal + LM', tone: '#38bdf8', tooltip: `Focal: ${focal} · LM: ${lm}` };
  }
  if (focal) {
    return { category: 'Focal only', tone: '#a78bfa', tooltip: `Focal: ${focal}` };
  }
  if (lm && empMail) {
    return { category: 'Employee + LM', tone: '#22c55e', tooltip: `Employee · LM: ${lm}` };
  }
  if (empMail) {
    return { category: 'Employee + ASIL', tone: '#f59e0b', tooltip: `Approver: ${HUZAIFA}` };
  }
  return {
    category: 'Setup needed',
    tone: '#ef4444',
    tooltip: 'Missing work/official or focal email — personal mailboxes are not used for Portal Claims',
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
