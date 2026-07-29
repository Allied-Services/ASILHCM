import React, { useState, useEffect, useCallback } from 'react';
import { api, apiFetch } from './api';
import AttendanceIntake from './features/attendance/AttendanceIntake';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
const fmt = n => (parseFloat(n)||0).toLocaleString('en-PK');
const today = () => new Date().toISOString().slice(0,10);
const yesterday = () => new Date(Date.now()-86400000).toISOString().slice(0,10);

const STATUS_CFG = {
  present:  { label: 'P',        color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   full: 'Present'  },
  absent:   { label: 'A',        color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   full: 'Absent'   },
  unexcused:{ label: 'U',        color: '#f97316', bg: 'rgba(249,115,22,0.15)', full: 'Unexcused' },
  half_day: { label: '½',        color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', full: 'Half Day' },
  leave:    { label: 'L',        color: '#38bdf8', bg: 'rgba(56,189,248,0.15)', full: 'Leave'    },
  ot:       { label: 'OT',       color: '#a78bfa', bg: 'rgba(167,139,250,0.15)',full: 'Overtime' },
};

const Card = ({children, style={}}) => (
  <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'12px',padding:'1.25rem',...style}}>{children}</div>
);
const Kpi = ({label,value,color='var(--primary)'}) => (
  <div style={{background:'var(--bg-dark)',borderRadius:'10px',padding:'1rem',textAlign:'center',border:'1px solid var(--border)'}}>
    <div style={{fontSize:'1.8rem',fontWeight:800,color}}>{value}</div>
    <div style={{fontSize:'0.75rem',color:'var(--text-muted)',marginTop:'3px'}}>{label}</div>
  </div>
);

// ── Daily Marking (Supervisor) ────────────────────────────────────────────────
function DailyMarking({user}) {
  const [team, setTeam] = useState([]);
  const [date, setDate] = useState(today());
  const [records, setRecords] = useState({});
  const [remarks, setRemarks] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMyTeam().then(d => { setTeam(d.team||[]); setLoading(false); }).catch(()=>setLoading(false));
  }, []);

  useEffect(() => {
    if (!team.length) return;
    api.getAttendanceToday().then(d => {
      setRecords(Object.fromEntries(Object.entries(d.attendance||{}).map(([k,v])=>[k,v.status])));
      setRemarks(Object.fromEntries(Object.entries(d.attendance||{}).map(([k,v])=>[k,v.remarks||''])));
    }).catch(()=>{});
  }, [team]);

  const set = (empId, status) => setRecords(p=>({...p,[empId]:status}));
  const setRem = (empId, val) => setRemarks(p=>({...p,[empId]:val}));

  const submit = async () => {
    setSaving(true);
    try {
      const recs = team.map(e=>({employee_id:e.employee_id, status:records[e.employee_id]||'present', remarks:remarks[e.employee_id]||''}));
      await api.markAttendance(date, recs);
      setSaved(true); setTimeout(()=>setSaved(false),3000);
    } catch(e){alert('Save failed: '+e.message);}
    setSaving(false);
  };

  const counts = Object.values(records);
  const present = counts.filter(s=>s==='present'||s==='ot').length;
  const absent  = counts.filter(s=>s==='absent'||s==='unexcused').length;
  const half    = counts.filter(s=>s==='half_day').length;
  const leave   = counts.filter(s=>s==='leave').length;

  if (loading) return <div style={{padding:'4rem',textAlign:'center',color:'var(--text-muted)'}}>Loading team...</div>;
  if (!team.length) return (
    <Card><div style={{textAlign:'center',padding:'3rem',color:'var(--text-muted)'}}>
      <div style={{fontSize:'2.5rem',marginBottom:'1rem'}}>👥</div>
      <div style={{fontWeight:700,marginBottom:'0.5rem'}}>No Team Assigned</div>
      <div style={{fontSize:'0.85rem'}}>Ask your HR Manager to assign employees to your team.</div>
    </div></Card>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
      {/* Header controls */}
      <div style={{display:'flex',gap:'1rem',alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>Date</div>
          <select value={date} onChange={e=>setDate(e.target.value)}
            style={{background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'8px',padding:'7px 12px',color:'var(--text)',fontSize:'0.88rem'}}>
            <option value={today()}>Today — {today()}</option>
            <option value={yesterday()}>Yesterday — {yesterday()}</option>
          </select>
        </div>
        <div style={{flex:1}}/>
        {saved && <span style={{color:'#22c55e',fontWeight:700,fontSize:'0.88rem'}}>✅ Attendance saved!</span>}
        <button onClick={submit} disabled={saving}
          style={{background:saving?'#334155':'#22c55e',border:'none',color:'white',padding:'9px 20px',borderRadius:'8px',cursor:'pointer',fontWeight:700,fontSize:'0.88rem'}}>
          {saving?'Saving…':'✓ Submit Attendance'}
        </button>
      </div>

      {/* KPI row */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'0.75rem'}}>
        <Kpi label="Present" value={present} color="#22c55e"/>
        <Kpi label="Absent"  value={absent}  color="#ef4444"/>
        <Kpi label="Half Day" value={half}   color="#f59e0b"/>
        <Kpi label="On Leave" value={leave}  color="#38bdf8"/>
      </div>

      {/* Attendance table */}
      <Card style={{padding:0,overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.875rem'}}>
            <thead>
              <tr style={{background:'var(--bg-dark)',borderBottom:'1px solid var(--border)'}}>
                {['Employee','Designation','Site',Object.values(STATUS_CFG).map(s=>s.full).join(' / '),'Remarks'].map(h=>(
                  <th key={h} style={{padding:'0.75rem 1rem',textAlign:'left',color:'var(--text-muted)',fontWeight:600,fontSize:'0.75rem',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.map(e=>{
                const cur = records[e.employee_id];
                return (
                  <tr key={e.employee_id} style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'0.75rem 1rem'}}>
                      <div style={{fontWeight:600}}>{e.name}</div>
                      <div style={{color:'var(--text-muted)',fontSize:'0.78rem',fontFamily:'monospace'}}>{e.employee_id}</div>
                    </td>
                    <td style={{padding:'0.75rem 1rem',color:'var(--text-muted)',fontSize:'0.85rem'}}>{e.designation||'—'}</td>
                    <td style={{padding:'0.75rem 1rem',color:'var(--text-muted)',fontSize:'0.85rem'}}>{e.emp_client||e.site||'—'}</td>
                    <td style={{padding:'0.75rem 1rem'}}>
                      <div style={{display:'flex',gap:'5px'}}>
                        {Object.entries(STATUS_CFG).map(([key,cfg])=>(
                          <button key={key} onClick={()=>set(e.employee_id,key)}
                            style={{width:'36px',height:'32px',borderRadius:'6px',border:`2px solid ${cur===key?cfg.color:'var(--border)'}`,
                              background:cur===key?cfg.bg:'transparent',color:cur===key?cfg.color:'var(--text-muted)',
                              cursor:'pointer',fontWeight:700,fontSize:'0.8rem',transition:'all 0.15s'}}>
                            {cfg.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td style={{padding:'0.75rem 1rem'}}>
                      <input value={remarks[e.employee_id]||''} onChange={ev=>setRem(e.employee_id,ev.target.value)}
                        placeholder="Optional remarks..." maxLength={120}
                        style={{background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'6px',
                          padding:'5px 9px',color:'var(--text)',fontSize:'0.82rem',width:'200px',outline:'none'}}/>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Helpers (shared by Monthly Report + Team Admin) ───────────────────────────
const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
const Sel = ({ label, value, onChange, options, placeholder='All' }) => (
  <div>
    <div style={{fontSize:'0.74rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>{label}</div>
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{width:'100%',background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'7px',padding:'8px 10px',color:'var(--text)',fontSize:'0.88rem',boxSizing:'border-box'}}>
      <option value="">{placeholder}</option>
      {options.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

// ── Monthly Report Hub (15-column export/import + rollups) ────────────────────
function MonthlyReport({user}) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth()+1);
  const [year, setYear]   = useState(now.getFullYear());
  const [fClient, setFClient] = useState('');
  const [fContract, setFContract] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [fEmpId, setFEmpId] = useState('');
  const [fName, setFName] = useState('');
  const [filterOpts, setFilterOpts] = useState({ clients: [], contracts: [], locations: [] });
  const [data, setData]   = useState(null);
  const [rollups, setRollups] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adjEmpId, setAdjEmpId] = useState('');
  const [adjPresent, setAdjPresent] = useState('');
  const [adjOt2, setAdjOt2] = useState('');
  const [adjLeaveDed, setAdjLeaveDed] = useState('');
  const [adjArrears, setAdjArrears] = useState('');
  const [adjOtherDed, setAdjOtherDed] = useState('');
  const [adjMsg, setAdjMsg] = useState('');
  const [rowEdits, setRowEdits] = useState({});
  const [rowSaving, setRowSaving] = useState(null);

  const queryParams = () => ({
    month, year,
    ...(fClient ? { client: fClient } : {}),
    ...(fContract ? { contract: fContract } : {}),
    ...(fLocation ? { location: fLocation } : {}),
    ...(fEmpId.trim() ? { employeeId: fEmpId.trim() } : {}),
    ...(fName.trim() ? { name: fName.trim() } : {}),
  });

  const load = useCallback(() => {
    setLoading(true);
    const q = queryParams();
    Promise.all([
      api.getMonthlyHubList(q),
      api.getMonthlyHubRollups({ month, year, ...(fClient ? { client: fClient } : {}) }).catch(() => null),
    ])
      .then(([d, r]) => {
        setData(d);
        if (d.filterOptions) setFilterOpts(d.filterOptions);
        setRollups(r);
        setRowEdits({});
      })
      .catch(e=>alert(e.message))
      .finally(()=>setLoading(false));
  }, [month, year, fClient, fContract, fLocation, fEmpId, fName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{ load(); }, [load]);

  const contractOpts = uniq(filterOpts.contracts.filter(c => !fClient || true));
  const locationOpts = uniq(filterOpts.locations);

  const resetBelow = (level) => {
    if (level <= 1) setFContract('');
    if (level <= 2) setFLocation('');
  };

  const pctColor = p => p==null?'var(--text-muted)' : p>=95?'#22c55e' : p>=80?'#f59e0b' : '#ef4444';

  const exportHub = async () => {
    setBusy(true);
    try {
      await api.exportMonthlyHub({ month, year, ...(fClient ? { client: fClient } : {}) });
    } catch (e) {
      alert(e.message || 'Export failed');
    }
    setBusy(false);
  };

  const importHub = async () => {
    if (!importText.trim()) return alert('Paste the 15-column CSV first.');
    setBusy(true);
    try {
      const r = await api.importMonthlyHub({ csvText: importText, month, year });
      setImportResult(r);
      load();
    } catch (e) {
      alert(e.message || 'Import failed');
    }
    setBusy(false);
  };

  const saveEmployeeOverride = async (employeeId, fields = {}) => {
    if (!employeeId) return alert('Employee ID required.');
    setBusy(true);
    setAdjMsg('');
    try {
      const payload = { employeeId, month, year };
      const putNum = (key, val) => {
        if (val !== '' && val != null) payload[key] = Number(val);
      };
      putNum('presentDays', fields.presentDays);
      putNum('ot2Hours', fields.ot2Hours);
      putNum('ot3Hours', fields.ot3Hours);
      putNum('leaveDeduction', fields.leaveDeduction);
      putNum('arrears', fields.arrears);
      putNum('otherDeduction', fields.otherDeduction);
      putNum('absentDays', fields.absentDays);
      const r = await api.saveMonthlyHubOverride(payload);
      setAdjMsg(
        `Saved ${r.employeeName || r.employeeId}: present ${r.presentDays ?? '—'}, OT@2X ${r.ot2 ?? 0}h, `
        + `leave ded ${r.leaveDeduction ?? 0}, arrears ${r.arrears ?? 0}, other ded ${r.otherDeduction ?? 0}. `
        + `Recompute the payroll run (Fixed Value → Payroll, or Payroll Run) for this to affect net pay.`
      );
      load();
    } catch (e) {
      alert(e.message || 'Save failed');
    }
    setBusy(false);
  };

  const saveQuickOverride = () => saveEmployeeOverride(adjEmpId.trim(), {
    presentDays: adjPresent,
    ot2Hours: adjOt2,
    leaveDeduction: adjLeaveDed,
    arrears: adjArrears,
    otherDeduction: adjOtherDed,
  });

  const clearMonthOverrides = async () => {
    const label = `${month}/${year}${fContract ? ` · ${fContract}` : fClient ? ` · ${fClient}` : ' (all contracts)'}`;
    if (!confirm(`Delete ALL monthly attendance overrides for ${label}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const payload = { month, year };
      if (fContract) payload.contract = fContract;
      else if (fClient) payload.client = fClient;
      const r = await api.clearMonthlyHubOverrides(payload);
      setAdjMsg(`Cleared ${r.deleted} override row(s) for ${month}/${year}`);
      load();
    } catch (e) {
      alert(e.message || 'Clear failed');
    }
    setBusy(false);
  };

  const getRowEdit = (r) => {
    const stored = rowEdits[r.employee_id];
    if (stored) return stored;
    return {
      present: r.present ?? '',
      ot2: r.ot2_hours ?? '',
      leaveDeduction: r.leave_deduction ?? '',
      arrears: r.arrears ?? '',
      otherDeduction: r.other_deduction ?? '',
    };
  };

  const setRowEdit = (r, field, val) => {
    setRowEdits(prev => ({
      ...prev,
      [r.employee_id]: { ...getRowEdit(r), [field]: val },
    }));
  };

  const saveRowOverride = async (r) => {
    const edit = getRowEdit(r);
    setRowSaving(r.employee_id);
    try {
      await saveEmployeeOverride(r.employee_id, {
        presentDays: edit.present,
        ot2Hours: edit.ot2,
        leaveDeduction: edit.leaveDeduction,
        arrears: edit.arrears,
        otherDeduction: edit.otherDeduction,
      });
    } finally {
      setRowSaving(null);
    }
  };

  const RollupCard = ({ title, rows }) => (
    <Card style={{ padding: '1rem' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>{title}</div>
      <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: '0.82rem' }}>
        {(rows || []).slice(0, 12).map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <span>{r.label || r.key}</span>
            <span style={{ color: 'var(--text-muted)' }}>{r.records} rec · {r.present || 0} present</span>
          </div>
        ))}
        {!rows?.length && <div style={{ color: 'var(--text-muted)' }}>No records</div>}
      </div>
    </Card>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
      <div style={{display:'flex',gap:'0.75rem',flexWrap:'wrap',alignItems:'flex-end'}}>
        {[['Month','month',Array.from({length:12},(_,i)=>({v:i+1,l:new Date(2000,i).toLocaleString('en',{month:'long'})}))],
          ['Year', 'year',[2024,2025,2026].map(y=>({v:y,l:y}))]].map(([lbl,key,opts])=>(
          <div key={key}>
            <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>{lbl}</div>
            <select value={key==='month'?month:year} onChange={e=>key==='month'?setMonth(+e.target.value):setYear(+e.target.value)}
              style={{background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'8px',padding:'7px 12px',color:'var(--text)',fontSize:'0.88rem'}}>
              {opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
        ))}
        <div>
          <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>Client</div>
          <select value={fClient} onChange={e=>{ setFClient(e.target.value); resetBelow(1); }}
            style={{background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'8px',padding:'7px 12px',color:'var(--text)',fontSize:'0.88rem',minWidth:'160px'}}>
            <option value="">All clients</option>
            {filterOpts.clients.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>Contract</div>
          <select value={fContract} onChange={e=>{ setFContract(e.target.value); resetBelow(2); }}
            style={{background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'8px',padding:'7px 12px',color:'var(--text)',fontSize:'0.88rem',minWidth:'160px'}}>
            <option value="">All contracts</option>
            {contractOpts.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>Location</div>
          <select value={fLocation} onChange={e=>setFLocation(e.target.value)}
            style={{background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'8px',padding:'7px 12px',color:'var(--text)',fontSize:'0.88rem',minWidth:'140px'}}>
            <option value="">All locations</option>
            {locationOpts.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>Employee ID</div>
          <input value={fEmpId} onChange={e=>setFEmpId(e.target.value)} placeholder="ASIL/SPL-419/21"
            style={{background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'8px',padding:'7px 12px',color:'var(--text)',fontSize:'0.88rem',width:'150px'}}/>
        </div>
        <div>
          <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>Name</div>
          <input value={fName} onChange={e=>setFName(e.target.value)} placeholder="Search name"
            style={{background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'8px',padding:'7px 12px',color:'var(--text)',fontSize:'0.88rem',width:'140px'}}/>
        </div>
        <div style={{flex:1}}/>
        <button type="button" disabled={busy} onClick={exportHub}
          style={{background:'rgba(34,197,94,0.12)',border:'1px solid #22c55e',color:'#22c55e',padding:'8px 16px',borderRadius:'8px',fontWeight:600,fontSize:'0.84rem',cursor:'pointer'}}>
          ⬇ Export CSV (15 cols)
        </button>
        <button type="button" disabled={busy} onClick={clearMonthOverrides}
          style={{background:'rgba(239,68,68,0.1)',border:'1px solid #ef4444',color:'#ef4444',padding:'8px 16px',borderRadius:'8px',fontWeight:600,fontSize:'0.84rem',cursor:'pointer'}}>
          Clear month overrides
        </button>
      </div>

      <Card>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Import CSV (15 master columns)</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
          Match on ASIL Employee Code only. Blank cells never wipe existing values.
        </p>
        <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={5}
          placeholder="CNIC,Staff Code,Month,Year,ASIL Employee Code,Contract Name,Present Days,OT Hrs @ 2X,OT Hrs @ 3X,OPD,Expense Reimbursement,Arrears,Special Allowance,Other Allowance Fuel | Mobile,Other Deduction"
          style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, color: 'var(--text)', fontFamily: 'monospace', fontSize: '0.8rem' }} />
        <button type="button" disabled={busy} onClick={importHub} className="btn-primary" style={{ marginTop: '0.75rem' }}>
          Import CSV Overrides
        </button>
        {importResult && <pre style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>{JSON.stringify(importResult, null, 2)}</pre>}
      </Card>

      <Card>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Single employee adjustment</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
          Canonical store: <code>monthly_attendance_overrides</code> (same source Fixed Value payroll reads).
          Set Present, OT hrs @ 2X, Deduction against Leaves, Arrears, and Other Deduction.
          <strong> You must recompute the payroll run after saving</strong> or net pay will stay stale.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>ASIL Employee Code</div>
            <input value={adjEmpId} onChange={e => setAdjEmpId(e.target.value)} placeholder="ASIL/PSO-060/25"
              style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', color: 'var(--text)', width: 200 }} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Present Days</div>
            <input type="number" min="0" max="31" value={adjPresent} onChange={e => setAdjPresent(e.target.value)} placeholder="e.g. 27"
              style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', color: 'var(--text)', width: 90 }} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>OT Hrs @ 2X</div>
            <input type="number" min="0" step="0.5" value={adjOt2} onChange={e => setAdjOt2(e.target.value)} placeholder="0"
              style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', color: 'var(--text)', width: 90 }} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Deduction vs Leaves (Rs.)</div>
            <input type="number" min="0" value={adjLeaveDed} onChange={e => setAdjLeaveDed(e.target.value)} placeholder="0"
              style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', color: 'var(--text)', width: 120 }} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Arrears (Rs.)</div>
            <input type="number" min="0" value={adjArrears} onChange={e => setAdjArrears(e.target.value)} placeholder="0"
              style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', color: 'var(--text)', width: 100 }} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Other Deduction (Rs.)</div>
            <input type="number" min="0" value={adjOtherDed} onChange={e => setAdjOtherDed(e.target.value)} placeholder="0"
              style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', color: 'var(--text)', width: 120 }} />
          </div>
          <button type="button" disabled={busy} onClick={saveQuickOverride} className="btn-primary">Save override</button>
        </div>
        {adjMsg && <div style={{ marginTop: '0.75rem', fontSize: '0.84rem', color: '#22c55e' }}>{adjMsg}</div>}
      </Card>

      {loading && <div style={{padding:'3rem',textAlign:'center',color:'var(--text-muted)'}}>Loading report...</div>}

      {data && !loading && (<>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'0.75rem'}}>
          <Kpi label="Total Employees" value={data.employees?.length||0} color="var(--primary)"/>
          <Kpi label="Working Days" value={data.working_days} color="var(--primary)"/>
          <Kpi label="Avg Attendance" value={(() => {
            const rows = data.employees||[];
            if (!rows.length) return '—';
            const avg = rows.reduce((a,r)=>a+(r.attendance_pct||0),0)/rows.length;
            return Math.round(avg)+'%';
          })()} color="#22c55e"/>
          <Kpi label="Total Deductions" value={'Rs. '+fmt(data.employees?.reduce((a,r)=>a+(r.other_deduction||0)+(r.leave_deduction||0),0)||0)} color="#ef4444"/>
        </div>

        {rollups && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <RollupCard title="By Location" rows={rollups.byLocation} />
            <RollupCard title="By Employee" rows={rollups.byEmployee} />
            <RollupCard title="By Contract" rows={rollups.byContract} />
            <RollupCard title="By Business Unit" rows={rollups.byBu} />
          </div>
        )}

        <Card style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'0.75rem 1rem',borderBottom:'1px solid var(--border)',fontSize:'0.8rem',color:'var(--text-muted)'}}>
            {data.employees?.length || 0} employee{(data.employees?.length||0)!==1?'s':''} shown
            {fClient||fContract||fLocation||fEmpId||fName ? ' (filtered)' : ''}
            · Edit Present / OT / Leave Ded. / Arrears / Other Ded. inline, then Save — then recompute payroll
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.84rem'}}>
              <thead>
                <tr style={{background:'var(--bg-dark)',borderBottom:'1px solid var(--border)'}}>
                  {['Employee','Client/Contract/Site','Days','Present','Absent','Leave','Att%','OT@2X','Leave Ded.','Arrears','Other Ded.',''].map(h=>(
                    <th key={h||'act'} style={{padding:'0.75rem 0.6rem',textAlign:'left',color:'var(--text-muted)',fontWeight:600,fontSize:'0.72rem',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.employees||[]).map(r=>{
                  const edit = getRowEdit(r);
                  const numDirty = (a, b) => a !== '' && Number(a) !== Number(b || 0);
                  const dirty = numDirty(edit.present, r.present)
                    || numDirty(edit.ot2, r.ot2_hours)
                    || numDirty(edit.leaveDeduction, r.leave_deduction)
                    || numDirty(edit.arrears, r.arrears)
                    || numDirty(edit.otherDeduction, r.other_deduction);
                  const cellInp = (field, width, color) => (
                    <input type="number" min="0" step={field==='ot2'?'0.5':'1'} value={edit[field]}
                      onChange={e=>setRowEdit(r,field,e.target.value)}
                      placeholder="0"
                      style={{width,background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:6,padding:'4px 6px',color:color||'var(--text)',fontWeight:700,textAlign:'right'}}/>
                  );
                  return (
                  <tr key={r.employee_id} style={{borderBottom:'1px solid var(--border)',background:r.has_override?'rgba(56,189,248,0.04)':'transparent'}}>
                    <td style={{padding:'0.75rem 0.6rem'}}>
                      <div style={{fontWeight:600}}>{r.name}</div>
                      <div style={{color:'var(--text-muted)',fontSize:'0.76rem',fontFamily:'monospace'}}>{r.employee_id}</div>
                    </td>
                    <td style={{padding:'0.75rem 0.6rem',color:'var(--text-muted)',fontSize:'0.82rem'}}>
                      <div>{r.client||'—'}</div>
                      <div style={{fontSize:'0.76rem'}}>{r.contract||''}</div>
                      <div style={{fontSize:'0.76rem'}}>{r.site||''}</div>
                    </td>
                    <td style={{padding:'0.75rem 0.6rem',textAlign:'center'}}>{r.working_days}</td>
                    <td style={{padding:'0.5rem 0.4rem',textAlign:'center'}}>
                      <input type="number" min="0" max="31" value={edit.present}
                        onChange={e=>setRowEdit(r,'present',e.target.value)}
                        style={{width:52,textAlign:'center',background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:6,padding:'4px 6px',color:'#22c55e',fontWeight:700}}/>
                    </td>
                    <td style={{padding:'0.75rem 0.6rem',textAlign:'center',color:'#ef4444',fontWeight:700}}>{r.absent||0}</td>
                    <td style={{padding:'0.75rem 0.6rem',textAlign:'center',color:'#38bdf8',fontWeight:700}}>{r.on_leave||0}</td>
                    <td style={{padding:'0.75rem 0.6rem',textAlign:'center'}}>
                      <span style={{fontWeight:700,color:pctColor(r.attendance_pct)}}>
                        {r.attendance_pct!=null?r.attendance_pct+'%':'—'}
                      </span>
                    </td>
                    <td style={{padding:'0.5rem 0.4rem'}}>{cellInp('ot2', 56, '#a78bfa')}</td>
                    <td style={{padding:'0.5rem 0.4rem'}}>{cellInp('leaveDeduction', 72, r.leave_deduction>0?'#f97316':undefined)}</td>
                    <td style={{padding:'0.5rem 0.4rem'}}>{cellInp('arrears', 72, r.arrears>0?'#22c55e':undefined)}</td>
                    <td style={{padding:'0.5rem 0.4rem'}}>{cellInp('otherDeduction', 72, r.other_deduction>0?'#ef4444':undefined)}</td>
                    <td style={{padding:'0.5rem 0.4rem'}}>
                      <button type="button" disabled={busy||rowSaving===r.employee_id}
                        onClick={()=>saveRowOverride(r)}
                        style={{background:dirty?'var(--primary)':'var(--bg-dark)',border:`1px solid ${dirty?'var(--primary)':'var(--border)'}`,color:dirty?'#fff':'var(--text-muted)',padding:'4px 10px',borderRadius:6,cursor:'pointer',fontSize:'0.78rem',fontWeight:600,whiteSpace:'nowrap'}}>
                        {rowSaving===r.employee_id?'…':'Save'}
                      </button>
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        </Card>
      </>)}
    </div>
  );
}


// ── Team Admin (HR/Admin) ─────────────────────────────────────────────────────
function TeamAdmin({user}) {
  const [teams,setTeams]=useState([]);
  const [emps,setEmps]=useState([]);
  const [sysUsers,setSysUsers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [loadErr,setLoadErr]=useState('');
  const [fClient,setFClient]=useState('');
  const [fContract,setFContract]=useState('');
  const [fLocation,setFLocation]=useState('');
  const [fBU,setFBU]=useState('');
  const [supEmail,setSupEmail]=useState('');
  const [focalEmails,setFocalEmails]=useState('');
  const [selectedIds,setSelectedIds]=useState([]);

  useEffect(()=>{
    // allSettled: a teams-fetch failure never silently kills the employee list
    // apiFetch directly bypasses the 2-min api.js cache that may serve stale/empty data
    Promise.allSettled([
      api.getAttendanceTeams(),
      apiFetch('/api/employees'),
      apiFetch('/api/users'),
    ])
      .then(([teamsRes, empsRes, usersRes])=>{
        if(teamsRes.status==='fulfilled') setTeams(teamsRes.value.teams||[]);
        if(empsRes.status==='fulfilled')  setEmps(empsRes.value.employees||[]);
        if(usersRes.status==='fulfilled') setSysUsers((usersRes.value.users||[]).filter(u=>u.role==='supervisor'));
        const errs=[];
        if(teamsRes.status==='rejected') errs.push('Teams: '+teamsRes.reason?.message);
        if(empsRes.status==='rejected')  errs.push('Employees: '+empsRes.reason?.message);
        if(errs.length) setLoadErr(errs.join(' | '));
      })
      .finally(()=>setLoading(false));
  },[]);

  const active=emps.filter(e=>e.active==='Yes');
  const clientOpts=uniq(active.map(e=>e.client));
  const contractOpts=uniq(active.filter(e=>!fClient||e.client===fClient).map(e=>e.contractName));
  const locationOpts=uniq(active.filter(e=>(!fClient||e.client===fClient)&&(!fContract||e.contractName===fContract)).map(e=>e.location));
  const buOpts=uniq(active.filter(e=>(!fClient||e.client===fClient)&&(!fContract||e.contractName===fContract)&&(!fLocation||e.location===fLocation)).map(e=>e.bu||e.dept));

  const resetBelow=(level)=>{if(level<=1)setFContract('');if(level<=2)setFLocation('');if(level<=3)setFBU('');setSupEmail('');setFocalEmails('');setSelectedIds([]);};
  const setClient=v=>{setFClient(v);resetBelow(1);};
  const setContract=v=>{setFContract(v);resetBelow(2);};
  const setLocation=v=>{setFLocation(v);resetBelow(3);};
  const setBU=v=>{setFBU(v);setSupEmail('');setFocalEmails('');setSelectedIds([]);};

  const filtered=active.filter(e=>
    (!fClient||e.client===fClient)&&
    (!fContract||e.contractName===fContract)&&
    (!fLocation||e.location===fLocation)&&
    (!fBU||(e.bu||e.dept)===fBU)
  );

  const assign=async()=>{
    if(!supEmail.trim())return alert('Enter the supervisor\'s Google login email.');
    if(!/\S+@\S+\.\S+/.test(supEmail.trim()))return alert('Please enter a valid email address.');
    if(!selectedIds.length)return alert('Select at least one team member.');
    setSaving(true);
    try{
      await api.assignTeam({
        supervisor_email:supEmail.trim().toLowerCase(),
        employee_ids:selectedIds,
        site:fLocation||fClient,
        client:fClient,
        contract_id:filtered[0]?.contractId||null,
        focal_emails: focalEmails.split(',').map(s=>s.trim()).filter(Boolean),
      });
      const t=await api.getAttendanceTeams();
      setTeams(t.teams||[]);setSupEmail('');setFocalEmails('');setSelectedIds([]);
    }catch(e){alert(e.message);}
    setSaving(false);
  };

  const remove=async(id)=>{
    if(!confirm('Remove this team member?'))return;
    await api.removeTeamMember(id);
    const t=await api.getAttendanceTeams();setTeams(t.teams||[]);
  };

  if(loading)return <div style={{padding:'3rem',textAlign:'center',color:'var(--text-muted)'}}>Loading...</div>;

  const sBox={background:'rgba(56,189,248,0.04)',border:'1px solid rgba(56,189,248,0.12)',borderRadius:'8px',padding:'0.85rem',display:'flex',flexDirection:'column',gap:'0.7rem'};
  const sLabel={fontSize:'0.72rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'};

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
      {loadErr&&<div style={{background:'rgba(239,68,68,0.12)',border:'1px solid #ef4444',borderRadius:'8px',padding:'0.75rem 1rem',color:'#ef4444',fontSize:'0.83rem'}}>⚠ Load error: {loadErr}</div>}
      {!loadErr&&emps.length===0&&<div style={{background:'rgba(245,158,11,0.1)',border:'1px solid #f59e0b',borderRadius:'8px',padding:'0.75rem 1rem',color:'#f59e0b',fontSize:'0.83rem'}}>⚠ No employees loaded — the employee database may be empty or unreachable.</div>}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1.4fr',gap:'1.25rem',alignItems:'start'}}>
      <Card>
        <h3 style={{margin:'0 0 1rem',fontSize:'0.8rem',textTransform:'uppercase',letterSpacing:'0.07em',color:'var(--text-muted)'}}>Assign Team to Supervisor</h3>
        <div style={{display:'flex',flexDirection:'column',gap:'0.85rem'}}>

          {/* Step 1 — Filters */}
          <div style={sBox}>
            <div style={{...sLabel,color:'#38bdf8'}}>Step 1 — Filter Employees</div>
            <Sel label="Client" value={fClient} onChange={setClient} options={clientOpts} placeholder="All Clients"/>
            <Sel label="Contract" value={fContract} onChange={setContract} options={contractOpts} placeholder="All Contracts"/>
            <Sel label="Location / Site" value={fLocation} onChange={setLocation} options={locationOpts} placeholder="All Locations"/>
            <Sel label="Business Unit" value={fBU} onChange={setBU} options={buOpts} placeholder="All BUs"/>
            <div style={{fontSize:'0.78rem',color:'var(--text-muted)',textAlign:'right'}}>{filtered.length} employee{filtered.length!==1?'s':''} match</div>
          </div>

          {/* Step 2 — Supervisor email */}
          <div style={{...sBox,background:'rgba(167,139,250,0.04)',border:'1px solid rgba(167,139,250,0.2)'}}>
            <div style={{...sLabel,color:'#a78bfa'}}>Step 2 — Supervisor Google Login Email</div>
            <input
              type="email"
              value={supEmail}
              onChange={e=>setSupEmail(e.target.value)}
              placeholder="e.g. supervisor@gmail.com"
              style={{width:'100%',background:'var(--bg-dark)',border:`1px solid ${supEmail?'#a78bfa':'var(--border)'}`,borderRadius:'7px',padding:'8px 10px',color:'var(--text)',fontSize:'0.88rem',boxSizing:'border-box',outline:'none'}}
            />
            <div style={{fontSize:'0.74rem',color:'var(--text-muted)'}}>This must match the Google account the supervisor will use to sign in.</div>
            {sysUsers.length>0&&(
              <div>
                <div style={{fontSize:'0.72rem',color:'var(--text-muted)',marginBottom:'5px',fontWeight:600}}>REGISTERED SUPERVISORS — click to select:</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                  {sysUsers.map(u=>(
                    <button key={u.email} onClick={()=>setSupEmail(u.email)}
                      style={{background:supEmail===u.email?'rgba(167,139,250,0.2)':'var(--bg-dark)',border:`1px solid ${supEmail===u.email?'#a78bfa':'var(--border)'}`,borderRadius:'6px',padding:'3px 9px',color:supEmail===u.email?'#a78bfa':'var(--text-muted)',cursor:'pointer',fontSize:'0.78rem'}}>
                      {u.name||u.email}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {supEmail&&<div style={{fontSize:'0.78rem',color:'#a78bfa',background:'rgba(167,139,250,0.1)',borderRadius:'6px',padding:'5px 8px'}}>👤 Supervisor: {supEmail}</div>}
            <div>
              <div style={{fontSize:'0.72rem',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'#f59e0b',marginBottom:'6px'}}>Client Focal Email(s) (Comma-Separated)</div>
              <input
                type="text"
                value={focalEmails}
                onChange={e=>setFocalEmails(e.target.value)}
                placeholder="e.g. focal1@client.com, focal2@client.com"
                style={{width:'100%',background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'7px',padding:'8px 10px',color:'var(--text)',fontSize:'0.88rem',boxSizing:'border-box',outline:'none'}}
              />
              <div style={{fontSize:'0.74rem',color:'var(--text-muted)',marginTop:'4px'}}>Bound to this Project/Site/Department for passwordless leave Approve / Reject / Remarks links.</div>
            </div>
          </div>

          {/* Step 3 — Team members */}
          <div style={{...sBox,background:'rgba(34,197,94,0.04)',border:'1px solid rgba(34,197,94,0.15)'}}>
            <div style={{...sLabel,color:'#22c55e'}}>Step 3 — Select Team Members ({selectedIds.length} selected)</div>
            {!filtered.length
              ?<div style={{fontSize:'0.82rem',color:'var(--text-muted)',textAlign:'center',padding:'0.75rem 0'}}>Apply filters above to see employees</div>
              :<>
                <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'0.8rem',color:'var(--text-muted)',borderBottom:'1px solid var(--border)',paddingBottom:'5px'}}>
                  <input type="checkbox" style={{accentColor:'#22c55e'}}
                    checked={filtered.length>0&&filtered.every(e=>selectedIds.includes(e.id))}
                    onChange={ev=>setSelectedIds(ev.target.checked?filtered.map(e=>e.id):[])}/>
                  Select all ({filtered.length})
                </label>
                <div style={{maxHeight:'200px',overflowY:'auto'}}>
                  {filtered.map(e=>(
                    <label key={e.id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'6px 4px',cursor:'pointer',borderBottom:'1px solid rgba(255,255,255,0.03)',background:selectedIds.includes(e.id)?'rgba(34,197,94,0.07)':'transparent',borderRadius:'4px'}}>
                      <input type="checkbox" checked={selectedIds.includes(e.id)} style={{accentColor:'#22c55e'}}
                        onChange={ev=>setSelectedIds(p=>ev.target.checked?[...p,e.id]:p.filter(x=>x!==e.id))}/>
                      <div>
                        <div style={{fontSize:'0.83rem',fontWeight:500}}>{e.name}</div>
                        <div style={{fontSize:'0.73rem',color:'var(--text-muted)'}}>{e.designation} · {e.location}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            }
          </div>

          <button onClick={assign} disabled={saving||!supEmail.trim()||!selectedIds.length}
            style={{background:(!supEmail.trim()||!selectedIds.length)?'#1e293b':'var(--primary)',border:'none',color:(!supEmail.trim()||!selectedIds.length)?'var(--text-muted)':'white',padding:'10px',borderRadius:'8px',cursor:(!supEmail.trim()||!selectedIds.length)?'not-allowed':'pointer',fontWeight:700}}>
            {saving?'Saving…':supEmail&&selectedIds.length?`✓ Assign ${selectedIds.length} member${selectedIds.length!==1?'s':''} to ${supEmail.split('@')[0]}`:'Assign Team'}
          </button>
        </div>
      </Card>

      <Card style={{padding:0,overflow:'hidden'}}>
        <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)'}}>
          <h3 style={{margin:0,fontSize:'0.8rem',textTransform:'uppercase',letterSpacing:'0.07em',color:'var(--text-muted)'}}>Current Team Assignments ({teams.length} supervisors)</h3>
        </div>
        <div style={{maxHeight:'600px',overflowY:'auto'}}>
          {!teams.length&&<div style={{padding:'2rem',textAlign:'center',color:'var(--text-muted)',fontSize:'0.85rem'}}>No teams assigned yet.</div>}
          {teams.map(t=>(
            <div key={t.supervisor_email} style={{borderBottom:'1px solid var(--border)',padding:'0.85rem 1.25rem'}}>
              <div style={{fontWeight:700,fontSize:'0.88rem',marginBottom:'2px',color:'#a78bfa'}}>👤 {t.supervisor_email}</div>
              <div style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'0.5rem'}}>{t.client||''}{t.site?' · '+t.site:''}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                {(t.team||[]).map(m=>(
                  <span key={m.id} style={{display:'inline-flex',alignItems:'center',gap:'5px',background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'6px',padding:'3px 8px',fontSize:'0.78rem'}}>
                    {m.name}
                    <button onClick={()=>remove(m.id)} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:'0.85rem',lineHeight:1,padding:0}}>×</button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
    </div>
  );
}

// ── Leave Desk (Step 1 internal approval) ────────────────────────────────────
function LeaveDesk() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.getLeaveRequests('pending').then(d => setRequests(d.requests || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const decide = async (id, decision) => {
    try {
      await api.leaveInternalDecision(id, decision);
      load();
    } catch (e) { alert(e.message); }
  };

  if (loading) return <div style={{padding:'2rem',textAlign:'center',color:'var(--text-muted)'}}>Loading leave requests...</div>;

  return (
    <Card>
      <h3 style={{margin:'0 0 1rem'}}>Pending Leave Requests (Step 1 — Allied Focal)</h3>
      {!requests.length ? <p style={{color:'var(--text-muted)'}}>No pending requests.</p> : (
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.85rem'}}>
          <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
            {['Employee','Type','Dates','Days','Reason','Actions'].map(h=><th key={h} style={{padding:'8px',textAlign:'left',color:'var(--text-muted)'}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {requests.map(r => (
              <tr key={r.id} style={{borderBottom:'1px solid var(--border)'}}>
                <td style={{padding:'8px'}}><strong>{r.employee_name}</strong><br/><span style={{fontSize:'0.75rem',color:'var(--text-muted)'}}>{r.employee_id}</span></td>
                <td style={{padding:'8px'}}>{r.leave_type}</td>
                <td style={{padding:'8px'}}>{r.from_date} → {r.to_date}</td>
                <td style={{padding:'8px'}}>{r.days}</td>
                <td style={{padding:'8px',maxWidth:'200px'}}>{r.reason || '—'}</td>
                <td style={{padding:'8px'}}>
                  <button onClick={()=>decide(r.id,'approve')} style={{marginRight:'6px',padding:'4px 12px',background:'#22c55e',border:'none',borderRadius:'6px',color:'#fff',cursor:'pointer',fontWeight:600}}>Approve</button>
                  <button onClick={()=>decide(r.id,'reject')} style={{padding:'4px 12px',background:'#ef4444',border:'none',borderRadius:'6px',color:'#fff',cursor:'pointer',fontWeight:600}}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default function AttendanceManagement({ user }) {
  const hasAttPerm = (perm, roleFallback = []) => {
    if (user?.role === 'superadmin') return true;
    const hasCustom = user?.permissions && typeof user.permissions === 'object' && Object.keys(user.permissions).length > 0;
    if (hasCustom) {
      const att = user.permissions.attendance;
      return !!(att?.access && att?.subPerms?.includes(perm));
    }
    return roleFallback.includes(user?.role);
  };

  const isSupervisor = user?.role === 'supervisor';
  const isAdmin = ['superadmin','admin','hr_manager','finance_manager','finance_approver'].includes(user?.role);
  const isLeaveDesk = hasAttPerm('approve_leave', ['operations','hr_manager','admin','finance_manager','finance_approver']);
  const canTeamSetup = hasAttPerm('team_setup', ['admin','hr_manager','finance_manager','finance_approver','operations']);
  const canMark = isSupervisor || isAdmin || hasAttPerm('mark_attendance', ['operations']);

  const canIntake = isAdmin || hasAttPerm('mark_attendance', ['operations']);

  const canMonthly = isAdmin || user?.role === 'payroll_initiator' || hasAttPerm('mark_attendance', ['operations']);

  const TABS = [
    ...(canMark ? [{ key:'mark', label:'📋 Daily Marking' }] : []),
    ...(canIntake ? [{ key:'intake', label:'📥 CSV Intake & Alerts' }] : []),
    ...(isLeaveDesk ? [{ key:'leave', label:'🏖 Leave Desk' }] : []),
    ...(canMonthly ? [{ key:'monthly', label:'📊 Monthly Report' }] : []),
    ...(canTeamSetup ? [{ key:'teams', label:'👥 Team Setup' }] : []),
  ];

  const [tab, setTab] = useState(TABS[0]?.key || 'mark');

  // Keep visible tab in sync when role-based tabs differ (prevents blank content area)
  useEffect(() => {
    if (TABS.length && !TABS.some(t => t.key === tab)) {
      setTab(TABS[0].key);
    }
  }, [user?.role, user?.permissions, TABS.map(t => t.key).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!TABS.length) return (
    <div style={{padding:'4rem',textAlign:'center',color:'var(--text-muted)'}}>
      <div style={{fontSize:'2rem',marginBottom:'1rem'}}>🔒</div>
      You do not have access to the Attendance module.
    </div>
  );

  return (
    <div className="dashboard">
      <header className="header">
        <h1>Attendance Management</h1>
        <p>Daily attendance tracking, weekly &amp; monthly reports, salary deduction flags.</p>
      </header>

      {/* Tab bar */}
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginBottom:'1.5rem'}}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)}
            style={{display:'flex',alignItems:'center',gap:'6px',padding:'0.8rem 1.25rem',background:'transparent',border:'none',
              borderBottom:`2px solid ${tab===t.key?'var(--primary)':'transparent'}`,
              color:tab===t.key?'var(--primary)':'var(--text-muted)',
              cursor:'pointer',fontWeight:tab===t.key?700:400,fontSize:'0.875rem',whiteSpace:'nowrap'}}>
            {t.label}
          </button>
        ))}
      </div>

      {tab==='mark'    && <DailyMarking user={user}/>}
      {tab==='intake'  && <AttendanceIntake />}
      {tab==='leave'   && <LeaveDesk/>}
      {tab==='monthly' && <MonthlyReport user={user}/>}
      {tab==='teams'   && <TeamAdmin user={user}/>}
    </div>
  );
}

