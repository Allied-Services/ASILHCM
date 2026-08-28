// Dedicated Payroll Sheet "Salary Revision" column. History loads only when Revise is opened (not per row on mount).
// Popover is portaled to document.body — table rows / overflow would otherwise hide it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';
import { api } from '../../api';
import './SalaryRevisionCell.css';

const MONTHS = [
    { n: 1, label: 'Jan' }, { n: 2, label: 'Feb' }, { n: 3, label: 'Mar' },
    { n: 4, label: 'Apr' }, { n: 5, label: 'May' }, { n: 6, label: 'Jun' },
    { n: 7, label: 'Jul' }, { n: 8, label: 'Aug' }, { n: 9, label: 'Sep' },
    { n: 10, label: 'Oct' }, { n: 11, label: 'Nov' }, { n: 12, label: 'Dec' },
];

const POPOVER_WIDTH = 260;
const POPOVER_EST_HEIGHT = 280;
const GAP = 6;

function parseSheetMonth(sheetMonth, year, month) {
    if (Number(year) && Number(month) >= 1 && Number(month) <= 12) {
        return { year: Number(year), month: Number(month) };
    }
    if (Number(year) && Number(sheetMonth) >= 1 && Number(sheetMonth) <= 12) {
        return { year: Number(year), month: Number(sheetMonth) };
    }
    const raw = String(sheetMonth || '');
    const m = raw.match(/^(\d{4})-(\d{1,2})$/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function nextMonth(year, month) {
    if (month >= 12) return { year: year + 1, month: 1 };
    return { year, month: month + 1 };
}

function periodKey(y, m) {
    return Number(y) * 12 + Number(m);
}

function salaryAsOfClient(revisions, year, month, fallback) {
    let bestOnOrBefore = null;
    let earliestAfter = null;
    for (const r of revisions || []) {
        const key = periodKey(r.effective_year, r.effective_month);
        if (key <= periodKey(year, month)) {
            if (!bestOnOrBefore || key > periodKey(bestOnOrBefore.effective_year, bestOnOrBefore.effective_month)) {
                bestOnOrBefore = r;
            }
        } else if (!earliestAfter || key < periodKey(earliestAfter.effective_year, earliestAfter.effective_month)) {
            earliestAfter = r;
        }
    }
    if (bestOnOrBefore) return Number(bestOnOrBefore.new_salary);
    if (earliestAfter) return Number(earliestAfter.old_salary);
    return Number(fallback) || 0;
}

function placePopover(btn) {
    if (!btn) return { top: 80, left: 80 };
    const r = btn.getBoundingClientRect();
    const left = Math.min(
        Math.max(8, r.right - POPOVER_WIDTH),
        Math.max(8, window.innerWidth - POPOVER_WIDTH - 8),
    );
    const below = r.bottom + GAP;
    const top = (below + POPOVER_EST_HEIGHT > window.innerHeight - 8)
        ? Math.max(8, r.top - POPOVER_EST_HEIGHT - GAP)
        : below;
    return { top, left };
}

export default function SalaryRevisionCell({
    employeeId,
    sheetMonth,
    sheetYear,
    month: monthProp,
    locked = false,
    fallbackSalary = 0,
    onRevised,
}) {
    const sheet = useMemo(
        () => parseSheetMonth(sheetMonth, sheetYear, monthProp),
        [sheetMonth, sheetYear, monthProp],
    );
    const defaultEffective = locked ? nextMonth(sheet.year, sheet.month) : sheet;

    const btnRef = useRef(null);
    const popRef = useRef(null);

    const [revisions, setRevisions] = useState([]);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [form, setForm] = useState({
        newSalary: '',
        effectiveYear: defaultEffective.year,
        effectiveMonth: defaultEffective.month,
        note: '',
    });

    const [displaySalary, setDisplaySalary] = useState(Number(fallbackSalary) || 0);

    useEffect(() => {
        setDisplaySalary(Number(fallbackSalary) || 0);
    }, [fallbackSalary]);

    const load = useCallback(() => {
        if (!employeeId) return Promise.resolve([]);
        return api.getSalaryRevisions(employeeId)
            .then((d) => {
                const rows = d.revisions || [];
                setRevisions(rows);
                setDisplaySalary(salaryAsOfClient(rows, sheet.year, sheet.month, fallbackSalary));
                return rows;
            })
            .catch(() => []);
    }, [employeeId, sheet.year, sheet.month, fallbackSalary]);

    const current = revisions.length
        ? salaryAsOfClient(revisions, sheet.year, sheet.month, fallbackSalary)
        : displaySalary;

    const openForm = () => {
        const eff = locked ? nextMonth(sheet.year, sheet.month) : sheet;
        setForm({
            newSalary: String(current || fallbackSalary || ''),
            effectiveYear: eff.year,
            effectiveMonth: eff.month,
            note: '',
        });
        setError('');
        setPos(placePopover(btnRef.current));
        setOpen(true);
        load();
    };

    useEffect(() => {
        if (!open) return undefined;
        const place = () => setPos(placePopover(btnRef.current));
        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return () => {
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (btnRef.current && btnRef.current.contains(e.target)) return;
            if (popRef.current && popRef.current.contains(e.target)) return;
            setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const save = async () => {
        const amount = Number(form.newSalary);
        if (!Number.isFinite(amount) || amount < 0) {
            setError('Enter the new salary.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            await api.createSalaryRevision(employeeId, {
                newSalary: amount,
                effectiveYear: Number(form.effectiveYear),
                effectiveMonth: Number(form.effectiveMonth),
                note: form.note,
            });
            setOpen(false);
            const rows = await load();
            const asOf = salaryAsOfClient(rows, sheet.year, sheet.month, fallbackSalary);
            if (typeof onRevised === 'function') onRevised(asOf);
        } catch (err) {
            const msg = err.message || 'Could not save revision';
            setError(msg);
            if (/locked/i.test(msg)) {
                const bump = nextMonth(Number(form.effectiveYear), Number(form.effectiveMonth));
                setForm((p) => ({ ...p, effectiveYear: bump.year, effectiveMonth: bump.month }));
            }
        }
        setSaving(false);
    };

    const years = [sheet.year - 1, sheet.year, sheet.year + 1];

    const popover = open ? createPortal(
        <div
            ref={popRef}
            className="src-popover"
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-label="Revise salary"
        >
            <h4>Revise salary</h4>
            <div className="src-field">
                <label>New salary (Rs.)</label>
                <input
                    type="number"
                    value={form.newSalary}
                    onChange={(e) => setForm((p) => ({ ...p, newSalary: e.target.value }))}
                />
            </div>
            <div className="src-field">
                <label>Effective month</label>
                <select
                    value={`${form.effectiveYear}-${form.effectiveMonth}`}
                    onChange={(e) => {
                        const [y, m] = e.target.value.split('-').map(Number);
                        setForm((p) => ({ ...p, effectiveYear: y, effectiveMonth: m }));
                    }}
                >
                    {years.flatMap((y) => MONTHS.map((mo) => (
                        <option key={`${y}-${mo.n}`} value={`${y}-${mo.n}`}>{mo.label} {y}</option>
                    )))}
                </select>
            </div>
            <div className="src-field">
                <label>Note (optional)</label>
                <input
                    type="text"
                    value={form.note}
                    onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                    placeholder="Annual increment"
                />
            </div>
            {error && <p className="src-error">{error}</p>}
            <div className="src-actions">
                <button type="button" className="src-cancel" onClick={() => setOpen(false)}>Cancel</button>
                <button type="button" className="src-save" onClick={save} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </div>,
        document.body,
    ) : null;

    return (
        <div className="src-cell">
            <button
                ref={btnRef}
                type="button"
                className="src-revise"
                onClick={openForm}
                title="Revise salary from this month"
            >
                <Pencil size={14} />
                Revise
            </button>
            {popover}
        </div>
    );
}
