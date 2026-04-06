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
    // Auto logout on expired/invalid token
    if (res.status === 401) {
        localStorage.removeItem('asil_hcm_token');
        window.location.href = '/?error=session_expired';
        throw new Error('Session expired. Please sign in again.');
    }
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
    updateEmployee: (id, data) => apiFetch(`/api/employees/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteEmployee: (id) => apiFetch(`/api/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    bulkImportEmployees: (employees) => apiFetch('/api/employees/bulk', { method: 'POST', body: JSON.stringify({ employees }) }),

    // ── Clients ───────────────────────────────────────────────────────────────
    getClients: () => apiFetch('/api/clients'),
    createClient: (data) => apiFetch('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
    updateClient: (id, data) => apiFetch(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteClient: (id) => apiFetch(`/api/clients/${id}`, { method: 'DELETE' }),

    // ── Contracts ─────────────────────────────────────────────────────────────
    getContracts: () => apiFetch('/api/contracts'),
    deleteContract: (id) => apiFetch(`/api/contracts/${id}`, { method: 'DELETE' }),
    reassignContract: (id, clientId) => apiFetch(`/api/contracts/${id}/reassign`, { method: 'PATCH', body: JSON.stringify({ client_id: clientId }) }),

    // ── Contract Bid Tracking ─────────────────────────────────────────────────
    getBidItems:    (contractId)           => apiFetch(`/api/contracts/${contractId}/bid-items`),
    createBidItem:  (contractId, d)        => apiFetch(`/api/contracts/${contractId}/bid-items`, { method: 'POST', body: JSON.stringify(d) }),
    updateBidItem:  (contractId, itemId, d)=> apiFetch(`/api/contracts/${contractId}/bid-items/${itemId}`, { method: 'PUT', body: JSON.stringify(d) }),
    deleteBidItem:  (contractId, itemId)   => apiFetch(`/api/contracts/${contractId}/bid-items/${itemId}`, { method: 'DELETE' }),
    getBidActuals:  (contractId, year)     => apiFetch(`/api/contracts/${contractId}/bid-actuals?year=${year}`),
    upsertBidActual:(contractId, d)        => apiFetch(`/api/contracts/${contractId}/bid-actuals`, { method: 'POST', body: JSON.stringify(d) }),

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

    // ── Vendors ───────────────────────────────────────────────────────────────
    getVendors:            ()        => apiFetch('/api/vendors'),
    createVendor:          (data)    => apiFetch('/api/vendors', { method: 'POST', body: JSON.stringify(data) }),
    updateVendor:          (id, d)   => apiFetch(`/api/vendors/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    deleteVendor:          (id)      => apiFetch(`/api/vendors/${id}`, { method: 'DELETE' }),
    getVendorPayments:     (id)      => apiFetch(`/api/vendors/${id}/payments`),
    createVendorPayment:   (id, d)   => apiFetch(`/api/vendors/${id}/payments`, { method: 'POST', body: JSON.stringify(d) }),

    // ── System Config ─────────────────────────────────────────────────────────
    getConfig:             (key)     => apiFetch(`/api/config/${key}`),
    updateConfig:          (key, v)  => apiFetch(`/api/config/${key}`, { method: 'PUT', body: JSON.stringify({ value: v }) }),

    // ── Employee Documents ────────────────────────────────────────────────────
    getEmployeeDocs:       (id)      => apiFetch(`/api/employees/${id}/documents`),
    createEmployeeDoc:     (id, d)   => apiFetch(`/api/employees/${id}/documents`, { method: 'POST', body: JSON.stringify(d) }),
    updateEmployeeDoc:     (id, did, d) => apiFetch(`/api/employees/${id}/documents/${did}`, { method: 'PUT', body: JSON.stringify(d) }),
    deleteEmployeeDoc:     (id, did) => apiFetch(`/api/employees/${id}/documents/${did}`, { method: 'DELETE' }),

    // ── Employee Messaging ────────────────────────────────────────────────────
    getEmployeeMessages:   (id)      => apiFetch(`/api/employees/${id}/messages`),
    sendEmployeeMessage:   (id, d)   => apiFetch(`/api/employees/${id}/messages`, { method: 'POST', body: JSON.stringify(d) }),

    // ── SMS (Jazz CMT) ────────────────────────────────────────────────────────
    sendSms: (to, message, employee_id) => apiFetch('/api/sms/send', { method: 'POST', body: JSON.stringify({ to, message, employee_id }) }),
    bulkSms: (recipients, message)      => apiFetch('/api/sms/bulk',  { method: 'POST', body: JSON.stringify({ recipients, message }) }),

    // ── Bills / Procurement ───────────────────────────────────────────────────
    getBills:          ()          => apiFetch('/api/bills'),
    saveBill:          (bill)      => apiFetch('/api/bills', { method: 'POST', body: JSON.stringify(bill) }),
    updateBillStatus:  (id, status) => apiFetch(`/api/bills/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    getHitlFlags:      ()          => apiFetch('/api/bills/hitl-flags'),

    // ── Advances / Loans ──────────────────────────────────────────────────────
    getAdvances:         (id)      => apiFetch(`/api/employees/${id}/advances`),
    createAdvance:       (id, d)   => apiFetch(`/api/employees/${id}/advances`, { method: 'POST', body: JSON.stringify(d) }),
    payAdvanceInstallment: (id, advId) => apiFetch(`/api/employees/${id}/advances/${advId}/pay-installment`, { method: 'POST' }),
    deleteAdvance:       (id, advId) => apiFetch(`/api/employees/${id}/advances/${advId}`, { method: 'DELETE' }),
    getAdvanceDeductions: ()       => apiFetch('/api/payroll/advance-deductions'),

    // ── PF Ledger ─────────────────────────────────────────────────────────────
    getPFLedger:         (id)      => apiFetch(`/api/employees/${id}/pf-ledger`),
    upsertPFEntry:       (id, d)   => apiFetch(`/api/employees/${id}/pf-ledger`, { method: 'POST', body: JSON.stringify(d) }),

    // ── Gratuity Ledger ───────────────────────────────────────────────────────
    getGratuityLedger:   (id)      => apiFetch(`/api/employees/${id}/gratuity-ledger`),
    upsertGratuityEntry: (id, d)   => apiFetch(`/api/employees/${id}/gratuity-ledger`, { method: 'POST', body: JSON.stringify(d) }),

    // ── Asset Issuances ───────────────────────────────────────────────────────
    getAssets:           (id)      => apiFetch(`/api/employees/${id}/assets`),
    createAsset:         (id, d)   => apiFetch(`/api/employees/${id}/assets`, { method: 'POST', body: JSON.stringify(d) }),
    returnAsset:         (id, aid) => apiFetch(`/api/employees/${id}/assets/${aid}/return`, { method: 'PATCH' }),
    deleteAsset:         (id, aid) => apiFetch(`/api/employees/${id}/assets/${aid}`, { method: 'DELETE' }),

    // ── Invoices (legacy — kept for backwards compat) ─────────────────────────
    getInvoices:         ()        => apiFetch('/api/invoices'),
    createInvoice:       (d)       => apiFetch('/api/invoices', { method: 'POST', body: JSON.stringify(d) }),
    updateInvoiceStatus: (id, status) => apiFetch(`/api/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

    // ── Client Invoices (AR — new engine) ────────────────────────────────────
    getClientInvoices:      (q = {}) => apiFetch('/api/client-invoices?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([,v])=>v))).toString()),
    createClientInvoice:    (d)      => apiFetch('/api/client-invoices', { method: 'POST', body: JSON.stringify(d) }),
    updateClientInvoice:    (id, d)  => apiFetch(`/api/client-invoices/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
    pushClientInvoiceXero:  (id)     => apiFetch(`/api/client-invoices/${id}/push-xero`, { method: 'POST' }),
    getBanks:               ()       => apiFetch('/api/banks'),

    // ── Payroll Persistence ───────────────────────────────────────────────────
    getPayroll:    (year, month)        => apiFetch(`/api/payroll/${year}/${month}`),
    savePayroll:   (year, month, rows)  => apiFetch(`/api/payroll/${year}/${month}`, { method: 'POST', body: JSON.stringify({ rows }) }),
    lockPayroll:   (year, month, employeeIds) => apiFetch(`/api/payroll/${year}/${month}/lock`,   { method: 'PATCH', body: JSON.stringify({ employee_ids: employeeIds || [] }) }),
    unlockPayroll: (year, month)              => apiFetch(`/api/payroll/${year}/${month}/unlock`, { method: 'PATCH' }),
    xeroStatus:    ()                         => apiFetch('/api/xero/status'),

    // ── Payslips ──────────────────────────────────────────────────────────────
    getPayslipUrl: (empId, month, year) => `${API}/api/payslip/${encodeURIComponent(empId)}/${month}/${year}`,
    openPayslip:   (empId, month, year) => {
        const token = localStorage.getItem('asil_hcm_token');
        // URL-encode employee ID to handle IDs with slashes or special characters
        const url = `${API}/api/payslip/${encodeURIComponent(empId)}/${month}/${year}`;
        fetch(url, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
            .then(html => { const w = window.open('', '_blank'); w.document.write(html); w.document.close(); })
            .catch(e => alert('Could not load payslip: ' + e.message));
    },

    // ── Bulk Payroll SMS ──────────────────────────────────────────────────────
    sendPayrollSMS: (employeeIds, month, year, messageTemplate) =>
        apiFetch('/api/sms/payroll-batch', { method: 'POST', body: JSON.stringify({ employeeIds, month, year, messageTemplate }) }),

    // ── Portal (Employee Self-Service) ────────────────────────────────────────
    portalRequestOtp: (phone) => apiFetch('/api/portal/request-otp', { method: 'POST', body: JSON.stringify({ phone }) }),
    portalVerifyOtp:  (phone, otp) => apiFetch('/api/portal/verify-otp', { method: 'POST', body: JSON.stringify({ phone, otp }) }),
    portalGetMe: (portalToken) => {
        const API_URL = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
        return fetch(`${API_URL}/api/portal/me`, { headers: { Authorization: `Bearer ${portalToken}` } })
            .then(r => r.json());
    },
};

