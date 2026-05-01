import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, X, Save, AlertCircle, CheckCircle, TrendingUp, Package, RefreshCw } from 'lucide-react';
import { api } from './api';

const fmt = v => Math.round(parseFloat(v) || 0).toLocaleString('en-PK');
const Rs  = v => `Rs. ${fmt(v)}`;

// ── Helpers ───────────────────────────────────────────────────────────────────
const inp = {
    background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px',
    padding: '9px 12px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none',
    width: '100%', boxSizing: 'border-box',
};
const FL = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
        {children}
    </div>
);

const STATUS_CLR = { active: '#22c55e', exhausted: '#f59e0b', cancelled: '#ef4444', expired: '#94a3b8' };

function UtilBar({ pct, balance, value }) {
    const safe = Math.min(100, Math.max(0, pct || 0));
    const clr = safe >= 90 ? '#ef4444' : safe >= 70 ? '#f59e0b' : '#22c55e';
    return (
        <div>
            <div style={{ background: 'var(--bg-dark)', borderRadius: '99px', height: '6px', overflow: 'hidden', marginBottom: '4px' }}>
                <div style={{ height: '100%', width: `${safe}%`, background: clr, borderRadius: '99px', transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <span style={{ color: clr, fontWeight: 700 }}>{safe}% used</span>
                <span>Balance: {Rs(balance)}</span>
            </div>
        </div>
    );
}

// ── PO Form Modal ─────────────────────────────────────────────────────────────
function POFormModal({ existing = null, onSave, onClose }) {
    const isEdit = !!existing;

    // Form state
    const [po_number,         setPONumber]      = useState(existing?.po_number         || '');
    const [client_name,       setClientName]    = useState(existing?.client_name       || '');
    const [contract_id,       setContractId]    = useState(existing?.contract_id       || '');
    const [contract_name,     setContractName]  = useState(existing?.contract_name     || '');
    const [bu_name,           setBuName]        = useState(existing?.bu_name           || '');
    const [po_value,          setPOValue]       = useState(existing?.po_value          || '');
    const [po_date,           setPODate]        = useState(existing?.po_date           ? existing.po_date.split('T')[0] : '');
    const [po_expiry,         setPOExpiry]      = useState(existing?.po_expiry         ? existing.po_expiry.split('T')[0] : '');
    const [allocation_method, setAllocMethod]   = useState(existing?.allocation_method || 'fifo');
    const [priority,          setPriority]      = useState(existing?.priority          ?? 100);
    const [notes,             setNotes]         = useState(existing?.notes             || '');
    const [status,            setStatus]        = useState(existing?.status            || 'active');

    // Load clients + contracts inside the modal — guarantees dropdown always has data
    const [clients,    setClients]    = useState([]);
    const [contracts,  setContracts]  = useState([]);
    const [loadingData, setLoadingData] = useState(true);

    const [saving, setSaving] = useState(false);
    const [err,    setErr]    = useState('');

    useEffect(() => {
        setLoadingData(true);
        Promise.all([api.getClients(), api.getContracts()])
            .then(([cr, ctr]) => {
                // Handle both { clients:[...] } and plain array responses
                const cls = Array.isArray(cr) ? cr : (cr?.clients || cr?.data || []);
                const cts = Array.isArray(ctr) ? ctr : (ctr?.contracts || ctr?.data || []);
                setClients(cls);
                setContracts(cts);
            })
            .catch(() => {})
            .finally(() => setLoadingData(false));
    }, []);

    // When client changes, reset contract selection
    const handleClientChange = (name) => {
        setClientName(name);
        setContractId('');
        setContractName('');
    };

    // When contract changes, auto-fill contract_name
    const handleContractChange = (cid) => {
        setContractId(cid);
        const ct = contracts.find(c => String(c.id) === String(cid));
        if (ct) setContractName(ct.contract_name || ct.name || '');
    };

    // Filter contracts for the selected client
    const filteredContracts = contracts.filter(c => {
        if (!client_name) return true;
        // Contracts may store client name in different fields
        const cClient = c.client_name || c.client || '';
        return cClient.toLowerCase() === client_name.toLowerCase();
    });

    const handleSave = async () => {
        if (!po_number.trim()) return setErr('PO Number is required');
        if (!client_name.trim()) return setErr('Client is required');
        if (!po_value || parseFloat(po_value) <= 0) return setErr('PO Value must be greater than 0');
        setSaving(true); setErr('');
        try {
            const d = {
                po_number, client_name,
                contract_id: contract_id || null,
                contract_name,
                bu_name,
                po_value: parseFloat(po_value),
                po_date: po_date || null,
                po_expiry: po_expiry || null,
                allocation_method,
                priority: parseInt(priority) || 100,
                notes, status
            };
            if (isEdit) await api.updatePurchaseOrder(existing.id, d);
            else        await api.createPurchaseOrder(d);
            onSave();
        } catch (e) { setErr(e.message || 'Save failed'); }
        finally { setSaving(false); }
    };

    const selStyle = { ...inp, appearance: 'auto' };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1100, padding: '2rem', overflowY: 'auto' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '660px', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <h2 style={{ margin: 0 }}>{isEdit ? 'Edit Purchase Order' : 'Register New PO'}</h2>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>PO must be entered when received from client. Required before invoicing.</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={22} /></button>
                </div>
                <div style={{ padding: '1.75rem 2rem' }}>
                    {err && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '10px 14px', color: '#f87171', marginBottom: '1rem', fontSize: '0.87rem' }}>⚠ {err}</div>}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                        <div style={{ gridColumn: '1/-1' }}>
                            <FL label="PO Number *">
                                <input style={inp} value={po_number} onChange={e => setPONumber(e.target.value)} placeholder="e.g. PO-WAFI-2026-001" />
                            </FL>
                        </div>

                        {/* CLIENT — always a dropdown */}
                        <FL label="Client *">
                            <select style={selStyle} value={client_name} onChange={e => handleClientChange(e.target.value)}
                                disabled={loadingData}>
                                <option value="">{loadingData ? 'Loading clients…' : '— Select Client —'}</option>
                                {clients.map(c => (
                                    <option key={c.id} value={c.name}>{c.name}</option>
                                ))}
                            </select>
                        </FL>

                        {/* CONTRACT — dropdown filtered by selected client */}
                        <FL label="Contract (optional)">
                            <select style={selStyle} value={contract_id} onChange={e => handleContractChange(e.target.value)}
                                disabled={loadingData || !client_name}>
                                <option value="">{!client_name ? '— Select client first —' : '— All contracts for client —'}</option>
                                {filteredContracts.map(c => (
                                    <option key={c.id} value={c.id}>{c.contract_name || c.name}</option>
                                ))}
                            </select>
                            {client_name && filteredContracts.length === 0 && !loadingData && (
                                <div style={{ fontSize: '0.73rem', color: '#f59e0b', marginTop: '4px' }}>No contracts found for this client — PO will apply to all contracts.</div>
                            )}
                        </FL>

                        <FL label="BU / Division (optional)">
                            <input style={inp} value={bu_name} onChange={e => setBuName(e.target.value)} placeholder="e.g. FM Division" />
                        </FL>
                        <FL label="PO Value (Rs.) *">
                            <input style={inp} type="number" value={po_value} onChange={e => setPOValue(e.target.value)} placeholder="0" />
                        </FL>
                        <FL label="PO Issue Date">
                            <input style={inp} type="date" value={po_date} onChange={e => setPODate(e.target.value)} />
                        </FL>
                        <FL label="PO Expiry Date (optional)">
                            <input style={inp} type="date" value={po_expiry} onChange={e => setPOExpiry(e.target.value)} />
                        </FL>
                    </div>

                    {/* Allocation method */}
                    <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#818cf8', marginBottom: '0.75rem' }}>Invoice Allocation Method</div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            {[
                                { value: 'fifo',   label: 'FIFO (Default)', hint: 'System uses oldest active PO first' },
                                { value: 'manual', label: 'Manual',         hint: 'Team selects PO on each invoice' },
                            ].map(opt => (
                                <label key={opt.value} style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px', borderRadius: '8px', cursor: 'pointer',
                                    background: allocation_method === opt.value ? 'rgba(99,102,241,0.12)' : 'var(--bg-dark)',
                                    border: `1px solid ${allocation_method === opt.value ? 'rgba(99,102,241,0.5)' : 'var(--border)'}` }}>
                                    <input type="radio" name="alloc" value={opt.value} checked={allocation_method === opt.value}
                                        onChange={() => setAllocMethod(opt.value)} style={{ marginTop: '2px', accentColor: '#818cf8' }} />
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{opt.label}</div>
                                        <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '2px' }}>{opt.hint}</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                        {allocation_method === 'fifo' && (
                            <div style={{ marginTop: '8px', fontSize: '0.76rem', color: '#818cf8' }}>
                                📌 FIFO priority = {priority}. Lower number = used first. Adjust if client has multiple active POs.
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.75rem' }}>
                            <FL label="FIFO Priority (lower = first)">
                                <input style={inp} type="number" value={priority} onChange={e => setPriority(e.target.value)} placeholder="100" />
                            </FL>
                            <FL label="Status">
                                <select style={selStyle} value={status} onChange={e => setStatus(e.target.value)}>
                                    <option value="active">Active</option>
                                    <option value="exhausted">Exhausted</option>
                                    <option value="cancelled">Cancelled</option>
                                    <option value="expired">Expired</option>
                                </select>
                            </FL>
                        </div>
                    </div>

                    <FL label="Notes (optional)">
                        <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special instructions or remarks about this PO" />
                    </FL>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '1.5rem' }}>
                        <button onClick={onClose} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={handleSave} disabled={saving || loadingData}
                            style={{ background: 'linear-gradient(135deg,#6366f1,#818cf8)', border: 'none', color: '#fff', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', opacity: (saving || loadingData) ? 0.7 : 1 }}>
                            <Save size={16} />{saving ? 'Saving…' : loadingData ? 'Loading…' : isEdit ? 'Update PO' : 'Register PO'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Main PO Tracking Page ─────────────────────────────────────────────────────
export default function POTracking({ user }) {
    const [pos,       setPos]      = useState([]);
    const [summary,   setSummary]  = useState({});
    const [clients,   setClients]  = useState([]);
    const [contracts, setContracts]= useState([]);
    const [loading,   setLoading]  = useState(true);
    const [modal,     setModal]    = useState(null); // null | { mode: 'new'|'edit', po }
    const [filterClient, setFilterClient] = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    const canEdit = ['superadmin','finance_manager','finance_approver','finance_proposer','ar_team'].includes(user?.role);

    const load = async () => {
        setLoading(true);
        try {
            const q = {};
            if (filterClient) q.client = filterClient;
            if (filterStatus) q.status = filterStatus;
            const [posRes, clientsRes, contractsRes] = await Promise.all([
                api.getPurchaseOrders(q),
                api.getClients ? api.getClients() : Promise.resolve({ clients: [] }),
                api.getContracts(),
            ]);
            setPos(posRes.purchase_orders || []);
            setSummary(posRes.summary || {});
            setClients((clientsRes.clients || clientsRes || []).filter(Boolean));
            setContracts(contractsRes.contracts || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, [filterClient, filterStatus]);

    const handleDelete = async (po) => {
        if (!window.confirm(`Delete PO ${po.po_number}? This cannot be undone.`)) return;
        try { await api.deletePurchaseOrder(po.id); load(); } catch (e) { alert(e.message); }
    };

    const statCards = [
        { label: 'Total POs',       value: summary.total_pos || 0,       color: '#6366f1', sub: 'registered' },
        { label: 'Total PO Value',  value: Rs(summary.total_value || 0),  color: '#38bdf8', sub: 'committed' },
        { label: 'Total Utilized',  value: Rs(summary.total_utilized || 0), color: '#f59e0b', sub: 'invoiced so far' },
        { label: 'Available Balance', value: Rs(summary.total_balance || 0), color: '#22c55e', sub: 'remaining' },
    ];

    return (
        <div style={{ padding: '2rem', maxWidth: '1400px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.75rem' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800 }}>PO Tracking</h1>
                    <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        Purchase Order register — FIFO auto-matching with manual override. A PO must be registered before invoicing against a contract.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={load} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <RefreshCw size={15} /> Refresh
                    </button>
                    {canEdit && (
                        <button onClick={() => setModal({ mode: 'new', po: null })}
                            style={{ background: 'linear-gradient(135deg,#6366f1,#818cf8)', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Plus size={16} /> Register PO
                        </button>
                    )}
                </div>
            </div>

            {/* Mandatory PO notice */}
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <AlertCircle size={18} color="#f59e0b" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.85rem' }}>
                    <strong style={{ color: '#f59e0b' }}>Mandatory PO Policy:</strong> Every Purchase Order received from a client must be registered here <em>before</em> an invoice can be raised against that contract. This ensures PO balances are always tracked and prevents over-invoicing. If a contract has any active PO on record, the invoice wizard will require you to select one.
                </div>
            </div>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem', marginBottom: '1.75rem' }}>
                {statCards.map(c => (
                    <div key={c.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{c.label}</div>
                        <div style={{ fontWeight: 800, fontSize: '1.3rem', color: c.color }}>{c.value}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '3px' }}>{c.sub}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                <select style={{ ...inp, width: 'auto', minWidth: '200px' }} value={filterClient} onChange={e => setFilterClient(e.target.value)}>
                    <option value="">All Clients</option>
                    {[...new Set(pos.map(p => p.client_name).filter(Boolean))].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select style={{ ...inp, width: 'auto', minWidth: '160px' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="">All Statuses</option>
                    {['active','exhausted','cancelled','expired'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
            </div>

            {/* PO List */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>Loading POs…</div>
            ) : pos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '5rem', background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)' }}>
                    <Package size={48} color="var(--text-muted)" style={{ marginBottom: '1rem', opacity: 0.4 }} />
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>No Purchase Orders Registered</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Register your first PO to begin tracking. All invoices must reference a PO.</div>
                    {canEdit && (
                        <button onClick={() => setModal({ mode: 'new', po: null })}
                            style={{ background: 'linear-gradient(135deg,#6366f1,#818cf8)', border: 'none', color: '#fff', padding: '12px 24px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700 }}>
                            + Register First PO
                        </button>
                    )}
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {pos.map(po => (
                        <div key={po.id} style={{ background: 'var(--bg-card)', border: `1px solid var(--border)`, borderLeft: `4px solid ${STATUS_CLR[po.status] || '#64748b'}`, borderRadius: '12px', padding: '1.25rem 1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: '260px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                        <span style={{ fontWeight: 800, fontSize: '1rem' }}>{po.po_number}</span>
                                        <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 10px', borderRadius: '99px', background: `${STATUS_CLR[po.status] || '#64748b'}18`, color: STATUS_CLR[po.status] || '#64748b', border: `1px solid ${STATUS_CLR[po.status] || '#64748b'}44` }}>
                                            {(po.status || 'active').toUpperCase()}
                                        </span>
                                        <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '6px', background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>
                                            {po.allocation_method === 'fifo' ? `FIFO #${po.priority}` : 'Manual'}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                                        <strong style={{ color: 'var(--text)' }}>{po.client_name}</strong>
                                        {po.contract_name && <span> · {po.contract_name}</span>}
                                        {po.bu_name && <span style={{ color: '#818cf8' }}> · {po.bu_name}</span>}
                                    </div>
                                    {(po.po_date || po.po_expiry) && (
                                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                            {po.po_date && <span>Issued: {po.po_date.split('T')[0]}</span>}
                                            {po.po_expiry && <span style={{ marginLeft: '12px', color: '#f87171' }}>Expires: {po.po_expiry.split('T')[0]}</span>}
                                        </div>
                                    )}
                                    {po.notes && <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>{po.notes}</div>}
                                </div>
                                <div style={{ minWidth: '260px', flex: 1 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <div>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>PO Value</div>
                                            <div style={{ fontWeight: 800, fontSize: '1rem', color: '#38bdf8' }}>{Rs(po.po_value)}</div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Utilized</div>
                                            <div style={{ fontWeight: 700, color: '#f59e0b' }}>{Rs(po.utilized)}</div>
                                        </div>
                                    </div>
                                    <UtilBar pct={po.utilization_pct} balance={po.balance} value={po.po_value} />
                                </div>
                                {canEdit && (
                                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                        <button onClick={() => setModal({ mode: 'edit', po })}
                                            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', padding: '7px 14px', borderRadius: '7px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem', fontWeight: 600 }}>
                                            <Edit2 size={13} /> Edit
                                        </button>
                                        {user?.role === 'superadmin' && (
                                            <button onClick={() => handleDelete(po)}
                                                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '7px 10px', borderRadius: '7px', cursor: 'pointer' }}>
                                                <Trash2 size={13} />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {modal && (
                <POFormModal
                    existing={modal.po}
                    onSave={() => { setModal(null); load(); }}
                    onClose={() => setModal(null)}
                />
            )}
        </div>
    );
}
