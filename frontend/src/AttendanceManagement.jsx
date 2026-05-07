import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
const fmt = n => (parseFloat(n)||0).toLocaleString('en-PK');
const today = () => new Date().toISOString().slice(0,10);
const yesterday = () => new Date(Date.now()-86400000).toISOString().slice(0,10);

const STATUS_CFG = {
  present:  { label: 'P',        color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   full: 'Present'  },
  absent:   { label: 'A',        color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   full: 'Absent'   },
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
  const absent  = counts.filter(s=>s==='absent').length;
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

// ── Monthly Report (HR/Finance) ───────────────────────────────────────────────
function MonthlyReport({user}) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth()+1);
  const [year, setYear]   = useState(now.getFullYear());
  const [client, setClient] = useState('');
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.getMonthlyReport({month, year, ...(client?{client}:{})})
      .then(d=>setData(d)).catch(e=>alert(e.message)).finally(()=>setLoading(false));
  }, [month, year, client]);

  useEffect(()=>{ load(); }, [load]);

  const pctColor = p => p==null?'var(--text-muted)' : p>=95?'#22c55e' : p>=80?'#f59e0b' : '#ef4444';

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
      {/* Controls */}
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
          <div style={{fontSize:'0.75rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>Client Filter</div>
          <input value={client} onChange={e=>setClient(e.target.value)} placeholder="All clients"
            style={{background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'8px',padding:'7px 12px',color:'var(--text)',fontSize:'0.88rem',width:'180px'}}/>
        </div>
        <div style={{flex:1}}/>
        {data && (
          <a href={api.exportAttendance({month,year,...(client?{client}:{})})}
            target="_blank" rel="noreferrer"
            style={{background:'rgba(34,197,94,0.12)',border:'1px solid #22c55e',color:'#22c55e',padding:'8px 16px',borderRadius:'8px',textDecoration:'none',fontWeight:600,fontSize:'0.84rem'}}>
            ⬇ Export CSV
          </a>
        )}
      </div>

      {loading && <div style={{padding:'3rem',textAlign:'center',color:'var(--text-muted)'}}>Loading report...</div>}

      {data && !loading && (<>
        {/* Summary KPIs */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'0.75rem'}}>
          <Kpi label="Total Employees" value={data.employees?.length||0} color="var(--primary)"/>
          <Kpi label="Working Days" value={data.working_days} color="var(--primary)"/>
          <Kpi label="Avg Attendance" value={(() => {
            const rows = data.employees||[];
            if (!rows.length) return '—';
            const avg = rows.reduce((a,r)=>a+(r.attendance_pct||0),0)/rows.length;
            return Math.round(avg)+'%';
          })()} color="#22c55e"/>
          <Kpi label="Total Deductions" value={'Rs. '+fmt(data.employees?.reduce((a,r)=>a+(r.salary_deduction||0),0)||0)} color="#ef4444"/>
        </div>

        {/* Table */}
        <Card style={{padding:0,overflow:'hidden'}}>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.84rem'}}>
              <thead>
                <tr style={{background:'var(--bg-dark)',borderBottom:'1px solid var(--border)'}}>
                  {['Employee','Client/Site','Days','Present','Absent','Half','Leave','Att%','Deduction'].map(h=>(
                    <th key={h} style={{padding:'0.75rem 1rem',textAlign:'left',color:'var(--text-muted)',fontWeight:600,fontSize:'0.72rem',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.employees||[]).map(r=>(
                  <tr key={r.employee_id} style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={{padding:'0.75rem 1rem'}}>
                      <div style={{fontWeight:600}}>{r.name}</div>
                      <div style={{color:'var(--text-muted)',fontSize:'0.76rem',fontFamily:'monospace'}}>{r.employee_id}</div>
                    </td>
                    <td style={{padding:'0.75rem 1rem',color:'var(--text-muted)',fontSize:'0.82rem'}}>
                      <div>{r.client||'—'}</div>
                      <div style={{fontSize:'0.76rem'}}>{r.site||''}</div>
                    </td>
                    <td style={{padding:'0.75rem 1rem',textAlign:'center'}}>{r.working_days}</td>
                    <td style={{padding:'0.75rem 1rem',textAlign:'center',color:'#22c55e',fontWeight:700}}>{r.present||0}</td>
                    <td style={{padding:'0.75rem 1rem',textAlign:'center',color:'#ef4444',fontWeight:700}}>{r.absent||0}</td>
                    <td style={{padding:'0.75rem 1rem',textAlign:'center',color:'#f59e0b'}}>{r.half_day||0}</td>
                    <td style={{padding:'0.75rem 1rem',textAlign:'center',color:'#38bdf8'}}>{r.on_leave||0}</td>
                    <td style={{padding:'0.75rem 1rem',textAlign:'center'}}>
                      <span style={{fontWeight:700,color:pctColor(r.attendance_pct)}}>
                        {r.attendance_pct!=null?r.attendance_pct+'%':'—'}
                      </span>
                    </td>
                    <td style={{padding:'0.75rem 1rem',color:r.salary_deduction>0?'#ef4444':'var(--text-muted)',fontWeight:r.salary_deduction>0?700:400}}>
                      {r.salary_deduction>0?'Rs. '+fmt(r.salary_deduction):'—'}
                    </td>
                  </tr>
                ))}
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
  const [teams, setTeams] = useState([]);
  const [emps, setEmps]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [supervisorEmail, setSupervisorEmail] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [site, setSite] = useState('');
  const [client, setClientName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.getAttendanceTeams(), api.getEmployees()])
      .then(([t,e])=>{ setTeams(t.teams||[]); setEmps(e.employees||[]); })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  }, []);

  const assign = async () => {
    if (!supervisorEmail || !selectedIds.length) return alert('Fill supervisor email and select employees');
    setSaving(true);
    try {
      await api.assignTeam({ supervisor_email:supervisorEmail, employee_ids:selectedIds, site, client });
      const t = await api.getAttendanceTeams();
      setTeams(t.teams||[]);
      setSupervisorEmail(''); setSelectedIds([]); setSite(''); setClientName('');
    } catch(e){alert(e.message);}
    setSaving(false);
  };

  const remove = async (id) => {
    if (!confirm('Remove this team member?')) return;
    await api.removeTeamMember(id);
    const t = await api.getAttendanceTeams();
    setTeams(t.teams||[]);
  };

  if (loading) return <div style={{padding:'3rem',textAlign:'center',color:'var(--text-muted)'}}>Loading...</div>;

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1.4fr',gap:'1.25rem',alignItems:'start'}}>
      {/* Assignment form */}
      <Card>
        <h3 style={{margin:'0 0 1.25rem',fontSize:'0.8rem',textTransform:'uppercase',letterSpacing:'0.07em',color:'var(--text-muted)'}}>Assign Team to Supervisor</h3>
        <div style={{display:'flex',flexDirection:'column',gap:'0.85rem'}}>
          {[['Supervisor Email','supervisorEmail',supervisorEmail,setSupervisorEmail,'e.g. supervisor@asil.com'],
            ['Site / Location','site',site,setSite,'e.g. Islamabad Site'],
            ['Client','client',client,setClientName,'e.g. Wafi Energy']].map(([lbl,key,val,setter,ph])=>(
            <div key={key}>
              <div style={{fontSize:'0.74rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>{lbl}</div>
              <input value={val} onChange={e=>setter(e.target.value)} placeholder={ph}
                style={{width:'100%',background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'7px',padding:'8px 10px',color:'var(--text)',fontSize:'0.88rem',boxSizing:'border-box'}}/>
            </div>
          ))}
          <div>
            <div style={{fontSize:'0.74rem',color:'var(--text-muted)',fontWeight:600,textTransform:'uppercase',marginBottom:'4px'}}>Select Employees ({selectedIds.length} selected)</div>
            <div style={{maxHeight:'200px',overflowY:'auto',border:'1px solid var(--border)',borderRadius:'7px',background:'var(--bg-dark)'}}>
              {emps.filter(e=>e.active==='Yes').map(e=>(
                <label key={e.id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'7px 10px',cursor:'pointer',
                  background:selectedIds.includes(e.id)?'rgba(56,189,248,0.08)':'transparent',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                  <input type="checkbox" checked={selectedIds.includes(e.id)}
                    onChange={ev=>setSelectedIds(p=>ev.target.checked?[...p,e.id]:p.filter(x=>x!==e.id))}
                    style={{accentColor:'#38bdf8'}}/>
                  <div>
                    <div style={{fontSize:'0.83rem',fontWeight:500}}>{e.name}</div>
                    <div style={{fontSize:'0.73rem',color:'var(--text-muted)'}}>{e.designation} · {e.location}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <button onClick={assign} disabled={saving}
            style={{background:'var(--primary)',border:'none',color:'white',padding:'10px',borderRadius:'8px',cursor:'pointer',fontWeight:700}}>
            {saving?'Saving…':'Assign Team'}
          </button>
        </div>
      </Card>

      {/* Current teams */}
      <Card style={{padding:0,overflow:'hidden'}}>
        <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)'}}>
          <h3 style={{margin:0,fontSize:'0.8rem',textTransform:'uppercase',letterSpacing:'0.07em',color:'var(--text-muted)'}}>Current Team Assignments ({teams.length} supervisors)</h3>
        </div>
        <div style={{maxHeight:'500px',overflowY:'auto'}}>
          {teams.length===0 && <div style={{padding:'2rem',textAlign:'center',color:'var(--text-muted)',fontSize:'0.85rem'}}>No teams assigned yet.</div>}
          {teams.map(t=>(
            <div key={t.supervisor_email} style={{borderBottom:'1px solid var(--border)',padding:'0.85rem 1.25rem'}}>
              <div style={{fontWeight:700,fontSize:'0.88rem',marginBottom:'3px',color:'var(--primary)'}}>{t.supervisor_email}</div>
              <div style={{fontSize:'0.75rem',color:'var(--text-muted)',marginBottom:'0.5rem'}}>{t.client||''} {t.site?'· '+t.site:''}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                {(t.team||[]).map(m=>(
                  <span key={m.id} style={{display:'inline-flex',alignItems:'center',gap:'5px',background:'var(--bg-dark)',
                    border:'1px solid var(--border)',borderRadius:'6px',padding:'3px 8px',fontSize:'0.78rem'}}>
                    {m.name}
                    <button onClick={()=>remove(m.id)}
                      style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:'0.85rem',lineHeight:1,padding:0}}>×</button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────
export default function AttendanceManagement({ user }) {
  const isSupervisor = user?.role === 'supervisor';
  const isAdmin = ['superadmin','admin','hr_manager','finance_manager','finance_approver'].includes(user?.role);

  const TABS = [
    ...(isSupervisor || isAdmin ? [{ key:'mark', label:'📋 Daily Marking' }] : []),
    ...(isAdmin ? [
      { key:'monthly', label:'📊 Monthly Report' },
      { key:'teams',   label:'👥 Team Setup'     },
    ] : []),
  ];

  const [tab, setTab] = useState(TABS[0]?.key||'mark');

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
      {tab==='monthly' && <MonthlyReport user={user}/>}
      {tab==='teams'   && <TeamAdmin user={user}/>}
    </div>
  );
}
