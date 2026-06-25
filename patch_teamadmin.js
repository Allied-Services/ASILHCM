const fs = require('fs');
const path = 'G:/My Drive/Experiments/BPOFMSystem/frontend/src/AttendanceManagement.jsx';
let src = fs.readFileSync(path, 'utf8');

const newTeamAdmin = `
// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Team Admin (HR/Admin) ─────────────────────────────────────────────────────
function TeamAdmin({user}) {
  const [teams,setTeams]=useState([]);
  const [emps,setEmps]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [fClient,setFClient]=useState('');
  const [fContract,setFContract]=useState('');
  const [fLocation,setFLocation]=useState('');
  const [fBU,setFBU]=useState('');
  const [supervisorId,setSupervisorId]=useState('');
  const [selectedIds,setSelectedIds]=useState([]);

  useEffect(()=>{
    Promise.all([api.getAttendanceTeams(),api.getEmployees()])
      .then(([t,e])=>{setTeams(t.teams||[]);setEmps(e.employees||[]);})
      .catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  const active=emps.filter(e=>e.active==='Yes');
  const clientOpts=uniq(active.map(e=>e.client));
  const contractOpts=uniq(active.filter(e=>!fClient||e.client===fClient).map(e=>e.contract_name||e.contract));
  const locationOpts=uniq(active.filter(e=>(!fClient||e.client===fClient)&&(!fContract||(e.contract_name||e.contract)===fContract)).map(e=>e.location));
  const buOpts=uniq(active.filter(e=>(!fClient||e.client===fClient)&&(!fContract||(e.contract_name||e.contract)===fContract)&&(!fLocation||e.location===fLocation)).map(e=>e.asil_bu||e.department));

  const resetBelow=(level)=>{if(level<=1)setFContract('');if(level<=2)setFLocation('');if(level<=3)setFBU('');setSupervisorId('');setSelectedIds([]);};
  const setClient=v=>{setFClient(v);resetBelow(1);};
  const setContract=v=>{setFContract(v);resetBelow(2);};
  const setLocation=v=>{setFLocation(v);resetBelow(3);};
  const setBU=v=>{setFBU(v);setSupervisorId('');setSelectedIds([]);};

  const filtered=active.filter(e=>
    (!fClient||e.client===fClient)&&
    (!fContract||(e.contract_name||e.contract)===fContract)&&
    (!fLocation||e.location===fLocation)&&
    (!fBU||e.asil_bu===fBU||e.department===fBU)
  );
  const supervisor=filtered.find(e=>e.id===supervisorId);
  const teamMembers=filtered.filter(e=>e.id!==supervisorId);

  const assign=async()=>{
    if(!supervisorId)return alert('Select a Supervisor first.');
    if(!selectedIds.length)return alert('Select at least one team member.');
    const supEmail=supervisor?.email||supervisor?.id;
    if(!supEmail)return alert('Supervisor has no email on record.');
    setSaving(true);
    try{
      await api.assignTeam({supervisor_email:supEmail,employee_ids:selectedIds,site:fLocation||fClient,client:fClient,contract_id:filtered[0]?.contract_id||null});
      const t=await api.getAttendanceTeams();
      setTeams(t.teams||[]);setSupervisorId('');setSelectedIds([]);
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

          {/* Step 2 — Supervisor */}
          <div style={{...sBox,background:'rgba(167,139,250,0.04)',border:'1px solid rgba(167,139,250,0.2)'}}>
            <div style={{...sLabel,color:'#a78bfa'}}>Step 2 — Select Supervisor</div>
            <select value={supervisorId} onChange={e=>{setSupervisorId(e.target.value);setSelectedIds(p=>p.filter(x=>x!==e.target.value));}}
              style={{width:'100%',background:'var(--bg-dark)',border:\`1px solid \${supervisorId?'#a78bfa':'var(--border)'}\`,borderRadius:'7px',padding:'8px 10px',color:'var(--text)',fontSize:'0.88rem'}}>
              <option value="">— Pick from filtered list —</option>
              {filtered.map(e=><option key={e.id} value={e.id}>{e.name} · {e.designation||e.id}</option>)}
            </select>
            {supervisor&&<div style={{fontSize:'0.78rem',color:'#a78bfa',background:'rgba(167,139,250,0.1)',borderRadius:'6px',padding:'5px 8px'}}>👤 {supervisor.name} · {supervisor.email||'No email recorded'}</div>}
          </div>

          {/* Step 3 — Team members */}
          <div style={{...sBox,background:'rgba(34,197,94,0.04)',border:'1px solid rgba(34,197,94,0.15)'}}>
            <div style={{...sLabel,color:'#22c55e'}}>Step 3 — Select Team Members ({selectedIds.length} selected)</div>
            {!filtered.length
              ?<div style={{fontSize:'0.82rem',color:'var(--text-muted)',textAlign:'center',padding:'0.75rem 0'}}>Apply filters above to see employees</div>
              :<>
                <label style={{display:'flex',alignItems:'center',gap:'7px',cursor:'pointer',fontSize:'0.8rem',color:'var(--text-muted)',borderBottom:'1px solid var(--border)',paddingBottom:'5px'}}>
                  <input type="checkbox" style={{accentColor:'#22c55e'}}
                    checked={teamMembers.length>0&&teamMembers.every(e=>selectedIds.includes(e.id))}
                    onChange={ev=>setSelectedIds(ev.target.checked?teamMembers.map(e=>e.id):[])}/>
                  Select all ({teamMembers.length})
                </label>
                <div style={{maxHeight:'200px',overflowY:'auto'}}>
                  {teamMembers.map(e=>(
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

          <button onClick={assign} disabled={saving||!supervisorId||!selectedIds.length}
            style={{background:(!supervisorId||!selectedIds.length)?'#1e293b':'var(--primary)',border:'none',color:(!supervisorId||!selectedIds.length)?'var(--text-muted)':'white',padding:'10px',borderRadius:'8px',cursor:(!supervisorId||!selectedIds.length)?'not-allowed':'pointer',fontWeight:700}}>
            {saving?'Saving…':supervisorId&&selectedIds.length?\`✓ Assign \${selectedIds.length} member\${selectedIds.length!==1?'s':''} to \${supervisor?.name?.split(' ')[0]}\`:'Assign Team'}
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
  );
}
`;

// Replace from "// ── Team Admin" to just before "// ── Main Export"
const startMarker = '// ── Team Admin (HR/Admin) ─────────────────────────────────────────────────────';
const endMarker   = '// ── Main Export ───────────────────────────────────────────────────────────────';
const startIdx = src.indexOf(startMarker);
const endIdx   = src.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found. startIdx:', startIdx, 'endIdx:', endIdx);
  process.exit(1);
}
const patched = src.slice(0, startIdx) + newTeamAdmin + '\n' + src.slice(endIdx);
fs.writeFileSync(path, patched, 'utf8');
console.log('Patched. Lines:', patched.split('\n').length);
