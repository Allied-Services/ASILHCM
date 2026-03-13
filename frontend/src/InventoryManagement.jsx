import React, { useState, useEffect, useCallback } from 'react';
import { Package, PackagePlus, ArrowDownCircle, Users, AlertTriangle, CheckCircle, X, Plus, Search, Filter, Edit2, Trash2, RotateCcw, Clock, ChevronDown, DollarSign, Archive } from 'lucide-react';
import { api } from './api';

// ─── Style helpers ────────────────────────────────────────────────────────────
const rs = n => `Rs. ${(parseFloat(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const daysUntil = d => d ? Math.round((new Date(d) - new Date()) / 86400000) : null;

const CATEGORY_COLORS = {
    'Clothing': '#6366f1', 'PPE': '#f59e0b', 'IT Equipment': '#38bdf8',
    'Tools': '#10b981', 'Vehicle': '#f43f5e', 'Other': '#94a3b8',
};
const STATUS_COLORS = { 'Issued': '#f59e0b', 'Returned': '#22c55e', 'Expired': '#ef4444', 'Lost': '#91003c' };
const catColor = c => CATEGORY_COLORS[c] || '#94a3b8';
const stColor = s => STATUS_COLORS[s] || '#94a3b8';

const Card = ({ children, style = {} }) => (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem', ...style }}>
        {children}
    </div>
);
const STitle = ({ children }) => (
    <h3 style={{ margin: '0 0 1rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>{children}</h3>
);
const Badge = ({ label, color }) => (
    <span style={{ background: color + '22', color, border: `1px solid ${color}44`, padding: '2px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700 }}>{label}</span>
);
const Pill = ({ label, color = 'var(--text-muted)' }) => (
    <span style={{ background: color + '18', color, padding: '1px 8px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 600 }}>{label}</span>
);

// ─── Modal wrapper ────────────────────────────────────────────────────────────
const Modal = ({ title, onClose, children, wide = false }) => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1200, padding: '2rem', overflowY: 'auto' }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: wide ? '900px' : '600px', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{title}</h3>
                <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}><X size={20} /></button>
            </div>
            <div style={{ padding: '1.5rem' }}>{children}</div>
        </div>
    </div>
);

// ─── Form field ───────────────────────────────────────────────────────────────
const FLabel = ({ children, required }) => (
    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '5px' }}>
        {children}{required && <span style={{ color: '#ef4444' }}> *</span>}
    </label>
);
const FInput = ({ value, onChange, type = 'text', placeholder = '', disabled = false, style = {} }) => (
    <input type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder} disabled={disabled}
        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'var(--text)', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box', ...style }} />
);
const FSelect = ({ value, onChange, children, disabled = false }) => (
    <select value={value ?? ''} onChange={onChange} disabled={disabled}
        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'var(--text)', fontSize: '0.9rem', width: '100%' }}>
        {children}
    </select>
);
const FField = ({ label, required, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <FLabel required={required}>{label}</FLabel>
        {children}
    </div>
);
const FTextarea = ({ value, onChange, placeholder = '', rows = 3 }) => (
    <textarea value={value ?? ''} onChange={onChange} placeholder={placeholder} rows={rows}
        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'var(--text)', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
);

const CATEGORIES = ['Clothing', 'PPE', 'IT Equipment', 'Tools', 'Vehicle', 'Other'];
const UNITS = ['piece', 'pair', 'set', 'kit', 'box', 'unit', 'litre', 'metre'];
const CONDITIONS = ['New', 'Good', 'Fair', 'Poor'];

// ════════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════════
export default function InventoryManagement() {
    const [activeTab, setActiveTab] = useState('overview');
    const [items, setItems] = useState([]);
    const [issuances, setIssuances] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterCat, setFilterCat] = useState('All');
    const [filterStatus, setFilterStatus] = useState('All');

    // Modals
    const [showItemForm, setShowItemForm] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [showStockIn, setShowStockIn] = useState(null); // item
    const [showIssue, setShowIssue] = useState(null);     // item
    const [showReturn, setShowReturn] = useState(null);   // issuance
    const [showStockHistory, setShowStockHistory] = useState(null); // item
    const [stockHistory, setStockHistory] = useState([]);
    const [saving, setSaving] = useState(false);

    // Load data
    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [itemsRes, issRes, empRes] = await Promise.all([
                api.getInventoryItems(),
                api.getIssuances({}),
                api.getEmployees(),
            ]);
            setItems(itemsRes.items || []);
            setIssuances(issRes.issuances || []);
            setEmployees(empRes.employees || []);
        } catch (err) { console.error(err); }
        setLoading(false);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // ── Derived stats ────────────────────────────────────────────────────────
    const today = new Date();
    const expiringSoon = issuances.filter(i => i.status === 'Issued' && i.expiry_date && daysUntil(i.expiry_date) <= 30 && daysUntil(i.expiry_date) >= 0);
    const expired = issuances.filter(i => i.status === 'Issued' && i.expiry_date && daysUntil(i.expiry_date) < 0);
    const activeIssuances = issuances.filter(i => i.status === 'Issued');
    const totalValue = items.reduce((s, i) => s + parseFloat(i.total_procurement_value || 0), 0);
    const lowStock = items.filter(i => parseInt(i.available_stock) <= parseInt(i.min_stock) && parseInt(i.min_stock) > 0);

    // ── Item Form state ──────────────────────────────────────────────────────
    const blankItem = { name: '', category: 'PPE', description: '', unit: 'piece', has_expiry: false, expiry_months: '', min_stock: '' };
    const [itemForm, setItemForm] = useState(blankItem);
    const iF = (f, v) => setItemForm(p => ({ ...p, [f]: v }));

    const openAddItem = () => { setItemForm(blankItem); setEditingItem(null); setShowItemForm(true); };
    const openEditItem = (item) => {
        setItemForm({ name: item.name, category: item.category, description: item.description || '', unit: item.unit, has_expiry: item.has_expiry, expiry_months: item.expiry_months || '', min_stock: item.min_stock });
        setEditingItem(item);
        setShowItemForm(true);
    };
    const saveItem = async () => {
        if (!itemForm.name) return alert('Item name is required.');
        setSaving(true);
        try {
            const payload = { ...itemForm, expiry_months: itemForm.has_expiry ? (parseInt(itemForm.expiry_months) || null) : null, min_stock: parseInt(itemForm.min_stock) || 0 };
            if (editingItem) await api.updateInventoryItem(editingItem.id, payload);
            else await api.createInventoryItem(payload);
            await refresh(); setShowItemForm(false);
        } catch (err) { alert(err.message); }
        setSaving(false);
    };
    const deleteItem = async (id) => {
        if (!window.confirm('Delete this inventory item? All stock records will also be removed.')) return;
        try { await api.deleteInventoryItem(id); await refresh(); } catch (err) { alert(err.message); }
    };

    // ── Stock In form ────────────────────────────────────────────────────────
    const blankStock = { quantity: '', unit_cost: '', supplier: '', receipt_no: '', po_number: '', received_date: today.toISOString().split('T')[0], notes: '' };
    const [stockForm, setStockForm] = useState(blankStock);
    const sF = (f, v) => setStockForm(p => ({ ...p, [f]: v }));
    const openStockIn = async (item) => { setShowStockIn(item); setStockForm(blankStock); };
    const saveStock = async () => {
        if (!stockForm.quantity) return alert('Quantity is required.');
        setSaving(true);
        try {
            await api.createInventoryStock({ item_id: showStockIn.id, ...stockForm, quantity: parseInt(stockForm.quantity), unit_cost: parseFloat(stockForm.unit_cost) || null });
            await refresh(); setShowStockIn(null);
        } catch (err) { alert(err.message); }
        setSaving(false);
    };

    // ── Issue form ───────────────────────────────────────────────────────────
    const blankIssue = { employee_id: '', quantity: '1', issue_date: today.toISOString().split('T')[0], condition_out: 'New', notes: '' };
    const [issueForm, setIssueForm] = useState(blankIssue);
    const iIF = (f, v) => setIssueForm(p => ({ ...p, [f]: v }));
    const openIssue = (item) => { setShowIssue(item); setIssueForm(blankIssue); };
    const computeExpiry = (issueDate, months) => {
        if (!issueDate || !months) return null;
        const d = new Date(issueDate);
        d.setMonth(d.getMonth() + parseInt(months));
        return d.toISOString().split('T')[0];
    };
    const saveIssuance = async () => {
        const emp = employees.find(e => e.id === issueForm.employee_id);
        if (!issueForm.employee_id || !emp) return alert('Please select an employee.');
        if (!issueForm.issue_date) return alert('Issue date is required.');
        const avail = parseInt(showIssue.available_stock || 0);
        if (parseInt(issueForm.quantity) > avail) return alert(`Only ${avail} unit(s) available in stock.`);
        setSaving(true);
        try {
            const expiry = showIssue.has_expiry ? computeExpiry(issueForm.issue_date, showIssue.expiry_months) : null;
            await api.createIssuance({
                item_id: showIssue.id, employee_id: emp.id, employee_name: emp.name,
                quantity: parseInt(issueForm.quantity) || 1, issue_date: issueForm.issue_date,
                expiry_date: expiry, condition_out: issueForm.condition_out, notes: issueForm.notes,
            });
            await refresh(); setShowIssue(null);
        } catch (err) { alert(err.message); }
        setSaving(false);
    };

    // ── Return form ──────────────────────────────────────────────────────────
    const [returnForm, setReturnForm] = useState({ return_date: today.toISOString().split('T')[0], condition_in: 'Good', status: 'Returned', notes: '' });
    const rF = (f, v) => setReturnForm(p => ({ ...p, [f]: v }));
    const openReturn = (iss) => { setShowReturn(iss); setReturnForm({ return_date: today.toISOString().split('T')[0], condition_in: 'Good', status: 'Returned', notes: '' }); };
    const saveReturn = async () => {
        setSaving(true);
        try {
            await api.updateIssuance(showReturn.id, returnForm);
            await refresh(); setShowReturn(null);
        } catch (err) { alert(err.message); }
        setSaving(false);
    };

    // ── Stock history ────────────────────────────────────────────────────────
    const openStockHistory = async (item) => {
        setShowStockHistory(item);
        try { const r = await api.getInventoryStock(item.id); setStockHistory(r.stock || []); } catch { setStockHistory([]); }
    };

    // ── Filtered views ───────────────────────────────────────────────────────
    const filteredItems = items.filter(i => {
        const q = search.toLowerCase();
        const matchS = !search || i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q);
        const matchC = filterCat === 'All' || i.category === filterCat;
        return matchS && matchC;
    });

    const filteredIssuances = issuances.filter(i => {
        const q = search.toLowerCase();
        const matchS = !search || (i.employee_name || '').toLowerCase().includes(q) || (i.item_name || '').toLowerCase().includes(q);
        const matchSt = filterStatus === 'All' || i.status === filterStatus;
        return matchS && matchSt;
    });

    const TABS = [
        { key: 'overview',  label: 'Overview',       icon: <Package size={15} /> },
        { key: 'catalog',   label: 'Items Catalog',  icon: <Archive size={15} /> },
        { key: 'issuances', label: 'Issuances',      icon: <Users size={15} /> },
    ];

    // ════════════════════════════════════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════════════════════════════════════
    return (
        <div className="dashboard">
            <header className="header">
                <h1>Inventory Management</h1>
                <p>Track equipment, uniforms and tools — procurement, issuance &amp; returns across all contracts.</p>
            </header>

            {/* Tab bar */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', gap: 0, overflowX: 'auto' }}>
                {TABS.map(t => (
                    <button key={t.key} onClick={() => setActiveTab(t.key)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.85rem 1.5rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${activeTab === t.key ? 'var(--primary)' : 'transparent'}`, color: activeTab === t.key ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: activeTab === t.key ? 700 : 400, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                        {t.icon}{t.label}
                    </button>
                ))}
            </div>

            {loading && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>Loading inventory…</div>}

            {/* ══ OVERVIEW TAB ══ */}
            {!loading && activeTab === 'overview' && (
                <div>
                    {/* KPI Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                        {[
                            { label: 'Catalog Items', value: items.length, icon: <Archive size={20} />, color: '#6366f1' },
                            { label: 'Active Issuances', value: activeIssuances.length, icon: <Users size={20} />, color: '#f59e0b' },
                            { label: 'Expiring ≤ 30 days', value: expiringSoon.length, icon: <Clock size={20} />, color: '#f97316', urgent: expiringSoon.length > 0 },
                            { label: 'Overdue / Expired', value: expired.length, icon: <AlertTriangle size={20} />, color: '#ef4444', urgent: expired.length > 0 },
                            { label: 'Low Stock Alerts', value: lowStock.length, icon: <AlertTriangle size={20} />, color: '#eab308', urgent: lowStock.length > 0 },
                            { label: 'Total Procurement Value', value: rs(totalValue), icon: <DollarSign size={20} />, color: '#22c55e' },
                        ].map(kpi => (
                            <Card key={kpi.label} style={{ borderLeft: `3px solid ${kpi.color}`, position: 'relative', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: kpi.urgent ? kpi.color : 'var(--text)', lineHeight: 1 }}>{kpi.value}</div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '4px' }}>{kpi.label}</div>
                                    </div>
                                    <div style={{ background: kpi.color + '22', borderRadius: '10px', padding: '8px', color: kpi.color }}>{kpi.icon}</div>
                                </div>
                                {kpi.urgent && <div style={{ position: 'absolute', top: 0, right: 0, width: '4px', height: '100%', background: kpi.color, opacity: 0.5 }} />}
                            </Card>
                        ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                        {/* Items by Category */}
                        <Card>
                            <STitle><Archive size={13} /> Inventory by Category</STitle>
                            {CATEGORIES.map(cat => {
                                const catItems = items.filter(i => i.category === cat);
                                if (!catItems.length) return null;
                                const issued = catItems.reduce((s, i) => s + parseInt(i.total_issued || 0), 0);
                                const avail = catItems.reduce((s, i) => s + parseInt(i.available_stock || 0), 0);
                                return (
                                    <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: catColor(cat) }} />
                                            <span style={{ fontSize: '0.88rem' }}>{cat}</span>
                                            <Pill label={`${catItems.length} items`} color={catColor(cat)} />
                                        </div>
                                        <div style={{ display: 'flex', gap: '12px', fontSize: '0.82rem' }}>
                                            <span style={{ color: '#f59e0b' }}>{issued} issued</span>
                                            <span style={{ color: '#22c55e' }}>{avail} avail</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </Card>

                        {/* Alerts */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {/* Expiring Soon */}
                            <Card style={{ borderTop: '3px solid #f97316' }}>
                                <STitle><Clock size={13} color="#f97316" /> Expiring Within 30 Days</STitle>
                                {expiringSoon.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>✓ No items expiring soon.</p>}
                                {expiringSoon.slice(0, 5).map(iss => {
                                    const days = daysUntil(iss.expiry_date);
                                    return (
                                        <div key={iss.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.83rem' }}>
                                            <div>
                                                <div style={{ fontWeight: 600 }}>{iss.item_name}</div>
                                                <div style={{ color: 'var(--text-muted)' }}>{iss.employee_name} · {fmtDate(iss.expiry_date)}</div>
                                            </div>
                                            <span style={{ color: '#f97316', fontWeight: 700, fontSize: '0.78rem' }}>{days}d left</span>
                                        </div>
                                    );
                                })}
                            </Card>

                            {/* Low Stock */}
                            <Card style={{ borderTop: '3px solid #eab308' }}>
                                <STitle><AlertTriangle size={13} color="#eab308" /> Low Stock Alerts</STitle>
                                {lowStock.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>✓ All items above minimum stock.</p>}
                                {lowStock.map(item => (
                                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.83rem' }}>
                                        <div>
                                            <div style={{ fontWeight: 600 }}>{item.name}</div>
                                            <div style={{ color: 'var(--text-muted)' }}>Min: {item.min_stock} {item.unit}s</div>
                                        </div>
                                        <span style={{ color: '#ef4444', fontWeight: 700 }}>{item.available_stock} left</span>
                                    </div>
                                ))}
                            </Card>
                        </div>
                    </div>
                </div>
            )}

            {/* ══ CATALOG TAB ══ */}
            {!loading && activeTab === 'catalog' && (
                <div>
                    {/* Controls */}
                    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: '220px', display: 'flex', alignItems: 'center', background: 'var(--bg-card)', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                            <Search size={16} color="var(--text-muted)" style={{ marginRight: '8px', flexShrink: 0 }} />
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none', fontSize: '0.9rem' }} />
                        </div>
                        <FSelect value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ width: 'auto' }}>
                            <option value="All">All Categories</option>
                            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </FSelect>
                        <button onClick={openAddItem} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.55rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            <Plus size={16} /> Add Item
                        </button>
                    </div>

                    {/* Items Table */}
                    <div className="data-table-container">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Item</th><th>Category</th><th>Unit</th><th>Stocked</th><th>Issued</th><th>Available</th><th>Avg Cost</th><th>Expiry</th><th>Min Stock</th><th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredItems.map(item => {
                                    const avail = parseInt(item.available_stock || 0);
                                    const isLow = avail <= parseInt(item.min_stock || 0) && parseInt(item.min_stock || 0) > 0;
                                    return (
                                        <tr key={item.id}>
                                            <td>
                                                <div style={{ fontWeight: 700 }}>{item.name}</div>
                                                {item.description && <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</div>}
                                            </td>
                                            <td><Pill label={item.category} color={catColor(item.category)} /></td>
                                            <td style={{ color: 'var(--text-muted)' }}>{item.unit}</td>
                                            <td style={{ fontWeight: 600 }}>{item.total_stocked}</td>
                                            <td style={{ color: '#f59e0b', fontWeight: 600 }}>{item.total_issued}</td>
                                            <td>
                                                <span style={{ fontWeight: 700, color: isLow ? '#ef4444' : '#22c55e' }}>{avail}</span>
                                                {isLow && <span style={{ fontSize: '0.7rem', color: '#ef4444', marginLeft: '4px' }}>LOW</span>}
                                            </td>
                                            <td>{item.avg_unit_cost > 0 ? rs(item.avg_unit_cost) : '—'}</td>
                                            <td>
                                                {item.has_expiry
                                                    ? <Pill label={`${item.expiry_months}m`} color="#f97316" />
                                                    : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>None</span>}
                                            </td>
                                            <td style={{ color: 'var(--text-muted)' }}>{item.min_stock}</td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    <button onClick={() => openStockIn(item)} title="Stock In" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>+ Stock</button>
                                                    <button onClick={() => openIssue(item)} title="Issue to Employee" style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>Issue</button>
                                                    <button onClick={() => openStockHistory(item)} title="View Stock History" style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '4px 6px', borderRadius: '6px', cursor: 'pointer' }}><Archive size={13} /></button>
                                                    <button onClick={() => openEditItem(item)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '4px 6px', borderRadius: '6px', cursor: 'pointer' }}><Edit2 size={13} /></button>
                                                    <button onClick={() => deleteItem(item.id)} style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', padding: '4px 6px', borderRadius: '6px', cursor: 'pointer' }}><Trash2 size={13} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {!filteredItems.length && (
                                    <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No items found.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ══ ISSUANCES TAB ══ */}
            {!loading && activeTab === 'issuances' && (
                <div>
                    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ flex: 1, minWidth: '220px', display: 'flex', alignItems: 'center', background: 'var(--bg-card)', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                            <Search size={16} color="var(--text-muted)" style={{ marginRight: '8px', flexShrink: 0 }} />
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee or item…" style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none', fontSize: '0.9rem' }} />
                        </div>
                        <FSelect value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 'auto' }}>
                            {['All', 'Issued', 'Returned', 'Expired', 'Lost'].map(s => <option key={s}>{s}</option>)}
                        </FSelect>
                    </div>

                    <div className="data-table-container">
                        <table className="data-table">
                            <thead>
                                <tr><th>Employee</th><th>Item</th><th>Qty</th><th>Issued</th><th>Expiry</th><th>Condition Out</th><th>Status</th><th>Actions</th></tr>
                            </thead>
                            <tbody>
                                {filteredIssuances.map(iss => {
                                    const days = daysUntil(iss.expiry_date);
                                    const isExpiring = days !== null && days >= 0 && days <= 30;
                                    const isExpired = days !== null && days < 0 && iss.status === 'Issued';
                                    return (
                                        <tr key={iss.id} style={{ background: isExpired ? 'rgba(239,68,68,0.04)' : isExpiring ? 'rgba(249,115,22,0.04)' : '' }}>
                                            <td>
                                                <div style={{ fontWeight: 600 }}>{iss.employee_name}</div>
                                                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{iss.employee_id}</div>
                                            </td>
                                            <td>
                                                <div>{iss.item_name}</div>
                                                <Pill label={iss.category} color={catColor(iss.category)} />
                                            </td>
                                            <td style={{ fontWeight: 600 }}>{iss.quantity} {iss.unit}</td>
                                            <td>{fmtDate(iss.issue_date)}</td>
                                            <td>
                                                {iss.expiry_date ? (
                                                    <span style={{ color: isExpired ? '#ef4444' : isExpiring ? '#f97316' : 'var(--text)', fontWeight: isExpired || isExpiring ? 700 : 400 }}>
                                                        {fmtDate(iss.expiry_date)}
                                                        {isExpired && <span style={{ fontSize: '0.72rem', marginLeft: '4px' }}>EXPIRED</span>}
                                                        {isExpiring && !isExpired && <span style={{ fontSize: '0.72rem', marginLeft: '4px' }}>{days}d</span>}
                                                    </span>
                                                ) : '—'}
                                            </td>
                                            <td><Pill label={iss.condition_out || 'New'} color="#94a3b8" /></td>
                                            <td><Badge label={iss.status} color={stColor(iss.status)} /></td>
                                            <td>
                                                {iss.status === 'Issued' && (
                                                    <button onClick={() => openReturn(iss)} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
                                                        <RotateCcw size={12} /> Return
                                                    </button>
                                                )}
                                                {iss.status !== 'Issued' && <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{iss.return_date ? fmtDate(iss.return_date) : '—'}</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {!filteredIssuances.length && (
                                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No issuances found.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ══ MODALS ══ */}

            {/* Add / Edit Item */}
            {showItemForm && (
                <Modal title={editingItem ? 'Edit Inventory Item' : 'Add Inventory Item'} onClose={() => setShowItemForm(false)}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ gridColumn: '1/-1' }}>
                            <FField label="Item Name" required><FInput value={itemForm.name} onChange={e => iF('name', e.target.value)} placeholder="e.g. Safety Helmet" /></FField>
                        </div>
                        <FField label="Category">
                            <FSelect value={itemForm.category} onChange={e => iF('category', e.target.value)}>
                                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                            </FSelect>
                        </FField>
                        <FField label="Unit">
                            <FSelect value={itemForm.unit} onChange={e => iF('unit', e.target.value)}>
                                {UNITS.map(u => <option key={u}>{u}</option>)}
                            </FSelect>
                        </FField>
                        <div style={{ gridColumn: '1/-1' }}>
                            <FField label="Description"><FTextarea rows={2} value={itemForm.description} onChange={e => iF('description', e.target.value)} placeholder="Brief description or spec" /></FField>
                        </div>
                        <FField label="Minimum Stock Alert">
                            <FInput type="number" value={itemForm.min_stock} onChange={e => iF('min_stock', e.target.value)} placeholder="e.g. 5" />
                        </FField>
                        <FField label="Has Expiry?">
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', height: '38px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                    <input type="checkbox" checked={!!itemForm.has_expiry} onChange={e => iF('has_expiry', e.target.checked)}
                                        style={{ width: '16px', height: '16px', accentColor: 'var(--primary)' }} />
                                    Yes — expires after:
                                </label>
                                {itemForm.has_expiry && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <FInput type="number" value={itemForm.expiry_months} onChange={e => iF('expiry_months', e.target.value)} placeholder="12" style={{ width: '70px' }} />
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>months</span>
                                    </div>
                                )}
                            </div>
                        </FField>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                        <button onClick={() => setShowItemForm(false)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.65rem 1.25rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={saveItem} disabled={saving} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.65rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                            <CheckCircle size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />{saving ? 'Saving…' : editingItem ? 'Update Item' : 'Add Item'}
                        </button>
                    </div>
                </Modal>
            )}

            {/* Stock In */}
            {showStockIn && (
                <Modal title={`Stock In — ${showStockIn.name}`} onClose={() => setShowStockIn(null)}>
                    <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: '#22c55e' }}>
                        Current available stock: <strong>{showStockIn.available_stock} {showStockIn.unit}(s)</strong>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <FField label="Quantity Received" required><FInput type="number" value={stockForm.quantity} onChange={e => sF('quantity', e.target.value)} placeholder="e.g. 20" /></FField>
                        <FField label="Unit Cost (Rs.)"><FInput type="number" value={stockForm.unit_cost} onChange={e => sF('unit_cost', e.target.value)} placeholder="e.g. 2500" /></FField>
                        <FField label="Received Date"><FInput type="date" value={stockForm.received_date} onChange={e => sF('received_date', e.target.value)} /></FField>
                        <FField label="Supplier Name"><FInput value={stockForm.supplier} onChange={e => sF('supplier', e.target.value)} placeholder="Supplier / Vendor" /></FField>
                        <FField label="Receipt / Challan No"><FInput value={stockForm.receipt_no} onChange={e => sF('receipt_no', e.target.value)} placeholder="e.g. RCT-2026-001" /></FField>
                        <FField label="PO Number"><FInput value={stockForm.po_number} onChange={e => sF('po_number', e.target.value)} placeholder="e.g. PO-001" /></FField>
                        <div style={{ gridColumn: '1/-1' }}><FField label="Notes"><FTextarea rows={2} value={stockForm.notes} onChange={e => sF('notes', e.target.value)} placeholder="Optional notes" /></FField></div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                        <button onClick={() => setShowStockIn(null)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.65rem 1.25rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={saveStock} disabled={saving} style={{ background: '#22c55e', border: 'none', color: 'white', padding: '0.65rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                            <PackagePlus size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />{saving ? 'Saving…' : 'Record Stock In'}
                        </button>
                    </div>
                </Modal>
            )}

            {/* Issue to Employee */}
            {showIssue && (
                <Modal title={`Issue — ${showIssue.name}`} onClose={() => setShowIssue(null)}>
                    <div style={{ background: parseInt(showIssue.available_stock) > 0 ? 'rgba(56,189,248,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${parseInt(showIssue.available_stock) > 0 ? 'rgba(56,189,248,0.25)' : 'rgba(239,68,68,0.25)'}`, borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: parseInt(showIssue.available_stock) > 0 ? '#38bdf8' : '#ef4444' }}>
                        Available stock: <strong>{showIssue.available_stock} {showIssue.unit}(s)</strong>
                        {showIssue.has_expiry && <span style={{ marginLeft: '12px', color: '#f97316' }}>• Expiry: {showIssue.expiry_months} months from issue date</span>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ gridColumn: '1/-1' }}>
                            <FField label="Select Employee" required>
                                <FSelect value={issueForm.employee_id} onChange={e => iIF('employee_id', e.target.value)}>
                                    <option value="">— Select Employee —</option>
                                    {employees.filter(e => e.active === 'Yes').sort((a, b) => a.name.localeCompare(b.name)).map(e => (
                                        <option key={e.id} value={e.id}>{e.name} ({e.id})</option>
                                    ))}
                                </FSelect>
                            </FField>
                        </div>
                        <FField label="Quantity"><FInput type="number" value={issueForm.quantity} onChange={e => iIF('quantity', e.target.value)} /></FField>
                        <FField label="Issue Date" required><FInput type="date" value={issueForm.issue_date} onChange={e => iIF('issue_date', e.target.value)} /></FField>
                        <FField label="Condition at Issue">
                            <FSelect value={issueForm.condition_out} onChange={e => iIF('condition_out', e.target.value)}>
                                {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                            </FSelect>
                        </FField>
                        {showIssue.has_expiry && (
                            <FField label="Calculated Expiry">
                                <div style={{ padding: '8px 12px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: '#f97316', fontWeight: 600, fontSize: '0.88rem' }}>
                                    {computeExpiry(issueForm.issue_date, showIssue.expiry_months) ? fmtDate(computeExpiry(issueForm.issue_date, showIssue.expiry_months)) : '—'}
                                </div>
                            </FField>
                        )}
                        <div style={{ gridColumn: '1/-1' }}><FField label="Notes"><FTextarea rows={2} value={issueForm.notes} onChange={e => iIF('notes', e.target.value)} /></FField></div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                        <button onClick={() => setShowIssue(null)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.65rem 1.25rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={saveIssuance} disabled={saving || parseInt(showIssue.available_stock) <= 0} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.65rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, opacity: parseInt(showIssue.available_stock) <= 0 ? 0.5 : 1 }}>
                            <ArrowDownCircle size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />{saving ? 'Issuing…' : 'Issue Item'}
                        </button>
                    </div>
                </Modal>
            )}

            {/* Return Modal */}
            {showReturn && (
                <Modal title={`Return — ${showReturn.item_name}`} onClose={() => setShowReturn(null)}>
                    <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
                        Issued to: <strong>{showReturn.employee_name}</strong> · Issued: {fmtDate(showReturn.issue_date)}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <FField label="Return Date"><FInput type="date" value={returnForm.return_date} onChange={e => rF('return_date', e.target.value)} /></FField>
                        <FField label="Return Status">
                            <FSelect value={returnForm.status} onChange={e => rF('status', e.target.value)}>
                                {['Returned', 'Lost', 'Expired'].map(s => <option key={s}>{s}</option>)}
                            </FSelect>
                        </FField>
                        <FField label="Condition on Return">
                            <FSelect value={returnForm.condition_in} onChange={e => rF('condition_in', e.target.value)}>
                                {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                            </FSelect>
                        </FField>
                        <div style={{ gridColumn: '1/-1' }}><FField label="Notes"><FTextarea rows={2} value={returnForm.notes} onChange={e => rF('notes', e.target.value)} /></FField></div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                        <button onClick={() => setShowReturn(null)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.65rem 1.25rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={saveReturn} disabled={saving} style={{ background: '#22c55e', border: 'none', color: 'white', padding: '0.65rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                            <RotateCcw size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />{saving ? 'Saving…' : 'Record Return'}
                        </button>
                    </div>
                </Modal>
            )}

            {/* Stock History */}
            {showStockHistory && (
                <Modal title={`Procurement History — ${showStockHistory.name}`} onClose={() => setShowStockHistory(null)} wide>
                    <div className="data-table-container">
                        <table className="data-table">
                            <thead><tr><th>Date</th><th>Qty</th><th>Unit Cost</th><th>Total Value</th><th>Supplier</th><th>Receipt No.</th><th>PO No.</th><th>Notes</th></tr></thead>
                            <tbody>
                                {stockHistory.map(s => (
                                    <tr key={s.id}>
                                        <td>{fmtDate(s.received_date)}</td>
                                        <td style={{ fontWeight: 700 }}>{s.quantity} {s.unit}</td>
                                        <td>{s.unit_cost ? rs(s.unit_cost) : '—'}</td>
                                        <td style={{ color: '#22c55e', fontWeight: 700 }}>{s.unit_cost ? rs(s.quantity * s.unit_cost) : '—'}</td>
                                        <td>{s.supplier || '—'}</td>
                                        <td>{s.receipt_no || '—'}</td>
                                        <td>{s.po_number || '—'}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{s.notes || '—'}</td>
                                    </tr>
                                ))}
                                {!stockHistory.length && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No procurement records yet.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </Modal>
            )}
        </div>
    );
}
