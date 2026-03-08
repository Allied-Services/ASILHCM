import React, { useState, useEffect } from 'react';
import { Home, FileText, ScanLine, Settings, Users, Building, Truck, Calculator, FilePlus, Receipt, Smartphone, LogOut } from 'lucide-react';
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
import EmployeePortal from './EmployeePortal';
import LoginScreen from './LoginScreen';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showESS, setShowESS] = useState(false);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState(null);

  // ── On mount: check for ?token in URL (post-OAuth redirect) or stored token ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const urlError = params.get('error');

    if (urlError) {
      setAuthError(urlError);
      setAuthReady(true);
      window.history.replaceState({}, '', '/');
      return;
    }

    if (urlToken) {
      localStorage.setItem('asil_hcm_token', urlToken);
      window.history.replaceState({}, '', '/');
    }

    const token = urlToken || localStorage.getItem('asil_hcm_token');
    if (!token) { setAuthReady(true); return; }

    fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setUser(data.user); setAuthReady(true); })
      .catch(() => { localStorage.removeItem('asil_hcm_token'); setAuthReady(true); });
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('asil_hcm_token');
    setUser(null);
    setAuthError(null);
  };

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

  // ── Not authenticated → Login ──────────────────────────────────────────────
  if (!user) return <LoginScreen error={authError} />;

  // ── Authenticated → Full App ───────────────────────────────────────────────
  const NAV = [
    { key: 'dashboard', label: 'Managing Director View', icon: <Home size={20} /> },
    { key: 'employee', label: 'Employee Information', icon: <Users size={20} /> },
    { key: 'payroll', label: 'Payroll Sheet', icon: <Calculator size={20} /> },
    { key: 'documents', label: 'Document Generator', icon: <FilePlus size={20} /> },
    { key: 'billing', label: 'Bills & Procurement', icon: <Receipt size={20} /> },
    { key: 'invoices', label: 'Invoices', icon: <FileText size={20} /> },
    { key: 'client', label: 'Client Information', icon: <Building size={20} /> },
    { key: 'vendor', label: 'Vendor Supplier Master', icon: <Truck size={20} /> },
    { key: 'annexure', label: 'Annexure Approval', icon: <ScanLine size={20} /> },
    { key: 'config', label: 'System Configs', icon: <Settings size={20} />, disabled: true },
  ];

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
              <button key={n.key} className={`nav-item ${activeTab === n.key ? 'active' : ''}`}
                onClick={() => !n.disabled && setActiveTab(n.key)} disabled={n.disabled}
                style={n.disabled ? { opacity: 0.45, cursor: 'not-allowed' } : {}}>
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

          {/* User info + logout */}
          <div style={{ marginTop: 'auto', padding: '12px 8px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', marginBottom: '8px' }}>
              {user.avatar
                ? <img src={user.avatar} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
                : <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.75rem', fontWeight: 700 }}>{user.name?.[0]?.toUpperCase()}</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e2e8f0', fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                <div style={{ color: '#64748b', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
              </div>
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
          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'employee' && <EmployeeInformation />}
          {activeTab === 'payroll' && <PayrollSheet />}
          {activeTab === 'documents' && <DocumentGenerator />}
          {activeTab === 'billing' && <BillingProcurement />}
          {activeTab === 'invoices' && <InvoiceSection />}
          {activeTab === 'client' && <ClientInformation />}
          {activeTab === 'vendor' && <VendorMaster />}
          {activeTab === 'annexure' && <AnnexureDashboard />}
        </main>
      </div>
    </>
  );
}

export default App;
