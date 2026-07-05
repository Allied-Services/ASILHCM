import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const AttendanceIntake = () => {
    const [csvText, setCsvText] = useState('');
    const [inputMode, setInputMode] = useState('full_ledger');
    const [projectId, setProjectId] = useState('');
    const [result, setResult] = useState(null);
    const [alertRules, setAlertRules] = useState([]);
    const [ruleForm, setRuleForm] = useState({ project_id: '', rule_type: 'unexcused_leave', recipients: '' });
    const [error, setError] = useState('');

    useEffect(() => {
        api.getAttendanceAlertRules().then(setAlertRules).catch(() => {});
    }, []);

    const parseCsv = async () => {
        setError('');
        try {
            const r = await api.parseAttendanceCsv({ csvText, inputMode, projectId, periodMonth: new Date().getMonth() + 1, periodYear: new Date().getFullYear() });
            setResult(r);
        } catch (e) {
            setError(e.message);
        }
    };

    const saveRule = async (e) => {
        e.preventDefault();
        try {
            await api.saveAttendanceAlertRule({
                project_id: ruleForm.project_id,
                rule_type: ruleForm.rule_type,
                recipients: ruleForm.recipients.split(',').map(s => s.trim()).filter(Boolean),
                channels: ['email'],
            });
            const rules = await api.getAttendanceAlertRules();
            setAlertRules(rules);
        } catch (err) {
            setError(err.message);
        }
    };

    const runAlerts = async () => {
        try {
            const r = await api.runAttendanceAlerts();
            setResult(r);
        } catch (e) {
            setError(e.message);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <Card>
                <h3 style={{ marginBottom: '1rem' }}>CSV Attendance Import (Trace: P3-OPS-001)</h3>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <select value={inputMode} onChange={e => setInputMode(e.target.value)}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }}>
                        <option value="full_ledger">Full ledger (all rows)</option>
                        <option value="absent_only">Absent only (calculate present)</option>
                        <option value="present_only">Present only (calculate absent)</option>
                    </select>
                    <input placeholder="Project / Site ID" value={projectId} onChange={e => setProjectId(e.target.value)}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                </div>
                <textarea value={csvText} onChange={e => setCsvText(e.target.value)} placeholder="Paste CSV content here (employee_id, date, status columns)"
                    rows={6} style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, color: 'var(--text)', fontFamily: 'monospace', fontSize: '0.85rem' }} />
                <button onClick={parseCsv} className="btn-primary" style={{ marginTop: '0.75rem' }}>Parse & Import</button>
            </Card>

            <Card>
                <h3 style={{ marginBottom: '1rem' }}>FM Site Alert Rules (Trace: P3-OPS-004)</h3>
                <form onSubmit={saveRule} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                    <input placeholder="Project ID" value={ruleForm.project_id} onChange={e => setRuleForm(f => ({ ...f, project_id: e.target.value }))} required
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                    <input placeholder="Alert recipients (emails, comma-separated)" value={ruleForm.recipients} onChange={e => setRuleForm(f => ({ ...f, recipients: e.target.value }))}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                    <button type="submit" className="btn-secondary">Save Rule</button>
                    <button type="button" onClick={runAlerts} className="btn-primary">Run Alerts Now</button>
                </form>
                <table className="data-table">
                    <thead><tr><th>Project</th><th>Type</th><th>Recipients</th><th>Active</th></tr></thead>
                    <tbody>
                        {alertRules.map(r => (
                            <tr key={r.id}>
                                <td>{r.project_name || r.project_id}</td>
                                <td>{r.rule_type}</td>
                                <td>{(r.recipients || []).join(', ')}</td>
                                <td>{r.active ? 'Yes' : 'No'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>

            {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
            {result && <Card><pre style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{JSON.stringify(result, null, 2)}</pre></Card>}
        </div>
    );
};

const Card = ({ children, style = {} }) => (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem', ...style }}>{children}</div>
);

export default AttendanceIntake;
