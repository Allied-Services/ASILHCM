import React, { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api } from '../../api';

export const MASTER_ROSTER_HEADERS = [
    'ASIL Employee Code',
    'Name',
    'CNIC',
    'Base Salary',
    'Client Name',
    'Contract Name',
    'Location Name',
    'Business Unit',
    'Supervisor Email',
    'Client Focal Email(s)',
];

/**
 * Master roster export / 10-column import controls for the Employee Directory.
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
        if (!importText.trim()) return alert('Paste the 10-column Master Roster CSV first.');
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
                    Export Master Roster
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
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                        Exact 10 columns — match on ASIL Employee Code. Blank cells keep existing values where applicable.
                        No SMS/email triggers on this import.
                    </div>
                    <textarea
                        value={importText}
                        onChange={e => setImportText(e.target.value)}
                        rows={6}
                        placeholder={MASTER_ROSTER_HEADERS.join(',')}
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
                        {busy ? 'Importing…' : 'Upload & Update Roster'}
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
