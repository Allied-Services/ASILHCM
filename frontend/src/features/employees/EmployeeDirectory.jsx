import React, { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api } from '../../api';

/** Full employee master columns (mirrors backend export schema). */
export const MASTER_ROSTER_HEADERS = [
    'ASIL Employee Code',
    'ASIL BU',
    'Contract Name',
    'Contract ID',
    'Active',
    'CLIENT NAME',
    'Client Business Unit',
    'Department',
    'Designation',
    'Client Location',
    'Site',
    'Province',
    'Employee Name',
    "Father's Name",
    "Mother's Name",
    'CNIC Number',
    'CNIC Issue',
    'CNIC Expiry',
    'Place of Birth',
    'EOBI No',
    'Religion',
    'Salary',
    'Marital Status',
    'Primary Contact',
    'Emergency Contact',
    'Email Address',
    'Present Address',
    'Permanent Address',
    'Date of Birth',
    'Date of Joining',
    'Last Working Day',
    'Spouse Name',
    'Spouse Age',
    'Spouse CNIC',
    'Child 1 Name',
    'Child 1 Age',
    'Child 1 CNIC/Bay Form',
    'Child 2 Name',
    'Child 2 Age',
    'Child 2 CNIC/Bay Form',
    'Medical Coverage (Type)',
    'Medical Coverage Maternity',
    'Total Medical Coverage (Self & Family)',
    'Bank Name',
    'Bank Account',
    'Account Title',
    'NEXT OF KIN NAME',
    'NEXT OF KIN RELATION',
    'NEXT OF KIN CONTACT',
    'SESSI Number',
    'Shirt Size',
    'Trouser Size',
    'Safety Shoe Size',
    'Last Uniform Issue Date',
    'Last PPE Issue Date',
    'Gate Pass Expiry',
    'Payroll Cycle Type',
    'Region',
    'Line Manager Name',
    'Line Manager Email',
    'Supervisor Email',
    'Client Focal Email(s)',
    'Claim Authority',
];

/**
 * Full employee master export / partial-column import (blank-safe).
 */
export default function EmployeeDirectoryToolbar({ onImported }) {
    const [busy, setBusy] = useState(false);
    const [importText, setImportText] = useState('');
    const [showImport, setShowImport] = useState(false);
    const [result, setResult] = useState(null);

    const exportRoster = async () => {
        setBusy(true);
        try {
            await api.exportMasterRoster();
        } catch (e) {
            alert(e.message || 'Master roster export failed');
        }
        setBusy(false);
    };

    const importRoster = async () => {
        if (!importText.trim()) return alert('Paste the employee master CSV first.');
        setBusy(true);
        try {
            const r = await api.importMasterRoster({ csvText: importText });
            setResult(r);
            if (onImported) onImported(r);
        } catch (e) {
            alert(e.message || 'Master roster import failed');
        }
        setBusy(false);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                    type="button"
                    disabled={busy}
                    onClick={exportRoster}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                        background: 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(16,185,129,0.12))',
                        border: '1px solid #22c55e', color: '#4ade80',
                        padding: '10px 18px', borderRadius: '10px',
                        fontWeight: 700, fontSize: '0.88rem', cursor: busy ? 'wait' : 'pointer',
                        boxShadow: '0 0 0 1px rgba(34,197,94,0.08)',
                    }}
                >
                    <Download size={16} />
                    Export Master Roster ({MASTER_ROSTER_HEADERS.length} cols)
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowImport(v => !v)}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                        background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.4)',
                        color: '#a5b4fc', padding: '10px 18px', borderRadius: '10px',
                        fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
                    }}
                >
                    <Upload size={16} />
                    Import Master Roster
                </button>
            </div>

            {showImport && (
                <div style={{
                    background: 'var(--bg-card, #0f172a)', border: '1px solid var(--border, #1e293b)',
                    borderRadius: '12px', padding: '1rem 1.25rem',
                }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem', lineHeight: 1.5 }}>
                        Match on <strong>ASIL Employee Code</strong>. You may import only the columns you have filled —
                        <strong> blank cells never overwrite</strong> existing database values.
                        Supports the full {MASTER_ROSTER_HEADERS.length}-column master sheet or a partial update (e.g. Supervisor / Client Focal only).
                        No SMS or email triggers on this import.
                    </div>
                    <textarea
                        value={importText}
                        onChange={e => setImportText(e.target.value)}
                        rows={6}
                        placeholder={`ASIL Employee Code,Supervisor Email,Client Focal Email(s)\nASIL/PSO-001/25,manager@asil.com.pk,focal@client.com`}
                        style={{
                            width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '0.8rem',
                            background: 'var(--bg-dark, #020617)', border: '1px solid var(--border, #1e293b)',
                            borderRadius: 8, padding: 10, color: 'var(--text, #e2e8f0)',
                        }}
                    />
                    <button
                        type="button"
                        disabled={busy}
                        onClick={importRoster}
                        className="btn-primary"
                        style={{ marginTop: '0.75rem' }}
                    >
                        {busy ? 'Importing…' : 'Upload & Merge Updates'}
                    </button>
                    {result && (
                        <pre style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem', whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(result, null, 2)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}
