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
    deleteClient: (id) => apiFetch(`/api/clients/${id}`, { method: 'DELETE' }),

    // ── Contracts ─────────────────────────────────────────────────────────────
    deleteContract: (id) => apiFetch(`/api/contracts/${id}`, { method: 'DELETE' }),
    reassignContract: (id, clientId) => apiFetch(`/api/contracts/${id}/reassign`, { method: 'PATCH', body: JSON.stringify({ client_id: clientId }) }),

    // ── Inventory ─────────────────────────────────────────────────────────────
    getInventoryItems:     ()        => apiFetch('/api/inventory/items'),
    createInventoryItem:   (data)    => apiFetch('/api/inventory/items', { method: 'POST', body: JSON.stringify(data) }),
    updateInventoryItem:   (id, d)   => apiFetch(`/api/inventory/items/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    deleteInventoryItem:   (id)      => apiFetch(`/api/inventory/items/${id}`, { method: 'DELETE' }),

    getInventoryStock:     (itemId)  => apiFetch(`/api/inventory/stock${itemId ? '?item_id=' + itemId : ''}`),
    createInventoryStock:  (data)    => apiFetch('/api/inventory/stock', { method: 'POST', body: JSON.stringify(data) }),
    deleteInventoryStock:  (id)      => apiFetch(`/api/inventory/stock/${id}`, { method: 'DELETE' }),

    getIssuances:          (q = {})  => apiFetch('/api/inventory/issuances?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([,v])=>v))).toString()),
    createIssuance:        (data)    => apiFetch('/api/inventory/issuances', { method: 'POST', body: JSON.stringify(data) }),
    updateIssuance:        (id, d)   => apiFetch(`/api/inventory/issuances/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    deleteIssuance:        (id)      => apiFetch(`/api/inventory/issuances/${id}`, { method: 'DELETE' }),
};
