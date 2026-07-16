import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { ASIL_BUS, normalizeAsilBu } from './orgHierarchy';

const PROVINCES = ['', 'Sindh', 'Punjab', 'KPK', 'Balochistan', 'Gilgit-Baltistan', 'AJK', 'Islamabad (ICT)'];

const selStyle = (ok) => ({
    background: 'var(--bg-dark)',
    border: `1px solid ${ok === false ? '#f59e0b' : 'var(--border)'}`,
    borderRadius: '6px',
    padding: '8px 10px',
    color: 'var(--text)',
    fontSize: '0.9rem',
    outline: 'none',
    width: '100%',
});

const labelStyle = {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
};

/**
 * Cascading employment org fields:
 * ASIL BU → Active Client → Contract → Client BU → Location → Department
 *
 * Writes string fields on the employee form: bu, client, contractId, contractName,
 * clientBU, location, province, dept (+ optional clientId for internal use).
 */
export default function EmploymentOrgCascade({ form, setForm, layout = 'grid', compact = false }) {
    const [clients, setClients] = useState([]);
    const [contracts, setContracts] = useState([]);
    const [bus, setBus] = useState([]);
    const [locations, setLocations] = useState([]);
    const [departments, setDepartments] = useState([]);

    const asilBu = normalizeAsilBu(form.bu) || form.bu || '';

    useEffect(() => {
        api.getClients()
            .then((d) => setClients((d.clients || []).filter((c) => c.isActive !== false)))
            .catch(() => setClients([]));
        api.getContracts()
            .then((list) => setContracts(Array.isArray(list) ? list : (list?.contracts || [])))
            .catch(() => setContracts([]));
    }, []);

    const clientsForBu = useMemo(() => {
        if (!asilBu) return clients;
        return clients.filter((c) => {
            const cBu = normalizeAsilBu(c.asilBu);
            return !cBu || cBu === asilBu;
        });
    }, [clients, asilBu]);

    const selectedClient = useMemo(() => {
        if (!form.client) return null;
        const name = String(form.client).toLowerCase().trim();
        return clients.find((c) => c.name?.toLowerCase().trim() === name)
            || clientsForBu.find((c) => c.name?.toLowerCase().trim() === name)
            || null;
    }, [clients, clientsForBu, form.client]);

    const clientId = selectedClient?.id || form.clientId || '';

    const contractsForClient = useMemo(() => {
        const active = contracts.filter((ct) => ct.status === 'Active' || !ct.status);
        if (!clientId && !form.client) return active;
        return active.filter((ct) => {
            if (clientId && ct.clientId === clientId) return true;
            if (form.client && ct.clientName?.toLowerCase().trim() === String(form.client).toLowerCase().trim()) return true;
            return false;
        });
    }, [contracts, clientId, form.client]);

    // Load masters when client changes
    useEffect(() => {
        if (!clientId) {
            setBus([]);
            setLocations([]);
            setDepartments([]);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const [buRes, locRes, deptRes] = await Promise.all([
                    api.getClientBus(clientId),
                    api.getClientLocations(clientId, form.contractId ? { contract_id: form.contractId } : {}),
                    api.getClientDepartments(clientId),
                ]);
                if (cancelled) return;
                setBus((buRes.bus || []).filter((b) => b.is_active !== false));
                setLocations((locRes.locations || []).filter((l) => l.is_active !== false));
                setDepartments((deptRes.departments || []).filter((d) => d.is_active !== false));
            } catch {
                if (!cancelled) {
                    setBus([]);
                    setLocations([]);
                    setDepartments([]);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [clientId, form.contractId]);

    const deptsFiltered = useMemo(() => {
        const buMatch = bus.find((b) => b.bu_name === form.clientBU || b.bu_code === form.clientBU);
        const locMatch = locations.find((l) => l.name === form.location);
        return departments.filter((d) => {
            if (buMatch?.id && d.bu_id && d.bu_id !== buMatch.id) return false;
            if (locMatch?.id && d.location_id && d.location_id !== locMatch.id) return false;
            return true;
        });
    }, [departments, bus, locations, form.clientBU, form.location]);

    const patch = (partial) => setForm((p) => ({ ...p, ...partial }));

    const onAsilBu = (v) => {
        const next = normalizeAsilBu(v) || v;
        patch({
            bu: next,
            client: '',
            clientId: '',
            contractId: '',
            contractName: '',
            clientBU: '',
            location: '',
            dept: '',
        });
    };

    const onClient = (name) => {
        const cl = clients.find((c) => c.name === name);
        const inheritedBu = normalizeAsilBu(cl?.asilBu) || asilBu;
        patch({
            client: name,
            clientId: cl?.id || '',
            bu: inheritedBu || form.bu,
            contractId: '',
            contractName: '',
            clientBU: '',
            location: '',
            dept: '',
        });
    };

    const onContract = (id) => {
        const ct = contracts.find((c) => c.id === id);
        patch({
            contractId: ct?.id || '',
            contractName: ct?.contractName || '',
            client: ct?.clientName || form.client,
            clientId: ct?.clientId || form.clientId,
            location: ct?.location || form.location,
            province: ct?.regionProvince || ct?.province || form.province,
        });
    };

    const onLocation = (name) => {
        const loc = locations.find((l) => l.name === name);
        patch({
            location: name,
            province: loc?.province || form.province,
            dept: '',
        });
    };

    const Field = ({ label, children, full }) => {
        if (layout === 'rows') {
            return (
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.35rem 0', borderBottom: '1px solid var(--border)', gap: '8px',
                    ...(full ? { gridColumn: '1 / -1' } : {}),
                }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: compact ? '0.8rem' : '0.85rem', minWidth: '44%', flexShrink: 0 }}>{label}</span>
                    <div style={{ flex: 1 }}>{children}</div>
                </div>
            );
        }
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', ...(full ? { gridColumn: '1 / -1' } : {}) }}>
                <label style={labelStyle}>{label}</label>
                {children}
            </div>
        );
    };

    return (
        <>
            <Field label="ASIL BU *">
                <select value={asilBu} onChange={(e) => onAsilBu(e.target.value)} style={selStyle(!!asilBu)}>
                    <option value="">-- Select ASIL BU --</option>
                    {ASIL_BUS.map((b) => <option key={b} value={b}>{b}</option>)}
                    {asilBu && !ASIL_BUS.includes(asilBu) && (
                        <option value={asilBu}>{asilBu} (legacy — reassign)</option>
                    )}
                </select>
            </Field>

            <Field label="Client Name *">
                <select
                    value={form.client || ''}
                    onChange={(e) => onClient(e.target.value)}
                    disabled={!asilBu}
                    style={selStyle(!!form.client)}
                >
                    <option value="">{asilBu ? '-- Select active client --' : '-- Select ASIL BU first --'}</option>
                    {clientsForBu.map((c) => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                    {form.client && !clientsForBu.some((c) => c.name === form.client) && (
                        <option value={form.client}>{form.client} (not in active list)</option>
                    )}
                </select>
            </Field>

            <Field label="Contract *" full={layout === 'grid'}>
                <select
                    value={form.contractId || ''}
                    onChange={(e) => onContract(e.target.value)}
                    disabled={!form.client}
                    style={selStyle(!!form.contractId)}
                >
                    <option value="">{form.client ? '-- Select contract --' : '-- Select client first --'}</option>
                    {contractsForClient.map((ct) => (
                        <option key={ct.id} value={ct.id}>
                            {ct.contractName}{ct.location ? ` · ${ct.location}` : ''}
                        </option>
                    ))}
                    {form.contractId && !contractsForClient.some((c) => c.id === form.contractId) && (
                        <option value={form.contractId}>{form.contractName || form.contractId} (current)</option>
                    )}
                </select>
                {layout === 'grid' && form.contractId && (
                    <div style={{ fontSize: '0.75rem', color: '#22c55e', marginTop: '2px' }}>
                        ✓ {form.contractName} · {form.contractId}
                    </div>
                )}
                {layout === 'grid' && !form.contractId && form.client && (
                    <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginTop: '2px' }}>
                        Without a contract, EOSB / service charge / invoice logic may be skipped in payroll.
                    </div>
                )}
            </Field>

            <Field label="Client Business Unit">
                <select
                    value={form.clientBU || ''}
                    onChange={(e) => patch({ clientBU: e.target.value, dept: '' })}
                    disabled={!clientId}
                    style={selStyle(true)}
                >
                    <option value="">{clientId ? '-- Select client BU --' : '-- Select client first --'}</option>
                    {bus.filter((b) => b.bu_code !== 'ALL').map((b) => (
                        <option key={b.id || b.bu_code} value={b.bu_name}>{b.bu_name}{b.bu_code ? ` (${b.bu_code})` : ''}</option>
                    ))}
                    {form.clientBU && !bus.some((b) => b.bu_name === form.clientBU || b.bu_code === form.clientBU) && (
                        <option value={form.clientBU}>{form.clientBU} (legacy)</option>
                    )}
                </select>
            </Field>

            <Field label="Client Location">
                <select
                    value={form.location || ''}
                    onChange={(e) => onLocation(e.target.value)}
                    disabled={!clientId}
                    style={selStyle(true)}
                >
                    <option value="">{clientId ? '-- Select location --' : '-- Select client first --'}</option>
                    {locations.map((l) => (
                        <option key={l.id} value={l.name}>{l.name}{l.province ? ` · ${l.province}` : ''}</option>
                    ))}
                    {form.location && !locations.some((l) => l.name === form.location) && (
                        <option value={form.location}>{form.location} (legacy)</option>
                    )}
                </select>
            </Field>

            <Field label="Department">
                <select
                    value={form.dept || ''}
                    onChange={(e) => patch({ dept: e.target.value })}
                    disabled={!clientId}
                    style={selStyle(true)}
                >
                    <option value="">{clientId ? '-- Select department --' : '-- Select client first --'}</option>
                    {deptsFiltered.map((d) => (
                        <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                    {form.dept && !deptsFiltered.some((d) => d.name === form.dept) && (
                        <option value={form.dept}>{form.dept} (legacy)</option>
                    )}
                </select>
            </Field>

            {layout === 'grid' && (
                <Field label="Province">
                    <select value={form.province || ''} onChange={(e) => patch({ province: e.target.value })} style={selStyle(true)}>
                        {PROVINCES.map((p) => <option key={p || 'blank'} value={p}>{p || '-- Select --'}</option>)}
                    </select>
                </Field>
            )}
        </>
    );
}

export { PROVINCES };
