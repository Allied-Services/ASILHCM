import React, { useState } from 'react';
import { Home, FileText, ScanLine, Settings, Users, Building, Truck, Calculator, FilePlus, Receipt, Smartphone } from 'lucide-react';
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

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showESS, setShowESS] = useState(false);

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
    { key: 'ocr', label: 'Katcha Bill / OCR', icon: <ScanLine size={20} />, hidden: true }, // now inside Bills & Procurement
    { key: 'config', label: 'System Configs', icon: <Settings size={20} />, disabled: true },
  ];

  return (
    <>
      {/* ── Employee Self-Service Portal (light theme, overlays the admin app) ── */}
      {showESS && <EmployeePortal />}

      <div className="app-container">
        <aside className="sidebar">
          <div className="logo">
            <ScanLine className="logo-icon" size={28} />
            ASIL HCM System
          </div>

          <nav className="nav-menu">
            {NAV.filter(n => !n.hidden).map(n => (
              <button
                key={n.key}
                className={`nav-item ${activeTab === n.key ? 'active' : ''}`}
                onClick={() => !n.disabled && setActiveTab(n.key)}
                disabled={n.disabled}
                style={n.disabled ? { opacity: 0.45, cursor: 'not-allowed' } : {}}
              >
                {n.icon}
                {n.label}
              </button>
            ))}
          </nav>

          {/* ESS portal shortcut */}
          <div style={{ marginTop: '16px', padding: '0 4px' }}>
            <button
              onClick={() => setShowESS(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '8px', background: showESS ? 'rgba(56,189,248,0.15)' : 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)', color: '#38bdf8', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
            >
              <Smartphone size={16} />
              {showESS ? 'Close Employee Portal' : 'Preview Employee Portal'}
            </button>
          </div>

          <div style={{ marginTop: 'auto', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', padding: '1rem' }}>
            Allied Services (Pvt.) Ltd.<br />ASIL HCM · 2026
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
          {activeTab === 'ocr' && <MockOCR />}
        </main>
      </div>
    </>
  );
}

export default App;
