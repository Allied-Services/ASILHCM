import React, { useState } from 'react';
import { Calculator, Play, Download, Search, CheckCircle, FileText, Database } from 'lucide-react';

function PayrollIntegration() {
    const [running, setRunning] = useState(false);

    const handleRunPayroll = () => {
        setRunning(true);
        setTimeout(() => setRunning(false), 2000);
    };

    return (
        <div className="dashboard">
            <header className="header">
                <h1>Financial Benefits & Payroll Integration</h1>
                <p>Run monthly payroll calculations, integrate EOBI, SESSI, WHT, and Gratuity into Katcha accounts.</p>
            </header>

            <div className="grid">
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, minWidth: '300px' }}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Calculator size={20} color="var(--primary)" /> Run Payroll Cycle</h3>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Execute calculations for active employees across all contracts. This process calculates Net Salaries, EOBI, SESSI, and total cost to company margins.</p>

                    <div style={{ background: 'var(--bg-dark)', padding: '1rem', borderRadius: '8px', marginTop: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                            <span>Target Month:</span> <strong>July 2026</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                            <span>Active Roster:</span> <strong>1,450 Employees</strong>
                        </div>
                    </div>

                    <button onClick={handleRunPayroll} disabled={running} className="btn btn-primary" style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: running ? 'var(--text-muted)' : 'var(--primary)', color: 'white', border: 'none', padding: '0.75rem', borderRadius: '8px', cursor: running ? 'not-allowed' : 'pointer' }}>
                        {running ? <span className="spinner" style={{ width: '16px', height: '16px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} /> : <Play size={20} />}
                        {running ? 'Processing Computations...' : 'Execute Payroll Calc Engine'}
                    </button>
                </div>

                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, minWidth: '300px' }}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Database size={20} color="var(--primary)" /> Tax Engine Rules (2026)</h3>

                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <li style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            <CheckCircle size={16} color="#22c55e" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <strong>EOBI</strong>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Rs. 1,950 total (Rs. 390 Employee / Rs. 1,560 Employer)</div>
                            </div>
                        </li>
                        <li style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            <CheckCircle size={16} color="#22c55e" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <strong>SESSI</strong>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>7% of lower limit (Employer side only)</div>
                            </div>
                        </li>
                        <li style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            <CheckCircle size={16} color="#22c55e" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <strong>WHT (Income Tax)</strong>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Slabs applied internally &gt; Rs. 50k pm</div>
                            </div>
                        </li>
                        <li style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                            <CheckCircle size={16} color="#22c55e" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <strong>Gratuity Escrow</strong>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Accrued monthly for eligible tenures</div>
                            </div>
                        </li>
                    </ul>

                    <button className="btn btn-secondary" style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '8px', cursor: 'pointer' }}>
                        <FileText size={18} /> Review Tax Engine Configuration
                    </button>
                </div>
            </div>

            <div className="recent-operations section" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem', marginTop: '2rem' }}>
                <h2>Recent Payroll Runs</h2>
                <div className="table-responsive" style={{ overflowX: 'auto', marginTop: '1rem' }}>
                    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                                <th style={{ padding: '1rem 0.5rem' }}>PERIOD</th>
                                <th style={{ padding: '1rem 0.5rem' }}>PAYROLL BATCH</th>
                                <th style={{ padding: '1rem 0.5rem' }}>GROSS PAYOUT</th>
                                <th style={{ padding: '1rem 0.5rem' }}>TOTAL DEDUCTIONS</th>
                                <th style={{ padding: '1rem 0.5rem' }}>NET PAYABLE</th>
                                <th style={{ padding: '1rem 0.5rem' }}>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
                                <td style={{ padding: '1rem 0.5rem', color: 'var(--text)' }}>June 2026</td>
                                <td style={{ padding: '1rem 0.5rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>BATCH-2606-ALL</td>
                                <td style={{ padding: '1rem 0.5rem' }}>Rs. 14,250,500</td>
                                <td style={{ padding: '1rem 0.5rem', color: '#f43f5e' }}>Rs. 1,480,200</td>
                                <td style={{ padding: '1rem 0.5rem', fontWeight: 'bold' }}>Rs. 12,770,300</td>
                                <td style={{ padding: '1rem 0.5rem' }}>
                                    <button className="btn btn-text" style={{ color: 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Download size={16} /> Export CSV
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}} />
        </div>
    );
}

export default PayrollIntegration;
