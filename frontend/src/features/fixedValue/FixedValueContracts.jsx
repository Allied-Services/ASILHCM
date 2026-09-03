import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    MapPin, Upload, CloudDownload, Calculator, FileText, Shield,
    Mail, Database, RefreshCw, AlertCircle, CheckCircle, Download,
    ExternalLink, Layers, Play, Plus, Pencil, ClipboardCheck, Trash2,
} from 'lucide-react';
import { api } from '../../api';
import FixedValueContractWizard from './FixedValueContractWizard';
import { parseAdjustmentAmount, amountLooksNegative } from './parseAdjustmentAmount';
import './FixedValueOps.css';

const ALL_SITES = '__ALL__';
const fmt = (n) => (n == null || Number.isNaN(n)) ? '-' : Math.round(Number(n)).toLocaleString();
const pct = (n) => (n == null || Number.isNaN(n)) ? '-' : `${(Number(n) * 100).toFixed(0)}%`;

function rowSiteCode(r) {
    return String(r.site || r.site_code || '').trim().toUpperCase();
}

function soLines(order) {
    let lines = order?.lines;
    if (typeof lines === 'string') {
        try { lines = JSON.parse(lines); } catch { lines = []; }
    }
    return Array.isArray(lines) ? lines : [];
}

function lineItemLabel(l, idx) {
    const num = l.line_number || l.lineNumber || (idx + 1);
    const name = l.name || l.description || `Line ${num}`;
    const rate = Number(l.rate);
    const rateBit = Number.isFinite(rate) && rate !== 0
        ? ` - Rs. ${Math.round(rate).toLocaleString()}`
        : '';
    return `${num}. ${name}${rateBit}`;
}

/** Sheet/override absent is authoritative; never invent from WD - present when known. */
function presentDays(r) {
    const p = r.inputs?.present_days ?? r.inputs?.presentDays ?? r.paid_days;
    return p == null || p === '' ? null : Number(p);
}
function absentDays(r) {
    const explicit = r.inputs?.absent_days ?? r.inputs?.absentDays;
    if (explicit != null && explicit !== '') return Math.max(0, Number(explicit) || 0);
    if (r.computed?.modelA?.absentSource === 'explicit' && r.computed?.modelA?.absentDays != null) {
        return Math.max(0, Number(r.computed.modelA.absentDays) || 0);
    }
    return null;
}

/** Employee take-home fields - prefer computed, fall back to inputs for pre-patch rows. */
function rowArrears(r) {
    const c = r.computed || {};
    const v = c.arrears ?? r.inputs?.arrears ?? r.inputs?.Arrears;
    return Number(v || 0);
}
function rowDeductions(r) {
    const c = r.computed || {};
    if (c.otherDeductionTotal != null) return Number(c.otherDeductionTotal) || 0;
    const other = Number(c.otherDeduction ?? r.inputs?.otherDeduction ?? r.inputs?.other_deduction ?? 0);
    const leave = Number(c.leaveDeduction ?? r.inputs?.leaveDeduction ?? r.inputs?.leave_deduction ?? 0);
    return other + leave;
}
function rowBonus(r) {
    return Number((r.computed || {}).bonusDisbursed || 0);
}
function rowOt(r) {
    return Number((r.computed || {}).overtimeAmount || 0);
}

const IS_STAGING = /staging/i.test(import.meta.env.VITE_API_URL || '')
    || (typeof window !== 'undefined' && /staging/i.test(window.location.hostname));
const COLD_START_MSG = 'Staging server waking up (Render free tier) - usually 1-2 minutes...';

const STEPS = [
    { key: 'period', label: 'Period & Contract', icon: Layers },
    { key: 'attendance', label: 'Attendance', icon: Upload },
    { key: 'billable', label: 'Confirm billable services', icon: ClipboardCheck },
    { key: 'payroll', label: 'Payroll', icon: Calculator },
    { key: 'invoice', label: 'Invoice', icon: FileText },
    { key: 'compliance', label: 'Statutory', icon: Shield },
    { key: 'export', label: 'Export & Push', icon: Download },
];

const PRINT_FORMATS = [
    { key: 'invoice', label: 'Proforma' },
    { key: 'invoice_letterhead', label: 'Proforma (LH)' },
    { key: 'sales_tax', label: 'Sales Tax' },
    { key: 'sales_tax_letterhead', label: 'Sales Tax (LH)' },
];

export default function FixedValueContracts({ user }) {
    const now = new Date();
    const [month, setMonth] = useState(7);
    const [year, setYear] = useState(2026);
    const [contracts, setContracts] = useState([]);
    const [contractId, setContractId] = useState('');
    const [orders, setOrders] = useState([]);
    const [siteCode, setSiteCode] = useState(ALL_SITES);
    const [step, setStep] = useState('period');
    const [loading, setLoading] = useState(false);
    const [slowLoad, setSlowLoad] = useState(false);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    const [attStatus, setAttStatus] = useState([]);
    const [attProgress, setAttProgress] = useState(null);
    const [bulkAttResults, setBulkAttResults] = useState([]);
    const [parsedRows, setParsedRows] = useState([]);
    const [deductions, setDeductions] = useState([]);
    const [hubOverrides, setHubOverrides] = useState([]);
    const [hubEdits, setHubEdits] = useState({});
    const [hubSaving, setHubSaving] = useState(null);

    const [payrollRun, setPayrollRun] = useState(null);
    const [payrollRows, setPayrollRows] = useState([]);
    const [payrollWarnings, setPayrollWarnings] = useState([]);

    const [invoicePack, setInvoicePack] = useState(null);
    const [billablePack, setBillablePack] = useState(null);
    const [billableEdits, setBillableEdits] = useState({}); // { [soId]: { [lineId]: boolean } }
    const [registry, setRegistry] = useState([]);
    const [registryNumberEdits, setRegistryNumberEdits] = useState({}); // { [invoiceId]: string }
    const [registryNumberSaving, setRegistryNumberSaving] = useState(null);
    const [emailResult, setEmailResult] = useState(null);
    const [wizard, setWizard] = useState(null); // { mode: 'create'|'edit', contractId? }
    const [adjNote, setAdjNote] = useState('');
    const [adjAmount, setAdjAmount] = useState('');
    const [adjSign, setAdjSign] = useState('deduct');
    const [adjLineId, setAdjLineId] = useState('');

    const canWrite = ['superadmin', 'operations', 'finance_manager', 'finance_approver', 'ar_team', 'payroll_initiator', 'payroll']
        .includes(user?.role);
    const canEditContract = ['superadmin', 'operations'].includes(user?.role);

    const selectedOrder = useMemo(
        () => orders.find(o => o.site_code === siteCode) || null,
        [orders, siteCode]
    );

    const adjLines = useMemo(() => soLines(selectedOrder), [selectedOrder]);

    const manualAdjustments = useMemo(
        () => (deductions || []).filter((d) => String(d.source || '') === 'manual'),
        [deductions]
    );

    const filteredPayrollRows = useMemo(() => {
        if (!siteCode || siteCode === ALL_SITES) return payrollRows;
        const want = String(siteCode).trim().toUpperCase();
        const order = orders.find(o => o.site_code === siteCode);
        const nameNeedle = String(order?.name || '').toLowerCase();
        const bySite = payrollRows.filter(r => rowSiteCode(r) === want);
        if (bySite.length) return bySite;
        if (nameNeedle) {
            return payrollRows.filter(r => {
                const loc = String(r.location || '').toLowerCase();
                return loc.includes(nameNeedle) || loc.includes(want.toLowerCase());
            });
        }
        return bySite;
    }, [payrollRows, siteCode, orders]);

    const payrollBySite = useMemo(() => {
        const map = new Map();
        for (const r of payrollRows) {
            const site = rowSiteCode(r) || 'UNKNOWN';
            if (!map.has(site)) {
                map.set(site, {
                    site, headcount: 0, present: 0, absent: 0, wages: 0, arrears: 0, deductions: 0,
                    bonus: 0, ot: 0, eobi: 0, tax: 0, net: 0,
                    sessi: 0, life: 0, gross: 0,
                });
            }
            const s = map.get(site);
            const c = r.computed || {};
            s.headcount += 1;
            const p = presentDays(r);
            const a = absentDays(r);
            if (p != null) s.present += p;
            if (a != null) s.absent += a;
            s.wages += Number(c.salaryForDays || 0);
            s.arrears += rowArrears(r);
            s.deductions += rowDeductions(r);
            s.bonus += rowBonus(r);
            s.ot += rowOt(r);
            s.eobi += Number(c.eobiEmployee || 0);
            s.tax += Number(c.wht || 0);
            s.net += Number(c.netPay || 0);
            // Employer costs - for Statutory step only
            s.sessi += Number(c.sessiEmployer || 0);
            s.life += Number(c.lifeInsurance || 0);
            s.gross += Number(c.gross || 0);
        }
        return [...map.values()].sort((a, b) => a.site.localeCompare(b.site));
    }, [payrollRows]);

    const emptyTotals = {
        headcount: 0, present: 0, absent: 0, wages: 0, arrears: 0, deductions: 0, bonus: 0, ot: 0,
        eobi: 0, tax: 0, net: 0, sessi: 0, life: 0, gross: 0,
    };
    const payrollTotals = useMemo(() => payrollBySite.reduce((a, s) => ({
        headcount: a.headcount + s.headcount,
        present: a.present + s.present,
        absent: a.absent + s.absent,
        wages: a.wages + s.wages,
        arrears: a.arrears + s.arrears,
        deductions: a.deductions + s.deductions,
        bonus: a.bonus + s.bonus,
        ot: a.ot + s.ot,
        eobi: a.eobi + s.eobi,
        tax: a.tax + s.tax,
        net: a.net + s.net,
        sessi: a.sessi + s.sessi,
        life: a.life + s.life,
        gross: a.gross + s.gross,
    }), emptyTotals), [payrollBySite]);

    const attDoneCount = attStatus.filter(s => s.status === 'done').length;
    const billableReviewedCount = billablePack?.reviewedCount || 0;
    const billableSiteCount = billablePack?.siteCount || orders.length;
    const stepStatus = useMemo(() => ({
        period: contractId ? 'done' : 'not_started',
        attendance: attDoneCount === 0 ? 'not_started' : (attDoneCount >= orders.length && orders.length ? 'done' : 'ready'),
        billable: billablePack?.allReviewed
            ? 'done'
            : (attDoneCount || contractId ? 'ready' : 'not_started'),
        payroll: payrollRows.length ? 'done' : (attDoneCount ? 'ready' : 'not_started'),
        invoice: invoicePack?.sites?.length
            ? 'done'
            : (billablePack?.allReviewed ? 'ready' : 'not_started'),
        compliance: payrollRows.length ? 'ready' : 'not_started',
        export: (payrollRows.length || invoicePack?.sites?.length) ? 'ready' : 'not_started',
    }), [contractId, attDoneCount, orders.length, payrollRows.length, invoicePack, billablePack]);

    const loadContracts = useCallback(async () => {
        const rows = await api.getFixedValueContracts();
        setContracts(Array.isArray(rows) ? rows : []);
        if (!contractId && rows?.length) setContractId(rows[0].id);
    }, [contractId]);

    const loadOrders = useCallback(async () => {
        if (!contractId) return;
        const rows = await api.getFixedValueServiceOrders(contractId);
        setOrders(Array.isArray(rows) ? rows : []);
    }, [contractId]);

    const loadAttStatus = useCallback(async () => {
        if (!contractId) return;
        const rows = await api.getFixedValueAttendanceStatus(contractId, month, year);
        setAttStatus(Array.isArray(rows) ? rows : []);
    }, [contractId, month, year]);

    const loadPayrollRun = useCallback(async () => {
        if (!contractId) {
            setPayrollRun(null);
            setPayrollRows([]);
            return;
        }
        const data = await api.getPayrollRuns(contractId, month, year);
        setPayrollRun(data.run || null);
        setPayrollRows(Array.isArray(data.rows) ? data.rows : []);
    }, [contractId, month, year]);

    const loadRegistry = useCallback(async () => {
        if (!contractId) return;
        const siteArg = siteCode && siteCode !== ALL_SITES ? siteCode : undefined;
        const rows = await api.getFixedValueRegistry(contractId, month, year, siteArg);
        setRegistry(Array.isArray(rows) ? rows : []);
    }, [contractId, month, year, siteCode]);

    const loadDeductions = useCallback(async () => {
        if (!selectedOrder?.id) { setDeductions([]); return; }
        const rows = await api.getFixedValueDeductions(selectedOrder.id, month, year);
        setDeductions(Array.isArray(rows) ? rows : []);
    }, [selectedOrder?.id, month, year]);

    const loadBillableConfirmations = useCallback(async () => {
        if (!contractId) {
            setBillablePack(null);
            setBillableEdits({});
            return;
        }
        const pack = await api.getFixedValueBillableConfirmations(contractId, month, year);
        setBillablePack(pack);
        const edits = {};
        for (const site of pack?.sites || []) {
            edits[site.serviceOrderId] = {};
            for (const line of site.lines || []) {
                edits[site.serviceOrderId][line.lineId] = !!line.billable;
            }
        }
        setBillableEdits(edits);
    }, [contractId, month, year]);

    const loadHubOverrides = useCallback(async () => {
        if (!contractId || step !== 'attendance') {
            setHubOverrides([]);
            return;
        }
        const contract = contracts.find(c => c.id === contractId);
        const q = {
            month, year,
            ...(contract?.contract_name ? { contract: contract.contract_name } : {}),
            ...(selectedOrder?.name ? { location: selectedOrder.name } : {}),
        };
        try {
            const data = await api.getMonthlyHubList(q);
            setHubOverrides(Array.isArray(data?.employees) ? data.employees : []);
            setHubEdits({});
        } catch {
            setHubOverrides([]);
        }
    }, [contractId, contracts, month, year, selectedOrder?.name, step]);

    const saveHubRow = async (r) => {
        const edit = hubEdits[r.employee_id] || {};
        // Empty / cleared money fields must send 0 (not omit) so prior deductions are wiped.
        const numOr0 = (editVal, fallback) => {
            const v = editVal !== undefined ? editVal : fallback;
            if (v === '' || v == null) return 0;
            return Number(v) || 0;
        };
        const payload = {
            employeeId: r.employee_id,
            month,
            year,
            presentDays: edit.present !== undefined && edit.present !== ''
                ? Number(edit.present)
                : (r.present != null ? Number(r.present) : undefined),
            ot2Hours: numOr0(edit.ot2, r.ot2_hours),
            leaveDeduction: numOr0(edit.leaveDeduction, r.leave_deduction),
            arrears: numOr0(edit.arrears, r.arrears),
            otherDeduction: numOr0(edit.otherDeduction, r.other_deduction),
        };
        setHubSaving(r.employee_id);
        try {
            const saved = await api.saveMonthlyHubOverride(payload);
            const synced = saved?.payrollSync?.recomputed;
            setMsg(synced
                ? `Saved overrides for ${r.name || r.employee_id} and refreshed draft payroll run #${saved.payrollSync.runId}.`
                : `Saved overrides for ${r.name || r.employee_id}. ${saved?.payrollSync?.reason === 'RUN_LOCKED' ? 'Payroll run is locked - unlock/recompute manually.' : 'Open Payroll and recompute if figures look stale.'}`);
            await loadHubOverrides();
            if (synced) await loadPayrollRun().catch(() => {});
        } catch (e) {
            setError(e.message || 'Override save failed');
        } finally {
            setHubSaving(null);
        }
    };

    useEffect(() => { loadContracts().catch(e => setError(e.message)); }, [loadContracts]);
    useEffect(() => { loadOrders().catch(() => {}); }, [loadOrders]);
    useEffect(() => { loadAttStatus().catch(() => {}); }, [loadAttStatus]);
    useEffect(() => {
        if (step === 'payroll' || step === 'compliance' || step === 'export') {
            loadPayrollRun().catch(() => {});
        }
    }, [step, loadPayrollRun]);
    useEffect(() => {
        if (step === 'invoice' || step === 'export') loadRegistry().catch(() => {});
    }, [step, loadRegistry]);
    useEffect(() => {
        if (step === 'billable' || step === 'invoice') {
            loadBillableConfirmations().catch((e) => setError(e.message || 'Failed to load billable confirmations'));
        }
    }, [step, loadBillableConfirmations]);
    useEffect(() => { loadDeductions().catch(() => {}); }, [loadDeductions]);
    useEffect(() => {
        if (adjLines.length === 1) setAdjLineId(String(adjLines[0].id));
        else setAdjLineId('');
    }, [selectedOrder?.id, adjLines.length]);
    useEffect(() => { loadHubOverrides().catch(() => {}); }, [loadHubOverrides]);
    useEffect(() => {
        if (!loading) { setSlowLoad(false); return undefined; }
        const t = setTimeout(() => setSlowLoad(true), 4000);
        return () => clearTimeout(t);
    }, [loading]);

    const runAction = async (fn, okMsg) => {
        setError('');
        setMsg('');
        setLoading(true);
        try {
            await fn();
            if (okMsg) setMsg(okMsg);
        } catch (e) {
            setError(e.message || 'Request failed');
        } finally {
            setLoading(false);
        }
    };

    /** Progressive bulk: Drive-pull + apply each site with live progress. */
    const handleBulkAttendance = () => runAction(async () => {
        if (!orders.length) throw new Error('No service orders for this contract');
        const results = [];
        setAttProgress({ done: 0, total: orders.length, current: '' });
        for (let i = 0; i < orders.length; i++) {
            const so = orders[i];
            setAttProgress({ done: i, total: orders.length, current: so.site_code });
            try {
                const pulled = await api.pullFixedValueDriveAttendance(so.id, month, year);
                if (!pulled.ok) {
                    results.push({
                        siteCode: so.site_code, ok: false, pullOk: false,
                        code: pulled.code, fileName: pulled.fileName, overrides: 0, deductions: 0,
                    });
                    continue;
                }
                const summary = await api.applyFixedValueAttendance(so.id, month, year, pulled.parse?.rows || []);
                results.push({
                    siteCode: so.site_code, ok: true, pullOk: true,
                    fileName: pulled.fileName,
                    overrides: summary.overrides || 0,
                    deductions: summary.deductions || 0,
                    skipped: summary.skipped?.length || 0,
                    errors: summary.errors?.length || 0,
                });
            } catch (e) {
                results.push({ siteCode: so.site_code, ok: false, message: e.message });
            }
        }
        setAttProgress({ done: orders.length, total: orders.length, current: '' });
        setBulkAttResults(results);
        await loadAttStatus();
        const okN = results.filter(r => r.ok).length;
        setMsg(`Attendance applied for ${okN}/${orders.length} sites`);
    });

    const handleComputePayroll = () => runAction(async () => {
        const result = await api.computePayrollRun(contractId, month, year);
        if (result.ok === false) {
            setMsg(result.message || result.code || 'Compute failed');
            return;
        }
        setPayrollRun(result.run || null);
        setPayrollRows(Array.isArray(result.rows) ? result.rows : []);
        setPayrollWarnings(Array.isArray(result.warnings) ? result.warnings : []);
        await loadPayrollRun().catch(() => {});
        setMsg(`Payroll computed - ${result.headcount ?? result.rows?.length ?? 0} employees (all sites)`);
        setStep('payroll');
    });

    const handleComputeInvoicesAll = () => runAction(async () => {
        const pack = await api.computeFixedValueInvoicesAll(contractId, month, year);
        setInvoicePack(pack);
        setMsg(`Invoice preview for ${pack.sites?.length || 0} sites`);
        setStep('invoice');
    });

    const handlePersistInvoicesAll = () => runAction(async () => {
        const result = await api.persistFixedValueInvoicesAll(contractId, month, year);
        const pack = await api.computeFixedValueInvoicesAll(contractId, month, year);
        setInvoicePack(pack);
        await loadRegistry();
        setMsg(`Stamped / regenerated ${result.count} site invoices (Draft/Raised/Sent lines refreshed; invoice # preserved)`);
    });

    const handleAddInvoiceAdjustment = () => runAction(async () => {
        if (!selectedOrder?.id || siteCode === ALL_SITES) {
            throw new Error('Select a single site before adding an adjustment');
        }
        const note = String(adjNote || '').trim();
        if (!note) throw new Error('Comment is required - it prints on the invoice');
        if (!adjLineId) throw new Error('Select a line item for this location');
        const parsed = parseAdjustmentAmount(adjAmount, adjSign);
        if (parsed.error) throw new Error(parsed.error);
        await api.addFixedValueDeduction(selectedOrder.id, {
            period_month: month,
            period_year: year,
            type: 'adjustment',
            amount: parsed.amount,
            effect: parsed.amount < 0 ? 'deduct' : 'add',
            line_id: Number(adjLineId),
            note,
        });
        setAdjNote('');
        setAdjAmount('');
        if (adjLines.length !== 1) setAdjLineId('');
        await loadDeductions();
        if (billablePack?.allReviewed) {
            const preview = await api.computeFixedValueInvoice(selectedOrder.id, month, year);
            setInvoicePack({
                sites: [preview],
                totals: {
                    sites: 1,
                    gross: preview.gross,
                    shortage: preview.totalShortages ?? preview.totalDeductions,
                    adjustments: preview.totalAdjustments,
                    netTaxable: preview.netTaxable,
                    salesTax: preview.provincialSt,
                    grandTotal: preview.grandTotal,
                    netReceivable: preview.netReceivable,
                },
            });
        }
        setMsg('Adjustment saved. Print now includes it in Net Taxable; Stamp to persist AR totals.');
    });

    const handleDeleteInvoiceAdjustment = (deductionId) => runAction(async () => {
        if (!selectedOrder?.id) throw new Error('Select a site first');
        if (!window.confirm('Remove this invoice adjustment?')) return;
        await api.deleteFixedValueDeduction(selectedOrder.id, deductionId);
        await loadDeductions();
        if (selectedOrder?.id && billablePack?.allReviewed) {
            const preview = await api.computeFixedValueInvoice(selectedOrder.id, month, year);
            setInvoicePack({
                sites: [preview],
                totals: {
                    sites: 1,
                    gross: preview.gross,
                    shortage: preview.totalShortages ?? preview.totalDeductions,
                    adjustments: preview.totalAdjustments,
                    netTaxable: preview.netTaxable,
                    salesTax: preview.provincialSt,
                    grandTotal: preview.grandTotal,
                    netReceivable: preview.netReceivable,
                },
            });
        }
        setMsg('Adjustment removed. Print now reflects the change; Stamp to persist AR totals.');
    });

    const saveRegistryInvoiceNumber = (inv) => runAction(async () => {
        const next = String(registryNumberEdits[inv.id] ?? inv.invoice_number ?? '').trim();
        if (!next) throw new Error('Invoice number cannot be empty');
        if (next === inv.invoice_number) {
            setMsg('Invoice number unchanged');
            return;
        }
        setRegistryNumberSaving(inv.id);
        try {
            const result = await api.updateFixedValueInvoiceNumber(inv.id, next);
            setRegistry((prev) => prev.map((r) => (
                r.id === inv.id
                    ? { ...r, invoice_number: result.invoice?.invoice_number || next }
                    : r
            )));
            setRegistryNumberEdits((prev) => {
                const copy = { ...prev };
                delete copy[inv.id];
                return copy;
            });
            setMsg(`Invoice number saved - prints will show ${result.invoice?.invoice_number || next}`);
        } finally {
            setRegistryNumberSaving(null);
        }
    });

    const toggleBillableLine = (soId, lineId, checked) => {
        setBillableEdits((prev) => ({
            ...prev,
            [soId]: { ...(prev[soId] || {}), [lineId]: checked },
        }));
    };

    const handleSaveSiteBillable = (site, { confirmAll = false } = {}) => runAction(async () => {
        if (confirmAll) {
            await api.confirmAllFixedValueBillable(site.serviceOrderId, month, year);
        } else {
            const edits = billableEdits[site.serviceOrderId] || {};
            const lines = (site.lines || []).map((l) => ({
                lineId: l.lineId,
                billable: edits[l.lineId] !== undefined ? !!edits[l.lineId] : !!l.billable,
            }));
            await api.saveFixedValueBillableConfirmations(site.serviceOrderId, month, year, lines);
        }
        await loadBillableConfirmations();
        setMsg(confirmAll
            ? `Confirmed all billable services for ${site.siteCode}`
            : `Saved billable confirmations for ${site.siteCode}`);
    });

    const handleSaveAllBillable = ({ confirmAll = false } = {}) => runAction(async () => {
        if (confirmAll) {
            await api.confirmAllFixedValueBillableContract(contractId, month, year);
        } else {
            const sites = (billablePack?.sites || []).map((site) => {
                const edits = billableEdits[site.serviceOrderId] || {};
                return {
                    serviceOrderId: site.serviceOrderId,
                    lines: (site.lines || []).map((l) => ({
                        lineId: l.lineId,
                        billable: edits[l.lineId] !== undefined ? !!edits[l.lineId] : !!l.billable,
                    })),
                };
            });
            await api.saveFixedValueBillableConfirmationsAll(contractId, month, year, { sites });
        }
        await loadBillableConfirmations();
        setMsg(confirmAll
            ? 'Confirmed all billable services for every site this period'
            : 'Saved billable confirmations for every site this period');
    });

    const handleDryRunVerificationEmail = () => runAction(async () => {
        const result = await api.sendFixedValueVerificationEmails(contractId, month, year, { dryRun: true });
        setEmailResult(result);
        if (result.sent) {
            setMsg(`Dry run sent - ${result.sent} site email${result.sent === 1 ? '' : 's'} to internal team (proforma + payroll PDF each)`);
        } else {
            const detail = result.results?.[0];
            const why = result.message
                || (detail?.reason ? `Not sent: ${detail.reason}` : null)
                || 'Dry run completed - no emails sent';
            setMsg(why);
        }
    });

    const handleSendAllVerificationEmails = () => runAction(async () => {
        if (!window.confirm('Send payroll & invoice verification email to every terminal with focal emails configured?')) return;
        const result = await api.sendFixedValueVerificationEmails(contractId, month, year, { dryRun: false });
        setEmailResult(result);
        setMsg(`Verification emails sent: ${result.sent} | skipped ${result.skipped} | failed ${result.failed || 0}`);
    });

    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !selectedOrder) return;
        await runAction(async () => {
            const parsed = await api.uploadFixedValueAttendance(selectedOrder.id, month, year, file);
            if (!parsed.ok) throw new Error(parsed.error || 'Parse failed');
            setParsedRows(parsed.rows || []);
            setMsg(`Parsed ${parsed.rows?.length || 0} rows from ${parsed.sheetName}`);
        });
        e.target.value = '';
    };

    const handleApplySite = () => runAction(async () => {
        const summary = await api.applyFixedValueAttendance(selectedOrder.id, month, year, parsedRows);
        setMsg(`Applied ${summary.overrides} overrides, ${summary.deductions} deductions`);
        await loadDeductions();
        await loadAttStatus();
    });

    const downloadBlob = async (promise, fallbackName) => {
        setLoading(true);
        setError('');
        try {
            await promise;
            setMsg(`Downloaded ${fallbackName}`);
        } catch (e) {
            setError(e.message || 'Download failed');
        } finally {
            setLoading(false);
        }
    };

    const chipClass = (st) => (st === 'done' ? 'done' : st === 'ready' ? 'ready' : loading && stepStatus[step] === st ? 'busy' : '');

    return (
        <div className="fv-ops">
            <div className="fv-ops-header">
                <div>
                    <h2>Fixed Value / Conservancy</h2>
                    <p>Stepped monthly ops - attendance -> confirm billable services -> payroll -> invoices -> exports.</p>
                </div>
                <div className="fv-ops-period">
                    <select value={contractId} onChange={e => setContractId(e.target.value)}>
                        {contracts.map(c => <option key={c.id} value={c.id}>{c.contract_name || c.id}</option>)}
                    </select>
                    <select value={month} onChange={e => setMonth(Number(e.target.value))}>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                            <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('en', { month: 'long' })}</option>
                        ))}
                    </select>
                    <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 90 }} />
                    <div className="fv-site-bar">
                        <MapPin size={14} />
                        <select value={siteCode} onChange={e => setSiteCode(e.target.value)}>
                            <option value={ALL_SITES}>All sites (contract rollup)</option>
                            {orders.map(o => <option key={o.id} value={o.site_code}>{o.name} ({o.site_code})</option>)}
                        </select>
                    </div>
                </div>
            </div>

            <div className="fv-stepper">
                {STEPS.map((s, idx) => {
                    const Icon = s.icon;
                    const st = stepStatus[s.key];
                    return (
                        <button
                            key={s.key}
                            type="button"
                            className={`fv-step${step === s.key ? ' active' : ''}`}
                            onClick={() => setStep(s.key)}
                        >
                            <span className="fv-step-no">Step {idx + 1}</span>
                            <span className="fv-step-title"><Icon size={14} style={{ marginRight: 4, verticalAlign: -2 }} />{s.label}</span>
                            <span className={`fv-chip ${chipClass(st)}`}>
                                {st === 'done' ? 'Done' : st === 'ready' ? 'Ready' : 'Not started'}
                            </span>
                        </button>
                    );
                })}
            </div>

            {error && <div className="fv-alert error"><AlertCircle size={16} />{error}</div>}
            {msg && <div className="fv-alert ok"><CheckCircle size={16} />{msg}</div>}
            {IS_STAGING && slowLoad && (
                <div className="fv-alert ok"><RefreshCw size={16} />{COLD_START_MSG}</div>
            )}

            {step === 'period' && (
                <div className="fv-panel">
                    <h3>1. Period & contract</h3>
                    <p className="fv-lead">
                        Select the billing month and Fixed Value contract. Site filter narrows drill-downs;
                        contract-level CTAs (bulk attendance, entire payroll, all-site invoices) always cover every depot.
                    </p>
                    {IS_STAGING && (
                        <div className="fv-cold-note">
                            <strong>Staging note:</strong> Render free tier sleeps after ~10-20 min idle.
                            The first request after wake can take 1-2 minutes - not a hang.
                        </div>
                    )}
                    <div className="fv-kpi-grid">
                        <div className="fv-kpi"><div className="label">Contract</div><div className="value" style={{ fontSize: '0.85rem' }}>{contractId || '-'}</div></div>
                        <div className="fv-kpi"><div className="label">Sites</div><div className="value">{orders.length}</div></div>
                        <div className="fv-kpi"><div className="label">Period</div><div className="value">{month}/{year}</div></div>
                        <div className="fv-kpi"><div className="label">Attendance done</div><div className="value">{attDoneCount}/{orders.length || 0}</div></div>
                    </div>
                    <div className="fv-actions">
                        <button type="button" className="btn-primary" disabled={!contractId} onClick={() => setStep('attendance')}>
                            Continue to Attendance <Play size={14} />
                        </button>
                        {canEditContract && (
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setWizard({ mode: 'create' })}
                            >
                                <Plus size={14} /> New Fixed Value Contract
                            </button>
                        )}
                        {canEditContract && contractId && (
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setWizard({ mode: 'edit', contractId })}
                            >
                                <Pencil size={14} /> Edit contract
                            </button>
                        )}
                        {user?.role === 'superadmin' && (
                            <button
                                type="button"
                                className="btn-secondary"
                                disabled={loading}
                                onClick={() => {
                                    const ok = window.confirm(
                                        'Re-sync North Zone from seed JSON?\n\nThis overwrites SO line rates/meta for CTR-PSO-NORTH-ZONE from pso_sites.json. UI edits will be replaced.'
                                    );
                                    if (!ok) return;
                                    runAction(async () => {
                                        await api.resyncPsoNorthZoneSeed(true, false);
                                        await loadContracts();
                                        await loadOrders();
                                        await loadAttStatus();
                                    }, 'North Zone re-synced from seed JSON');
                                }}
                            >
                                Re-sync North Zone from seed JSON
                            </button>
                        )}
                    </div>
                    <div className="fv-table-wrap">
                        <table className="fv-table">
                            <thead><tr><th>Site</th><th>SO ID</th><th>Lines</th><th>Attendance</th></tr></thead>
                            <tbody>
                                {orders.map(o => {
                                    const st = attStatus.find(a => a.siteCode === o.site_code);
                                    return (
                                        <tr key={o.id}>
                                            <td>{o.name}</td>
                                            <td>{o.id}</td>
                                            <td className="num">{(o.lines || []).length}</td>
                                            <td>{st?.status === 'done' ? `Done (${st.overrideCount} overrides)` : 'Not started'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {step === 'attendance' && (
                <div className="fv-panel">
                    <h3>2. Attendance</h3>
                    <p className="fv-lead">
                        Primary CTA pulls every depot sheet from Drive and applies present/absent into
                        <code> monthly_attendance_overrides</code> + absence deductions. Per-site upload remains secondary.
                    </p>
                    <div className="fv-actions">
                        <button type="button" className="btn-primary" disabled={loading || !canWrite || !orders.length} onClick={handleBulkAttendance}>
                            <CloudDownload size={16} /> Compute ALL attendance ({orders.length} sites)
                        </button>
                        <button type="button" className="btn-secondary" disabled={loading} onClick={() => runAction(loadAttStatus, 'Status refreshed')}>
                            <RefreshCw size={16} /> Refresh status
                        </button>
                    </div>
                    {attProgress && (
                        <div>
                            <div className="fv-progress"><span style={{ width: `${(attProgress.done / Math.max(attProgress.total, 1)) * 100}%` }} /></div>
                            <p className="fv-lead" style={{ marginTop: 6 }}>
                                {attProgress.done}/{attProgress.total}{attProgress.current ? ` - ${attProgress.current}` : ''}
                            </p>
                        </div>
                    )}
                    {(bulkAttResults.length > 0 || attStatus.length > 0) && (
                        <div className="fv-table-wrap">
                            <table className="fv-table">
                                <thead>
                                    <tr>
                                        <th>Site</th><th>Status</th><th className="num">Overrides</th>
                                        <th className="num">Deductions</th><th>File / note</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(bulkAttResults.length ? bulkAttResults : attStatus.map(a => ({
                                        siteCode: a.siteCode,
                                        ok: a.status === 'done',
                                        overrides: a.overrideCount,
                                        deductions: a.deductionCount,
                                        fileName: '',
                                    }))).map(r => (
                                        <tr key={r.siteCode}>
                                            <td>{r.siteCode}</td>
                                            <td>{r.ok ? 'OK' : (r.code || r.message || 'Pending')}</td>
                                            <td className="num">{r.overrides ?? '-'}</td>
                                            <td className="num">{r.deductions ?? '-'}</td>
                                            <td>{r.fileName || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="fv-later">
                        <strong>Secondary - single site</strong>
                        {siteCode === ALL_SITES
                            ? ' Choose a site in the filter to upload/apply one Excel sheet.'
                            : ` Working on ${selectedOrder?.name || siteCode}.`}
                    </div>
                    {selectedOrder && siteCode !== ALL_SITES && (
                        <div className="fv-actions">
                            <label className="btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <Upload size={16} /> Upload Excel
                                <input type="file" accept=".xlsx,.xls" hidden onChange={handleUpload} />
                            </label>
                            <button type="button" className="btn-secondary" disabled={loading || !parsedRows.length} onClick={handleApplySite}>
                                Apply to ledger
                            </button>
                            <span className="fv-lead">Parsed rows: {parsedRows.length} | Deductions: {deductions.length}</span>
                        </div>
                    )}
                    {parsedRows.length > 0 && (
                        <div className="fv-table-wrap">
                            <table className="fv-table">
                                <thead><tr><th>Code</th><th>Name</th><th>Designation</th><th className="num">Present</th><th className="num">Absent</th></tr></thead>
                                <tbody>
                                    {parsedRows.slice(0, 40).map((r, i) => (
                                        <tr key={i}><td>{r.empCode}</td><td>{r.name}</td><td>{r.designation}</td><td className="num">{r.presentDays}</td><td className="num">{r.absentDays}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="fv-later" style={{ marginTop: '1rem' }}>
                        <strong>Manual overrides</strong> (same <code>monthly_attendance_overrides</code> as Attendance -> Monthly Report):
                        OT hrs, Deduction against Leaves, Arrears, Other Deduction. Filter to a site above for a shorter list.
                    </div>
                    {hubOverrides.length > 0 && (
                        <div className="fv-table-wrap">
                            <table className="fv-table">
                                <thead>
                                    <tr>
                                        <th>Code</th><th>Name</th>
                                        <th className="num">Present</th><th className="num">Absent</th>
                                        <th className="num">OT@2X</th><th className="num">Leave Ded.</th>
                                        <th className="num">Arrears</th><th className="num">Other Ded.</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {hubOverrides.slice(0, 80).map(r => {
                                        const edit = hubEdits[r.employee_id] || {};
                                        const val = (k, fallback) => (edit[k] !== undefined ? edit[k] : (fallback ?? ''));
                                        const set = (k, v) => setHubEdits(prev => ({
                                            ...prev,
                                            [r.employee_id]: { ...edit, [k]: v },
                                        }));
                                        return (
                                            <tr key={r.employee_id}>
                                                <td>{r.employee_id}</td>
                                                <td>{r.name}</td>
                                                <td className="num">
                                                    <input type="number" min="0" max="31" style={{ width: 56 }}
                                                        value={val('present', r.present)}
                                                        onChange={e => set('present', e.target.value)} />
                                                </td>
                                                <td className="num">{r.absent ?? 0}</td>
                                                <td className="num">
                                                    <input type="number" min="0" step="0.5" style={{ width: 56 }}
                                                        value={val('ot2', r.ot2_hours)}
                                                        onChange={e => set('ot2', e.target.value)} />
                                                </td>
                                                <td className="num">
                                                    <input type="number" min="0" style={{ width: 72 }}
                                                        value={val('leaveDeduction', r.leave_deduction)}
                                                        onChange={e => set('leaveDeduction', e.target.value)} />
                                                </td>
                                                <td className="num">
                                                    <input type="number" min="0" style={{ width: 72 }}
                                                        value={val('arrears', r.arrears)}
                                                        onChange={e => set('arrears', e.target.value)} />
                                                </td>
                                                <td className="num">
                                                    <input type="number" min="0" style={{ width: 72 }}
                                                        value={val('otherDeduction', r.other_deduction)}
                                                        onChange={e => set('otherDeduction', e.target.value)} />
                                                </td>
                                                <td>
                                                    <button type="button" className="btn-secondary" style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                                                        disabled={loading || hubSaving === r.employee_id || !canWrite}
                                                        onClick={() => saveHubRow(r)}>
                                                        {hubSaving === r.employee_id ? '...' : 'Save'}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="fv-actions">
                        <button type="button" className="btn-primary" disabled={!attDoneCount} onClick={() => setStep('billable')}>
                            Continue to Confirm billable services
                        </button>
                    </div>
                </div>
            )}

            {step === 'billable' && (
                <div className="fv-panel">
                    <h3>3. Confirm billable services</h3>
                    <p className="fv-lead">
                        Attendance proves manpower; an explicit monthly confirmation proves non-manpower is billable.
                        Tick consumables, garbage, equipment, and other fixed lines that were provided this month.
                        Defaults are <strong>off</strong> for a new month. Save even if you leave everything unchecked -
                        invoices will not generate until each site has a saved confirmation for the period.
                    </p>
                    <div className="fv-kpi-grid">
                        <div className="fv-kpi">
                            <div className="label">Sites reviewed</div>
                            <div className="value">{billableReviewedCount}/{billableSiteCount || 0}</div>
                        </div>
                        <div className="fv-kpi">
                            <div className="label">Period</div>
                            <div className="value">{month}/{year}</div>
                        </div>
                    </div>
                    <div className="fv-actions">
                        <button type="button" className="btn-primary" disabled={loading || !canWrite || !contractId}
                            onClick={() => handleSaveAllBillable({ confirmAll: false })}>
                            <ClipboardCheck size={16} /> Save confirmations (all sites)
                        </button>
                        <button type="button" className="btn-secondary" disabled={loading || !canWrite || !contractId}
                            onClick={() => handleSaveAllBillable({ confirmAll: true })}>
                            Confirm all billable (contract)
                        </button>
                        <button type="button" className="btn-secondary" disabled={loading || !contractId}
                            onClick={() => runAction(loadBillableConfirmations, 'Billable checklist reloaded')}>
                            <RefreshCw size={16} /> Reload
                        </button>
                    </div>

                    {(billablePack?.sites || [])
                        .filter((s) => siteCode === ALL_SITES || s.siteCode === siteCode)
                        .map((site) => {
                            const edits = billableEdits[site.serviceOrderId] || {};
                            const lines = site.lines || [];
                            return (
                                <div key={site.serviceOrderId} style={{ marginTop: 16 }}>
                                    <h4 style={{ margin: '0 0 8px' }}>
                                        {site.siteName || site.siteCode}
                                        <span className={`fv-chip ${site.reviewed ? 'done' : 'ready'}`} style={{ marginLeft: 8 }}>
                                            {site.reviewed ? 'Saved for period' : 'Not saved yet'}
                                        </span>
                                    </h4>
                                    {lines.length === 0 ? (
                                        <p className="fv-lead">No non-manpower lines on this site - save once to acknowledge the period.</p>
                                    ) : (
                                        <div className="fv-table-wrap">
                                            <table className="fv-table">
                                                <thead>
                                                    <tr>
                                                        <th>Billable</th>
                                                        <th>Line</th>
                                                        <th>Service</th>
                                                        <th className="num">Monthly rate</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {lines.map((l) => {
                                                        const checked = edits[l.lineId] !== undefined
                                                            ? !!edits[l.lineId]
                                                            : !!l.billable;
                                                        return (
                                                            <tr key={l.lineId}>
                                                                <td>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={checked}
                                                                        disabled={!canWrite || loading}
                                                                        onChange={(e) => toggleBillableLine(
                                                                            site.serviceOrderId, l.lineId, e.target.checked
                                                                        )}
                                                                    />
                                                                </td>
                                                                <td>{l.lineNumber || l.lineId}</td>
                                                                <td>{l.name}</td>
                                                                <td className="num">{fmt(l.rate)}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                    <div className="fv-actions">
                                        <button type="button" className="btn-secondary"
                                            disabled={loading || !canWrite}
                                            onClick={() => handleSaveSiteBillable(site)}>
                                            Save this site
                                        </button>
                                        <button type="button" className="btn-secondary"
                                            disabled={loading || !canWrite || !lines.length}
                                            onClick={() => handleSaveSiteBillable(site, { confirmAll: true })}>
                                            Confirm all billable (site)
                                        </button>
                                    </div>
                                </div>
                            );
                        })}

                    <div className="fv-actions">
                        <button type="button" className="btn-primary"
                            disabled={!billablePack?.allReviewed}
                            onClick={() => setStep('payroll')}>
                            Continue to Payroll
                        </button>
                        <button type="button" className="btn-secondary"
                            disabled={!billablePack?.allReviewed}
                            onClick={() => setStep('invoice')}>
                            Skip to Invoice
                        </button>
                    </div>
                </div>
            )}

            {step === 'payroll' && (
                <div className="fv-panel">
                    <h3>4. Payroll (absent-driven)</h3>
                    <p className="fv-lead">
                        World B compute for the whole contract. Wages use Conservancy Model A:
                        <strong> paid factor = (30 - sheet absent) / 30</strong>. Present is shown from the sheet for audit; Absent must match attendance exactly.
                        OT / Arrears / Leave Deduction / Other Deduction come from <code>monthly_attendance_overrides</code>.
                        Saving an override on Attendance (here or Monthly Report) auto-refreshes the draft payroll run.
                    </p>
                    <div className="fv-actions">
                        <button type="button" className="btn-primary" disabled={loading || !contractId || !canWrite} onClick={handleComputePayroll}>
                            <Calculator size={16} /> Compute entire payroll
                        </button>
                        <button type="button" className="btn-secondary" disabled={loading || !contractId} onClick={() => runAction(loadPayrollRun, 'Payroll reloaded')}>
                            <RefreshCw size={16} /> Reload
                        </button>
                        <button type="button" className="btn-secondary" disabled={loading || !payrollRows.length}
                            onClick={() => downloadBlob(api.downloadFixedValuePayrollExcel(contractId, month, year), 'payroll.xlsx')}>
                            <Download size={16} /> Excel
                        </button>
                        <span className="fv-lead" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <ExternalLink size={14} /> Lock / disburse: sidebar -> Payroll Run
                        </span>
                    </div>

                    {payrollRun && (
                        <div className="fv-kpi-grid">
                            <div className="fv-kpi fv-kpi-run">
                                <div className="label">Payroll run #{payrollRun.id}</div>
                                <p className="fv-kpi-help">
                                    World B batch id for this contract/month; use this id in sidebar -> Payroll Run
                                    to lock/disburse. Not an invoice number.
                                </p>
                            </div>
                            <div className="fv-kpi"><div className="label">Status</div><div className="value">{payrollRun.status}</div></div>
                            <div className="fv-kpi"><div className="label">HC</div><div className="value">{payrollTotals.headcount}</div></div>
                            <div className="fv-kpi"><div className="label">Wages</div><div className="value">{fmt(payrollTotals.wages)}</div></div>
                            <div className="fv-kpi"><div className="label">Arrears</div><div className="value">{fmt(payrollTotals.arrears)}</div></div>
                            <div className="fv-kpi"><div className="label">Deductions</div><div className="value">{fmt(payrollTotals.deductions)}</div></div>
                            <div className="fv-kpi"><div className="label">Bonus</div><div className="value">{fmt(payrollTotals.bonus)}</div></div>
                            <div className="fv-kpi"><div className="label">OT</div><div className="value">{fmt(payrollTotals.ot)}</div></div>
                            <div className="fv-kpi"><div className="label">EOBI EE</div><div className="value">{fmt(payrollTotals.eobi)}</div></div>
                            <div className="fv-kpi"><div className="label">Tax</div><div className="value">{fmt(payrollTotals.tax)}</div></div>
                            <div className="fv-kpi"><div className="label">Net</div><div className="value">{fmt(payrollTotals.net)}</div></div>
                        </div>
                    )}
                    <p className="fv-lead">
                        Employee take-home only. Employer SESSI &amp; life insurance are on the Statutory step.
                    </p>

                    <h4 style={{ margin: 0 }}>By site</h4>
                    <div className="fv-table-wrap">
                        <table className="fv-table">
                            <thead>
                                <tr>
                                    <th>Site</th><th className="num">HC</th>
                                    <th className="num">Present</th><th className="num">Absent</th>
                                    <th className="num">Wages</th>
                                    <th className="num">Arrears</th><th className="num">Deductions</th>
                                    <th className="num">Bonus</th><th className="num">OT</th>
                                    <th className="num">EOBI EE</th><th className="num">Tax</th><th className="num">Net</th>
                                </tr>
                            </thead>
                            <tbody>
                                {payrollBySite.map(s => (
                                    <tr key={s.site} style={siteCode === s.site ? { background: 'rgba(91,141,239,0.08)' } : undefined}>
                                        <td>
                                            <button type="button" className="btn-secondary" style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                                                onClick={() => setSiteCode(s.site)}>{s.site}</button>
                                        </td>
                                        <td className="num">{s.headcount}</td>
                                        <td className="num">{fmt(s.present)}</td>
                                        <td className="num">{fmt(s.absent)}</td>
                                        <td className="num">{fmt(s.wages)}</td>
                                        <td className="num">{fmt(s.arrears)}</td>
                                        <td className="num">{fmt(s.deductions)}</td>
                                        <td className="num">{fmt(s.bonus)}</td>
                                        <td className="num">{fmt(s.ot)}</td>
                                        <td className="num">{fmt(s.eobi)}</td>
                                        <td className="num">{fmt(s.tax)}</td>
                                        <td className="num">{fmt(s.net)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td>Contract total</td>
                                    <td className="num">{payrollTotals.headcount}</td>
                                    <td className="num">{fmt(payrollTotals.present)}</td>
                                    <td className="num">{fmt(payrollTotals.absent)}</td>
                                    <td className="num">{fmt(payrollTotals.wages)}</td>
                                    <td className="num">{fmt(payrollTotals.arrears)}</td>
                                    <td className="num">{fmt(payrollTotals.deductions)}</td>
                                    <td className="num">{fmt(payrollTotals.bonus)}</td>
                                    <td className="num">{fmt(payrollTotals.ot)}</td>
                                    <td className="num">{fmt(payrollTotals.eobi)}</td>
                                    <td className="num">{fmt(payrollTotals.tax)}</td>
                                    <td className="num">{fmt(payrollTotals.net)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <h4 style={{ margin: 0 }}>
                        Detail {siteCode !== ALL_SITES ? `- ${siteCode}` : '- all sites'} ({filteredPayrollRows.length})
                    </h4>
                    <div className="fv-table-wrap">
                        <table className="fv-table">
                            <thead>
                                <tr>
                                    <th>Code</th><th>Name</th>
                                    {(siteCode === ALL_SITES) && <th>Site</th>}
                                    <th>Designation</th>
                                    <th className="num">Present</th><th className="num">Absent</th>
                                    <th className="num">Basic</th><th className="num">Wages</th>
                                    <th className="num">Arrears</th><th className="num">Deductions</th>
                                    <th className="num">Bonus</th><th className="num">OT</th>
                                    <th className="num">EOBI EE</th><th className="num">Tax</th><th className="num">Net</th>
                                    <th>Source</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPayrollRows.map(r => {
                                    const c = r.computed || {};
                                    return (
                                        <tr key={r.id || r.employee_id}>
                                            <td>{r.employee_id}</td>
                                            <td>{r.employee_name || '-'}</td>
                                            {siteCode === ALL_SITES && <td>{r.site || '-'}</td>}
                                            <td>{r.designation || '-'}</td>
                                            <td className="num">{presentDays(r) ?? '-'}</td>
                                            <td className="num">{absentDays(r) ?? '-'}</td>
                                            <td className="num">{fmt(r.basic_salary)}</td>
                                            <td className="num">{fmt(c.salaryForDays)}</td>
                                            <td className="num">{fmt(rowArrears(r))}</td>
                                            <td className="num">{fmt(rowDeductions(r))}</td>
                                            <td className="num">{fmt(rowBonus(r))}</td>
                                            <td className="num">{fmt(rowOt(r))}</td>
                                            <td className="num">{fmt(c.eobiEmployee)}</td>
                                            <td className="num">{fmt(c.wht)}</td>
                                            <td className="num">{fmt(c.netPay)}</td>
                                            <td>{r.source || '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {payrollWarnings.length > 0 && (
                        <p className="fv-lead">{payrollWarnings.length} compute warnings (see server logs / full run).</p>
                    )}
                </div>
            )}

            {step === 'invoice' && (
                <div className="fv-panel">
                    <h3>5. Invoice</h3>
                    <p className="fv-lead">
                        Conservancy SO methodology: gross line rates - absence shortage (resourceRate/30 x days absent)
                        + provincial ST. Income WHT &amp; 20% ST withholding are receivable-only - stamped grand is not reduced.
                        Rates aligned to Wafi portal (Punjab 16%, Sindh/KPK/Balochistan 15%).
                        Unchecked non-manpower services still appear on the invoice with QTY 0 and Amount PKR 0
                        (checked = QTY 1 at full monthly rate). Manpower LESS lines are unchanged.
                        Stamp / regenerate refreshes Draft, Raised, or Sent FV invoices without changing the invoice number.
                        {!billablePack?.allReviewed && (
                            <> <strong>Save Confirm billable services for every site before preview/stamp.</strong></>
                        )}
                    </p>
                    <div className="fv-actions">
                        <button type="button" className="btn-primary"
                            disabled={loading || !contractId || !billablePack?.allReviewed}
                            onClick={handleComputeInvoicesAll}>
                            <FileText size={16} /> Preview all-site invoices
                        </button>
                        <button type="button" className="btn-secondary"
                            disabled={loading || !canWrite || !invoicePack || !billablePack?.allReviewed}
                            onClick={handlePersistInvoicesAll}>
                            Stamp / regenerate all sites
                        </button>
                        <button type="button" className="btn-secondary" disabled={loading || !contractId}
                            onClick={() => downloadBlob(api.downloadFixedValueInvoicesExcel(contractId, month, year), 'invoices.xlsx')}>
                            <Download size={16} /> Invoice Excel
                        </button>
                        <button type="button" className="btn-secondary" disabled={loading || !contractId || !canWrite}
                            onClick={handleDryRunVerificationEmail}>
                            <Mail size={16} /> Dry run (all sites -> ASIL test)
                        </button>
                        <button type="button" className="btn-primary" disabled={loading || !contractId || !canWrite || !invoicePack}
                            onClick={handleSendAllVerificationEmails}>
                            <Mail size={16} /> Send verification emails (all sites)
                        </button>
                        {selectedOrder && siteCode !== ALL_SITES && (
                            <button type="button" className="btn-secondary" disabled={loading || !billablePack?.allReviewed} onClick={() => runAction(async () => {
                                const preview = await api.computeFixedValueInvoice(selectedOrder.id, month, year);
                                setInvoicePack({
                                    sites: [preview],
                                    totals: {
                                        sites: 1,
                                        gross: preview.gross,
                                        shortage: preview.totalShortages ?? preview.totalDeductions,
                                        adjustments: preview.totalAdjustments,
                                        netTaxable: preview.netTaxable,
                                        salesTax: preview.provincialSt,
                                        grandTotal: preview.grandTotal,
                                        netReceivable: preview.netReceivable,
                                    },
                                });
                            }, 'Site invoice previewed')}>
                                Preview this site only
                            </button>
                        )}
                    </div>

                    {invoicePack?.totals && (
                        <div className="fv-kpi-grid">
                            <div className="fv-kpi"><div className="label">Gross</div><div className="value">{fmt(invoicePack.totals.gross)}</div></div>
                            <div className="fv-kpi"><div className="label">Shortage</div><div className="value">{fmt(invoicePack.totals.shortage)}</div></div>
                            <div className="fv-kpi"><div className="label">Adjustments</div><div className="value">{fmt(invoicePack.totals.adjustments ?? invoicePack.sites?.[0]?.totalAdjustments)}</div></div>
                            <div className="fv-kpi"><div className="label">Net taxable</div><div className="value">{fmt(invoicePack.totals.netTaxable ?? invoicePack.sites?.[0]?.netTaxable)}</div></div>
                            <div className="fv-kpi"><div className="label">Sales tax</div><div className="value">{fmt(invoicePack.totals.salesTax)}</div></div>
                            <div className="fv-kpi"><div className="label">Stamped grand</div><div className="value">{fmt(invoicePack.totals.grandTotal)}</div></div>
                            <div className="fv-kpi"><div className="label">Net receivable</div><div className="value">{fmt(invoicePack.totals.netReceivable)}</div></div>
                        </div>
                    )}

                    {invoicePack?.sites?.length > 0 && (
                        <div className="fv-table-wrap">
                            <table className="fv-table">
                                <thead>
                                    <tr>
                                        <th>Site</th><th>Province</th>
                                        <th className="num">Gross</th><th className="num">Shortage</th>
                                        <th className="num">ST</th><th className="num">Rate</th>
                                        <th className="num">Grand</th><th className="num">Receivable</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoicePack.sites.map(s => (
                                        <tr key={s.siteCode || s.serviceOrderId}>
                                            <td>
                                                {s.siteName || s.siteCode || '-'}
                                                {s.resources != null ? ` | ${s.resources} res` : ''}
                                            </td>
                                            <td>{s.province || '-'}</td>
                                            <td className="num">{fmt(s.gross)}</td>
                                            <td className="num">{fmt(s.totalDeductions)}</td>
                                            <td className="num">{fmt(s.provincialSt)}</td>
                                            <td className="num">{pct(s.taxRate)}</td>
                                            <td className="num">{fmt(s.grandTotal)}</td>
                                            <td className="num">{fmt(s.netReceivable)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="fv-adj-block">
                        <h4 style={{ margin: 0 }}>Invoice adjustment (one-off)</h4>
                        <p className="fv-lead">
                            Applied <strong>before sales tax</strong> on the selected location and service-order line.
                            Payroll is unchanged. <strong>- Deduct</strong> is the default: type the PKR amount - no minus required.
                            Print nests the adjustment under that line; Stamp to save AR.
                        </p>
                        {!orders.length ? (
                            <p className="fv-lead">Load a contract first.</p>
                        ) : (
                            <>
                                <div className="fv-adj-form">
                                    <label className="fv-adj-field fv-adj-location">
                                        <span>Location</span>
                                        <select
                                            value={siteCode === ALL_SITES ? '' : siteCode}
                                            disabled={!canWrite || loading}
                                            onChange={(e) => setSiteCode(e.target.value || ALL_SITES)}
                                        >
                                            <option value="">Select location</option>
                                            {orders.map((o) => (
                                                <option key={o.id} value={o.site_code}>
                                                    {o.name} ({o.site_code})
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="fv-adj-field fv-adj-note">
                                        <span>Comment on invoice</span>
                                        <input
                                            type="text"
                                            value={adjNote}
                                            disabled={!canWrite || loading || !selectedOrder}
                                            placeholder="e.g. Credit - services billed in June but not delivered"
                                            onChange={(e) => setAdjNote(e.target.value)}
                                        />
                                    </label>
                                    <label className="fv-adj-field fv-adj-line">
                                        <span>Line item</span>
                                        <select
                                            value={adjLineId}
                                            disabled={!canWrite || loading || !selectedOrder || adjLines.length === 0}
                                            onChange={(e) => setAdjLineId(e.target.value)}
                                        >
                                            <option value="">
                                                {selectedOrder
                                                    ? (adjLines.length ? 'Select line item' : 'No lines on this service order')
                                                    : 'Select a location first'}
                                            </option>
                                            {adjLines.map((l, idx) => (
                                                <option key={l.id} value={l.id}>{lineItemLabel(l, idx)}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <div className="fv-adj-field">
                                        <span>Effect</span>
                                        <div className="fv-adj-sign">
                                            <button
                                                type="button"
                                                className={adjSign === 'add' ? 'active' : ''}
                                                disabled={!canWrite || loading}
                                                onClick={() => setAdjSign('add')}
                                            >
                                                + Add
                                            </button>
                                            <button
                                                type="button"
                                                className={adjSign === 'deduct' ? 'active' : ''}
                                                disabled={!canWrite || loading}
                                                onClick={() => setAdjSign('deduct')}
                                            >
                                                - Deduct
                                            </button>
                                        </div>
                                    </div>
                                    <label className="fv-adj-field">
                                        <span>Amount (PKR)</span>
                                        <input
                                            type="text"
                                            inputMode="decimal"
                                            autoComplete="off"
                                            value={adjAmount}
                                            disabled={!canWrite || loading || !selectedOrder}
                                            placeholder={adjSign === 'add' ? 'e.g. 29523 to add' : 'e.g. 29523 to deduct'}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                setAdjAmount(v);
                                                if (amountLooksNegative(v)) setAdjSign('deduct');
                                            }}
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        className="btn-primary"
                                        disabled={!canWrite || loading || !selectedOrder}
                                        onClick={handleAddInvoiceAdjustment}
                                    >
                                        <Plus size={16} /> Add adjustment
                                    </button>
                                </div>
                                {!selectedOrder ? (
                                    <p className="fv-lead">Select a location to see and add adjustments for that site's service order.</p>
                                ) : (
                                <div className="fv-table-wrap">
                                    <table className="fv-table">
                                        <thead>
                                            <tr>
                                                <th>Line</th>
                                                <th>Comment</th>
                                                <th>Effect</th>
                                                <th className="num">Amount</th>
                                                <th style={{ width: 72 }} />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {manualAdjustments.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                                                        No manual adjustments for {selectedOrder.site_code || selectedOrder.name} this period.
                                                    </td>
                                                </tr>
                                            ) : manualAdjustments.map((d) => {
                                                const amt = Number(d.amount) || 0;
                                                const add = amt > 0;
                                                const lineLabel = d.line_name
                                                    ? `${d.line_number ? `${d.line_number}. ` : ''}${d.line_name}`
                                                    : (d.line_id ? `Line #${d.line_id}` : '-');
                                                return (
                                                <tr key={d.id}>
                                                    <td>{lineLabel}</td>
                                                    <td>{d.note || d.type || 'Adjustment'}</td>
                                                    <td>{add ? 'Add to invoice' : 'Deduct from invoice'}</td>
                                                    <td className={`num ${add ? 'fv-adj-add' : 'fv-adj-deduct'}`}>
                                                        {add ? '+' : '-'}{fmt(Math.abs(amt))}
                                                    </td>
                                                    <td>
                                                        <button
                                                            type="button"
                                                            className="btn-secondary fv-adj-remove"
                                                            disabled={!canWrite || loading}
                                                            title="Remove adjustment"
                                                            onClick={() => handleDeleteInvoiceAdjustment(d.id)}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                )}
                            </>
                        )}
                    </div>

                    {emailResult?.results?.length > 0 && (
                        <div className="fv-panel" style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)' }}>
                            <h4 style={{ margin: '0 0 8px' }}>Email preview {emailResult.dryRun ? '(dry run - all sites)' : ''}</h4>
                            <p className="fv-lead" style={{ margin: '0 0 8px' }}>
                                {emailResult.dryRun ? (
                                    <>Dry run CC: obaid.rana@asil.com.pk, huzaifa.rafaqat@asil.com.pk only (contract focal not copied)</>
                                ) : (
                                    <>
                                        Contract focal CC: {emailResult.contractFocal?.name || '-'}
                                        {emailResult.contractFocal?.email ? ` | ${emailResult.contractFocal.email}` : ''}
                                        {' | '}Always CC: obaid.rana@asil.com.pk, huzaifa.rafaqat@asil.com.pk
                                    </>
                                )}
                            </p>
                            <div className="fv-table-wrap">
                                <table className="fv-table">
                                    <thead>
                                        <tr>
                                            <th>Site</th>
                                            <th>Status</th>
                                            <th>Attachments</th>
                                            <th>TO (sent)</th>
                                            <th>Would go to (client)</th>
                                            <th>Subject</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {emailResult.results.map((r) => (
                                            <tr key={r.serviceOrderId || r.siteCode}>
                                                <td>{r.siteName || r.siteCode}</td>
                                                <td>{r.ok ? 'Sent' : r.skipped ? `Skipped (${r.reason})` : 'Failed'}</td>
                                                <td style={{ fontSize: '0.75rem' }}>
                                                    {(r.attachments || []).length
                                                        ? r.attachments.join(', ')
                                                        : r.pdfWarnings?.length
                                                            ? `PDF issue (${r.pdfWarnings.join(', ')})`
                                                            : '-'}
                                                    {r.payrollHeadcount != null ? ` | ${r.payrollHeadcount} staff` : ''}
                                                </td>
                                                <td style={{ fontSize: '0.75rem' }}>{(r.to || []).join(', ') || '-'}</td>
                                                <td style={{ fontSize: '0.75rem' }}>{(r.intendedTo || []).join(', ') || '-'}</td>
                                                <td style={{ fontSize: '0.75rem' }}>{r.subject || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <h4 style={{ margin: 0 }}>Registry <Database size={14} style={{ verticalAlign: -2 }} /></h4>
                    <p className="fv-lead">Edit invoice # then Save - Proforma / LH / Sales Tax prints use the saved number.</p>
                    <div className="fv-table-wrap">
                        <table className="fv-table">
                            <thead>
                                <tr>
                                    <th>Invoice #</th>
                                    <th>Site</th>
                                    <th className="num">Resources</th>
                                    <th className="num">Grand</th>
                                    <th>Print</th>
                                </tr>
                            </thead>
                            <tbody>
                                {registry.length === 0 ? (
                                    <tr><td colSpan={5} style={{ color: 'var(--text-muted)' }}>No stamped invoices for this period yet.</td></tr>
                                ) : registry.map(inv => {
                                    const notes = inv.notes && typeof inv.notes === 'object' ? inv.notes : null;
                                    const siteLabel = inv.site_name || notes?.site_name || inv.site_code || notes?.site_code || '-';
                                    const resources = inv.resources ?? notes?.resources;
                                    const editVal = registryNumberEdits[inv.id] !== undefined
                                        ? registryNumberEdits[inv.id]
                                        : (inv.invoice_number || '');
                                    const dirty = String(editVal).trim() !== String(inv.invoice_number || '').trim();
                                    return (
                                        <tr key={inv.id}>
                                            <td>
                                                <div className="fv-inv-number-edit">
                                                    <input
                                                        className="fv-inv-number-input"
                                                        value={editVal}
                                                        disabled={!canWrite || registryNumberSaving === inv.id}
                                                        onChange={(e) => setRegistryNumberEdits((prev) => ({
                                                            ...prev,
                                                            [inv.id]: e.target.value,
                                                        }))}
                                                        aria-label={`Invoice number for ${siteLabel}`}
                                                    />
                                                    {canWrite && (
                                                        <button
                                                            type="button"
                                                            className="btn-secondary"
                                                            style={{ padding: '2px 8px', fontSize: '0.7rem' }}
                                                            disabled={!dirty || loading || registryNumberSaving === inv.id}
                                                            onClick={() => saveRegistryInvoiceNumber(inv)}
                                                        >
                                                            {registryNumberSaving === inv.id ? 'Saving...' : 'Save'}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                            <td title={inv.site_code || notes?.site_code || ''}>{siteLabel}</td>
                                            <td className="num">{resources != null ? resources : '-'}</td>
                                            <td className="num">{fmt(inv.grand_total)}</td>
                                            <td>
                                                {PRINT_FORMATS.map(f => (
                                                    <button key={f.key} type="button" className="btn-secondary" style={{ marginRight: 4, padding: '2px 6px', fontSize: '0.7rem' }}
                                                        onClick={() => api.openFixedValueInvoicePrint(inv.id, f.key)}>{f.label}</button>
                                                ))}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {step === 'compliance' && (
                <div className="fv-panel">
                    <h3>6. Statutory / Compliance</h3>
                    <p className="fv-lead">
                        Employer-cost rollup and employee statutory deductions from the computed payroll run -
                        ready for challan packs. SESSI/PESSI and life insurance are <strong>employer contributions</strong>
                        (not deducted from employee net). CPR freeze &amp; provincial sales-tax packs are <strong>Next</strong> on the roadmap.
                    </p>
                    <div className="fv-kpi-grid">
                        <div className="fv-kpi"><div className="label">Headcount</div><div className="value">{payrollTotals.headcount}</div></div>
                        <div className="fv-kpi"><div className="label">EOBI (employee)</div><div className="value">{fmt(payrollTotals.eobi)}</div></div>
                        <div className="fv-kpi"><div className="label">Income tax (payroll)</div><div className="value">{fmt(payrollTotals.tax)}</div></div>
                        <div className="fv-kpi"><div className="label">SESSI/PESSI (employer)</div><div className="value">{fmt(payrollTotals.sessi)}</div></div>
                        <div className="fv-kpi"><div className="label">Life insurance (employer)</div><div className="value">{fmt(payrollTotals.life)}</div></div>
                    </div>
                    <div className="fv-later">
                        <strong>Later:</strong> EOBI/SESSI challan Excel packs | BRA/SRB/KPRA/PRA ST annexures | CPR reference freeze before invoice stamp.
                    </div>
                    <div className="fv-actions">
                        <button type="button" className="btn-secondary" disabled={!payrollRows.length}
                            onClick={() => downloadBlob(api.downloadFixedValuePayrollExcel(contractId, month, year), 'payroll.xlsx')}>
                            Export payroll Excel (includes EOBI/SESSI columns)
                        </button>
                    </div>
                </div>
            )}

            {step === 'export' && (
                <div className="fv-panel">
                    <h3>7. Export &amp; Push</h3>
                    <p className="fv-lead">
                        Working today: pretty Excel for payroll + invoice register, bank-file stub sheet, focal email per site.
                        One-click Xero push is on the roadmap.
                    </p>
                    <div className="fv-actions">
                        <button type="button" className="btn-primary" disabled={loading || !contractId}
                            onClick={() => downloadBlob(api.downloadFixedValuePayrollExcel(contractId, month, year), 'FV payroll.xlsx')}>
                            <Download size={16} /> Payroll Excel
                        </button>
                        <button type="button" className="btn-primary" disabled={loading || !contractId}
                            onClick={() => downloadBlob(api.downloadFixedValueInvoicesExcel(contractId, month, year), 'FV invoices.xlsx')}>
                            <Download size={16} /> Invoice register Excel
                        </button>
                        {selectedOrder && siteCode !== ALL_SITES && (
                            <button type="button" className="btn-secondary" disabled={loading || !canWrite}
                                onClick={() => runAction(() => api.sendFixedValueFocalEmail(selectedOrder.id, month, year), 'Focal email queued/sent')}>
                                <Mail size={16} /> Email focal (this site)
                            </button>
                        )}
                    </div>
                    <div className="fv-later">
                        <strong>Bank file:</strong> included as sheet "Bank file (format TBD)" inside the payroll workbook
                        (Employee ID, Name, Bank, Account, IBAN, Net Pay, Payment Ref).
                    </div>
                    <div className="fv-later">
                        <strong>One-click later:</strong> Fetch Attendance -> Build Payroll -> Bank File -> Invoices -> Xero ->
                        EOBI/SESSI challans -> Sales tax by authority -> email focals.
                    </div>
                </div>
            )}

            {wizard && (
                <FixedValueContractWizard
                    mode={wizard.mode}
                    contractId={wizard.contractId || null}
                    onClose={() => setWizard(null)}
                    onSaved={async (result) => {
                        const id = result?.contract?.id || wizard.contractId;
                        setWizard(null);
                        await loadContracts();
                        if (id) setContractId(id);
                        await loadOrders();
                        setMsg(`Contract ${id} saved`);
                    }}
                />
            )}
        </div>
    );
}

