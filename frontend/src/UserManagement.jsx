import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, UserCheck, Clock, RefreshCcw, AlertTriangle,
  ChevronDown, ChevronUp, Eye, PlusCircle, Edit3,
  CheckCircle, XCircle, Search, Users, Grid, BookOpen,
  Lock, Unlock, Save, X, LayoutDashboard, FileText,
  Calculator, FilePlus, Receipt, CreditCard, Building,
  Truck, Package, ScanLine, Settings, UserPlus, Info,
  Mail, Inbox, Wrench, ClipboardList, MapPin,
} from 'lucide-react';
import { api } from './api';

// ─── Role Definitions ────────────────────────────────────────────────────────
const ROLE_META = {
  superadmin:            { label: 'Super Admin',           color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  desc: 'Unrestricted access to all modules, delete, and admin tools.' },
  operations:            { label: 'Operations',            color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', desc: 'Manages employee data and client information.' },
  operations_supervisor: { label: 'Ops Supervisor',        color: '#2563eb', bg: 'rgba(37,99,235,0.12)', desc: 'Operations oversight plus BD pipeline.' },
  operations_team:       { label: 'Operations Team',       color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', desc: 'Day-to-day operations and attendance.' },
  procurement_proposer:  { label: 'Procurement Proposer', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', desc: 'Creates bills, registers vendors, manages inventory.' },
  procurement_approver:  { label: 'Procurement Approver', color: '#6366f1', bg: 'rgba(99,102,241,0.12)', desc: 'Approves procurement bills and vendor entries.' },
  procurement_manager:   { label: 'Procurement Manager',  color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', desc: 'Full procurement oversight including AP.' },
  procurement:           { label: 'Procurement',          color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', desc: 'Procurement + AP (MD roster alias).' },
  finance_proposer:      { label: 'Finance Proposer',     color: '#10b981', bg: 'rgba(16,185,129,0.12)', desc: 'Creates invoices & bills, views payroll and employee data.' },
  finance_approver:      { label: 'Finance Approver',     color: '#14b8a6', bg: 'rgba(20,184,166,0.12)', desc: 'Approves invoices, payroll, billing. Access to config & users.' },
  finance_manager:       { label: 'Finance Manager',      color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)', desc: 'Full financial oversight, AP confirmation, Xero sync.' },
  ap_team:               { label: 'AP Team',              color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  desc: 'Confirms AP payment batches and billing access.' },
  ar_team:               { label: 'AR Team',              color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', desc: 'Manages accounts receivable invoices.' },
  payroll_initiator:     { label: 'Payroll Initiator',    color: '#f43f5e', bg: 'rgba(244,63,94,0.12)',  desc: 'Runs and locks monthly payroll, views employee records.' },
  payroll:               { label: 'Payroll',              color: '#f43f5e', bg: 'rgba(244,63,94,0.12)',  desc: 'Payroll (MD roster alias for payroll_initiator).' },
  bizdev:                { label: 'BizDev (BD)',          color: '#a855f7', bg: 'rgba(168,85,247,0.12)', desc: 'Business development pipeline.' },
  supervisor:             { label: 'Supervisor (Attendance)', color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  desc: 'External supervisor — can only mark daily attendance for their assigned team. Supports Gmail login.' },
  pending:               { label: 'Access Pending',       color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', desc: 'Awaiting role assignment from Super Admin.' },
};

const ROLE_OPTIONS = Object.entries(ROLE_META)
  .filter(([v]) => v !== 'pending')
  .map(([value, { label }]) => ({ value, label }));

// ─── Module Definitions ──────────────────────────────────────────────────────
const MODULES = [
  {
    key: 'dashboard', label: 'Managing Director View', navKey: 'dashboard',
    icon: <LayoutDashboard size={16} />,
    subPerms: ['view'],
  },
  {
    key: 'employee', label: 'Employee Information', navKey: 'employee',
    icon: <Users size={16} />,
    subPerms: ['view', 'create', 'edit', 'delete'],
  },
  {
    key: 'payroll', label: 'Payroll Sheet', navKey: 'payroll',
    icon: <Calculator size={16} />,
    subPerms: ['view', 'edit', 'lock', 'export'],
  },
  {
    key: 'fixed_value', label: 'Fixed Value / PSO', navKey: 'fixed_value',
    icon: <MapPin size={16} />,
    subPerms: ['view', 'edit'],
  },
  {
    key: 'documents', label: 'Document Generator', navKey: 'documents',
    icon: <FilePlus size={16} />,
    subPerms: ['view', 'generate'],
  },
  {
    key: 'billing', label: 'Bills & Procurement', navKey: 'billing',
    icon: <Receipt size={16} />,
    subPerms: ['view', 'create', 'edit', 'approve', 'mark_paid'],
  },
  {
    key: 'invoices', label: 'Invoices (AR)', navKey: 'invoices',
    icon: <FileText size={16} />,
    subPerms: ['view', 'create', 'approve'],
  },
  {
    key: 'po_tracking', label: 'PO Tracking', navKey: 'po_tracking',
    icon: <Receipt size={16} />,
    subPerms: ['view', 'create', 'edit'],
  },
  {
    key: 'ap', label: 'Accounts Payable', navKey: 'ap',
    icon: <CreditCard size={16} />,
    subPerms: ['view', 'confirm'],
  },
  {
    key: 'client', label: 'Client Information', navKey: 'client',
    icon: <Building size={16} />,
    subPerms: ['view', 'create', 'edit'],
  },
  {
    key: 'vendor', label: 'Vendor Supplier Master', navKey: 'vendor',
    icon: <Truck size={16} />,
    subPerms: ['view', 'create', 'edit', 'delete'],
  },
  {
    key: 'inventory', label: 'Inventory & Equipment', navKey: 'inventory',
    icon: <Package size={16} />,
    subPerms: ['view', 'create', 'edit', 'issue'],
  },
  {
    key: 'annexure', label: 'Annexure Approval', navKey: 'annexure',
    icon: <ScanLine size={16} />,
    subPerms: ['view', 'approve'],
  },
  {
    key: 'config', label: 'System Configuration', navKey: 'config',
    icon: <Settings size={16} />,
    subPerms: ['view', 'edit'],
  },
  {
    key: 'users', label: 'User Management', navKey: 'users',
    icon: <Shield size={16} />,
    subPerms: ['view', 'create', 'assign_role'],
  },
  {
    key: 'attendance', label: 'Attendance', navKey: 'attendance',
    icon: <Clock size={16} />,
    subPerms: ['view', 'mark_attendance', 'approve_leave', 'team_setup'],
  },
  {
    key: 'maintenance', label: 'Maintenance & CMMS', navKey: 'maintenance',
    icon: <Wrench size={16} />,
    subPerms: ['view', 'create', 'escalation_config'],
  },
  {
    key: 'email_claims', label: 'Email Claims', navKey: 'email_claims',
    icon: <Mail size={16} />,
    subPerms: ['view', 'trigger_poll'],
  },
  {
    key: 'wafi_claims', label: 'Wafi Claims', navKey: 'wafi_claims',
    icon: <Inbox size={16} />,
    subPerms: ['view', 'approve', 'export'],
  },
  {
    key: 'claims_portal', label: 'Portal Claims', navKey: 'claims_portal',
    icon: <ClipboardList size={16} />,
    subPerms: ['view', 'campaign', 'export', 'claims_manual_override'],
  },
];

// ─── Default permissions per role (must cover every ROLE_META key) ────────────
const ROLE_NAV_SET = {
  superadmin:            ['dashboard','employee','payroll','fixed_value','documents','billing','invoices','po_tracking','ap','client','vendor','inventory','annexure','config','users','attendance','maintenance','email_claims','wafi_claims','claims_portal'],
  operations:            ['employee','documents','client','fixed_value','attendance','maintenance','claims_portal'],
  operations_supervisor: ['employee','documents','client','fixed_value','attendance','maintenance','claims_portal'],
  operations_team:       ['employee','documents','client','fixed_value','attendance','maintenance','claims_portal'],
  procurement_proposer:  ['billing','vendor','inventory'],
  procurement_approver:  ['billing','vendor','inventory'],
  procurement_manager:   ['billing','vendor','inventory','ap','maintenance'],
  procurement:           ['billing','vendor','inventory','ap'],
  finance_proposer:      ['billing','invoices','fixed_value','po_tracking','employee','ap','vendor','inventory','annexure','maintenance'],
  finance_approver:      ['payroll','billing','invoices','fixed_value','po_tracking','client','annexure','config','users','attendance','email_claims','wafi_claims','claims_portal'],
  finance_manager:       ['payroll','billing','invoices','fixed_value','po_tracking','ap','client','vendor','annexure','config','users','attendance','maintenance','email_claims','wafi_claims','claims_portal'],
  ap_team:               ['ap','billing','fixed_value'],
  ar_team:               ['invoices','fixed_value','po_tracking','billing'],
  payroll_initiator:     ['payroll','fixed_value','employee','claims_portal'],
  payroll:               ['payroll','fixed_value','employee','claims_portal'],
  bizdev:                ['client'],
  supervisor:            ['attendance','maintenance'],
  pending:               [],
};

// Sub-permission defaults per role per module
const ROLE_SUB_PERMS = {
  superadmin: {
    dashboard:   ['view'],
    employee:    ['view','create','edit','delete'],
    payroll:     ['view','edit','lock','export'],
    documents:   ['view','generate'],
    billing:     ['view','create','edit','approve','mark_paid'],
    invoices:    ['view','create','approve'],
    po_tracking: ['view','create','edit'],
    ap:          ['view','confirm'],
    client:      ['view','create','edit'],
    vendor:      ['view','create','edit','delete'],
    inventory:   ['view','create','edit','issue'],
    annexure:    ['view','approve'],
    config:      ['view','edit'],
    users:       ['view','create','assign_role'],
    attendance:  ['view','mark_attendance','approve_leave','team_setup'],
    maintenance: ['view','create','escalation_config'],
    email_claims: ['view','trigger_poll'],
    wafi_claims: ['view','approve','export'],
    claims_portal: ['view','campaign','export','claims_manual_override'],
  },
  finance_proposer: {
    billing:     ['view','create','edit'],
    invoices:    ['view','create'],
    po_tracking: ['view','create','edit'],
    annexure:    ['view'],
    employee:    ['view'],
    payroll:     ['view'],
    ap:          ['view'],
    vendor:      ['view','create','edit'],
    inventory:   ['view','create'],
  },
  finance_approver: {
    payroll:     ['view','edit','lock','export'],
    billing:     ['view','create','edit','approve'],
    invoices:    ['view','create','approve'],
    po_tracking: ['view','create','edit'],
    client:      ['view'],
    annexure:    ['view','approve'],
    config:      ['view','edit'],
    users:       ['view','assign_role'],
    attendance:  ['view','approve_leave'],
    email_claims: ['view','trigger_poll'],
    wafi_claims: ['view','approve','export'],
    claims_portal: ['view','campaign','export','claims_manual_override'],
  },
  finance_manager: {
    payroll:     ['view','edit','lock','export'],
    billing:     ['view','create','edit','approve','mark_paid'],
    invoices:    ['view','create','approve'],
    po_tracking: ['view','create','edit'],
    ap:          ['view','confirm'],
    client:      ['view','create','edit'],
    vendor:      ['view','create','edit'],
    annexure:    ['view','approve'],
    config:      ['view','edit'],
    users:       ['view','create','assign_role'],
    attendance:  ['view','approve_leave'],
    maintenance: ['view','create','escalation_config'],
    email_claims: ['view','trigger_poll'],
    wafi_claims: ['view','approve','export'],
    claims_portal: ['view','campaign','export','claims_manual_override'],
  },
  procurement_proposer: {
    billing:   ['view','create','edit'],
    vendor:    ['view','create','edit'],
    inventory: ['view','create','edit','issue'],
  },
  procurement_approver: {
    billing:   ['view','create','edit','approve'],
    vendor:    ['view','create','edit'],
    inventory: ['view','edit'],
  },
  procurement_manager: {
    billing:   ['view','create','edit','approve','mark_paid'],
    vendor:    ['view','create','edit','delete'],
    inventory: ['view','create','edit','issue'],
    ap:        ['view','confirm'],
  },
  ap_team: {
    ap:      ['view','confirm'],
    billing: ['view'],
  },
  ar_team: {
    invoices:    ['view','create'],
    po_tracking: ['view','create','edit'],
    billing:     ['view'],
  },
  payroll_initiator: {
    payroll:  ['view','edit','lock','export'],
    employee: ['view'],
  },
  operations: {
    employee:  ['view','create','edit'],
    documents: ['view','generate'],
    client:    ['view'],
    attendance: ['view','mark_attendance','approve_leave','team_setup'],
    maintenance: ['view','create'],
  },
  operations_supervisor: {
    employee:  ['view','create','edit'],
    documents: ['view','generate'],
    client:    ['view','create','edit'],
    attendance: ['view','mark_attendance','approve_leave','team_setup'],
    maintenance: ['view','create','escalation_config'],
    claims_portal: ['view','campaign','export','claims_manual_override'],
  },
  operations_team: {
    employee:  ['view','edit'],
    documents: ['view','generate'],
    client:    ['view'],
    attendance: ['view','mark_attendance'],
    maintenance: ['view','create'],
  },
  procurement: {
    billing:   ['view','create','edit','approve','mark_paid'],
    vendor:    ['view','create','edit'],
    inventory: ['view','create','edit','issue'],
    ap:        ['view','confirm'],
  },
  payroll: {
    payroll:  ['view','edit','lock','export'],
    employee: ['view'],
  },
  bizdev: {
    client: ['view','create','edit'],
  },
  supervisor: {
    attendance: ['view','mark_attendance'],
    maintenance: ['view','create'],
  },
  pending: {},
};

/** Normalize DB/custom permission entries into { access, subPerms[] }. */
function normalizePermEntry(raw, fallback = { access: false, subPerms: [] }) {
  if (raw == null) return { access: !!fallback.access, subPerms: Array.isArray(fallback.subPerms) ? [...fallback.subPerms] : [] };
  if (typeof raw === 'boolean') {
    return { access: raw, subPerms: raw ? (Array.isArray(fallback.subPerms) && fallback.subPerms.length ? [...fallback.subPerms] : ['view']) : [] };
  }
  if (typeof raw !== 'object') return { access: false, subPerms: [] };
  const access = raw.access === true || raw.access === 'true' || raw.access === 1;
  let subPerms = raw.subPerms ?? raw.sub_perms ?? raw.perms;
  if (!Array.isArray(subPerms)) subPerms = access ? ['view'] : [];
  return { access, subPerms: subPerms.map(String) };
}

const SUB_PERM_LABELS = {
  view:             { label: 'View',            color: '#38bdf8' },
  create:           { label: 'Create',          color: '#10b981' },
  edit:             { label: 'Edit',            color: '#f59e0b' },
  mark_attendance:  { label: 'Mark Attendance', color: '#22c55e' },
  approve_leave:    { label: 'Approve Leave',   color: '#38bdf8' },
  team_setup:       { label: 'Team Setup',      color: '#a78bfa' },
  escalation_config:{ label: 'Escalation Config', color: '#f97316' },
  trigger_poll:     { label: 'Trigger Poll',    color: '#38bdf8' },
  delete:      { label: 'Delete',      color: '#ef4444' },
  approve:     { label: 'Approve',     color: '#a78bfa' },
  mark_paid:   { label: 'Mark Paid',   color: '#22c55e' },
  export:      { label: 'Export',      color: '#fb923c' },
  lock:        { label: 'Lock',        color: '#e879f9' },
  generate:    { label: 'Generate',    color: '#4ade80' },
  confirm:     { label: 'Confirm',     color: '#34d399' },
  issue:       { label: 'Issue',       color: '#fbbf24' },
  assign_role: { label: 'Assign Role', color: '#818cf8' },
};

function buildDefaultPerms(role) {
  const allowed = ROLE_NAV_SET[role] || [];
  const subDefaults = ROLE_SUB_PERMS[role] || {};
  const perms = {};
  MODULES.forEach(m => {
    const hasAccess = (role === 'superadmin') || allowed.includes(m.key);
    perms[m.key] = {
      access: hasAccess,
      subPerms: hasAccess
        ? (subDefaults[m.key] || (hasAccess ? ['view'] : []))
        : [],
    };
  });
  return perms;
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function RoleBadge({ role, small }) {
  const { label, color, bg } = ROLE_META[role] || ROLE_META.pending;
  return (
    <span style={{
      padding: small ? '2px 8px' : '3px 10px',
      borderRadius: '99px',
      fontSize: small ? '0.7rem' : '0.75rem',
      fontWeight: 700, color, background: bg,
    }}>{label}</span>
  );
}

function PermPill({ label, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px', borderRadius: '99px', fontSize: '0.7rem',
        fontWeight: 700, cursor: onClick ? 'pointer' : 'default',
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.08)'}`,
        background: active ? `${color}20` : 'rgba(255,255,255,0.03)',
        color: active ? color : '#475569',
        transition: 'all 0.15s',
        outline: 'none',
      }}
    >{label}</button>
  );
}

// ─── Permission Editor Panel (per user) ──────────────────────────────────────
function PermissionsPanel({ user, onClose, onSaved }) {
  // Use saved custom permissions from DB if they exist; fall back to role defaults
  const [perms, setPerms] = useState(() => {
    const defaults = buildDefaultPerms(user.role);
    let saved = user.permissions;
    if (typeof saved === 'string') {
      try { saved = JSON.parse(saved); } catch (_) { saved = null; }
    }
    if (saved && typeof saved === 'object' && !Array.isArray(saved) && Object.keys(saved).length > 0) {
      const merged = { ...defaults };
      Object.keys(defaults).forEach(k => {
        if (saved[k] !== undefined) merged[k] = normalizePermEntry(saved[k], defaults[k]);
      });
      return merged;
    }
    return defaults;
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 2800); };

  const toggleAccess = (moduleKey) => {
    setPerms(prev => {
      const cur = normalizePermEntry(prev[moduleKey]);
      const next = !cur.access;
      return {
        ...prev,
        [moduleKey]: {
          access: next,
          subPerms: next ? ['view'] : [],
        },
      };
    });
    setDirty(true);
  };

  const toggleSubPerm = (moduleKey, perm) => {
    setPerms(prev => {
      const cur = normalizePermEntry(prev[moduleKey]);
      if (!cur.access) return prev;
      const has = cur.subPerms.includes(perm);
      const next = has ? cur.subPerms.filter(p => p !== perm) : [...cur.subPerms, perm];
      return { ...prev, [moduleKey]: { access: true, subPerms: next } };
    });
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateUserPermissions(user.id, perms);
      showToast('\u2705 Permissions saved successfully');
      setDirty(false);
      if (onSaved) onSaved();
    } catch (err) {
      showToast(`\u274c Save failed: ${err.message}`);
    }
    setSaving(false);
  };

  const accessCount = Object.values(perms).filter(p => normalizePermEntry(p).access).length;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '20px', overflowY: 'auto',
    }}>
      {toast && (
        <div style={{
          position: 'fixed', top: '16px', right: '20px', zIndex: 9999,
          background: toast.startsWith('✅') ? '#22c55e' : '#f59e0b',
          color: 'white', padding: '10px 18px', borderRadius: '10px',
          fontWeight: 700, fontSize: '0.85rem', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>{toast}</div>
      )}

      <div style={{
        background: '#0f172a', border: '1px solid rgba(99,102,241,0.35)',
        borderRadius: '18px', width: '100%', maxWidth: '820px',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
        marginTop: '10px',
      }}>
        {/* Modal Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(16,185,129,0.06))',
          borderRadius: '18px 18px 0 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {user.avatar
              ? <img src={user.avatar} alt="" style={{ width: '46px', height: '46px', borderRadius: '50%', border: '2px solid rgba(99,102,241,0.5)' }} />
              : <div style={{ width: '46px', height: '46px', borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '1.1rem', fontWeight: 800 }}>{user.name?.[0]?.toUpperCase()}</div>
            }
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: '#f1f5f9' }}>{user.name || 'Unknown User'}</div>
              <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '2px' }}>{user.email}</div>
              <div style={{ marginTop: '5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RoleBadge role={user.role} small />
                <span style={{ color: '#475569', fontSize: '0.72rem' }}>• {accessCount} / {MODULES.length} modules enabled</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', padding: '7px', borderRadius: '8px', cursor: 'pointer', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Role description */}
        <div style={{ padding: '12px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Info size={14} color="#6366f1" />
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
            <strong style={{ color: '#94a3b8' }}>Base role:</strong> {ROLE_META[user.role]?.desc || '—'}
          </span>
        </div>

        {/* Module permission grid */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
            Module Access & Sub-Permissions
          </div>

          {MODULES.map(mod => {
            const mp = normalizePermEntry(perms[mod.key]);
            const isSuperAdmin = user.role === 'superadmin';

            return (
              <div key={mod.key} style={{
                background: mp.access ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${mp.access ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: '12px', padding: '14px 16px',
                transition: 'all 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  {/* Toggle */}
                  <button
                    onClick={() => !isSuperAdmin && toggleAccess(mod.key)}
                    title={isSuperAdmin ? 'SuperAdmin always has full access' : (mp.access ? 'Revoke access' : 'Grant access')}
                    style={{
                      width: '38px', height: '20px', borderRadius: '99px', border: 'none', cursor: isSuperAdmin ? 'default' : 'pointer',
                      background: mp.access ? '#6366f1' : '#1e293b',
                      position: 'relative', flexShrink: 0, transition: 'background 0.2s',
                      boxShadow: mp.access ? '0 0 8px rgba(99,102,241,0.4)' : 'none',
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: '2px',
                      left: mp.access ? '20px' : '2px',
                      width: '16px', height: '16px', borderRadius: '50%',
                      background: '#fff', transition: 'left 0.2s',
                    }} />
                  </button>

                  {/* Module name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 220px' }}>
                    <span style={{ color: mp.access ? '#6366f1' : '#334155' }}>{mod.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: '0.83rem', color: mp.access ? '#e2e8f0' : '#475569' }}>
                      {mod.label}
                    </span>
                  </div>

                  {/* Sub-permission pills */}
                  {mp.access ? (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
                      {mod.subPerms.map(sp => {
                        const meta = SUB_PERM_LABELS[sp];
                        const active = mp.subPerms.includes(sp);
                        return (
                          <PermPill
                            key={sp}
                            label={meta?.label || sp}
                            color={meta?.color || '#94a3b8'}
                            active={active}
                            onClick={isSuperAdmin ? null : () => toggleSubPerm(mod.key, sp)}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ flex: 1 }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: '99px', fontSize: '0.7rem',
                        fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.2)',
                      }}>🔒 Forbidden — Insufficient Role</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.01)', borderRadius: '0 0 18px 18px',
          flexWrap: 'wrap', gap: '12px',
        }}>
          <div style={{ fontSize: '0.76rem', color: '#475569' }}>
            {dirty ? '⚠️ You have unsaved changes' : '✓ Configuration matches role defaults'}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '8px 20px', borderRadius: '8px', background: dirty ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#1e293b', border: 'none', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '7px', opacity: saving ? 0.7 : 1 }}>
              <Save size={14} />
              {saving ? 'Saving…' : 'Save Permissions'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Role Reference Matrix ────────────────────────────────────────────────────
function RoleMatrix() {
  const roles = Object.keys(ROLE_NAV_SET).filter(r => r !== 'pending');

  return (
    <div style={{ overflowX: 'auto', marginTop: '8px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', minWidth: '900px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid rgba(99,102,241,0.3)' }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', color: '#94a3b8', fontWeight: 700, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: '#0f172a', zIndex: 2 }}>Module</th>
            {roles.map(r => (
              <th key={r} style={{ padding: '10px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                <span style={{ color: (ROLE_META[r] || ROLE_META.pending).color, fontWeight: 700, fontSize: '0.68rem' }}>
                  {(ROLE_META[r] || ROLE_META.pending).label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULES.map((mod, mi) => (
            <tr key={mod.key} style={{
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              background: mi % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
            }}>
              <td style={{
                padding: '9px 14px', fontWeight: 600, color: '#cbd5e1',
                display: 'flex', alignItems: 'center', gap: '7px',
                position: 'sticky', left: 0, background: mi % 2 === 0 ? '#0d1829' : '#0f172a', zIndex: 1,
                whiteSpace: 'nowrap',
              }}>
                <span style={{ color: '#6366f1' }}>{mod.icon}</span>
                {mod.label}
              </td>
              {roles.map(r => {
                const nav = ROLE_NAV_SET[r] || [];
                const allowed = nav.includes(mod.key) || r === 'superadmin';
                return (
                  <td key={r} style={{ padding: '9px 8px', textAlign: 'center' }}>
                    {allowed
                      ? <span style={{ color: '#10b981', fontSize: '1rem' }}>✅</span>
                      : <span style={{ color: '#334155', fontSize: '0.9rem' }}>—</span>
                    }
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function UserManagement({ user: currentUser }) {
  const isSuperAdmin = currentUser?.role === 'superadmin';
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'matrix' | 'roles'
  const [permPanel, setPermPanel] = useState(null); // user obj or null
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('finance_proposer');
  const [addLoading, setAddLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api.getUsers();
      setUsers(d.users || []);
    } catch (e) {
      setError(`Failed to load users: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(load, [load]);

  const addUser = async () => {
    if (!addEmail.trim()) return;
    if (!addEmail.toLowerCase().endsWith('@asil.com.pk')) {
      showToast('❌ Only @asil.com.pk addresses accepted');
      return;
    }
    setAddLoading(true);
    try {
      const d = await api.createUser({ email: addEmail.trim().toLowerCase(), role: addRole });
      setUsers(prev => [...prev.filter(u => u.email !== d.user.email), d.user]);
      setAddEmail(''); setAddRole('finance_proposer'); setShowAddForm(false);
      showToast(`✅ ${d.user.email} pre-registered as ${ROLE_META[addRole]?.label}`);
    } catch (e) { showToast(`❌ ${e.message}`); }
    setAddLoading(false);
  };

  const changeRole = async (userId, newRole, userName) => {
    setSaving(userId);
    try {
      await api.updateUserRole(userId, newRole);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
      showToast(`✅ ${userName}'s role → ${ROLE_META[newRole]?.label}`);
    } catch (e) { showToast(`❌ ${e.message}`); }
    setSaving(null);
  };

  const filtered = users.filter(u =>
    !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const pendingCount = users.filter(u => u.role === 'pending').length;

  // ── Tab style helper
  const tabStyle = (key) => ({
    padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer',
    fontWeight: 700, fontSize: '0.82rem',
    background: activeTab === key ? 'rgba(99,102,241,0.2)' : 'transparent',
    color: activeTab === key ? '#818cf8' : '#64748b',
    display: 'flex', alignItems: 'center', gap: '7px',
    transition: 'all 0.15s',
  });

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Permission Panel Overlay */}
      {permPanel && (
        <PermissionsPanel
          user={permPanel}
          onClose={() => setPermPanel(null)}
          onSaved={load}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          background: toast.startsWith('✅') ? '#22c55e' : toast.startsWith('⚠️') ? '#f59e0b' : '#ef4444',
          color: 'white', padding: '12px 20px', borderRadius: '10px',
          fontWeight: 700, fontSize: '0.88rem', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          animation: 'slideIn 0.3s ease',
        }}>{toast}</div>
      )}

      {/* ── Page Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '48px', height: '48px',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.15))',
            borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid rgba(99,102,241,0.3)',
          }}>
            <Shield size={24} color="#818cf8" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#f1f5f9' }}>User Permissions & Access</h1>
            <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem', marginTop: '2px' }}>
              {users.length} registered users · {pendingCount} pending
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem' }}>
            <RefreshCcw size={13} /> Refresh
          </button>
          <button onClick={() => setShowAddForm(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700 }}>
            <UserPlus size={15} /> Add User
          </button>
        </div>
      </div>

      {/* Pending alert */}
      {pendingCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '10px', padding: '12px 16px', marginBottom: '1.25rem' }}>
          <AlertTriangle size={16} color="#f59e0b" />
          <span style={{ color: '#f59e0b', fontWeight: 600, fontSize: '0.85rem' }}>
            {pendingCount} user{pendingCount > 1 ? 's' : ''} awaiting role assignment — expand their row to assign.
          </span>
        </div>
      )}

      {/* Add User Form */}
      {showAddForm && (
        <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '14px', padding: '1.25rem 1.5rem', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <UserPlus size={14} /> Pre-Register New User
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 2, minWidth: '220px' }}>
              <label style={{ fontSize: '0.73rem', color: '#64748b', display: 'block', marginBottom: '4px' }}>Email (@asil.com.pk)</label>
              <input
                type="email" value={addEmail}
                onChange={e => setAddEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addUser()}
                placeholder="laiba.mughal@asil.com.pk"
                style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '9px 12px', color: '#f1f5f9', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ fontSize: '0.73rem', color: '#64748b', display: 'block', marginBottom: '4px' }}>Assign Role</label>
              <select value={addRole} onChange={e => setAddRole(e.target.value)}
                style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '9px 12px', color: '#f1f5f9', fontSize: '0.85rem', outline: 'none' }}>
                {ROLE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setShowAddForm(false)} style={{ padding: '9px 14px', borderRadius: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem' }}>
                Cancel
              </button>
              <button onClick={addUser} disabled={!addEmail.trim() || addLoading}
                style={{ padding: '9px 20px', borderRadius: '8px', background: '#6366f1', border: 'none', color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', opacity: addLoading ? 0.7 : 1 }}>
                {addLoading ? 'Adding…' : '+ Add User'}
              </button>
            </div>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '0.73rem', color: '#475569' }}>
            The user will receive their role automatically when they sign in with their Google account for the first time.
          </p>
        </div>
      )}

      {/* ── Tab Navigation */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '1.25rem', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '10px', width: 'fit-content', border: '1px solid rgba(255,255,255,0.06)' }}>
        <button style={tabStyle('users')} onClick={() => setActiveTab('users')}><Users size={14} /> Users</button>
        <button style={tabStyle('matrix')} onClick={() => setActiveTab('matrix')}><Grid size={14} /> Role Matrix</button>
        <button style={tabStyle('roles')} onClick={() => setActiveTab('roles')}><BookOpen size={14} /> Role Guide</button>
      </div>

      {/* ── TAB: Users */}
      {activeTab === 'users' && (
        <>
          {/* Search */}
          <div style={{ position: 'relative', marginBottom: '1rem', maxWidth: '340px' }}>
            <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '8px 12px 8px 34px', color: '#f1f5f9', fontSize: '0.83rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '4rem', color: '#475569' }}>
              <div style={{ width: '32px', height: '32px', border: '2px solid #1e293b', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
              Loading users…
            </div>
          ) : error ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px', padding: '1rem 1.5rem', maxWidth: '480px' }}>
                <XCircle size={20} color="#ef4444" style={{ flexShrink: 0 }} />
                <div style={{ textAlign: 'left' }}>
                  <div style={{ color: '#f87171', fontWeight: 700, fontSize: '0.85rem', marginBottom: '4px' }}>Could not load users</div>
                  <div style={{ color: '#64748b', fontSize: '0.78rem' }}>{error}</div>
                </div>
                <button onClick={load} style={{ marginLeft: '8px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, flexShrink: 0 }}>
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: '4rem', color: '#475569', fontSize: '0.88rem' }}>No users match your search.</div>
              )}
              {filtered.map(u => (
                <UserRow
                  key={u.id}
                  user={u}
                  saving={saving === u.id}
                  isSuperAdmin={isSuperAdmin}
                  onChangeRole={(newRole) => changeRole(u.id, newRole, u.name)}
                  onOpenPerms={() => setPermPanel(u)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── TAB: Matrix */}
      {activeTab === 'matrix' && (
        <div style={{ background: '#0a1020', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Grid size={16} color="#6366f1" />
            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e2e8f0' }}>Module Access Matrix — All Roles</span>
          </div>
          <RoleMatrix />
        </div>
      )}

      {/* ── TAB: Role Guide */}
      {activeTab === 'roles' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {ROLE_OPTIONS.map(({ value: r }) => {
            const meta = ROLE_META[r] || ROLE_META.pending;
            const { label, color, bg, desc } = meta;
            const modules = (ROLE_NAV_SET[r] || []).map(k => MODULES.find(m => m.key === k)?.label).filter(Boolean);
            return (
              <div key={r} style={{ background: '#0a1020', border: `1px solid ${color}30`, borderRadius: '14px', padding: '18px', transition: 'transform 0.15s, box-shadow 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${color}18`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${color}40` }}>
                    <Shield size={16} color={color} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.88rem', color }}>{label}</div>
                    <div style={{ fontSize: '0.7rem', color: '#475569', fontFamily: 'monospace' }}>{r}</div>
                  </div>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.5 }}>{desc}</p>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Module Access ({modules.length})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {modules.length === 0
                    ? <span style={{ color: '#ef4444', fontSize: '0.73rem' }}>No modules</span>
                    : modules.map(m => (
                      <span key={m} style={{ padding: '2px 8px', borderRadius: '5px', fontSize: '0.68rem', background: `${color}15`, color, fontWeight: 600, border: `1px solid ${color}25` }}>{m}</span>
                    ))
                  }
                </div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

// ─── User Row (expandable) ────────────────────────────────────────────────────
function UserRow({ user, saving, isSuperAdmin, onChangeRole, onOpenPerms }) {
  const hasRole = user.role && user.role !== 'pending';
  const { color, bg, label } = ROLE_META[user.role] || ROLE_META.pending;
  const allowedModules = ROLE_NAV_SET[user.role] || [];

  return (
    <div style={{
      background: user.role === 'pending' ? 'rgba(245,158,11,0.04)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${user.role === 'pending' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: '14px', overflow: 'hidden', transition: 'box-shadow 0.2s',
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', flexWrap: 'wrap', gap: '12px' }}>
        {/* Avatar */}
        {user.avatar
          ? <img src={user.avatar} alt="" style={{ width: '38px', height: '38px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.08)', flexShrink: 0 }} />
          : <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: `linear-gradient(135deg, ${color}, ${color}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.9rem', fontWeight: 800, flexShrink: 0 }}>{user.name?.[0]?.toUpperCase() || '?'}</div>
        }

        {/* Name + email */}
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name || '—'}</div>
          <div style={{ color: '#475569', fontSize: '0.76rem', marginTop: '2px' }}>{user.email}</div>
        </div>

        {/* Current role badge */}
        <div style={{ flex: '0 0 auto' }}>
          <RoleBadge role={user.role} />
        </div>

        {/* Last login */}
        <div style={{ flex: '0 0 100px', fontSize: '0.76rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Clock size={11} />
          {user.last_login ? new Date(user.last_login).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : 'Never'}
        </div>

        {/* Role selector */}
        <div style={{ flex: '0 0 auto' }}>
          <select
            value={user.role}
            disabled={saving}
            onChange={e => onChangeRole(e.target.value)}
            style={{
              background: '#0a1020', border: '1px solid rgba(255,255,255,0.1)',
              color: color, padding: '6px 10px', borderRadius: '8px',
              fontSize: '0.8rem', cursor: 'pointer', fontWeight: 700,
              outline: 'none', opacity: saving ? 0.6 : 1,
            }}>
            {/* Only superadmin can assign superadmin role */}
            {ROLE_OPTIONS.filter(opt => isSuperAdmin || opt.value !== 'superadmin').map(opt => (
              <option key={opt.value} value={opt.value} style={{ color: '#e2e8f0', background: '#0a1020' }}>{opt.label}</option>
            ))}
            <option value="pending" style={{ color: '#94a3b8', background: '#0a1020' }}>Access Pending</option>
          </select>
        </div>

        {/* Configure Permissions — superadmin only */}
        {isSuperAdmin ? (
          <button onClick={onOpenPerms}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
              color: '#818cf8', padding: '6px 14px', borderRadius: '8px',
              cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700,
              flexShrink: 0, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; }}
          >
            <Lock size={12} /> Configure
          </button>
        ) : (
          <span style={{ fontSize: '0.7rem', color: '#334155', fontStyle: 'italic', flexShrink: 0 }}>
            Role default
          </span>
        )}
      </div>

      {/* Module access pills */}
      {hasRole && allowedModules.length > 0 && (
        <div style={{ padding: '8px 18px 14px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.68rem', color: '#334155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '4px' }}>Access:</span>
          {allowedModules.map(k => {
            const mod = MODULES.find(m => m.key === k);
            return mod ? (
              <span key={k} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 9px', borderRadius: '6px', fontSize: '0.68rem', background: 'rgba(99,102,241,0.08)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)', fontWeight: 600 }}>
                {mod.icon}{mod.label}
              </span>
            ) : null;
          })}
          {user.role === 'superadmin' && <span style={{ padding: '2px 9px', borderRadius: '6px', fontSize: '0.68rem', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)', fontWeight: 700 }}>+ All Modules</span>}
        </div>
      )}
    </div>
  );
}

