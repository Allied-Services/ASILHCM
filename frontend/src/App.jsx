import React, { useState, useEffect } from 'react';
import { Home, FileText, ScanLine, Settings, Users, Building, Truck, Calculator, FilePlus, Receipt, Smartphone, LogOut, Package, Shield, Clock, CreditCard, Mail, Inbox, Wrench } from 'lucide-react';
import EmailClaimsListener from './EmailClaimsListener';
import WafiClaimsDashboard from './WafiClaimsDashboard';
import Dashboard from './Dashboard';
import AnnexureDashboard from './AnnexureDashboard';
import MockOCR from './MockOCR';
import EmployeeInformation from './EmployeeInformation';
import ClientInformation from './ClientInformation';
import VendorMaster from './VendorMaster';
import PayrollSheet from './PayrollSheet';
import DocumentGenerator from './DocumentGenerator';
import BillingProcurement from './BillingProcurement';
import InvoiceSection from './InvoiceSection';
import AccountsPayable from './AccountsPayable';
import EmployeePortal from './EmployeePortal';
import LoginScreen from './LoginScreen';
import InventoryManagement from './InventoryManagement';
import SystemConfig from './SystemConfig';
import UserManagement from './UserManagement';
import POTracking from './POTracking';
import AttendanceManagement from './AttendanceManagement';
import MaintenanceCMMS from './MaintenanceCMMS';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';

// ── Role-based nav access ─────────────────────────────────────────────────────
// finance_proposer: can see Employee Info (view), AP (view), Vendor (register/view/edit),
// Inventory (create/add), Bills, Invoices (forbidden — enforced inside component), Annexure
const ROLE_NAV = {
    superadmin:           ['dashboard','employee','payroll','documents','billing','invoices','po_tracking','ap','client','vendor','inventory','annexure','config','users','attendance','maintenance','email_claims','wafi_claims'],
    supervisor:           ['attendance','maintenance'],
    operations:           ['employee','documents','client','attendance','maintenance'],
    procurement_proposer: ['billing','vendor','inventory'],
    procurement_approver: ['billing','vendor','inventory'],
    procurement_manager:  ['billing','vendor','inventory','ap','maintenance'],
    finance_proposer:     ['billing','invoices','po_tracking','employee','ap','vendor','inventory','annexure','maintenance'],
    finance_approver:     ['payroll','billing','invoices','po_tracking','client','annexure','config','users','attendance','email_claims','wafi_claims'],
    finance_manager:      ['payroll','billing','invoices','po_tracking','ap','client','vendor','annexure','config','users','attendance','maintenance','email_claims','wafi_claims'],
    ap_team:              ['ap','billing'],
    ar_team:              ['invoices','po_tracking','billing'],
    payroll_initiator:    ['payroll','employee'],
    pending:              [],
};

const ROLE_BADGE = {
    superadmin:           { label: 'Super Admin',           color: '#f59e0b' },
    supervisor:           { label: 'Supervisor',             color: '#22c55e' },
    operations:           { label: 'Operations',            color: '#3b82f6' },
    procurement_proposer: { label: 'Proc. Proposer',        color: '#8b5cf6' },
    procurement_approver: { label: 'Proc. Approver',        color: '#6366f1' },
    procurement_manager:  { label: 'Procurement Mgr',       color: '#7c3aed' },
    finance_proposer:     { label: 'Finance Proposer',      color: '#10b981' },
    finance_approver:     { label: 'Finance Approver',      color: '#14b8a6' },
    finance_manager:      { label: 'Finance Manager',       color: '#0ea5e9' },
    ap_team:              { label: 'AP Team',               color: '#22c55e' },
    ar_team:              { label: 'AR Team',               color: '#38bdf8' },
    payroll_initiator:    { label: 'Payroll Initiator',     color: '#f43f5e' },
    pending:              { label: 'Access Pending',         color: '#94a3b8' },
};

function App() {
  const portalPath = window.location.pathname === '/portal' || window.location.pathname === '/portal/';
  if (portalPath) return <EmployeePortal />;

  const [activeTab, setActiveTab] = useState('dashboard');
  const [showESS, setShowESS] = useState(false);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const urlError = params.get('error');

    if (urlError) { setAuthError(urlError); setAuthReady(true); window.history.replaceState({}, '', '/'); return; }

    if (urlToken) { localStorage.setItem('asil_hcm_token', urlToken); window.history.replaceState({}, '', '/'); }

    const token = urlToken || localStorage.getItem('asil_hcm_token');
    if (!token) { setAuthReady(true); return; }

    fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setUser(data.user); setAuthReady(true); })
      .catch(() => { localStorage.removeItem('asil_hcm_token'); setAuthReady(true); });
  }, []);

  const handleLogout = () => { localStorage.removeItem('asil_hcm_token'); setUser(null); setAuthError(null); };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!authReady) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#94a3b8', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '20px', height: '20px', border: '2px solid #334155', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Loading ASIL HCM…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return <LoginScreen error={authError} />;

  const role = user.role || 'pending';
  const roleBadge = ROLE_BADGE[role] || ROLE_BADGE.pending;

  // Compute allowed tabs:
  // 1. SuperAdmin -> always full access (no custom perms can restrict this)
  // 2. User has saved custom permissions (from User Management panel) -> use those
  // 3. Fallback -> role-based ROLE_NAV defaults
  let allowedTabs;
  if (role === 'superadmin') {
    allowedTabs = ['dashboard','employee','payroll','documents','billing','invoices','po_tracking','ap','client','vendor','inventory','annexure','config','users','attendance','maintenance','email_claims','wafi_claims'];
  } else if (user.permissions && typeof user.permissions === 'object' && Object.keys(user.permissions).length > 0) {
    // Saved custom permissions: show all modules where access === true
    allowedTabs = Object.entries(user.permissions)
      .filter(([, p]) => p && p.access === true)
      .map(([key]) => key);
  } else {
    allowedTabs = ROLE_NAV[role] || [];
  }

  // Auto-redirect to first allowed tab if current tab not accessible
  const effectiveTab = allowedTabs.includes(activeTab) ? activeTab : (allowedTabs[0] || '');

  // ── Pending user screen ────────────────────────────────────────────────────
  if (role === 'pending') {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '24px' }}>
        <div style={{ textAlign: 'center', maxWidth: '420px' }}>
          <div style={{ width: '64px', height: '64px', background: 'rgba(99,102,241,0.12)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Clock size={32} color="#6366f1" />
          </div>
          <h1 style={{ color: '#e2e8f0', margin: '0 0 10px', fontSize: '1.4rem' }}>Access Pending</h1>
          <p style={{ color: '#64748b', margin: '0 0 8px', lineHeight: '1.6' }}>
            Your account <strong style={{ color: '#94a3b8' }}>{user.email}</strong> is registered but has not been assigned a role yet.
          </p>
          <p style={{ color: '#64748b', margin: '0 0 24px', fontSize: '0.88rem' }}>
            Please contact your Super Admin to assign your role. Once assigned, sign out and sign back in.
          </p>
          <button onClick={handleLogout} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.88rem' }}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Full nav definition — filtered per role
  const ALL_NAV = [
    { key: 'dashboard', label: 'Managing Director View', icon: <Home size={20} /> },
    { key: 'employee',  label: 'Employee Information',   icon: <Users size={20} /> },
    { key: 'payroll',   label: 'Payroll Sheet',          icon: <Calculator size={20} /> },
    { key: 'documents', label: 'Document Generator',     icon: <FilePlus size={20} /> },
    { key: 'billing',   label: 'Bills & Procurement',    icon: <Receipt size={20} /> },
    { key: 'invoices',    label: 'Invoices (AR)',          icon: <FileText size={20} /> },
    { key: 'po_tracking', label: 'PO Tracking',             icon: <Receipt size={20} /> },
    { key: 'ap',          label: 'Accounts Payable',       icon: <CreditCard size={20} /> },
    { key: 'client',    label: 'Client Information',     icon: <Building size={20} /> },
    { key: 'vendor',    label: 'Vendor Supplier Master', icon: <Truck size={20} /> },
    { key: 'inventory', label: 'Inventory & Equipment',  icon: <Package size={20} /> },
    { key: 'annexure',  label: 'Annexure Approval',      icon: <ScanLine size={20} /> },
    { key: 'config',    label: 'System Configs',         icon: <Settings size={20} /> },
    { key: 'users',       label: 'User Management',        icon: <Shield size={20} /> },
    { key: 'attendance',    label: 'Attendance',              icon: <Clock size={20} /> },
    { key: 'maintenance',   label: 'Maintenance & CMMS',      icon: <Wrench size={20} /> },
    { key: 'email_claims',  label: 'Email Claims',            icon: <Mail size={20} /> },
    { key: 'wafi_claims',   label: 'Wafi Claims',             icon: <Inbox size={20} /> },
  ];

  const NAV = ALL_NAV.filter(n => allowedTabs.includes(n.key));

  return (
    <>
      {showESS && <EmployeePortal />}
      <div className="app-container">
        <aside className="sidebar">
          <div className="logo">
            <ScanLine className="logo-icon" size={28} />
            ASIL HCM System
          </div>

          <nav className="nav-menu">
            {NAV.map(n => (
              <button key={n.key} className={`nav-item ${effectiveTab === n.key ? 'active' : ''}`}
                onClick={() => setActiveTab(n.key)}>
                {n.icon}{n.label}
              </button>
            ))}
          </nav>

          <div style={{ marginTop: '16px', padding: '0 4px' }}>
            <button onClick={() => setShowESS(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '8px', background: showESS ? 'rgba(56,189,248,0.15)' : 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)', color: '#38bdf8', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
              <Smartphone size={16} />
              {showESS ? 'Close Employee Portal' : 'Preview Employee Portal'}
            </button>
          </div>

          {/* User info + role badge + logout */}
          <div style={{ marginTop: 'auto', padding: '12px 8px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', marginBottom: '6px' }}>
              {user.avatar
                ? <img src={user.avatar} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
                : <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.75rem', fontWeight: 700 }}>{user.name?.[0]?.toUpperCase()}</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e2e8f0', fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                <div style={{ color: '#64748b', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
              </div>
            </div>
            {/* Role badge */}
            <div style={{ textAlign: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: roleBadge.color, background: `${roleBadge.color}18`, padding: '2px 10px', borderRadius: '99px' }}>
                {roleBadge.label}
              </span>
            </div>
            <button onClick={handleLogout}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px', borderRadius: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', color: '#64748b', cursor: 'pointer', fontSize: '0.8rem' }}>
              <LogOut size={14} /> Sign out
            </button>
            <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', padding: '8px 0 0' }}>
              Allied Services (Pvt.) Ltd. · ASIL HCM · 2026
            </div>
          </div>
        </aside>

        <main className="main-content">
          {effectiveTab === 'dashboard'  && <Dashboard />}
          {effectiveTab === 'employee'   && <EmployeeInformation user={user} />}
          {effectiveTab === 'payroll'    && <PayrollSheet user={user} />}
          {effectiveTab === 'documents'  && <DocumentGenerator />}
          {effectiveTab === 'billing'    && <BillingProcurement user={user} />}
          {effectiveTab === 'invoices'    && <InvoiceSection user={user} />}
          {effectiveTab === 'po_tracking' && <POTracking user={user} />}
          {effectiveTab === 'ap'          && <AccountsPayable user={user} />}
          {effectiveTab === 'client'     && <ClientInformation />}
          {effectiveTab === 'vendor'     && <VendorMaster />}
          {effectiveTab === 'inventory'  && <InventoryManagement />}
          {effectiveTab === 'annexure'   && <AnnexureDashboard />}
          {effectiveTab === 'config'     && <SystemConfig user={user} />}
          {effectiveTab === 'users'      && <UserManagement user={user} />}
          {effectiveTab === 'attendance'   && <AttendanceManagement user={user} />}
          {effectiveTab === 'maintenance'  && <MaintenanceCMMS user={user} />}
          {effectiveTab === 'email_claims' && <EmailClaimsListener user={user} />}
          {effectiveTab === 'wafi_claims'  && <WafiClaimsDashboard user={user} />}
        </main>
      </div>
    </>
  );
}

export default App;
