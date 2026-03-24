import React, { useState, useEffect } from 'react';
import { Search, Filter, CheckCircle, XCircle, RefreshCw, Printer, AlertTriangle } from 'lucide-react';
import { api } from './api';

const Rs = n => 'Rs. ' + Math.round(parseFloat(n)||0).toLocaleString('en-PK');

// ─── WHT calculation (Filer vs Non-Filer) ─────────────────────────────────────
function calcWHT(amount, isFiler) {
    // FBR 2025-26: Services
    if (isFiler)    return Math.round(amount * 0.08);   // 8% filer services WHT
    return Math.round(amount * 0.14);                    // 14% non-filer services WHT
}

export default function AnnexureDashboard() {
    const [payrollRuns, setPayrollRuns] = useState([]);
    const [bills, setBills]             = useState([]);
    const [hitlFlags, setHitlFlags]     = useState([]);
    const [loading, setLoading]         = useState(true);
    const [filterClient, setFilterClient] = useState('');
    const [filterPeriod, setFilterPeriod] = useState('');
    const [selectedIds, setSelectedIds]   = useState([]);
    const [generating, setGenerating]     = useState(false);

    useEffect(() => {
        Promise.all([
            api.getEmployees().catch(() => ({ employees: [] })),
            api.getBills().catch(() => []),
            api.getHitlFlags().catch(() => ({ flagged: [] }))
        ]).then(([empData, billsData, hitlData]) => {
            // Build payroll groups from employees grouped by client
            const empList = empData.employees || empData || [];
            const billList = Array.isArray(billsData) ? billsData : (billsData.bills || []);
            setPayrollRuns(empList);
            setBills(billList);
            setHitlFlags(hitlData.flagged || []);
        }).finally(() => setLoading(false));
    }, []);

    // Group employees by client to compute payroll totals
    const clientGroups = {};
    payrollRuns.forEach(emp => {
        if (!emp.client) return;
        const clientKey = emp.client;
        if (!clientGroups[clientKey]) clientGroups[clientKey] = { client: emp.client, employees: [], grossTotal: 0 };
        clientGroups[clientKey].employees.push(emp);
        clientGroups[clientKey].grossTotal += parseFloat(emp.salary || 0);
    });

    // Group bills by client
    const billsByClient = {};
    bills.filter(b => b.status !== 'Rejected').forEach(b => {
        if (!b.client) return;
        if (!billsByClient[b.client]) billsByClient[b.client] = { materialTotal: 0, gstTotal: 0 };
        billsByClient[b.client].materialTotal += parseFloat(b.total || b.amount || 0);
        billsByClient[b.client].gstTotal += parseFloat(b.gst || 0);
    });

    // Build annexure rows — one per client
    const rows = Object.values(clientGroups).map(g => {
        const gross = g.grossTotal;
        const eobi_er = g.employees.length * 2000;          // Rs.2000 ER per head
        const sessi_er = g.employees.filter(e => parseFloat(e.salary||0) < 45000).length * Math.round(parseFloat(g.employees[0]?.salary||0) * 0.06 / g.employees.length || 0);
        const payrollCost = gross + eobi_er;                  // simplified
        const svcPct = 15; // default — ideally from contract
        const svcCharges = Math.round(payrollCost * svcPct / 100);
        const salesTax = Math.round(svcCharges * 0.13);       // 13% on svc charges ONLY
        const bill = billsByClient[g.client] || { materialTotal: 0, gstTotal: 0 };
        const grandTotal = payrollCost + svcCharges + salesTax + bill.materialTotal;
        return { client: g.client, headCount: g.employees.length, grossSalary: gross, employerOverheads: eobi_er, payrollCost, svcCharges, salesTax, materialCost: bill.materialTotal, materialGST: bill.gstTotal, grandTotal };
    }).filter(r => !filterClient || r.client.toLowerCase().includes(filterClient.toLowerCase()));

    const totals = rows.reduce((acc, r) => ({
        payrollCost: acc.payrollCost + r.payrollCost,
        svcCharges: acc.svcCharges + r.svcCharges,
        salesTax: acc.salesTax + r.salesTax,
        materialCost: acc.materialCost + r.materialCost,
        grandTotal: acc.grandTotal + r.grandTotal,
    }), { payrollCost: 0, svcCharges: 0, salesTax: 0, materialCost: 0, grandTotal: 0 });

    function printAnnexure() {
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;font-size:10pt;margin:0;padding:24px}
h1{color:#1e3a5f;font-size:14pt;margin:0 0 4px}
p.sub{color:#64748b;font-size:9pt;margin:0 0 16px}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th{background:#1e3a5f;color:#fff;padding:7px 10px;font-size:8.5pt;text-align:left}
td{padding:7px 10px;border-bottom:1px solid #f1f5f9;font-size:9pt}
.num{text-align:right}.total{background:#f8fafc;font-weight:800}
.grand{background:#1e3a5f;color:#fff;font-weight:800}
</style></head><body>
<h1>ASIL — Billing Annexure</h1>
<p class="sub">Generated: ${new Date().toLocaleDateString('en-PK')} | Allied Services International (Pvt.) Ltd.</p>
<table><thead><tr>
<th>Client</th><th>HC</th><th class="num">Gross Salary</th><th class="num">Employer OH</th>
<th class="num">Total Payroll</th><th class="num">Svc Charges (15%)</th>
<th class="num">Sales Tax on Svc</th><th class="num">Material Cost</th><th class="num">GRAND TOTAL</th>
</tr></thead><tbody>
${rows.map(r => `<tr>
<td>${r.client}</td><td>${r.headCount}</td>
<td class="num">${Rs(r.grossSalary)}</td><td class="num">${Rs(r.employerOverheads)}</td>
<td class="num">${Rs(r.payrollCost)}</td><td class="num">${Rs(r.svcCharges)}</td>
<td class="num">${Rs(r.salesTax)}</td><td class="num">${Rs(r.materialCost)}</td>
<td class="num">${Rs(r.grandTotal)}</td>
</tr>`).join('')}
<tr class="grand"><td colspan="4">TOTAL</td>
<td class="num">${Rs(totals.payrollCost)}</td><td class="num">${Rs(totals.svcCharges)}</td>
<td class="num">${Rs(totals.salesTax)}</td><td class="num">${Rs(totals.materialCost)}</td>
<td class="num">${Rs(totals.grandTotal)}</td>
</tr></tbody></table>
<p style="font-size:8pt;color:#94a3b8">Note: Sales Tax applied only on Service Charges portion per FBR SRB regulations. Material costs billed at cost + GST per vendor invoice.</p>
</body></html>`;
        const w = window.open('', '_blank');
        w.document.write(html);
        w.document.close();
        setTimeout(() => w.print(), 500);
    }

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Annexure &amp; Debit Note Approval</h1>
                <p className="page-subtitle">Real-time billing annexure — payroll + material costs grouped by client</p>
            </div>

            {/* HITL Flags */}
            {hitlFlags.length > 0 && (
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.5rem' }}>
                        <AlertTriangle size={18} color="#ef4444" />
                        <span style={{ fontWeight: 700, color: '#ef4444', fontSize: '0.9rem' }}>⚠️ {hitlFlags.length} Bill(s) Require Manual Review</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#f87171' }}>OCR total does not match sum of line items. Please review these bills before including in annexure:</p>
                    {hitlFlags.map(f => (
                        <div key={f.id} style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#fca5a5' }}>
                            • Bill {f.id} — {f.vendor} | Declared: {Rs(f.total)} | Items sum: {Rs(f.itemsSum)} | Gap: {Rs(Math.abs(f.discrepancy))}
                        </div>
                    ))}
                </div>
            )}

            <div className="glass-card" style={{ marginBottom: '24px' }}>
                <div className="controls-bar">
                    <div style={{ flex: 1, display: 'flex', gap: '12px' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <Search style={{ position: 'absolute', top: 10, left: 12, color: 'var(--text-muted)' }} size={18} />
                            <input type="text" className="input-glass" placeholder="Filter by Client..." value={filterClient} onChange={e => setFilterClient(e.target.value)} style={{ width: '100%', paddingLeft: '38px' }} />
                        </div>
                    </div>
                    <button onClick={printAnnexure} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Printer size={16} /> Print Annexure
                    </button>
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}><RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} /></div>
                ) : (
                    <div className="data-table-container" style={{ overflowX: 'auto' }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Client</th><th style={{ textAlign: 'center' }}>HC</th>
                                    <th style={{ textAlign: 'right' }}>Gross Salary</th>
                                    <th style={{ textAlign: 'right' }}>Employer OH (EOBI)</th>
                                    <th style={{ textAlign: 'right' }}>Total Payroll Cost</th>
                                    <th style={{ textAlign: 'right' }}>Svc Charges (15%)</th>
                                    <th style={{ textAlign: 'right' }}>Sales Tax on Svc</th>
                                    <th style={{ textAlign: 'right' }}>Materials</th>
                                    <th style={{ textAlign: 'right' }}>GRAND TOTAL</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.length === 0 && (
                                    <tr><td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2.5rem' }}>No data — add employees and clients first.</td></tr>
                                )}
                                {rows.map((r, i) => (
                                    <tr key={i}>
                                        <td style={{ fontWeight: '600', color: 'var(--primary)' }}>{r.client}</td>
                                        <td style={{ textAlign: 'center' }}>{r.headCount}</td>
                                        <td style={{ textAlign: 'right' }}>{Rs(r.grossSalary)}</td>
                                        <td style={{ textAlign: 'right' }}>{Rs(r.employerOverheads)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{Rs(r.payrollCost)}</td>
                                        <td style={{ textAlign: 'right', color: '#38bdf8' }}>{Rs(r.svcCharges)}</td>
                                        <td style={{ textAlign: 'right', color: '#f59e0b' }}>{Rs(r.salesTax)}</td>
                                        <td style={{ textAlign: 'right' }}>{r.materialCost > 0 ? Rs(r.materialCost) : '—'}</td>
                                        <td style={{ textAlign: 'right', fontWeight: '800', color: '#22c55e' }}>{Rs(r.grandTotal)}</td>
                                    </tr>
                                ))}
                                {rows.length > 0 && (
                                    <tr style={{ background: 'rgba(56,189,248,0.06)', fontWeight: 800 }}>
                                        <td>TOTAL</td><td style={{ textAlign: 'center' }}>{rows.reduce((s,r)=>s+r.headCount,0)}</td>
                                        <td style={{ textAlign: 'right' }}>{Rs(rows.reduce((s,r)=>s+r.grossSalary,0))}</td>
                                        <td style={{ textAlign: 'right' }}>{Rs(rows.reduce((s,r)=>s+r.employerOverheads,0))}</td>
                                        <td style={{ textAlign: 'right' }}>{Rs(totals.payrollCost)}</td>
                                        <td style={{ textAlign: 'right', color: '#38bdf8' }}>{Rs(totals.svcCharges)}</td>
                                        <td style={{ textAlign: 'right', color: '#f59e0b' }}>{Rs(totals.salesTax)}</td>
                                        <td style={{ textAlign: 'right' }}>{Rs(totals.materialCost)}</td>
                                        <td style={{ textAlign: 'right', color: '#22c55e' }}>{Rs(totals.grandTotal)}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.75rem 0 0', margin: 0 }}>
                            📌 Sales Tax applied <strong>only on Service Charges</strong> per FBR SRB. Material costs billed at cost + vendor GST.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
