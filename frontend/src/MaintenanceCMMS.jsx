import React, { useState, useEffect } from 'react';
import { api } from './api';

const CATEGORIES = [
  { value: 'broken_pipe', label: 'Broken Pipes' },
  { value: 'supply_shortage', label: 'Supply Shortages' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES = ['low', 'normal', 'critical'];

const Card = ({ children, style = {} }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem', ...style }}>{children}</div>
);

function TicketBoard() {
  const [tickets, setTickets] = useState([]);
  const [site, setSite] = useState('');
  const [form, setForm] = useState({ site: '', category: 'other', priority: 'normal', title: '', description: '', is_minor_petty_cash: false, petty_cash_amount: '' });
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.getMaintenanceTickets(site ? { site } : {}).then(d => setTickets(d.tickets || [])).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [site]);

  const submit = async (e) => {
    e.preventDefault();
    if (!photo) return alert('Photo upload is mandatory');
    try {
      await api.createMaintenanceTicket(form, photo);
      setForm({ site: '', category: 'other', priority: 'normal', title: '', description: '', is_minor_petty_cash: false, petty_cash_amount: '' });
      setPhoto(null);
      load();
    } catch (err) { alert(err.message); }
  };

  const updateStatus = async (id, status) => {
    try { await api.updateMaintenanceTicket(id, { status }); load(); } catch (e) { alert(e.message); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Card>
        <h3 style={{ margin: '0 0 1rem' }}>Report Maintenance Issue</h3>
        <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          {[
            ['Site', 'site', 'text'], ['Title', 'title', 'text'],
          ].map(([lbl, key, type]) => (
            <div key={key}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{lbl}</label>
              <input required type={type} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
            </div>
          ))}
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Category</label>
            <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Priority</label>
            <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Description</label>
            <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Photo (required)</label>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Open Tickets</h3>
          <input placeholder="Filter by site" value={site} onChange={e => setSite(e.target.value)}
            style={{ padding: '6px 12px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
        </div>
        {loading ? <p>Loading...</p> : !tickets.length ? <p style={{ color: 'var(--text-muted)' }}>No tickets.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['ID', 'Site', 'Category', 'Priority', 'Title', 'Status', 'Actions'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '0.75rem' }}>{t.id}</td>
                  <td style={{ padding: '8px' }}>{t.site}</td>
                  <td style={{ padding: '8px' }}>{t.category}</td>
                  <td style={{ padding: '8px' }}><span style={{ color: t.priority === 'critical' ? '#ef4444' : 'inherit', fontWeight: t.priority === 'critical' ? 700 : 400 }}>{t.priority}</span></td>
                  <td style={{ padding: '8px' }}>{t.title}</td>
                  <td style={{ padding: '8px' }}>{t.status}</td>
                  <td style={{ padding: '8px' }}>
                    {t.status === 'open' && <button onClick={() => updateStatus(t.id, 'in_progress')} style={{ marginRight: '4px', padding: '3px 8px', fontSize: '0.75rem', cursor: 'pointer' }}>Start</button>}
                    {['open', 'in_progress'].includes(t.status) && <button onClick={() => updateStatus(t.id, 'resolved')} style={{ padding: '3px 8px', fontSize: '0.75rem', cursor: 'pointer' }}>Resolve</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function EscalationMatrix() {
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState({ site: '', priority: 'critical', hours_open: '2', escalate_to_name: '', escalate_to_email: '', escalate_to_phone: '' });

  const load = () => api.getEscalationRules().then(d => setRules(d.rules || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    try { await api.createEscalationRule(form); setForm({ site: '', priority: 'critical', hours_open: '2', escalate_to_name: '', escalate_to_email: '', escalate_to_phone: '' }); load(); } catch (err) { alert(err.message); }
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
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Hours open before escalate</label>
            <input type="number" step="0.5" required value={form.hours_open} onChange={e => setForm(p => ({ ...p, hours_open: e.target.value }))}
              style={{ width: '100%', padding: '8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)' }} />
          </div>
          <div><button type="submit" style={{ marginTop: '18px', padding: '8px 16px', background: 'var(--primary)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer' }}>Add Rule</button></div>
        </form>
      </Card>
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Site', 'Priority', 'Hours', 'Manager', 'Email', 'Phone'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px' }}>{r.site}</td>
                <td style={{ padding: '8px' }}>{r.priority}</td>
                <td style={{ padding: '8px' }}>{r.hours_open}h</td>
                <td style={{ padding: '8px' }}>{r.escalate_to_name}</td>
                <td style={{ padding: '8px' }}>{r.escalate_to_email}</td>
                <td style={{ padding: '8px' }}>{r.escalate_to_phone || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
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
            {['Date', 'Site', 'Type', 'Amount', 'Notes'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {ledger.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px' }}>{e.entry_date}</td>
                <td style={{ padding: '8px' }}>{e.site}</td>
                <td style={{ padding: '8px' }}>{e.entry_type}</td>
                <td style={{ padding: '8px' }}>Rs {parseFloat(e.amount).toLocaleString('en-PK')}</td>
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
    ...(isAdmin ? [{ key: 'escalation', label: 'Escalation Matrix' }] : []),
    ...(isFinance ? [{ key: 'petty', label: 'Emergency Petty Cash' }] : []),
  ];
  const [tab, setTab] = useState('tickets');

  return (
    <div className="dashboard">
      <header className="header">
        <h1>Maintenance & CMMS</h1>
        <p>Asset ticketing, site escalation matrix, and emergency petty cash ledger.</p>
      </header>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '0.8rem 1.25rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t.key ? 'var(--primary)' : 'transparent'}`,
              color: tab === t.key ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: tab === t.key ? 700 : 400 }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'tickets' && <TicketBoard />}
      {tab === 'escalation' && <EscalationMatrix />}
      {tab === 'petty' && <PettyCashPanel />}
    </div>
  );
}
