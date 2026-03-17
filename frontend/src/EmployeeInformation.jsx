import React, { useState, useEffect, useRef } from 'react';
import { Users, Search, Plus, Filter, Upload, Download, CheckCircle, X,
         ChevronDown, Mail, MessageCircle } from 'lucide-react';
import { api } from './api';
import EmployeeProfile from './EmployeeProfile';

// ── Exact columns from Master Data.csv ───────────────────────────────────────
export const MASTER_COLUMNS = [
    'ASIL Employee Code', 'ASIL BU', 'Active', 'CLIENT NAME', 'Client Business Unit',
    'Department', 'Designation', 'Client Location', 'Province', 'Employee Name',
    "Father's Name", "Mother's Name", 'CNIC Number', 'CNIC Issue', 'CNIC Expiry',
    'Place of Birth', 'EOBI No', 'Religion', 'Salary', 'Marital Status',
    'Primary Contact', 'Emergency Contact', 'Email Address', 'Present Address',
    'Permanent Address', 'Date of Birth', 'Age', 'Date of Joining', 'Employment Duration',
    'Salary (Last/After Increment)', 'Spouse Name', 'Spouse Age', 'Spouse CNIC',
    'Child 1 Name', 'Child 1 Age', 'Child 1 CNIC/Bay Form',
    'Child 2 Name', 'Child 2 Age', 'Child 2 CNIC/Bay Form',
    'Medical Coverage (Type)', 'Medical Coverage Maternity', 'Total Medical Coverage (Self & Family)',
    'Bank Name', 'Bank Account', 'Account Title',
    'NEXT OF KIN NAME', 'NEXT OF KIN RELATION', 'NEXT OF KIN CONTACT'
];

const STATUS_CLR = { Active: '#22c55e', Inactive: '#eab308', Terminated: '#ef4444', Suspended: '#f97316' };

// ── Helper: parse raw salary string like "72,245.00" ────────────────────────
const parseSalary = (s) => parseFloat(String(s || '0').replace(/,/g, '')) || 0;

// No sample data — loaded from Neon DB

const EMPTY_FORM = {
    id: '', bu: '', active: 'Yes', client: '', clientBU: '', dept: '', designation: '',
    location: '', province: '', name: '', fatherName: '', motherName: '',
    cnic: '', cnicIssue: '', cnicExpiry: '', placeOfBirth: '', eobiNo: '', religion: 'Islam',
    salary: '', maritalStatus: 'Single',
    primaryContact: '', emergencyContact: '', email: '',
    presentAddress: '', permanentAddress: '', dob: '', doj: '',
    lastSalary: '',
    spouseName: '', spouseAge: '', spouseCnic: '',
    child1Name: '', child1Age: '', child1Id: '',
    child2Name: '', child2Age: '', child2Id: '',
    medicalType: 'Self', medicalMaternity: 'No', totalMedicalCoverage: '',
    bankName: '', bankAccount: '', accountTitle: '',
    nokName: '', nokRelation: '', nokContact: '',
};

// ── 8 form sections matching master sheet structure ───────────────────────────
const SECTIONS = ['Employment', 'Personal', 'CNIC & Compliance', 'Contact & Address', 'Salary', 'Family', 'Medical', 'Banking & NOK'];

const Overlay = ({ children, wide }) => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '1.5rem', overflowY: 'auto' }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', width: '100%', maxWidth: wide ? '960px' : '860px', border: '1px solid var(--border)', marginBottom: '2rem' }}>{children}</div>
    </div>
);

export default function EmployeeInformation({ user }) {
    const [emps, setEmps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [filterActive, setFilterActive] = useState('All');
    const [filterClient, setFilterClient] = useState('All');
    const [filterLocation, setFilterLocation] = useState('All');
    const [filterDept, setFilterDept] = useState('All');
    const [showAdd, setShowAdd] = useState(false);
    const [addMode, setAddMode] = useState('single');
    const [form, setForm] = useState(EMPTY_FORM);
    const [sec, setSec] = useState(SECTIONS[0]);
    const [profile, setProfile] = useState(null);
    const [csvRows, setCsvRows] = useState([]);
    const [csvErr, setCsvErr] = useState('');
    const fileRef = useRef();

    // ── Load employees from DB on mount ─────────────────────────────────────
    useEffect(() => {
        api.getEmployees()
            .then(data => { setEmps(data.employees); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    const secIdx = SECTIONS.indexOf(sec);

    // Unique values for filter dropdowns
    const allClients = ['All', ...new Set(emps.map(e => e.client).filter(Boolean))];
    const allLocations = ['All', ...new Set(emps.map(e => e.location).filter(Boolean))];
    const allDepts = ['All', ...new Set(emps.map(e => e.designation).filter(Boolean))];

    const filtered = emps.filter(e => {
        const q = search.toLowerCase();
        const matchSearch = !search ||
            (e.name || '').toLowerCase().includes(q) ||
            (e.cnic || '').includes(search) ||
            (e.id || '').toLowerCase().includes(q) ||
            (e.client || '').toLowerCase().includes(q) ||
            (e.designation || '').toLowerCase().includes(q);
        const matchActive = filterActive === 'All' || (filterActive === 'Active' && e.active === 'Yes') || (filterActive === 'Inactive' && e.active === 'No');
        const matchClient = filterClient === 'All' || e.client === filterClient;
        const matchLocation = filterLocation === 'All' || e.location === filterLocation;
        const matchDept = filterDept === 'All' || e.designation === filterDept;
        return matchSearch && matchActive && matchClient && matchLocation && matchDept;
    });

    // ── Flexible CSV header lookup (case-insensitive, multi-alias) ─────────
    const getF = (obj, ...keys) => {
        const lcObj = {};
        Object.keys(obj).forEach(k => { lcObj[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = obj[k]; });
        for (const k of keys) {
            const norm = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (lcObj[norm] !== undefined) return lcObj[norm] || '';
        }
        return '';
    };

    // ── Download template ─────────────────────────────────────────────────────
    const downloadTpl = () => {
        const ex = ['ASIL/SPL-001/25', 'WafiBPO', 'Yes', 'Client Name Ltd', 'Trading & Supply', 'Security Services', 'Security Guard', 'Karachi', 'Sindh', 'Muhammad Ali', 'Father Name', 'Mother Name', '42101-1234567-1', '01-Jan-20', '01-Jan-30', 'Karachi', 'EOBI-001', 'Islam', '"38,000.00"', 'Married', '0300-1234567', '0311-9876543', 'email@example.com', 'Present Address', 'Permanent Address', '01-Jan-1990', '', '01-Jan-2024', '1.0', '"38,000.00"', 'Spouse Name', '30', 'XXXXX-XXXXXXX-X', 'Child 1', '5', 'B-Form', 'Child 2', '3', 'B-Form', 'Self & Family', 'Yes', '500000', 'HBL', '12345678901', 'Muhammad Ali', 'NOK Name', 'Father', '0300-0000000'].join(',');
        const blob = new Blob([MASTER_COLUMNS.join(',') + '\n' + ex], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ASIL_Employee_Master_Template.csv'; a.click();
    };

    // ── Parse uploaded CSV ───────────────────────────────────────────────────
    const handleFile = (e) => {
        const f = e.target.files[0]; if (!f) return; setCsvErr('');
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const lines = ev.target.result.replace(/\r/g, '').split('\n').filter(Boolean);
                const hdrs = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
                const rows = lines.slice(1).map((line, i) => {
                    // Handle quoted fields with commas
                    const vals = []; let cur = '', inQ = false;
                    for (const ch of line) { if (ch === '"') { inQ = !inQ; } else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; } else { cur += ch; } } vals.push(cur.trim());
                    const obj = {};
                    hdrs.forEach((h, j) => { obj[h] = vals[j] || ''; });
                    return {
                        id: getF(obj, 'ASIL Employee Code', 'Employee Code', 'ID', 'EmpID') || `IMP-${i + 1}`,
                        bu: getF(obj, 'ASIL BU', 'BU', 'Business Unit'),
                        active: getF(obj, 'Active', 'Status') || 'Yes',
                        client: getF(obj, 'CLIENT NAME', 'Client Name', 'Client'),
                        clientBU: getF(obj, 'Client Business Unit', 'Client BU', 'ClientBU'),
                        dept: getF(obj, 'Department', 'Dept'),
                        designation: getF(obj, 'Designation', 'Position', 'Job Title'),
                        location: getF(obj, 'Client Location', 'Location', 'Site'),
                        province: getF(obj, 'Province'),
                        name: getF(obj, 'Employee Name', 'Name', 'Full Name'),
                        fatherName: getF(obj, "Father's Name", 'Father Name', 'Fathers Name', 'Father'),
                        motherName: getF(obj, "Mother's Name", 'Mother Name', 'Mothers Name', 'Mother'),
                        cnic: getF(obj, 'CNIC Number', 'CNIC No', 'CNIC', 'NIC'),
                        cnicIssue: getF(obj, 'CNIC Issue', 'CNIC Issue Date', 'Issue Date'),
                        cnicExpiry: getF(obj, 'CNIC Expiry', 'CNIC Expiry Date', 'Expiry Date'),
                        placeOfBirth: getF(obj, 'Place of Birth', 'Birth Place', 'POB'),
                        eobiNo: getF(obj, 'EOBI No', 'EOBI Number', 'EOBI'),
                        religion: getF(obj, 'Religion') || '',
                        salary: parseSalary(getF(obj, 'Salary', 'Basic Salary', 'Gross Salary')),
                        lastSalary: parseSalary(getF(obj, 'Salary (Last/After Increment)', 'Last Salary', 'Salary After Increment') || getF(obj, 'Salary')),
                        maritalStatus: getF(obj, 'Marital Status', 'Marital') || 'Single',
                        primaryContact: getF(obj, 'Primary Contact', 'Phone', 'Mobile', 'Contact'),
                        emergencyContact: getF(obj, 'Emergency Contact', 'Emergency Phone'),
                        email: getF(obj, 'Email Address', 'Email'),
                        presentAddress: getF(obj, 'Present Address', 'Current Address', 'Address'),
                        permanentAddress: getF(obj, 'Permanent Address', 'Home Address'),
                        dob: getF(obj, 'Date of Birth', 'DOB', 'Birth Date'),
                        doj: getF(obj, 'Date of Joining', 'DOJ', 'Joining Date', 'Start Date'),
                        spouseName: getF(obj, 'Spouse Name', 'Spouse'),
                        spouseAge: getF(obj, 'Spouse Age'),
                        spouseCnic: getF(obj, 'Spouse CNIC', 'Spouse NIC', 'Spouse ID'),
                        child1Name: getF(obj, 'Child 1 Name', 'Child1 Name', 'Child 1'),
                        child1Age: getF(obj, 'Child 1 Age', 'Child1 Age'),
                        child1Id: getF(obj, 'Child 1 CNIC/Bay Form', 'Child1 CNIC', 'Child 1 ID', 'Child1 ID'),
                        child2Name: getF(obj, 'Child 2 Name', 'Child2 Name', 'Child 2'),
                        child2Age: getF(obj, 'Child 2 Age', 'Child2 Age'),
                        child2Id: getF(obj, 'Child 2 CNIC/Bay Form', 'Child2 CNIC', 'Child 2 ID', 'Child2 ID'),
                        medicalType: getF(obj, 'Medical Coverage (Type)', 'Medical Type', 'Medical Coverage'),
                        medicalMaternity: getF(obj, 'Medical Coverage Maternity', 'Maternity'),
                        totalMedicalCoverage: getF(obj, 'Total Medical Coverage (Self & Family)', 'Total Medical Coverage', 'Medical Coverage Amount'),
                        bankName: getF(obj, 'Bank Name', 'Bank'),
                        bankAccount: getF(obj, 'Bank Account', 'Bank Account No', 'Account Number', 'Account No'),
                        accountTitle: getF(obj, 'Account Title', 'Account Name'),
                        nokName: getF(obj, 'NEXT OF KIN NAME', 'NOK Name', 'Next of Kin', 'NOK'),
                        nokRelation: getF(obj, 'NEXT OF KIN RELATION', 'NOK Relation', 'Next of Kin Relation'),
                        nokContact: getF(obj, 'NEXT OF KIN CONTACT', 'NOK Contact', 'Next of Kin Contact'),
                        salaryHistory: parseSalary(getF(obj, 'Salary')) ? [{ date: getF(obj, 'Date of Joining', 'DOJ') || '', basic: parseSalary(getF(obj, 'Salary')), hra: 0, conveyance: 0, medical: 0, other: 0, gross: parseSalary(getF(obj, 'Salary')), note: 'Imported from CSV' }] : [],
                        leaves: { cl: { total: 10, used: 0 }, ml: { total: 8, used: 0 }, el: { total: 14, used: 0 } },
                    };
                }).filter(r => r.name);
                setCsvRows(rows);
            } catch (err) { setCsvErr('Could not parse file. Please use the downloaded template.'); }
        };
        reader.readAsText(f);
    };

    const [importResult, setImportResult] = useState(null); // { saved, errors: [{id,name,error}] }

    const importBulk = async () => {
        setSaving(true);
        try {
            const data = await api.bulkImportEmployees(csvRows);
            // UPSERT behaviour — update existing, add new, avoid duplicates
            setEmps(p => {
                const map = new Map(p.map(e => [e.id, e]));
                data.employees.forEach(e => map.set(e.id, e));
                return Array.from(map.values());
            });
            setCsvRows([]); setShowAdd(false);
            if (fileRef.current) fileRef.current.value = '';
            setImportResult({ saved: data.saved, errors: data.errors || [] });
        } catch (err) { alert('Import error: ' + err.message); }
        setSaving(false);
    };

    const addSingle = async () => {
        if (!form.name || !form.cnic) return alert('Employee Name and CNIC are required.');
        setSaving(true);
        const gross = parseSalary(form.salary);
        try {
            const data = await api.createEmployee({ ...form, salary: gross, lastSalary: parseSalary(form.lastSalary) || gross });
            setEmps(p => [...p, data.employee]);
            setForm(EMPTY_FORM); setSec(SECTIONS[0]); setShowAdd(false);
        } catch (err) { alert('Save failed: ' + err.message); }
        setSaving(false);
    };

    const closeAdd = () => { setShowAdd(false); setCsvRows([]); setCsvErr(''); setForm(EMPTY_FORM); setSec(SECTIONS[0]); if (fileRef.current) fileRef.current.value = ''; };

    const updateEmployee = async (updated) => {
        setEmps(p => p.map(e => e.id === updated.id ? updated : e)); setProfile(updated); // optimistic
        try { await api.updateEmployee(updated.id, updated); } catch (err) { console.error('Sync error:', err.message); }
    };

    // ── Field Input helper ───────────────────────────────────────────────────
    const F = ({ label, field, type = 'text', opts }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
            {opts?.sel ? (
                <select value={form[field]} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem' }}>
                    {opts.sel.map(o => <option key={o}>{o}</option>)}
                </select>
            ) : (
                <input type={type} value={form[field] || ''} placeholder={opts?.ph || ''} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
                    style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
            )}
        </div>
    );

    if (profile) return <EmployeeProfile employee={profile} user={user} onBack={() => setProfile(null)} onUpdate={updateEmployee} />;

    return (
        <div className="dashboard">
            <header className="header">
                <h1>Employee Information</h1>
                <p>Full master roster — Employment, Personal, Compliance, Salary, Family, Medical &amp; Banking.</p>
            </header>

            {/* ── Import Results Modal ─────────────────────────────────────── */}
            {importResult && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '2rem' }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '780px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
                        {/* Header */}
                        <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0 }}>Import Results</h3>
                            <button onClick={() => setImportResult(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                        </div>
                        {/* Summary KPIs */}
                        <div style={{ display: 'flex', gap: '1rem', padding: '1.25rem 2rem', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ flex: 1, background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e40', borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
                                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#22c55e' }}>{importResult.saved}</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>✅ Imported / Updated</div>
                            </div>
                            <div style={{ flex: 1, background: importResult.errors.length ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.05)', border: `1px solid ${importResult.errors.length ? '#ef444440' : '#22c55e20'}`, borderRadius: '10px', padding: '1rem', textAlign: 'center' }}>
                                <div style={{ fontSize: '2rem', fontWeight: 800, color: importResult.errors.length ? '#ef4444' : '#22c55e' }}>{importResult.errors.length}</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{importResult.errors.length ? '❌ Skipped (errors below)' : '✅ No Errors'}</div>
                            </div>
                        </div>
                        {/* Error table */}
                        {importResult.errors.length > 0 && (
                            <div style={{ flex: 1, overflowY: 'auto', padding: '0 2rem 1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0 0.5rem' }}>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Skipped Records — Fix these in your CSV and re-upload</div>
                                    <button onClick={() => {
                                        const csv = ['Employee Code,Name,Error', ...importResult.errors.map(e => `"${e.id}","${e.name}","${e.error}"`)].join('\n');
                                        const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                                        a.download = 'import_errors.csv'; a.click();
                                    }} style={{ fontSize: '0.8rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer' }}>
                                        ⬇ Download Error Report
                                    </button>
                                </div>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--bg-dark)' }}>
                                            {['#', 'Employee Code', 'Name', 'Error Reason'].map(h => (
                                                <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {importResult.errors.map((e, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)', width: '40px' }}>{i + 1}</td>
                                                <td style={{ padding: '0.6rem 0.75rem', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{e.id || '—'}</td>
                                                <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{e.name || '—'}</td>
                                                <td style={{ padding: '0.6rem 0.75rem', color: '#ef4444', fontSize: '0.82rem' }}>{e.error}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <div style={{ padding: '1rem 2rem', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)' }}>
                            <button onClick={() => setImportResult(null)} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.7rem 2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Done</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', background: 'var(--bg-card)', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <Search size={18} color="var(--text-muted)" style={{ marginRight: '0.5rem', flexShrink: 0 }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by Name, CNIC, Employee ID, Client, or Position..." style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none' }} />
                </div>
                {['All', 'Active', 'Inactive'].map(f => (
                    <button key={f} onClick={() => setFilterActive(f)} style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid', borderColor: filterActive === f ? 'var(--primary)' : 'var(--border)', background: filterActive === f ? 'rgba(56,189,248,0.1)' : 'var(--bg-card)', color: filterActive === f ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: filterActive === f ? 700 : 400 }}>
                        {f}
                    </button>
                ))}
                <button onClick={() => { setShowAdd(true); setAddMode('single'); }} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.55rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                    <Plus size={18} /> Add Employee
                </button>
            </div>

            {/* Filter Row */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <Filter size={15} color="var(--text-muted)" />
                {[
                    { label: 'Client', val: filterClient, set: setFilterClient, opts: allClients },
                    { label: 'Location', val: filterLocation, set: setFilterLocation, opts: allLocations },
                    { label: 'Position', val: filterDept, set: setFilterDept, opts: allDepts },
                ].map(f => (
                    <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{f.label}:</span>
                        <select value={f.val} onChange={e => f.set(e.target.value)}
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 10px', color: 'var(--text)', fontSize: '0.82rem', outline: 'none', maxWidth: '200px' }}>
                            {f.opts.map(o => <option key={o}>{o}</option>)}
                        </select>
                    </div>
                ))}
                {(filterClient !== 'All' || filterLocation !== 'All' || filterDept !== 'All') && (
                    <button onClick={() => { setFilterClient('All'); setFilterLocation('All'); setFilterDept('All'); }}
                        style={{ fontSize: '0.78rem', color: '#ef4444', background: 'transparent', border: '1px solid #ef444440', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>
                        Clear Filters
                    </button>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Showing <strong>{filtered.length}</strong> of {emps.length} employees
                </span>
            </div>

            {/* Table */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', minWidth: '900px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-dark)' }}>
                            {['Employee Code', 'Name', 'Client', 'Designation', 'Location', 'Contract Start', 'Salary', 'Status', ''].map(h => (
                                <th key={h} style={{ padding: '0.9rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(emp => (
                            <tr key={emp.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-dark)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{emp.id}</td>
                                <td style={{ padding: '0.85rem 1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg,var(--primary),#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '0.78rem', flexShrink: 0 }}>
                                            {emp.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{emp.name}</div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{emp.cnic}</div>
                                        </div>
                                    </div>
                                </td>
                                <td style={{ padding: '0.85rem 1rem' }}>
                                    <div style={{ fontWeight: 500, lineHeight: 1.2 }}>{emp.client}</div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{emp.dept}</div>
                                </td>
                                <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>{emp.designation}</td>
                                <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{emp.location}, {emp.province}</td>
                                <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                                    {emp.contractDate ? (
                                        <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{String(emp.contractDate).slice(0, 10)}</span>
                                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                </td>
                                <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
                                    <div style={{ fontWeight: 600 }}>Rs. {(emp.salary || 0).toLocaleString()}</div>
                                    {emp.lastSalary && emp.lastSalary !== emp.salary && <div style={{ color: '#22c55e', fontSize: '0.76rem' }}>↑ Rs. {emp.lastSalary.toLocaleString()}</div>}
                                </td>
                                <td style={{ padding: '0.85rem 1rem' }}>
                                    <span style={{ background: emp.active === 'Yes' ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)', color: emp.active === 'Yes' ? '#22c55e' : '#eab308', padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600 }}>{emp.active === 'Yes' ? 'Active' : 'Inactive'}</span>
                                </td>
                                <td style={{ padding: '0.85rem 1rem' }}>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        <button onClick={() => setProfile(emp)} style={{ background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}>View Profile</button>
                                        {emp.email && (
                                            <a href={`mailto:${emp.email}`} title={`Email ${emp.name}`}
                                                style={{ display: 'flex', alignItems: 'center', padding: '5px 7px', borderRadius: '6px',
                                                    border: '1px solid var(--border)', color: 'var(--text-muted)',
                                                    textDecoration: 'none', transition: 'all 0.15s' }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                                                <Mail size={13} />
                                            </a>
                                        )}
                                        {emp.primaryContact && (
                                            <a href={`https://wa.me/92${emp.primaryContact.replace(/[^0-9]/g, '').slice(1)}`}
                                                target="_blank" rel="noreferrer" title={`WhatsApp ${emp.name}`}
                                                style={{ display: 'flex', alignItems: 'center', padding: '5px 7px', borderRadius: '6px',
                                                    border: '1px solid var(--border)', color: 'var(--text-muted)',
                                                    textDecoration: 'none', transition: 'all 0.15s' }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#22c55e'; e.currentTarget.style.color = '#22c55e'; }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}>
                                                <MessageCircle size={13} />
                                            </a>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filtered.length === 0 && (
                    <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <Users size={40} style={{ opacity: 0.3, display: 'block', margin: '0 auto 1rem' }} />
                        <p>No employees found.</p>
                    </div>
                )}
            </div>

            {/* ── ADD MODAL ── */}
            {showAdd && (
                <Overlay>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                        <div><h2 style={{ margin: 0 }}>Add Employee</h2><p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Single entry or bulk import from Master CSV</p></div>
                        <button onClick={closeAdd} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
                    </div>

                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                        {[['single', 'Single Entry'], ['bulk', 'Bulk Upload (Master CSV)']].map(([m, lbl]) => (
                            <button key={m} onClick={() => setAddMode(m)} style={{ flex: 1, padding: '1rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${addMode === m ? 'var(--primary)' : 'transparent'}`, color: addMode === m ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: addMode === m ? 700 : 400 }}>
                                {lbl}
                            </button>
                        ))}
                    </div>

                    {/* ── SINGLE FORM ── */}
                    {addMode === 'single' && (
                        <div style={{ padding: '2rem' }}>
                            {/* Section pills */}
                            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.75rem', flexWrap: 'wrap' }}>
                                {SECTIONS.map((s, i) => (
                                    <button key={s} onClick={() => setSec(s)} style={{ padding: '5px 12px', borderRadius: '20px', border: '1px solid', borderColor: sec === s ? 'var(--primary)' : 'var(--border)', background: sec === s ? 'rgba(56,189,248,0.1)' : 'transparent', color: sec === s ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: sec === s ? 700 : 400, whiteSpace: 'nowrap' }}>
                                        {i + 1}. {s}
                                    </button>
                                ))}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                                {sec === 'Employment' && <>
                                    <F label="ASIL Employee Code" field="id" opts={{ ph: 'ASIL/SPL-XXX/25' }} />
                                    <F label="ASIL BU" field="bu" opts={{ ph: 'e.g. WafiBPO' }} />
                                    <F label="Client Name" field="client" opts={{ ph: 'Client organisation name' }} />
                                    <F label="Client Business Unit" field="clientBU" opts={{ ph: 'e.g. Trading & Supply' }} />
                                    <F label="Department" field="dept" opts={{ ph: 'e.g. Security Services' }} />
                                    <F label="Designation" field="designation" opts={{ ph: 'e.g. Security Guard' }} />
                                    <F label="Client Location" field="location" opts={{ ph: 'e.g. Karachi' }} />
                                    <F label="Province" field="province" opts={{ sel: ['Sindh', 'Punjab', 'KPK', 'Balochistan', 'Gilgit-Baltistan', 'Islamabad'] }} />
                                    <F label="Date of Joining" field="doj" type="date" />
                                    <F label="Contract Start Date" field="contractDate" type="date" />
                                    <F label="Active" field="active" opts={{ sel: ['Yes', 'No'] }} />
                                </>}

                                {sec === 'Personal' && <>
                                    <F label="Employee Full Name *" field="name" opts={{ ph: 'As per CNIC' }} />
                                    <F label="Father's Name" field="fatherName" opts={{ ph: 'Father name' }} />
                                    <F label="Mother's Name" field="motherName" opts={{ ph: 'Mother name' }} />
                                    <F label="Date of Birth" field="dob" type="date" />
                                    <F label="Place of Birth" field="placeOfBirth" opts={{ ph: 'e.g. Lahore' }} />
                                    <F label="Gender" field="gender" opts={{ sel: ['Male', 'Female'] }} />
                                    <F label="Marital Status" field="maritalStatus" opts={{ sel: ['Single', 'Married', 'Divorced', 'Widowed'] }} />
                                    <F label="Religion" field="religion" opts={{ sel: ['Islam', 'Christianity', 'Hinduism', 'Other'] }} />
                                </>}

                                {sec === 'CNIC & Compliance' && <>
                                    <F label="CNIC Number *" field="cnic" opts={{ ph: 'XXXXX-XXXXXXX-X' }} />
                                    <F label="CNIC Issue Date" field="cnicIssue" type="date" />
                                    <F label="CNIC Expiry Date" field="cnicExpiry" type="date" />
                                    <F label="EOBI Number" field="eobiNo" opts={{ ph: 'EOBI-XXXXXXXX' }} />
                                </>}

                                {sec === 'Contact & Address' && <>
                                    <F label="Primary Contact" field="primaryContact" opts={{ ph: '03XX-XXXXXXX' }} />
                                    <F label="Emergency Contact" field="emergencyContact" opts={{ ph: '03XX-XXXXXXX' }} />
                                    <F label="Email Address" field="email" type="email" opts={{ ph: 'email@example.com' }} />
                                    <div></div>
                                    <div style={{ gridColumn: '1/-1' }}><F label="Present Address" field="presentAddress" opts={{ ph: 'Current residential address' }} /></div>
                                    <div style={{ gridColumn: '1/-1' }}><F label="Permanent Address" field="permanentAddress" opts={{ ph: 'Permanent hometown address' }} /></div>
                                </>}

                                {sec === 'Salary' && <>
                                    <F label="Current / Starting Gross Salary (Rs.)" field="salary" type="number" opts={{ ph: 'e.g. 38000' }} />
                                    <F label="Last Salary After Increment (Rs.)" field="lastSalary" type="number" opts={{ ph: 'Leave blank if no increment yet' }} />
                                    <div style={{ gridColumn: '1/-1', background: 'var(--bg-dark)', borderRadius: '8px', padding: '1rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                                        💡 Salary history is automatically tracked. If this employee already had an increment, enter the current salary in "Last Salary After Increment". You can add full increment history from their profile after saving.
                                    </div>
                                </>}

                                {sec === 'Family' && <>
                                    <F label="Spouse Name" field="spouseName" opts={{ ph: 'Leave blank if single' }} />
                                    <F label="Spouse Age" field="spouseAge" opts={{ ph: 'e.g. 28' }} />
                                    <F label="Spouse CNIC" field="spouseCnic" opts={{ ph: 'XXXXX-XXXXXXX-X' }} />
                                    <div style={{ gridColumn: '1/-1', borderTop: '1px solid var(--border)', paddingTop: '1rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Children</div>
                                    <F label="Child 1 Name" field="child1Name" opts={{ ph: 'Full name' }} />
                                    <F label="Child 1 Age" field="child1Age" opts={{ ph: 'Age in years' }} />
                                    <F label="Child 1 CNIC / Bay Form" field="child1Id" opts={{ ph: 'ID or Bay Form number' }} />
                                    <F label="Child 2 Name" field="child2Name" opts={{ ph: 'Full name' }} />
                                    <F label="Child 2 Age" field="child2Age" opts={{ ph: 'Age in years' }} />
                                    <F label="Child 2 CNIC / Bay Form" field="child2Id" opts={{ ph: 'ID or Bay Form number' }} />
                                </>}

                                {sec === 'Medical' && <>
                                    <F label="Medical Coverage Type" field="medicalType" opts={{ sel: ['Self', 'Self & Spouse', 'Self & Family (Spouse + 2 Children)', 'None'] }} />
                                    <F label="Maternity Coverage" field="medicalMaternity" opts={{ sel: ['Yes', 'No'] }} />
                                    <F label="Total Medical Coverage Amount (Rs.)" field="totalMedicalCoverage" opts={{ ph: 'e.g. 500000' }} />
                                </>}

                                {sec === 'Banking & NOK' && <>
                                    <F label="Bank Name" field="bankName" opts={{ ph: 'e.g. HBL' }} />
                                    <F label="Bank Account / IBAN" field="bankAccount" opts={{ ph: 'Account number or IBAN' }} />
                                    <F label="Account Title" field="accountTitle" opts={{ ph: 'Name on bank account' }} />
                                    <div style={{ gridColumn: '1/-1', borderTop: '1px solid var(--border)', paddingTop: '1rem', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Next of Kin</div>
                                    <F label="NOK Name" field="nokName" opts={{ ph: 'Next of kin full name' }} />
                                    <F label="NOK Relation" field="nokRelation" opts={{ ph: 'e.g. Father, Spouse, Brother' }} />
                                    <F label="NOK Contact" field="nokContact" opts={{ ph: '03XX-XXXXXXX' }} />
                                </>}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                                <button onClick={() => secIdx > 0 && setSec(SECTIONS[secIdx - 1])} disabled={secIdx === 0} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer', opacity: secIdx === 0 ? 0.4 : 1 }}>← Previous</button>
                                {secIdx < SECTIONS.length - 1
                                    ? <button onClick={() => setSec(SECTIONS[secIdx + 1])} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Next →</button>
                                    : <button onClick={addSingle} style={{ background: '#22c55e', border: 'none', color: 'white', padding: '0.7rem 2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>✓ Save Employee</button>
                                }
                            </div>
                        </div>
                    )}

                    {/* ── BULK UPLOAD ── */}
                    {addMode === 'bulk' && (
                        <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div style={{ background: 'var(--bg-dark)', borderRadius: '10px', padding: '1.5rem' }}>
                                <h3 style={{ margin: '0 0 0.5rem' }}>Step 1: Download the Official Template</h3>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 1rem' }}>This template matches the ASIL Employee Master format exactly (48 columns). You can also use your existing Master Data CSV directly if the columns match.</p>
                                <button onClick={downloadTpl} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                                    <Download size={16} /> Download ASIL Master Template
                                </button>
                            </div>

                            <div style={{ background: 'var(--bg-dark)', borderRadius: '10px', padding: '1.5rem' }}>
                                <h3 style={{ margin: '0 0 0.5rem' }}>Step 2: Upload Your CSV</h3>
                                <div onClick={() => fileRef.current?.click()} style={{ border: '2px dashed var(--border)', borderRadius: '10px', padding: '2.5rem', textAlign: 'center', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                                    <Upload size={32} color="var(--text-muted)" style={{ marginBottom: '0.5rem' }} />
                                    <p style={{ margin: 0, fontWeight: 600 }}>Click to upload Master CSV</p>
                                    <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Supports standard CSV (your existing Master Data format)</p>
                                    <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
                                </div>
                                {csvErr && <p style={{ color: '#ef4444', marginTop: '0.75rem', fontSize: '0.9rem' }}>⚠ {csvErr}</p>}
                            </div>

                            {csvRows.length > 0 && (
                                <div style={{ background: 'var(--bg-dark)', borderRadius: '10px', padding: '1.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                        <h3 style={{ margin: 0 }}>Step 3: Preview &amp; Import</h3>
                                        <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', padding: '4px 12px', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600 }}>{csvRows.length} records ready</span>
                                    </div>
                                    <div style={{ overflowX: 'auto', maxHeight: '220px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                            <thead>
                                                <tr style={{ background: 'var(--bg-card)' }}>
                                                    {['Code', 'Name', 'Client', 'Designation', 'Location', 'Salary', 'Active'].map(h => (
                                                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--bg-card)', whiteSpace: 'nowrap' }}>{h}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {csvRows.map((r, i) => (
                                                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.78rem' }}>{r.id}</td>
                                                        <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.name}</td>
                                                        <td style={{ padding: '8px 12px' }}>{r.client}</td>
                                                        <td style={{ padding: '8px 12px' }}>{r.designation}</td>
                                                        <td style={{ padding: '8px 12px' }}>{r.location}</td>
                                                        <td style={{ padding: '8px 12px' }}>Rs. {(r.salary || 0).toLocaleString()}</td>
                                                        <td style={{ padding: '8px 12px' }}><span style={{ color: r.active === 'Yes' ? '#22c55e' : '#eab308' }}>{r.active}</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <button onClick={importBulk} style={{ marginTop: '1rem', background: '#22c55e', border: 'none', color: 'white', padding: '0.75rem 2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <CheckCircle size={18} /> Import {csvRows.length} Employees
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </Overlay>
            )}
        </div>
    );
}
