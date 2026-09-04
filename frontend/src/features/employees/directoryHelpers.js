const DIR_KEYS = ['q', 'bu', 'client', 'contractId', 'clientBu', 'location', 'dept', 'active', 'page', 'browse'];
const RECENT_KEY = 'asil_emp_recent';
const RECENT_MAX = 8;

export function activeToParam(label) {
    if (label === 'Inactive') return 'no';
    if (label === 'All') return 'all';
    return 'yes';
}

export function paramToActive(value) {
    if (value === 'no') return 'Inactive';
    if (value === 'all') return 'All';
    return 'Active';
}

export function readDirectoryParams(search = typeof window !== 'undefined' ? window.location.search : '') {
    const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    return {
        q: p.get('q') || '',
        bu: p.get('bu') || '',
        client: p.get('client') || '',
        contractId: p.get('contractId') || '',
        clientBu: p.get('clientBu') || '',
        location: p.get('location') || '',
        dept: p.get('dept') || '',
        active: p.get('active') || 'all',
        page: Math.max(1, parseInt(p.get('page'), 10) || 1),
        browse: p.get('browse') === '1',
    };
}

export function hasDirectoryQuery(params) {
    return String(params.q || '').trim().length >= 2
        || !!(params.bu || params.client || params.contractId || params.clientBu || params.location || params.dept)
        || !!params.browse;
}

export function writeDirectoryParams(next, search = typeof window !== 'undefined' ? window.location.search : '') {
    const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    DIR_KEYS.forEach((k) => p.delete(k));
    if (next.q) p.set('q', next.q);
    if (next.bu) p.set('bu', next.bu);
    if (next.client) p.set('client', next.client);
    if (next.contractId) p.set('contractId', next.contractId);
    if (next.clientBu) p.set('clientBu', next.clientBu);
    if (next.location) p.set('location', next.location);
    if (next.dept) p.set('dept', next.dept);
    if (next.active && next.active !== 'all') p.set('active', next.active);
    if (next.page && next.page > 1) p.set('page', String(next.page));
    if (next.browse) p.set('browse', '1');
    const qs = p.toString();
    const url = qs ? `/?${qs}` : '/';
    if (typeof window !== 'undefined') window.history.replaceState({}, '', url);
    return url;
}

export function loadRecentEmployees() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.slice(0, RECENT_MAX) : [];
    } catch {
        return [];
    }
}

export function pushRecentEmployee(emp) {
    if (!emp?.id) return loadRecentEmployees();
    const next = [
        {
            id: emp.id,
            name: emp.name || '',
            client: emp.client || '',
            location: emp.location || '',
        },
        ...loadRecentEmployees().filter((e) => e.id !== emp.id),
    ].slice(0, RECENT_MAX);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore quota */ }
    return next;
}
