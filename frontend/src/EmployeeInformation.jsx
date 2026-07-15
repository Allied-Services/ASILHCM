import React, { useState, useEffect, useRef } from 'react';
import { Users, Search, Plus, Filter, Upload, Download, CheckCircle, X,
         ChevronDown, Mail, MessageCircle } from 'lucide-react';
import { api } from './api';
import EmployeeProfile from './EmployeeProfile';
import EmployeeDirectoryToolbar from './features/employees/EmployeeDirectory';

// ── Exact columns from Master Data.csv ───────────────────────────────────────
export const MASTER_COLUMNS = [
    'ASIL Employee Code', 'ASIL BU', 'Contract Name', 'Active', 'CLIENT NAME', 'Client Business Unit',
    'Department', 'Designation', 'Client Location', 'Site', 'Province', 'Employee Name',
    "Father's Name", "Mother's Name", 'CNIC Number', 'CNIC Issue', 'CNIC Expiry',
    'Place of Birth', 'EOBI No', 'Religion', 'Salary', 'Marital Status',
    'Primary Contact', 'Emergency Contact', 'Email Address', 'Present Address',
    'Permanent Address', 'Date of Birth', 'Age', 'Date of Joining', 'Employment Duration',
    'Salary (Last/After Increment)', 'Spouse Name', 'Spouse Age', 'Spouse CNIC',
    'Child 1 Name', 'Child 1 Age', 'Child 1 CNIC/Bay Form',
    'Child 2 Name', 'Child 2 Age', 'Child 2 CNIC/Bay Form',
    'Medical Coverage (Type)', 'Medical Coverage Maternity', 'Total Medical Coverage (Self & Family)',
    'Bank Name', 'Bank Account', 'Account Title',
    'NEXT OF KIN NAME', 'NEXT OF KIN RELATION', 'NEXT OF KIN CONTACT',
    // ── Operational fields (2026-07-02) ───────────────────────────────────────────────────────────
    'SESSI Number', 'Shirt Size', 'Trouser Size', 'Safety Shoe Size',
    'Last Uniform Issue Date', 'Last PPE Issue Date', 'Gate Pass Expiry', 'Payroll Cycle Type',
];

const STATUS_CLR = { Active: '#22c55e', Inactive: '#eab308', Terminated: '#ef4444', Suspended: '#f97316' };

// ── Helper: parse raw salary string like "72,245.00" ────────────────────────
const parseSalary = (s) => parseFloat(String(s || '0').replace(/,/g, '')) || 0;

// No sample data — loaded from Neon DB

const EMPTY_FORM = {
    id: '', bu: '', active: 'Yes', client: '', clientBU: '', dept: '', designation: '',
    location: '', site: '', province: '', contractName: '', contractId: '',
    name: '', fatherName: '', motherName: '',
    cnic: '', cnicIssue: '', cnicExpiry: '', placeOfBirth: '', eobiNo: '', religion: 'Islam',
    salary: '', maritalStatus: 'Single',
    primaryContact: '', emergencyContact: '', email: '',
    presentAddress: '', permanentAddress: '', dob: '', doj: '', lastWorkingDay: '',
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

// ── Field input defined OUTSIDE parent to prevent focus loss on re-render ──────
// If defined inside, React sees a new component type on every keystroke → unmount → focus lost
const FormField = ({ label, field, type = 'text', opts, form, setForm }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
        {opts?.sel ? (
            <select value={form[field]} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem' }}>
                {opts.sel.map(o => <option key={o}>{o}</option>)}
            </select>
        ) : opts?.list ? (
            <>
                <input type="text" list={field + '-datalist'} value={form[field] || ''} placeholder={opts?.ph || ''}
                    onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
                    style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
                <datalist id={field + '-datalist'}>
                    {opts.list.map(o => <option key={o} value={o} />)}
                </datalist>
            </>
        ) : (
            <input type={type} value={form[field] || ''} placeholder={opts?.ph || ''} onChange={e => setForm(p => ({ ...p, [field]: e.target.value }))}
                style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
        )}
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
    const [filterContract, setFilterContract] = useState('All');
    const [showAdd, setShowAdd] = useState(false);
    const [addMode, setAddMode] = useState('single');
    const [form, setForm] = useState(EMPTY_FORM);
    const [sec, setSec] = useState(SECTIONS[0]);
    const [profile, setProfile] = useState(null);
    const [csvRows, setCsvRows] = useState([]);
    const [csvErr, setCsvErr] = useState('');
    const fileRef = useRef();

    // ── Bulk selection state ─────────────────────────────────────────────────
    const [selected, setSelected] = useState(new Set());
    const [showBulkSMS, setShowBulkSMS] = useState(false);
    const [bulkSmsMsg, setBulkSmsMsg] = useState('Dear {name}, this is a message from ASIL HR.');
    const [bulkSmsSending, setBulkSmsSending] = useState(false);

    // ── Load employees + contracts from DB on mount ────────────────────────────
    const [contractsList, setContractsList] = useState([]);
    const loadEmployees = () => {
        setLoading(true);
        api.getEmployees()
            .then(data => { setEmps(data.employees || []); setLoading(false); })
            .catch(() => setLoading(false));
    };
    useEffect(() => {
        loadEmployees();
        api.getContracts()
            .then(data => setContractsList(data.contracts || []))
            .catch(() => {});
    }, []);

    const secIdx = SECTIONS.indexOf(sec);

    // Unique values for filter dropdowns
    const allClients = ['All', ...new Set(emps.map(e => e.client).filter(Boolean))];
    const allLocations = ['All', ...new Set(emps.map(e => e.location).filter(Boolean))];
    const allDepts = ['All', ...new Set(emps.map(e => e.designation).filter(Boolean))];
    const allContracts = ['All', ...new Set(emps.map(e => e.contractName).filter(Boolean))].sort();

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
        const matchContract = filterContract === 'All' || e.contractName === filterContract;
        return matchSearch && matchActive && matchClient && matchLocation && matchDept && matchContract;
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
        const ex = ['ASIL/SPL-001/25', 'WafiBPO', 'LSC Security Services', 'Yes', 'Client Name Ltd', 'Trading & Supply', 'Security Services', 'Security Guard', 'Karachi', 'Sindh', 'Muhammad Ali', 'Father Name', 'Mother Name', '42101-1234567-1', '01-Jan-20', '01-Jan-30', 'Karachi', 'EOBI-001', 'Islam', '"38,000.00"', 'Married', '0300-1234567', '0311-9876543', 'email@example.com', 'Present Address', 'Permanent Address', '01-Jan-1990', '', '01-Jan-2024', '1.0', '"38,000.00"', 'Spouse Name', '30', 'XXXXX-XXXXXXX-X', 'Child 1', '5', 'B-Form', 'Child 2', '3', 'B-Form', 'Self & Family', 'Yes', '500000', 'HBL', '12345678901', 'Muhammad Ali', 'NOK Name', 'Father', '0300-0000000', 'SESSI-0001', 'M', '32', '42', '01-Jan-2024', '01-Jan-2024', '31-Dec-2025', 'Monthly', 'O+', 'Bachelors', 'None', '5', 'p@email.com', 'ABC-123', 'Yes', 'HR Manager'].join(',');
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
                // Build a fast contract lookup map: name (lc) → contract object
                const ctByName = {};
                const ctById   = {};
                contractsList.forEach(ct => {
                    ctByName[ct.contractName?.toLowerCase()?.trim()] = ct;
                    if (ct.id) ctById[ct.id] = ct;
                });
                const rows = lines.slice(1).map((line, i) => {
                    // Handle quoted fields with commas
                    const vals = []; let cur = '', inQ = false;
                    for (const ch of line) { if (ch === '"') { inQ = !inQ; } else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; } else { cur += ch; } } vals.push(cur.trim());
                    const obj = {};
                    hdrs.forEach((h, j) => { obj[h] = vals[j] || ''; });

                    // ── Contract resolution: match CSV 'Contract Name' to DB contract ──
                    const rawContract = getF(obj, 'Contract Name', 'Contract', 'ContractName', 'Contract Name');
                    let resolvedCt = null;
                    if (rawContract) {
                        // Try exact ID first, then name (case-insensitive)
                        resolvedCt = ctById[rawContract] || ctByName[rawContract.toLowerCase().trim()] || null;
                    }
                    const contractError = rawContract && !resolvedCt
                        ? `Contract "${rawContract}" not found in system`
                        : (!rawContract ? '⚠ No contract specified (will import without EOSB/invoice logic)' : null);

                    return {
                        id:          getF(obj, 'ASIL Employee Code', 'Employee Code', 'ID', 'EmpID') || `IMP-${i + 1}`,
                        bu:          getF(obj, 'ASIL BU', 'BU', 'Business Unit'),
                        // ── Contract ──
                        contractName: resolvedCt?.contractName || rawContract || '',
                        contractId:   resolvedCt?.id           || '',
                        _contractRaw:   rawContract,
                        _contractError: contractError,
                        _contractOk:    !!resolvedCt,
                        // ── Inherited from contract ──
                        _eosbType:    resolvedCt?.costs?.eosb_type          || 'None',
                        _svcChargePct:resolvedCt?.financials?.service_charges_pct || 0,
                        // ── Employment ──
                        active:       getF(obj, 'Active', 'Status') || 'Yes',
                        client:       resolvedCt?.clientName || getF(obj, 'CLIENT NAME', 'Client Name', 'Client'),
                        clientBU:     getF(obj, 'Client Business Unit', 'Client BU', 'ClientBU'),
                        dept:         getF(obj, 'Department', 'Dept'),
                        designation:  getF(obj, 'Designation', 'Position', 'Job Title'),
                        location:     getF(obj, 'Client Location', 'Location'),
                        site:         getF(obj, 'Site', 'Work Site', 'Site Name'),
                        province:     getF(obj, 'Province'),
                        name:         getF(obj, 'Employee Name', 'Name', 'Full Name'),
                        fatherName:   getF(obj, "Father's Name", 'Father Name', 'Fathers Name', 'Father'),
                        motherName:   getF(obj, "Mother's Name", 'Mother Name', 'Mothers Name', 'Mother'),
                        cnic:         getF(obj, 'CNIC Number', 'CNIC No', 'CNIC', 'NIC'),
                        cnicIssue:    getF(obj, 'CNIC Issue', 'CNIC Issue Date', 'Issue Date'),
                        cnicExpiry:   getF(obj, 'CNIC Expiry', 'CNIC Expiry Date', 'Expiry Date'),
                        placeOfBirth: getF(obj, 'Place of Birth', 'Birth Place', 'POB'),
                        eobiNo:       getF(obj, 'EOBI No', 'EOBI Number', 'EOBI'),
                        religion:     getF(obj, 'Religion') || '',
                        salary:       parseSalary(getF(obj, 'Salary', 'Basic Salary', 'Gross Salary')),
                        lastSalary:   parseSalary(getF(obj, 'Salary (Last/After Increment)', 'Last Salary', 'Salary After Increment') || getF(obj, 'Salary')),
                        maritalStatus:    getF(obj, 'Marital Status', 'Marital') || 'Single',
                        primaryContact:   getF(obj, 'Primary Contact', 'Phone', 'Mobile', 'Contact'),
                        emergencyContact: getF(obj, 'Emergency Contact', 'Emergency Phone'),
                        email:            getF(obj, 'Email Address', 'Email'),
                        presentAddress:   getF(obj, 'Present Address', 'Current Address', 'Address'),
                        permanentAddress: getF(obj, 'Permanent Address', 'Home Address'),
                        dob:              getF(obj, 'Date of Birth', 'DOB', 'Birth Date'),
                        doj:              getF(obj, 'Date of Joining', 'DOJ', 'Joining Date', 'Start Date'),
                        lastWorkingDay:   getF(obj, 'Last Working Day', 'LWD', 'Exit Date', 'Resignation Date', 'Last Day'),
                        spouseName:       getF(obj, 'Spouse Name', 'Spouse'),
                        spouseAge:        getF(obj, 'Spouse Age'),
                        spouseCnic:       getF(obj, 'Spouse CNIC', 'Spouse NIC', 'Spouse ID'),
                        child1Name:       getF(obj, 'Child 1 Name', 'Child1 Name', 'Child 1'),
                        child1Age:        getF(obj, 'Child 1 Age', 'Child1 Age'),
                        child1Id:         getF(obj, 'Child 1 CNIC/Bay Form', 'Child1 CNIC', 'Child 1 ID', 'Child1 ID'),
                        child2Name:       getF(obj, 'Child 2 Name', 'Child2 Name', 'Child 2'),
                        child2Age:        getF(obj, 'Child 2 Age', 'Child2 Age'),
                        child2Id:         getF(obj, 'Child 2 CNIC/Bay Form', 'Child2 CNIC', 'Child 2 ID', 'Child2 ID'),
                        medicalType:      getF(obj, 'Medical Coverage (Type)', 'Medical Type', 'Medical Coverage'),
                        medicalMaternity: getF(obj, 'Medical Coverage Maternity', 'Maternity'),
                        totalMedicalCoverage: getF(obj, 'Total Medical Coverage (Self & Family)', 'Total Medical Coverage', 'Medical Coverage Amount'),
                        bankName:    getF(obj, 'Bank Name', 'Bank'),
                        bankAccount: getF(obj, 'Bank Account', 'Bank Account No', 'Account Number', 'Account No'),
                        accountTitle:getF(obj, 'Account Title', 'Account Name'),
                        nokName:     getF(obj, 'NEXT OF KIN NAME', 'NOK Name', 'Next of Kin', 'NOK'),
                        nokRelation: getF(obj, 'NEXT OF KIN RELATION', 'NOK Relation', 'Next of Kin Relation'),
                        nokContact:  getF(obj, 'NEXT OF KIN CONTACT', 'NOK Contact', 'Next of Kin Contact'),
                        // ── Operational fields (2026-07-02) ────────────────────────────────────────────
                        sessiNo:             getF(obj, 'SESSI Number', 'SESSI No', 'SESSI'),
                        shirtSize:           getF(obj, 'Shirt Size'),
                        trouserSize:         getF(obj, 'Trouser Size'),
                        safetyShoeSizeVal:   getF(obj, 'Safety Shoe Size', 'Shoe Size'),
                        lastUniformIssueDate:getF(obj, 'Last Uniform Issue Date', 'Uniform Issue Date'),
                        lastPpeIssueDate:    getF(obj, 'Last PPE Issue Date', 'PPE Issue Date'),
                        gatePassExpiry:      getF(obj, 'Gate Pass Expiry', 'Gate Pass Expiry Date'),
                        payrollCycleType:    getF(obj, 'Payroll Cycle Type', 'Payroll Cycle') || 'Monthly',
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
    const [notifyNew, setNotifyNew] = useState(false);

    const importBulk = async () => {
        if (csvRows.some(r => r._contractError && !r._contractError.startsWith('⚠'))) {
            return alert('Cannot import: Some rows have invalid contracts. Please fix them first.');
        }
        setSaving(true);
        try {
            const data = await api.bulkImportEmployees(csvRows, notifyNew);
            // UPSERT behaviour — update existing, add new, avoid duplicates
            setEmps(p => {
                const map = new Map(p.map(e => [e.id, e]));
                data.employees.forEach(e => map.set(e.id, e));
                return Array.from(map.values());
            });
            setCsvRows([]); setShowAdd(false);
            if (fileRef.current) fileRef.current.value = '';
            const smsSentNote = data.smsSent?.length ? ` SMS sent to ${data.smsSent.length} new employee(s).` : '';
            setImportResult({ saved: data.saved, errors: data.errors || [], smsSentNote });
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

    const deleteEmployee = async (emp) => {
        if (!window.confirm(`Delete ${emp.name}?\nThis cannot be undone.`)) return;
        try {
            await api.deleteEmployee(emp.id);
            setEmps(p => p.filter(e => e.id !== emp.id));
        } catch (err) { alert('Delete failed: ' + err.message); }
    };


    // ── Bulk helpers ─────────────────────────────────────────────────────────
    const toggleSelect = (id) => setSelected(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });
    const toggleAll = () => {
        if (selected.size === filtered.length) setSelected(new Set());
        else setSelected(new Set(filtered.map(e => e.id)));
    };
    const clearSelection = () => setSelected(new Set());

    const exportSelectedCSV = () => {
        const rows = emps.filter(e => selected.has(e.id));
        const headers = ['Employee Code','Name','Client','Designation','Location','Province','Contract Name','Salary','Active','CNIC','Email','Primary Contact','Bank Name','Bank Account'];
        const lines = rows.map(e => [
            e.id, e.name, e.client, e.designation, e.location, e.province,
            e.contractName || e.bu || '',
            e.salary, e.active === 'Yes' ? 'Active' : 'Inactive', e.cnic,
            e.email, e.primaryContact, e.bankName, e.bankAccount
        ].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
        const csv = [headers.join(','), ...lines].join('\n');
        const a = document.createElement('a');
        a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
        a.download = `ASIL_Export_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
    };

    const bulkSetStatus = async (status) => {
        if (!window.confirm(`Set ${selected.size} employee(s) to ${status === 'Yes' ? 'Active' : 'Inactive'}?`)) return;
        for (const id of selected) {
            const emp = emps.find(e => e.id === id);
            if (emp) {
                try { await api.updateEmployee(id, { ...emp, active: status }); }
                catch (err) { console.error(`Failed to update ${id}:`, err.message); }
            }
        }
        setEmps(p => p.map(e => selected.has(e.id) ? { ...e, active: status } : e));
        clearSelection();
    };

    const sendBulkSMS = async () => {
        if (!bulkSmsMsg.trim()) return;
        setBulkSmsSending(true);
        const recipients = emps
            .filter(e => selected.has(e.id) && e.primaryContact)
            .map(e => ({ id: e.id, name: e.name, phone: e.primaryContact }));
        try {
            const res = await api.bulkSms(recipients, bulkSmsMsg);
            alert(`✅ Sent: ${res.sent}, Failed: ${res.failed}`);
            setShowBulkSMS(false);
            clearSelection();
        } catch (err) { alert('Error: ' + err.message); }
        setBulkSmsSending(false);
    };

    // F is called as a FUNCTION (not component) to avoid React treating it as a new
    // component type on each render (which caused focus/cursor loss after every keystroke).
    // FormField itself is safely defined at module level.
    const F = (props) => FormField({ ...props, form, setForm });


    // ── Pending change-request state ─────────────────────────────────────────────────────────────────
    const [mainView, setMainView] = useState('list'); // 'list' | 'requests'
    const [changeRequests, setChangeRequests] = useState([]);
    const [crLoading, setCrLoading] = useState(false);
    const [rejectNoteId, setRejectNoteId] = useState(null);
    const [rejectNote, setRejectNote] = useState('');

    const loadChangeRequests = async (status = 'Pending') => {
        setCrLoading(true);
        try {
            const data = await api.getChangeRequests(status);
            setChangeRequests(data.requests || []);
        } catch (_) {}
        setCrLoading(false);
    };

    const handleApprove = async (id) => {
        if (!window.confirm('Approve this change and apply it to the employee record?')) return;
        try {
            await api.approveChangeRequest(id);
            setChangeRequests(p => p.filter(r => r.id !== id));
        } catch (err) { alert('Error: ' + err.message); }
    };

    const handleReject = async (id) => {
        try {
            await api.rejectChangeRequest(id, rejectNote);
            setChangeRequests(p => p.filter(r => r.id !== id));
            setRejectNoteId(null); setRejectNote('');
        } catch (err) { alert('Error: ' + err.message); }
    };

    if (profile) return <EmployeeProfile employee={profile} user={user} onBack={() => setProfile(null)} onUpdate={updateEmployee} allEmployees={emps} />;

    // ── Pending Requests view ──────────────────────────────────────────────────────────────────
    if (mainView === 'requests') return (
        <div className="dashboard">
            <header className="header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button onClick={() => setMainView('list')} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>← Back to Roster</button>
                    <div>
                        <h1 style={{ margin: 0 }}>Employee Change Requests</h1>
                        <p style={{ margin: 0 }}>Submitted via Employee Self-Service Portal</p>
                    </div>
                </div>
            </header>
            <div style={{ padding: '1.5rem 0' }}>
                {/* Status filter */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem' }}>
                    {['Pending', 'Approved', 'Rejected', 'All'].map(s => (
                        <button key={s} onClick={() => loadChangeRequests(s)}
                            style={{ padding: '6px 18px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>{s}</button>
                    ))}
                    {crLoading && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', alignSelf: 'center' }}>Loading…</span>}
                </div>
                {/* Reject note modal */}
                {rejectNoteId && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
                        <div style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border)', padding: '1.5rem', width: '420px' }}>
                            <h3 style={{ margin: '0 0 1rem' }}>Reject Request</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 0.75rem' }}>Optional: provide a reason (will be sent to the employee via SMS).</p>
                            <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3}
                                placeholder="e.g. Incomplete documentation provided"
                                style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem', boxSizing: 'border-box', resize: 'vertical' }} />
                            <div style={{ display: 'flex', gap: '8px', marginTop: '1rem', justifyContent: 'flex-end' }}>
                                <button onClick={() => { setRejectNoteId(null); setRejectNote(''); }} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={() => handleReject(rejectNoteId)} style={{ background: '#ef4444', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Reject & Notify</button>
                            </div>
                        </div>
                    </div>
                )}
                {/* Table */}
                {changeRequests.length === 0 && !crLoading ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                        No change requests found.
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                            <thead>
                                <tr style={{ background: 'var(--bg-dark)' }}>
                                    {['Employee', 'Field', 'Current Value', 'Proposed Value', 'Submitted', 'Status', 'Actions'].map(h => (
                                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {changeRequests.map(cr => (
                                    <tr key={cr.id} style={{ borderTop: '1px solid var(--border)' }}>
                                        <td style={{ padding: '10px 14px' }}>
                                            <div style={{ fontWeight: 600 }}>{cr.employee_name}</div>
                                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{cr.employee_id}</div>
                                            {cr.designation && <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{cr.designation} · {cr.client}</div>}
                                        </td>
                                        <td style={{ padding: '10px 14px', color: '#a78bfa', fontWeight: 600 }}>{cr.field_label}</td>
                                        <td style={{ padding: '10px 14px', color: 'var(--text-muted)', maxWidth: '180px', wordBreak: 'break-all' }}>{cr.old_value || '—'}</td>
                                        <td style={{ padding: '10px 14px', maxWidth: '200px', wordBreak: 'break-all' }}><strong>{cr.new_value}</strong></td>
                                        <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{new Date(cr.submitted_at).toLocaleDateString('en-PK')}</td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <span style={{ padding: '2px 10px', borderRadius: '99px', fontSize: '0.78rem', fontWeight: 700,
                                                background: cr.status === 'Approved' ? 'rgba(34,197,94,0.15)' : cr.status === 'Rejected' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                                                color: cr.status === 'Approved' ? '#22c55e' : cr.status === 'Rejected' ? '#ef4444' : '#f59e0b' }}>
                                                {cr.status}
                                            </span>
                                            {cr.notes && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '3px' }}>Note: {cr.notes}</div>}
                                        </td>
                                        <td style={{ padding: '10px 14px' }}>
                                            {cr.status === 'Pending' && (
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    <button onClick={() => handleApprove(cr.id)}
                                                        style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid #22c55e40', color: '#22c55e', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>✓ Approve</button>
                                                    <button onClick={() => { setRejectNoteId(cr.id); setRejectNote(''); }}
                                                        style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid #ef444440', color: '#f87171', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>✗ Reject</button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="dashboard">
            <header className="header">
                <h1>Employee Information</h1>
                <p>Full master roster — Employment, Personal, Compliance, Salary, Family, Medical &amp; Banking.</p>
            </header>

            <EmployeeDirectoryToolbar onImported={() => loadEmployees()} />

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
                        {importResult.smsSentNote && (
                            <div style={{ padding: '0.6rem 2rem', background: 'rgba(56,189,248,0.08)', borderBottom: '1px solid var(--border)', color: '#38bdf8', fontSize: '0.85rem', fontWeight: 600 }}>
                                📱 {importResult.smsSentNote}
                            </div>
                        )}
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

            {/* ── Bulk Action Bar ── */}
            {selected.size > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '10px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: '#38bdf8', fontSize: '0.88rem' }}>{selected.size} selected</span>
                    <button onClick={clearSelection} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-muted)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>✕ Clear</button>
                    <div style={{ flex: 1 }} />
                    <button onClick={exportSelectedCSV}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e', color: '#22c55e', padding: '6px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                        ⬇ Export CSV
                    </button>
                    <button onClick={() => setShowBulkSMS(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(56,189,248,0.12)', border: '1px solid #38bdf8', color: '#38bdf8', padding: '6px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                        📱 Bulk SMS
                    </button>
                    <button onClick={() => bulkSetStatus('Yes')}
                        style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e', color: '#22c55e', padding: '6px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                        ✅ Activate
                    </button>
                    <button onClick={() => bulkSetStatus('No')}
                        style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid #eab308', color: '#eab308', padding: '6px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                        ⏸ Deactivate
                    </button>
                </div>
            )}

            {/* Bulk SMS Modal */}
            {showBulkSMS && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '2rem' }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '540px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                            <div>
                                <h3 style={{ margin: 0 }}>📱 Bulk SMS</h3>
                                <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sending to {emps.filter(e => selected.has(e.id) && e.primaryContact).length} of {selected.size} selected employees with phone numbers</p>
                            </div>
                            <button onClick={() => setShowBulkSMS(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                        </div>
                        <div style={{ padding: '1.5rem 2rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Message — use <code style={{ background: 'var(--bg-dark)', padding: '1px 5px', borderRadius: '3px' }}>{'{name}'}</code> for employee name (max 160 chars)</div>
                            <textarea
                                value={bulkSmsMsg}
                                onChange={e => setBulkSmsMsg(e.target.value.slice(0, 160))}
                                rows={4}
                                style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px', color: 'var(--text)', fontSize: '0.88rem', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                            />
                            <div style={{ fontSize: '0.75rem', color: bulkSmsMsg.length > 140 ? '#f59e0b' : 'var(--text-muted)', marginTop: '4px' }}>{bulkSmsMsg.length}/160</div>
                        </div>
                        <div style={{ padding: '0 2rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                            <button onClick={() => setShowBulkSMS(false)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                            <button onClick={sendBulkSMS} disabled={bulkSmsSending || !bulkSmsMsg.trim()}
                                style={{ background: '#38bdf8', border: 'none', color: '#000', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                                {bulkSmsSending ? 'Sending…' : `Send to ${emps.filter(e => selected.has(e.id) && e.primaryContact).length} employees`}
                            </button>
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
                {(user?.role === 'superadmin' || user?.role === 'operations' || user?.role === 'payroll_initiator') && (
                    <button onClick={() => { setMainView('requests'); loadChangeRequests('Pending'); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.4)', color: '#a78bfa', padding: '0.55rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        📋 Pending Requests
                    </button>
                )}
            </div>

            {/* Filter Row */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <Filter size={15} color="var(--text-muted)" />
                {[
                    { label: 'Client', val: filterClient, set: setFilterClient, opts: allClients },
                    { label: 'Location', val: filterLocation, set: setFilterLocation, opts: allLocations },
                    { label: 'Position', val: filterDept, set: setFilterDept, opts: allDepts },
                    { label: 'Contract', val: filterContract, set: setFilterContract, opts: allContracts },
                ].map(f => (
                    <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{f.label}:</span>
                        <select value={f.val} onChange={e => f.set(e.target.value)}
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 10px', color: 'var(--text)', fontSize: '0.82rem', outline: 'none', maxWidth: '200px' }}>
                            {f.opts.map(o => <option key={o}>{o}</option>)}
                        </select>
                    </div>
                ))}
                {(filterClient !== 'All' || filterLocation !== 'All' || filterDept !== 'All' || filterContract !== 'All') && (
                    <button onClick={() => { setFilterClient('All'); setFilterLocation('All'); setFilterDept('All'); setFilterContract('All'); }}
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
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', minWidth: '1100px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-dark)' }}>
                            <th style={{ padding: '0.9rem 0.75rem', width: '40px' }}>
                                <input type="checkbox"
                                    checked={filtered.length > 0 && selected.size === filtered.length}
                                    onChange={toggleAll}
                                    style={{ cursor: 'pointer', accentColor: '#38bdf8', width: '15px', height: '15px' }} />
                            </th>
                            {['Employee Code', 'Name', 'Client', 'Designation', 'Location', 'Province', 'Contract', 'Salary', 'Status', ''].map(h => (
                                <th key={h} style={{ padding: '0.9rem 1rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(emp => (
                            <tr key={emp.id}
                                onClick={() => setProfile(emp)}
                                style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s', background: selected.has(emp.id) ? 'rgba(56,189,248,0.05)' : 'transparent', cursor: 'pointer' }}
                                onMouseEnter={e => { if (!selected.has(emp.id)) e.currentTarget.style.background = 'var(--bg-dark)'; }}
                                onMouseLeave={e => { if (!selected.has(emp.id)) e.currentTarget.style.background = 'transparent'; }}>
                                <td style={{ padding: '0.85rem 0.75rem' }} onClick={e => e.stopPropagation()}>
                                    <input type="checkbox" checked={selected.has(emp.id)} onChange={() => toggleSelect(emp.id)}
                                        style={{ cursor: 'pointer', accentColor: '#38bdf8', width: '15px', height: '15px' }} />
                                </td>
                                <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{emp.id}</td>
                                <td style={{ padding: '0.85rem 1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg,var(--primary),#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '0.78rem', flexShrink: 0 }}>
                                            {(emp.name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('')}
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
                                <td style={{ padding: '0.85rem 1rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{emp.location}</td>
                                <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
                                    {emp.province
                                        ? <span style={{ background: 'rgba(56,189,248,0.1)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600 }}>{emp.province}</span>
                                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                </td>
                                <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                                    {emp.contractName
                                        ? <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{emp.contractName}</span>
                                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                </td>
                                <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
                                    <div style={{ fontWeight: 600 }}>Rs. {(emp.salary || 0).toLocaleString()}</div>
                                    {emp.lastSalary && emp.lastSalary !== emp.salary && <div style={{ color: '#22c55e', fontSize: '0.76rem' }}>↑ Rs. {emp.lastSalary.toLocaleString()}</div>}
                                </td>
                                <td style={{ padding: '0.85rem 1rem' }}>
                                    <span style={{ background: emp.active === 'Yes' ? 'rgba(34,197,94,0.15)' : 'rgba(234,179,8,0.15)', color: emp.active === 'Yes' ? '#22c55e' : '#eab308', padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600 }}>{emp.active === 'Yes' ? 'Active' : 'Inactive'}</span>
                                </td>
                                <td style={{ padding: '0.85rem 1rem' }} onClick={e => e.stopPropagation()}>
                                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                        <button onClick={() => setProfile(emp)} style={{ background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}>View Profile</button>
                                        {user?.role === 'superadmin' && (
                                            <button onClick={() => deleteEmployee(emp)} title="Delete employee" style={{ background: 'transparent', border: '1px solid #ef444460', color: '#ef4444', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem' }}>🗑</button>
                                        )}
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
                                    <F label="ASIL BU" field="bu" opts={{ ph: 'e.g. WafiBPO', list: [...new Set(emps.map(e => e.bu).filter(Boolean))].sort() }} />
                                    <div style={{ gridColumn: '1/-1' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Contract *</label>
                                            <select value={form.contractId || ''}
                                                onChange={e => {
                                                    const ct = contractsList.find(c => c.id === e.target.value);
                                                    setForm(p => ({ ...p,
                                                        contractId: ct?.id || '',
                                                        contractName: ct?.contractName || '',
                                                        client: ct?.clientName || p.client,
                                                        location: ct?.location || p.location,
                                                        province: ct?.province || p.province,
                                                    }));
                                                }}
                                                style={{ background: 'var(--bg-dark)', border: `1px solid ${form.contractId ? '#22c55e' : '#f59e0b'}`, borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none', width: '100%' }}>
                                                <option value="">⚠ -- Select Contract (Required) --</option>
                                                {contractsList.filter(ct => ct.status === 'Active' || !ct.status).map(ct => (
                                                    <option key={ct.id} value={ct.id}>
                                                        {ct.contractName} ({ct.clientName || ct.id})
                                                    </option>
                                                ))}
                                            </select>
                                            {form.contractId && <div style={{ fontSize: '0.75rem', color: '#22c55e', marginTop: '2px' }}>✓ ID: {form.contractId} · Client auto-filled: {form.client}</div>}
                                            {!form.contractId && <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '2px' }}>⚠ Without a contract, EOSB, service charge, and invoice calculations will be skipped in payroll.</div>}
                                        </div>
                                    </div>
                                    <F label="Client Name" field="client" opts={{ ph: 'Client organisation name' }} />
                                    <F label="Client Business Unit" field="clientBU" opts={{ ph: 'e.g. Trading & Supply', list: [...new Set(emps.map(e => e.clientBU).filter(Boolean))].sort() }} />
                                    <F label="Department" field="dept" opts={{ ph: 'e.g. Security Services', list: [...new Set(emps.map(e => e.dept).filter(Boolean))].sort() }} />
                                    <F label="Designation" field="designation" opts={{ ph: 'e.g. Security Guard', list: [...new Set(emps.map(e => e.designation).filter(Boolean))].sort() }} />
                                    <F label="Client Location" field="location" opts={{ ph: 'e.g. Karachi', list: [...new Set(emps.map(e => e.location).filter(Boolean))].sort() }} />
                                    <F label="Province" field="province" opts={{ sel: ['', 'Sindh', 'Punjab', 'KPK', 'Balochistan', 'Gilgit-Baltistan', 'AJK', 'Islamabad (ICT)'] }} />
                                    <F label="Date of Joining" field="doj" type="date" />
                                    <F label="Last Working Day" field="lastWorkingDay" type="date" opts={{ ph: 'Leave blank if still active' }} />
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
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 0.5rem' }}>This template matches the ASIL Employee Master format (49 columns). Column C is <strong style={{ color: '#38bdf8' }}>Contract Name</strong> — it must exactly match a contract name registered in the system.</p>
                                <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '0.65rem 1rem', fontSize: '0.82rem', color: '#f59e0b', marginBottom: '1rem' }}>
                                    ⚠ <strong>Contract Name is required.</strong> Rows with an unrecognised contract name will be blocked at import. Leave the column blank only if the employee has no contract (EOSB/invoice will not be calculated).
                                </div>
                                <button onClick={downloadTpl} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                                    <Download size={16} /> Download ASIL Master Template (v2 — Contract Column Included)
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

                            {csvRows.length > 0 && (() => {
                                    const hardErrors = csvRows.filter(r => r._contractError && !r._contractError.startsWith('⚠'));
                                    const warnOnly   = csvRows.filter(r => r._contractError?.startsWith('⚠'));
                                    return (
                                        <div style={{ background: 'var(--bg-dark)', borderRadius: '10px', padding: '1.5rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '8px' }}>
                                                <h3 style={{ margin: 0 }}>Step 3: Preview &amp; Import</h3>
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                    <span style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', padding: '4px 12px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600 }}>{csvRows.length} rows parsed</span>
                                                    {hardErrors.length > 0 && <span style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '4px 12px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600 }}>✗ {hardErrors.length} contract error(s) — BLOCKED</span>}
                                                    {warnOnly.length > 0 && <span style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '4px 12px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600 }}>⚠ {warnOnly.length} without contract</span>}
                                                </div>
                                            </div>
                                            {hardErrors.length > 0 && (
                                                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.82rem' }}>
                                                    <div style={{ fontWeight: 700, color: '#f87171', marginBottom: '6px' }}>✗ These rows have unrecognised contract names and cannot be imported:</div>
                                                    {hardErrors.map((r, i) => <div key={i} style={{ color: '#fca5a5', marginTop: '3px' }}>• Row {csvRows.indexOf(r)+2}: <strong>{r.name}</strong> — {r._contractError}</div>)}
                                                    <div style={{ color: 'var(--text-muted)', marginTop: '8px', fontSize: '0.78rem' }}>Fix the contract name (must exactly match a contract in the system) and re-upload.</div>
                                                </div>
                                            )}
                                            <div style={{ overflowX: 'auto', maxHeight: '260px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                                    <thead>
                                                        <tr style={{ background: 'var(--bg-card)' }}>
                                                            {['Code', 'Name', 'Contract / EOSB', 'Client', 'Province', 'Salary', 'Active'].map(h => (
                                                                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--bg-card)', whiteSpace: 'nowrap' }}>{h}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {csvRows.map((r, i) => (
                                                            <tr key={i} style={{ borderTop: '1px solid var(--border)', background: (r._contractError && !r._contractError.startsWith('⚠')) ? 'rgba(239,68,68,0.06)' : 'transparent' }}>
                                                                <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.78rem' }}>{r.id}</td>
                                                                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.name}</td>
                                                                <td style={{ padding: '8px 12px', minWidth: '200px' }}>
                                                                    {r._contractOk
                                                                        ? <div>
                                                                            <span style={{ color: '#22c55e', fontWeight: 600, fontSize: '0.8rem' }}>✓ {r.contractName}</span>
                                                                            {r._eosbType !== 'None' && <span style={{ marginLeft: '6px', background: 'rgba(167,139,250,0.15)', color: '#a78bfa', padding: '1px 6px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600 }}>{r._eosbType}</span>}
                                                                          </div>
                                                                        : r._contractRaw
                                                                            ? <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>✗ '{r._contractRaw}' — not found</span>
                                                                            : <span style={{ color: '#f59e0b', fontSize: '0.8rem' }}>⚠ None (no EOSB)</span>
                                                                    }
                                                                </td>
                                                                <td style={{ padding: '8px 12px' }}>{r.client}</td>
                                                                <td style={{ padding: '8px 12px' }}>
                                                                    {r.province ? <span style={{ background: 'rgba(56,189,248,0.1)', color: '#38bdf8', padding: '2px 7px', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 600 }}>{r.province}</span> : '—'}
                                                                </td>
                                                                <td style={{ padding: '8px 12px' }}>Rs. {(r.salary || 0).toLocaleString()}</td>
                                                                <td style={{ padding: '8px 12px' }}><span style={{ color: r.active === 'Yes' ? '#22c55e' : '#eab308' }}>{r.active}</span></td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                                                {user?.role === 'superadmin' && (
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                    <input type="checkbox" checked={notifyNew} onChange={e => setNotifyNew(e.target.checked)}
                                                        style={{ width: '16px', height: '16px', accentColor: '#38bdf8', cursor: 'pointer' }} />
                                                    Send welcome SMS to newly added employees
                                                </label>
                                                )}
                                                <button
                                                    onClick={importBulk}
                                                    disabled={saving || hardErrors.length > 0}
                                                    title={hardErrors.length > 0 ? 'Fix contract errors above before importing' : ''}
                                                    style={{ background: hardErrors.length > 0 ? '#374151' : '#22c55e', border: '1px solid', borderColor: hardErrors.length > 0 ? '#ef444455' : '#22c55e', color: hardErrors.length > 0 ? '#9ca3af' : 'white', padding: '0.75rem 2rem', borderRadius: '8px', cursor: hardErrors.length > 0 ? 'not-allowed' : 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: hardErrors.length > 0 ? 0.6 : 1 }}>
                                                    <CheckCircle size={18} /> {hardErrors.length > 0 ? `Blocked — Fix ${hardErrors.length} Contract Error(s)` : `Import ${csvRows.length} Employees`}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                        </div>
                    )}
                </Overlay>
            )}
        </div>
    );
}
