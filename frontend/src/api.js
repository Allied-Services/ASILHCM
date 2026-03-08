// Shared API utility — automatically attaches JWT auth token to every request
const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';

export async function apiFetch(path, options = {}) {
    const token = localStorage.getItem('asil_hcm_token');
    const res = await fetch(`${API}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {}),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Request failed: ${res.status}`);
    }
    return res.json();
}

export const api = {
    // ── Employees ────────────────────────────────────────────────────────────
    getEmployees: () => apiFetch('/api/employees'),
    createEmployee: (data) => apiFetch('/api/employees', { method: 'POST', body: JSON.stringify(data) }),
    updateEmployee: (id, data) => apiFetch(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteEmployee: (id) => apiFetch(`/api/employees/${id}`, { method: 'DELETE' }),
    bulkImportEmployees: (employees) => apiFetch('/api/employees/bulk', { method: 'POST', body: JSON.stringify({ employees }) }),

    // ── Clients ───────────────────────────────────────────────────────────────
    getClients: () => apiFetch('/api/clients'),
    createClient: (data) => apiFetch('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
    updateClient: (id, data) => apiFetch(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
};
