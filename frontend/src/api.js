// Shared API utility — automatically attaches JWT auth token to every request

// ── Simple in-memory 2-minute cache for frequent read-only endpoints ──────────
const _cache = {};
const _cacheGet = (key) => {
    const entry = _cache[key];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > 120_000) { delete _cache[key]; return null; } // 2-min TTL
    return entry.data;
};
const _cacheSet = (key, data) => { _cache[key] = { data, cachedAt: Date.now() }; };
const _cacheClear = (key) => { delete _cache[key]; };
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
    getEmployees: () => { const c = _cacheGet('employees'); if (c) return Promise.resolve(c); return apiFetch('/api/employees').then(d => { _cacheSet('employees', d); return d; }); },
    createEmployee: (data) => apiFetch('/api/employees', { method: 'POST', body: JSON.stringify(data) }).then(d => { _cacheClear('employees'); return d; }),
    updateEmployee: (id, data) => apiFetch(`/api/employees/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => { _cacheClear('employees'); return d; }),
    deleteEmployee: (id) => apiFetch(`/api/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(d => { _cacheClear('employees'); return d; }),
    bulkImportEmployees: (employees) => apiFetch('/api/employees/bulk', { method: 'POST', body: JSON.stringify({ employees }) }),

    // ── Clients ───────────────────────────────────────────────────────────────
    getClients: () => apiFetch('/api/clients'),
    createClient: (data) => apiFetch('/api/clients', { method: 'POST', body: JSON.stringify(data) }),
    updateClient: (id, data) => apiFetch(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteClient: (id) => apiFetch(`/api/clients/${id}`, { method: 'DELETE' }),

    // ── Contracts ─────────────────────────────────────────────────────────────
    getContracts: () => { const c = _cacheGet('contracts'); if (c) return Promise.resolve(c); return apiFetch('/api/contracts').then(d => { _cacheSet('contracts', d); return d; }); },
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
    pfOpeningBalance:    (id, d)   => apiFetch(`/api/employees/${id}/pf-ledger/opening-balance`, { method: 'POST', body: JSON.stringify(d) }),
    pfWithdrawal:        (id, d)   => apiFetch(`/api/employees/${id}/pf-ledger/withdrawal`, { method: 'POST', body: JSON.stringify(d) }),
    deletePFEntry:       (id, eid) => apiFetch(`/api/employees/${id}/pf-ledger/${eid}`, { method: 'DELETE' }),

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
    unlockPayroll: (year, month, employeeIds) => apiFetch(`/api/payroll/${year}/${month}/unlock`, { method: 'PATCH', body: JSON.stringify({ employee_ids: employeeIds || [] }) }),
    resetPayroll:  (year, month, password)    => apiFetch(`/api/payroll/${year}/${month}`,        { method: 'DELETE', body: JSON.stringify({ password }) }),
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
    // ── Purchase Orders (PO Tracking) ─────────────────────────────────────────
    getPurchaseOrders:    (q = {}) => apiFetch('/api/purchase-orders?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([,v])=>v))).toString()),
    suggestPO:            (clientName, contractId) => apiFetch(`/api/purchase-orders/suggest?client_name=${encodeURIComponent(clientName)}${contractId ? '&contract_id=' + contractId : ''}`),
    createPurchaseOrder:  (d)       => apiFetch('/api/purchase-orders', { method: 'POST', body: JSON.stringify(d) }),
    updatePurchaseOrder:  (id, d)   => apiFetch(`/api/purchase-orders/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    deletePurchaseOrder:  (id)      => apiFetch(`/api/purchase-orders/${id}`, { method: 'DELETE' }),
    linkPOToInvoice:      (poId, invoiceId) => apiFetch(`/api/purchase-orders/${poId}/link-invoice`, { method: 'PATCH', body: JSON.stringify({ invoice_id: invoiceId }) }),

    // ── Payroll Invoice Status (for INV badge) ────────────────────────────────
    getPayrollInvoiceStatus: (year, month) => apiFetch(`/api/payroll/${year}/${month}/invoice-status`),

    // ── Attendance Management ─────────────────────────────────────────────────
    getMyTeam:           ()           => apiFetch('/api/attendance/my-team'),
    getAttendanceToday:  ()           => apiFetch('/api/attendance/today'),
    markAttendance:      (date, recs) => apiFetch('/api/attendance/mark', { method: 'POST', body: JSON.stringify({ date, records: recs }) }),
    getMonthlyReport:    (q = {})     => apiFetch('/api/attendance/report/monthly?' + new URLSearchParams(q).toString()),
    getWeeklyReport:     (week_start) => apiFetch(`/api/attendance/report/weekly?week_start=${week_start}`),
    exportAttendance:    (q = {})     => `${import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com'}/api/attendance/export?` + new URLSearchParams(q).toString(),
    getAttendanceTeams:  ()           => apiFetch('/api/attendance/teams'),
    assignTeam:          (d)          => apiFetch('/api/attendance/teams/assign', { method: 'POST', body: JSON.stringify(d) }),
    removeTeamMember:    (id)         => apiFetch(`/api/attendance/teams/${id}`, { method: 'DELETE' }),
};

