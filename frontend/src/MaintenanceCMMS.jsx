import React, { useState, useEffect } from 'react';
import { api } from './api';

const PRIORITIES = ['low', 'normal', 'high', 'critical'];
const BILLABLE_OPTIONS = ['tbd', 'billable', 'internal'];

const Card = ({ children, style = {} }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem', ...style }}>{children}</div>
);

const fmtDate = s => s ? String(s).slice(0, 10) : '—';
const isOverdue = (dueDate, status) => dueDate && ['open', 'in_progress'].includes(status) && new Date(dueDate) < new Date();

function TicketBoard({ user }) {
  const [tickets, setTickets] = useState([]);
  const [sites, setSites] = useState([]);
  const [siteFilter, setSiteFilter] = useState('');
  const [form, setForm] = useState({
    site: '', category: 'Other', priority: 'normal', title: '', description: '',
    is_minor_petty_cash: false, petty_cash_amount: '', due_date: '', cc_email: '',
  });
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(true);
  const canBill = ['superadmin', 'operations', 'finance_manager', 'finance_proposer'].includes(user?.role);

  const selectedSite = sites.find(s => s.site_name === form.site);
  const categories = selectedSite?.categories?.length
    ? selectedSite.categories.map(c => ({ value: c, label: c }))
    : [{ value: 'Other', label: 'Other' }];

  const loadSites = () => api.getCmmsSites().then(d => setSites(d.sites || [])).catch(() => {});
  const load = () => {
    setLoading(true);
    api.getMaintenanceTickets(siteFilter ? { site: siteFilter } : {})
      .then(d => setTickets(d.tickets || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSites(); }, []);
  useEffect(() => { load(); }, [siteFilter]);

  const submit = async (e) => {
    e.preventDefault();
    if (!photo) return alert('Photo upload is mandatory for staff submissions');
    try {
      await api.createMaintenanceTicket(form, photo);
      setForm({ site: '', category: 'Other', priority: 'normal', title: '', description: '', is_minor_petty_cash: false, petty_cash_amount: '', due_date: '', cc_email: '' });
      setPhoto(null);
      load();
    } catch (err) { alert(err.message); }
  };

  const updateStatus = async (id, status) => {
    try { await api.updateMaintenanceTicket(id, { status }); load(); } catch (e) { alert(e.message); }
  };

  const updateBillable = async (id, billable_to_client) => {
    try { await api.updateMaintenanceTicket(id, { billable_to_client }); load(); } catch (e) { alert(e.message); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card>
        <h3 style={{ margin: '0 0 1rem' }}>Report Maintenance Issue</h3>
        <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Site</label>
            <select required value={form.site} onChange={e => setForm(p => ({ ...p, site: e.target.value, category: (sites.find(s => s.site_name === e.target.value)?.categories?.[0]) || 'Other' }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
              <option value="">Select site…</option>
              {sites.map(s => <option key={s.id} value={s.site_name}>{s.site_name}{s.client_name ? ` (${s.client_name})` : ''}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Title</label>
            <input required value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Category</label>
            <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
              {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Priority</label>
            <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Deadline</label>
            <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CC Email</label>
            <input type="email" value={form.cc_email} onChange={e => setForm(p => ({ ...p, cc_email: e.target.value }))}
              placeholder={selectedSite?.cc_email || ''}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Description</label>
            <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Photo (required for staff)</label>
            <input type="file" accept="image/*" required onChange={e => setPhoto(e.target.files[0])} />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_minor_petty_cash} onChange={e => setForm(p => ({ ...p, is_minor_petty_cash: e.target.checked }))} />
              Minor Issue — Emergency Petty Cash used
            </label>
            {form.is_minor_petty_cash && (
              <input type="number" placeholder="Amount spent" value={form.petty_cash_amount}
                onChange={e => setForm(p => ({ ...p, petty_cash_amount: e.target.value }))}
                style={{ width: '120px', padding: '6px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)' }} />
            )}
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" style={{ padding: '10px 20px', background: 'var(--primary)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Submit Ticket</button>
          </div>
        </form>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Open Tickets</h3>
          <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)}
            style={{ padding: '6px 12px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
            <option value="">All sites</option>
            {sites.map(s => <option key={s.id} value={s.site_name}>{s.site_name}</option>)}
          </select>
        </div>
        {loading ? <p>Loading...</p> : !tickets.length ? <p style={{ color: 'var(--text-muted)' }}>No tickets.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['ID', 'Site', 'Category', 'Priority', 'Title', 'Deadline', 'Owner', 'Status', ...(canBill ? ['Billable'] : []), 'Actions'].map(h => (
                  <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border)', background: isOverdue(t.due_date, t.status) ? 'rgba(239,68,68,0.08)' : 'transparent' }}>
                    <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '0.75rem' }}>{t.id}</td>
                    <td style={{ padding: '8px' }}>{t.site}</td>
                    <td style={{ padding: '8px' }}>{t.category}</td>
                    <td style={{ padding: '8px' }}>
                      <span style={{ color: t.priority === 'critical' ? '#ef4444' : t.priority === 'high' ? '#f59e0b' : 'inherit', fontWeight: ['critical', 'high'].includes(t.priority) ? 700 : 400 }}>{t.priority}</span>
                    </td>
                    <td style={{ padding: '8px', maxWidth: '200px' }}>{t.title}</td>
                    <td style={{ padding: '8px', color: isOverdue(t.due_date, t.status) ? '#ef4444' : 'inherit', fontWeight: isOverdue(t.due_date, t.status) ? 700 : 400 }}>{fmtDate(t.due_date)}</td>
                    <td style={{ padding: '8px', fontSize: '0.75rem' }}>{t.assigned_to ? t.assigned_to.split('@')[0] : '—'}</td>
                    <td style={{ padding: '8px' }}>{t.status}</td>
                    {canBill && (
                      <td style={{ padding: '8px' }}>
                        <select value={t.billable_to_client || 'tbd'} onChange={e => updateBillable(t.id, e.target.value)}
                          style={{ padding: '4px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '0.75rem' }}>
                          {BILLABLE_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </td>
                    )}
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                      {t.status === 'open' && <button onClick={() => updateStatus(t.id, 'in_progress')} style={{ marginRight: '4px', padding: '3px 8px', fontSize: '0.75rem', cursor: 'pointer' }}>Start</button>}
                      {['open', 'in_progress'].includes(t.status) && <button onClick={() => updateStatus(t.id, 'resolved')} style={{ padding: '3px 8px', fontSize: '0.75rem', cursor: 'pointer' }}>Resolve</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SitesPanel() {
  const [sites, setSites] = useState([]);
  const [clientUsers, setClientUsers] = useState([]);
  const [form, setForm] = useState({
    site_name: '', client_name: '', categories: '', default_assignee_email: '', default_assignee_name: '', cc_email: '',
  });
  const [clientForm, setClientForm] = useState({ email: '', name: '', site: '' });

  const load = () => {
    api.getCmmsSites().then(d => setSites(d.sites || [])).catch(() => {});
    api.getCmmsClientUsers().then(d => setClientUsers(d.users || [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const saveSite = async (e) => {
    e.preventDefault();
    try {
      await api.createCmmsSite({
        ...form,
        categories: form.categories.split(',').map(s => s.trim()).filter(Boolean),
      });
      setForm({ site_name: '', client_name: '', categories: '', default_assignee_email: '', default_assignee_name: '', cc_email: '' });
      load();
    } catch (err) { alert(err.message); }
  };

  const saveClient = async (e) => {
    e.preventDefault();
    try {
      await api.createCmmsClientUser(clientForm);
      setClientForm({ email: '', name: '', site: '' });
      load();
    } catch (err) { alert(err.message); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card>
        <h3 style={{ margin: '0 0 1rem' }}>CMMS Sites Registry</h3>
        <form onSubmit={saveSite} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
          {[
            ['Site name', 'site_name'], ['Client name', 'client_name'], ['Categories (comma-separated)', 'categories'],
            ['Default assignee email', 'default_assignee_email'], ['Default assignee name', 'default_assignee_name'], ['CC email', 'cc_email'],
          ].map(([lbl, key]) => (
            <div key={key}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{lbl}</label>
              <input required={key === 'site_name'} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
            </div>
          ))}
          <div><button type="submit" style={{ marginTop: '18px', padding: '8px 16px', background: 'var(--primary)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer' }}>Add Site</button></div>
        </form>
      </Card>
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Site', 'Client', 'Assignee', 'Categories'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {sites.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px', fontWeight: 700 }}>{s.site_name}</td>
                <td style={{ padding: '8px' }}>{s.client_name || '—'}</td>
                <td style={{ padding: '8px', fontSize: '0.78rem' }}>{s.default_assignee_name || s.default_assignee_email || '—'}</td>
                <td style={{ padding: '8px', fontSize: '0.78rem' }}>{(s.categories || []).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <h3 style={{ margin: '0 0 1rem' }}>Client Portal Access</h3>
        <form onSubmit={saveClient} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input placeholder="Client email" required type="email" value={clientForm.email} onChange={e => setClientForm(p => ({ ...p, email: e.target.value }))}
            style={{ padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          <input placeholder="Name" value={clientForm.name} onChange={e => setClientForm(p => ({ ...p, name: e.target.value }))}
            style={{ padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          <select required value={clientForm.site} onChange={e => setClientForm(p => ({ ...p, site: e.target.value }))}
            style={{ padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
            <option value="">Site…</option>
            {sites.map(s => <option key={s.id} value={s.site_name}>{s.site_name}</option>)}
          </select>
          <button type="submit" style={{ padding: '8px 16px', background: 'var(--primary)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer' }}>Add Client</button>
        </form>
        <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Email', 'Name', 'Site'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {clientUsers.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px' }}>{u.email}</td>
                <td style={{ padding: '8px' }}>{u.name || '—'}</td>
                <td style={{ padding: '8px' }}>{u.site}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function EscalationMatrix() {
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState({ site: '', priority: 'any', hours_open: '0', basis: 'hours_overdue', escalate_to_name: '', escalate_to_email: '', escalate_to_phone: '' });

  const load = () => api.getEscalationRules().then(d => setRules(d.rules || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    try { await api.createEscalationRule(form); setForm({ site: '', priority: 'any', hours_open: '0', basis: 'hours_overdue', escalate_to_name: '', escalate_to_email: '', escalate_to_phone: '' }); load(); } catch (err) { alert(err.message); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card>
        <h3 style={{ margin: '0 0 1rem' }}>Site Escalation Matrix</h3>
        <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.75rem' }}>
          {['site', 'escalate_to_name', 'escalate_to_email', 'escalate_to_phone'].map(f => (
            <div key={f}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{f.replace(/_/g, ' ')}</label>
              <input required={['site', 'escalate_to_email'].includes(f)} value={form[f]} onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))}
                style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
            </div>
          ))}
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Priority</label>
            <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
              {[...PRIORITIES, 'any'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Basis</label>
            <select value={form.basis} onChange={e => setForm(p => ({ ...p, basis: e.target.value }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
              <option value="hours_overdue">Hours overdue (deadline-based)</option>
              <option value="hours_open">Hours open (no deadline)</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{form.basis === 'hours_overdue' ? 'Hours overdue threshold' : 'Hours open threshold'}</label>
            <input type="number" step="0.5" required value={form.hours_open} onChange={e => setForm(p => ({ ...p, hours_open: e.target.value }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          </div>
          <div><button type="submit" style={{ marginTop: '18px', padding: '8px 16px', background: 'var(--primary)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer' }}>Add Rule</button></div>
        </form>
      </Card>
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Site', 'Priority', 'Basis', 'Threshold (h)', 'Manager', 'Email'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px' }}>{r.site}</td>
                <td style={{ padding: '8px' }}>{r.priority}</td>
                <td style={{ padding: '8px' }}>{r.basis || 'hours_open'}</td>
                <td style={{ padding: '8px' }}>{r.hours_open}h</td>
                <td style={{ padding: '8px' }}>{r.escalate_to_name}</td>
                <td style={{ padding: '8px' }}>{r.escalate_to_email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function BillingReport() {
  const [report, setReport] = useState(null);
  const [site, setSite] = useState('LOBP');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [sites, setSites] = useState([]);

  useEffect(() => { api.getCmmsSites().then(d => setSites(d.sites || [])).catch(() => {}); }, []);

  const load = () => {
    api.getCmmsBillingReport({ site, month, year }).then(setReport).catch(() => {});
  };
  useEffect(() => { load(); }, [site, month, year]);

  const downloadCsv = async () => {
    const res = await api.getCmmsBillingReportCsv({ site, month, year });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cmms-billing-${year}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = report?.summary || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={site} onChange={e => setSite(e.target.value)}
            style={{ padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
            <option value="">All sites</option>
            {sites.map(st => <option key={st.id} value={st.site_name}>{st.site_name}</option>)}
          </select>
          <input type="number" min={1} max={12} value={month} onChange={e => setMonth(e.target.value)}
            style={{ width: '70px', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          <input type="number" value={year} onChange={e => setYear(e.target.value)}
            style={{ width: '90px', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          <button onClick={downloadCsv} style={{ padding: '8px 16px', background: 'var(--primary)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer' }}>Export CSV</button>
        </div>
      </Card>
      {report && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
            {[
              ['Billable tickets', s.billable || 0], ['Internal tickets', s.internal || 0], ['TBD tickets', s.tbd || 0],
              ['Billable spend', `Rs ${(s.spend_billable || 0).toLocaleString('en-PK')}`],
              ['Internal spend', `Rs ${(s.spend_internal || 0).toLocaleString('en-PK')}`],
            ].map(([lbl, val]) => (
              <Card key={lbl}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{lbl}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '4px' }}>{val}</div>
              </Card>
            ))}
          </div>
          <Card>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['ID', 'Site', 'Title', 'Billable', 'Spend', 'Status'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {(report.tickets || []).map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '0.75rem' }}>{t.id}</td>
                    <td style={{ padding: '8px' }}>{t.site}</td>
                    <td style={{ padding: '8px' }}>{t.title}</td>
                    <td style={{ padding: '8px' }}>{t.billable_to_client || 'tbd'}</td>
                    <td style={{ padding: '8px' }}>Rs {parseFloat(t.spend_total || 0).toLocaleString('en-PK')}</td>
                    <td style={{ padding: '8px' }}>{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function PettyCashPanel() {
  const [funds, setFunds] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [site, setSite] = useState('');
  const [fundForm, setFundForm] = useState({ site: '', monthly_threshold: '', finance_emails: '' });
  const [entryForm, setEntryForm] = useState({ site: '', entry_type: 'allocation', amount: '', notes: '' });

  const load = () => {
    api.getPettyCashFunds().then(d => setFunds(d.funds || [])).catch(() => {});
    api.getPettyCashLedger(site ? { site } : {}).then(d => setLedger(d.ledger || [])).catch(() => {});
  };
  useEffect(() => { load(); }, [site]);

  const saveFund = async (e) => {
    e.preventDefault();
    try {
      await api.savePettyCashFund({ ...fundForm, finance_emails: fundForm.finance_emails.split(',').map(s => s.trim()).filter(Boolean) });
      load();
    } catch (err) { alert(err.message); }
  };

  const addEntry = async (e) => {
    e.preventDefault();
    try { await api.addPettyCashEntry(entryForm); load(); } catch (err) { alert(err.message); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '1rem' }}>
        {funds.map(f => (
          <Card key={f.id}>
            <div style={{ fontWeight: 700, marginBottom: '4px' }}>{f.site}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: (f.pct_remaining || 0) < 0.2 ? '#ef4444' : '#22c55e' }}>
              Rs {(f.balance || 0).toLocaleString('en-PK')}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Threshold: Rs {parseFloat(f.monthly_threshold).toLocaleString('en-PK')} · {Math.round((f.pct_remaining || 0) * 100)}% remaining</div>
          </Card>
        ))}
      </div>
      <Card>
        <h3 style={{ margin: '0 0 1rem' }}>Configure Site Fund</h3>
        <form onSubmit={saveFund} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input placeholder="Site" required value={fundForm.site} onChange={e => setFundForm(p => ({ ...p, site: e.target.value }))}
            style={{ padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          <input type="number" placeholder="Monthly threshold" required value={fundForm.monthly_threshold} onChange={e => setFundForm(p => ({ ...p, monthly_threshold: e.target.value }))}
            style={{ padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          <input placeholder="Finance emails (comma-separated)" value={fundForm.finance_emails} onChange={e => setFundForm(p => ({ ...p, finance_emails: e.target.value }))}
            style={{ flex: 1, minWidth: '200px', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          <button type="submit" style={{ padding: '8px 16px', background: 'var(--primary)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer' }}>Save</button>
        </form>
      </Card>
      <Card>
        <h3 style={{ margin: '0 0 1rem' }}>Ledger Entry</h3>
        <form onSubmit={addEntry} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <input placeholder="Site" required value={entryForm.site} onChange={e => setEntryForm(p => ({ ...p, site: e.target.value }))}
            style={{ padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          <select value={entryForm.entry_type} onChange={e => setEntryForm(p => ({ ...p, entry_type: e.target.value }))}
            style={{ padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
            <option value="allocation">Allocation</option>
            <option value="replenishment">Replenishment</option>
            <option value="spend">Spend</option>
          </select>
          <input type="number" placeholder="Amount" required value={entryForm.amount} onChange={e => setEntryForm(p => ({ ...p, amount: e.target.value }))}
            style={{ padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          <input placeholder="Notes" value={entryForm.notes} onChange={e => setEntryForm(p => ({ ...p, notes: e.target.value }))}
            style={{ flex: 1, padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          <button type="submit" style={{ padding: '8px 16px', background: 'var(--primary)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer' }}>Add</button>
        </form>
        <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Date', 'Site', 'Type', 'Amount', 'Ticket', 'Notes'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {ledger.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px' }}>{e.entry_date}</td>
                <td style={{ padding: '8px' }}>{e.site}</td>
                <td style={{ padding: '8px' }}>{e.entry_type}</td>
                <td style={{ padding: '8px' }}>Rs {parseFloat(e.amount).toLocaleString('en-PK')}</td>
                <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '0.75rem' }}>{e.ticket_id || '—'}</td>
                <td style={{ padding: '8px' }}>{e.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function MaintenanceCMMS({ user }) {
  const isAdmin = ['superadmin', 'operations', 'procurement_manager'].includes(user?.role);
  const isFinance = ['finance_manager', 'finance_proposer', 'superadmin'].includes(user?.role);
  const tabs = [
    { key: 'tickets', label: 'Tickets' },
    ...(isAdmin ? [{ key: 'sites', label: 'Sites' }] : []),
    ...(isAdmin ? [{ key: 'escalation', label: 'Escalation Matrix' }] : []),
    ...(isFinance ? [{ key: 'billing', label: 'Billing Report' }] : []),
    ...(isFinance ? [{ key: 'petty', label: 'Emergency Petty Cash' }] : []),
  ];
  const [tab, setTab] = useState('tickets');

  return (
    <div className="dashboard">
      <header className="header">
        <h1>Maintenance & CMMS</h1>
        <p>Asset ticketing, site registry, escalation matrix, billing, and emergency petty cash.</p>
      </header>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '0.8rem 1.25rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t.key ? 'var(--primary)' : 'transparent'}`,
              color: tab === t.key ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: tab === t.key ? 700 : 400, whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'tickets' && <TicketBoard user={user} />}
      {tab === 'sites' && <SitesPanel />}
      {tab === 'escalation' && <EscalationMatrix />}
      {tab === 'billing' && <BillingReport />}
      {tab === 'petty' && <PettyCashPanel />}
    </div>
  );
}
