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
    getContracts: () => {
        const c = _cacheGet('contracts');
        const unwrap = (d) => (Array.isArray(d) ? d : (d?.contracts || []));
        if (c) return Promise.resolve(unwrap(c));
        return apiFetch('/api/contracts').then(d => { const list = unwrap(d); _cacheSet('contracts', list); return list; });
    },
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
    updateBillStatus:  (id, status, extra = {}) => apiFetch(`/api/bills/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, ...extra }) }),
    getHitlFlags:      ()          => apiFetch('/api/bills/hitl-flags'),
    getBillApprovalStatus: (billId) => apiFetch(`/api/bill-approval/${encodeURIComponent(billId)}/approval-status`),
    submitBillForApproval: (billId) => apiFetch(`/api/bill-approval/${encodeURIComponent(billId)}/submit`, { method: 'POST', body: '{}' }),

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
    syncXeroBills: (body)                    => apiFetch('/api/xero/bills/sync', { method: 'POST', body: JSON.stringify(body || {}) }),
    getXeroReviewQueue: ()                  => apiFetch('/api/xero/bills/review-queue'),
    resolveXeroBillReview: (id, body)       => apiFetch(`/api/xero/bills/${encodeURIComponent(id)}/review`, { method: 'PATCH', body: JSON.stringify(body) }),
    getBillableCandidates: (q = {})          => apiFetch('/api/client-invoices/billable-candidates?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([,v]) => v != null && v !== ''))).toString()),
    createInvoiceFromBillable: (body)        => apiFetch('/api/client-invoices/from-billable', { method: 'POST', body: JSON.stringify(body) }),
    previewReceiptSplit: (body)              => apiFetch('/api/ar/receipts/preview-split', { method: 'POST', body: JSON.stringify(body) }),
    postReceipt: (body)                      => apiFetch('/api/ar/receipts', { method: 'POST', body: JSON.stringify(body) }),
    listReceipts: (q = {})                   => apiFetch('/api/ar/receipts?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([,v]) => v))).toString()),

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

    // ── Employee Change Requests (portal → office approval) ───────────────────
    // Called from EmployeePortal.jsx using a portal token (not the main HCM token)
    portalSubmitChangeRequest: (portalToken, fieldName, newValue) => {
        const API_URL = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
        return fetch(`${API_URL}/api/portal/change-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${portalToken}` },
            body: JSON.stringify({ field_name: fieldName, new_value: newValue }),
        }).then(r => r.json());
    },
    portalGetMyRequests: (portalToken) => {
        const API_URL = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
        return fetch(`${API_URL}/api/portal/my-requests`, {
            headers: { Authorization: `Bearer ${portalToken}` },
        }).then(r => r.json());
    },
    // Called from EmployeeInformation.jsx with the normal HCM staff token
    getChangeRequests:   (status = 'Pending') => apiFetch(`/api/change-requests?status=${status}`),
    approveChangeRequest:(id)                 => apiFetch(`/api/change-requests/${id}/approve`, { method: 'PATCH' }),
    rejectChangeRequest: (id, note)           => apiFetch(`/api/change-requests/${id}/reject`, { method: 'PATCH', body: JSON.stringify({ note: note || '' }) }),

    // ── Phase 2: Files ────────────────────────────────────────────────────────
    uploadFile: async (file, kind, refId) => {
        const token = localStorage.getItem('asil_hcm_token');
        const fd = new FormData();
        fd.append('file', file);
        fd.append('kind', kind);
        if (refId) fd.append('ref_id', refId);
        const res = await fetch(`${API}/api/files`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Upload failed'); }
        return res.json();
    },
    getFileUrl: (id) => `${API}/api/files/${id}`,

    // ── Phase 2: Warnings ─────────────────────────────────────────────────────
    getWarnings: (empId) => apiFetch(`/api/employees/${encodeURIComponent(empId)}/warnings`),
    createWarning: (empId, data) => apiFetch(`/api/employees/${encodeURIComponent(empId)}/warnings`, { method: 'POST', body: JSON.stringify(data) }),
    getWarningPrintUrl: (id) => `${API}/api/warnings/${id}/print`,
    acknowledgeWarning: (id, ackFileId, ackNote) => apiFetch(`/api/warnings/${id}/acknowledge`, { method: 'POST', body: JSON.stringify({ ack_file_id: ackFileId, ack_note: ackNote }) }),

    // ── Phase 2: Report Distribution ──────────────────────────────────────────
    getReportSubscriptions: () => apiFetch('/api/report-subscriptions'),
    createReportSubscription: (d) => apiFetch('/api/report-subscriptions', { method: 'POST', body: JSON.stringify(d) }),
    updateReportSubscription: (id, d) => apiFetch(`/api/report-subscriptions/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    deleteReportSubscription: (id) => apiFetch(`/api/report-subscriptions/${id}`, { method: 'DELETE' }),
    getReportDispatchLog: () => apiFetch('/api/report-subscriptions/dispatch-log'),

    // ── Phase 2: Maintenance / CMMS ───────────────────────────────────────────
    getMaintenanceTickets: (q = {}) => apiFetch('/api/maintenance/tickets?' + new URLSearchParams(q).toString()),
    createMaintenanceTicket: async (data, photoFile) => {
        const token = localStorage.getItem('asil_hcm_token');
        const fd = new FormData();
        Object.entries(data).forEach(([k, v]) => fd.append(k, v));
        fd.append('photo', photoFile);
        const res = await fetch(`${API}/api/maintenance/tickets`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Failed'); }
        return res.json();
    },
    updateMaintenanceTicket: (id, d) => apiFetch(`/api/maintenance/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
    getEscalationRules: () => apiFetch('/api/maintenance/escalation-rules'),
    createEscalationRule: (d) => apiFetch('/api/maintenance/escalation-rules', { method: 'POST', body: JSON.stringify(d) }),
    updateEscalationRule: (id, d) => apiFetch(`/api/maintenance/escalation-rules/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    deleteEscalationRule: (id) => apiFetch(`/api/maintenance/escalation-rules/${id}`, { method: 'DELETE' }),

    // ── CMMS Sites & Client ───────────────────────────────────────────────────
    getCmmsSites: () => apiFetch('/api/cmms/sites'),
    createCmmsSite: (d) => apiFetch('/api/cmms/sites', { method: 'POST', body: JSON.stringify(d) }),
    updateCmmsSite: (id, d) => apiFetch(`/api/cmms/sites/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
    getCmmsClientUsers: () => apiFetch('/api/cmms/client-users'),
    createCmmsClientUser: (d) => apiFetch('/api/cmms/client-users', { method: 'POST', body: JSON.stringify(d) }),
    getCmmsBillingReport: (q = {}) => apiFetch('/api/cmms/billing-report?' + new URLSearchParams(q).toString()),
    getCmmsBillingReportCsv: (q = {}) => {
        const token = localStorage.getItem('asil_hcm_token');
        return fetch(`${API}/api/cmms/billing-report?` + new URLSearchParams({ ...q, format: 'csv' }).toString(), {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
    },

    // ── Phase 2: Petty Cash ─────────────────────────────────────────────────────
    getPettyCashFunds: () => apiFetch('/api/petty-cash/funds'),
    savePettyCashFund: (d) => apiFetch('/api/petty-cash/funds', { method: 'POST', body: JSON.stringify(d) }),
    getPettyCashLedger: (q = {}) => apiFetch('/api/petty-cash/ledger?' + new URLSearchParams(q).toString()),
    addPettyCashEntry: (d) => apiFetch('/api/petty-cash/ledger', { method: 'POST', body: JSON.stringify(d) }),

    // ── Phase 2: Leave Engine ─────────────────────────────────────────────────
    getLeaveRequests: (status = 'pending') => apiFetch(`/api/leave/requests?status=${status}`),
    leaveInternalDecision: (id, decision, note) => apiFetch(`/api/leave/requests/${id}/internal-decision`, { method: 'POST', body: JSON.stringify({ decision, note }) }),
    portalLeaveRequest: (portalToken, data) => {
        return fetch(`${API}/api/portal/leave-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${portalToken}` },
            body: JSON.stringify(data),
        }).then(r => r.json());
    },
    portalLeaveBalance: (portalToken) => fetch(`${API}/api/portal/leave-balance`, { headers: { Authorization: `Bearer ${portalToken}` } }).then(r => r.json()),

    // ── Restructure: P&L, Cashflow, Constraints ───────────────────────────────
    getContractPnl: (q = {}) => apiFetch('/api/pnl/contracts?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v != null))).toString()),
    refreshPnlAllocations: (month, year) => apiFetch('/api/pnl/refresh', { method: 'POST', body: JSON.stringify({ month, year }) }),
    getWeeklyCashflow: (weeks = 8) => apiFetch(`/api/cashflow/weekly?weeks=${weeks}`),
    getContractPolicy: (contractId, projectId) => apiFetch(`/api/constraints/policies/${encodeURIComponent(contractId)}${projectId ? '?project_id=' + encodeURIComponent(projectId) : ''}`),
    saveContractPolicy: (data) => apiFetch('/api/constraints/policies', { method: 'POST', body: JSON.stringify(data) }),

    // ── Restructure: Intake Hub ────────────────────────────────────────────────
    getIntakeMessages: (status) => apiFetch(`/api/intake/messages${status ? '?status=' + status : ''}`),
    triggerIntakePoll: () => apiFetch('/api/intake/trigger-poll', { method: 'POST' }),

    // ── Restructure: Projects ──────────────────────────────────────────────────
    getProjects: (q = {}) => apiFetch('/api/projects?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v))).toString()),

    // ── Restructure: Claims ────────────────────────────────────────────────────
    getEmployeeClaims: () => apiFetch('/api/claims/employee'),
    getMedicalUtilization: (employeeId, contractId) => apiFetch(`/api/claims/medical-utilization/${encodeURIComponent(employeeId)}?contract_id=${encodeURIComponent(contractId || '')}`),

    // ── Restructure: Onboarding & BizDev ───────────────────────────────────────
    getOnboardingStatus: (contractId) => apiFetch(`/api/onboarding/${encodeURIComponent(contractId)}`),
    startOnboarding: (data) => apiFetch('/api/onboarding/start', { method: 'POST', body: JSON.stringify(data) }),
    completeOnboardingTask: (taskId) => apiFetch(`/api/onboarding/tasks/${taskId}/complete`, { method: 'PATCH' }),
    getBdLeads: () => apiFetch('/api/bizdev/leads'),
    createBdLead: (data) => apiFetch('/api/bizdev/leads', { method: 'POST', body: JSON.stringify(data) }),
    getBdRenewals: () => apiFetch('/api/bizdev/renewals'),
    prPayrollPreview: (data) => apiFetch('/api/payroll/pr-preview', { method: 'POST', body: JSON.stringify(data) }),

    // ── Restructure: Claims (create) ───────────────────────────────────────────
    createClaim: (data) => apiFetch('/api/claims', { method: 'POST', body: JSON.stringify(data) }),
    retryIntakeMessage: (id) => apiFetch(`/api/intake/messages/${id}/retry`, { method: 'PATCH' }),
    updateBdLeadStage: (id, stage, contractId) => apiFetch(`/api/bizdev/leads/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage, contractId }) }),

    // ── Restructure: Attendance Intake ───────────────────────────────────────────
    parseAttendanceCsv: (data) => apiFetch('/api/attendance/parse-csv', { method: 'POST', body: JSON.stringify(data) }),
    manualAttendanceBulk: (data) => apiFetch('/api/attendance/manual-bulk', { method: 'POST', body: JSON.stringify(data) }),
    getAttendanceAlertRules: () => apiFetch('/api/attendance/alert-rules'),
    saveAttendanceAlertRule: (data) => apiFetch('/api/attendance/alert-rules', { method: 'POST', body: JSON.stringify(data) }),
    runAttendanceAlerts: () => apiFetch('/api/attendance/run-alerts', { method: 'POST' }),

    // ── Restructure: Procurement Verification ────────────────────────────────────
    getProcurementQueue: () => apiFetch('/api/procurement/verification-queue'),
    getBudgetLines: (contractId) => apiFetch(`/api/procurement/budget-lines/${encodeURIComponent(contractId)}`),
    createBudgetLine: (data) => apiFetch('/api/procurement/budget-lines', { method: 'POST', body: JSON.stringify(data) }),
    updateBudgetLine: (id, data) => apiFetch(`/api/procurement/budget-lines/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteBudgetLine: (id) => apiFetch(`/api/procurement/budget-lines/${id}`, { method: 'DELETE' }),
    verifyBillOcr: (billId, data) => apiFetch(`/api/procurement/bills/${encodeURIComponent(billId)}/verify-ocr`, { method: 'POST', body: JSON.stringify(data) }),
    matchBillBudget: (billId, budgetLineId) => apiFetch(`/api/procurement/bills/${encodeURIComponent(billId)}/match-budget`, { method: 'POST', body: JSON.stringify({ budgetLineId }) }),
    canApproveBill: (billId) => apiFetch(`/api/procurement/bills/${encodeURIComponent(billId)}/can-approve`),

    // ── Restructure: Compliance ──────────────────────────────────────────────────
    getComplianceLedger: (month, year) => apiFetch(`/api/compliance/ledger?month=${month}&year=${year}`),
    computeCompliance: (month, year) => apiFetch('/api/compliance/compute', { method: 'POST', body: JSON.stringify({ month, year }) }),
    generateFilingPreview: (month, year) => apiFetch('/api/compliance/filing-preview', { method: 'POST', body: JSON.stringify({ month, year }) }),
    validateInvoiceChallans: (invoiceId) => apiFetch(`/api/compliance/invoice/${encodeURIComponent(invoiceId)}/validate`, { method: 'POST' }),

    // ── Restructure: AR / PO / Dunning ───────────────────────────────────────────
    getPOBalance: (poId) => apiFetch(`/api/ar/po-balance/${poId}`),
    validateInvoicePO: (data) => apiFetch('/api/ar/validate-po', { method: 'POST', body: JSON.stringify(data) }),
    runDunning: () => apiFetch('/api/ar/run-dunning', { method: 'POST' }),
    getInvoiceSchedules: () => apiFetch('/api/ar/invoice-schedules'),
    getDunningLog: () => apiFetch('/api/ar/dunning-log'),

    // ── Payroll Run ──────────────────────────────────────────────────────────────
    computePayrollRun: (contractId, month, year) => apiFetch('/api/payroll-runs/compute', { method: 'POST', body: JSON.stringify({ contractId, month, year }) }),
    getPayrollRuns: (contractId, month, year) => apiFetch(`/api/payroll-runs?contractId=${encodeURIComponent(contractId)}&month=${month}&year=${year}`),
    lockPayrollRun: (id) => apiFetch(`/api/payroll-runs/${id}/lock`, { method: 'POST' }),
    invoicePayrollRun: (id) => apiFetch(`/api/payroll-runs/${id}/invoice`, { method: 'POST' }),
    patchPayrollRunRow: (runId, rowId, data) => apiFetch(`/api/payroll-runs/${runId}/rows/${rowId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    getHolidays: () => apiFetch('/api/holidays'),
    saveHoliday: (data) => apiFetch('/api/holidays', { method: 'POST', body: JSON.stringify(data) }),
    deleteHoliday: (id) => apiFetch(`/api/holidays/${id}`, { method: 'DELETE' }),
    getRateCards: (contractId) => apiFetch(`/api/rate-cards/${encodeURIComponent(contractId)}`),
    saveRateCard: (data) => apiFetch('/api/rate-cards', { method: 'POST', body: JSON.stringify(data) }),
    deleteRateCard: (id) => apiFetch(`/api/rate-cards/${id}`, { method: 'DELETE' }),
    sendPayrollRunPayslips: (runId) => apiFetch(`/api/payroll-runs/${runId}/send-payslips`, { method: 'POST' }),
    pushRunInvoiceToXero: (run, invoice) => apiFetch('/api/xero/invoices', {
        method: 'POST',
        body: JSON.stringify({
            invoice: {
                number: invoice.invoice_number,
                client: invoice.client,
                poNumber: invoice.po_number || '',
                dueDate: invoice.due_date,
                status: 'Draft',
                payrolls: [{
                    contract: invoice.contract,
                    period: `${run.period_month}/${run.period_year}`,
                    employees: run.headcount || 1,
                    totalPayrollCost: invoice.grand_total,
                }],
                debitNotes: [],
            },
        }),
    }),
    logXeroSync: (data) => apiFetch('/api/ar/xero-sync-log', { method: 'POST', body: JSON.stringify(data) }),
    previewReceiptSplit: (data) => apiFetch('/api/ar/receipts/preview-split', { method: 'POST', body: JSON.stringify(data) }),
    postReceipt: (data) => apiFetch('/api/ar/receipts', { method: 'POST', body: JSON.stringify(data) }),
    getReceipts: (q = {}) => apiFetch('/api/ar/receipts?' + new URLSearchParams(q).toString()),

  // ── Xero bill import / billable invoicing ────────────────────────────────────
    syncXeroBills: () => apiFetch('/api/xero/bills/sync', { method: 'POST', body: '{}' }),
    getBillReviewQueue: () => apiFetch('/api/xero/bills/review-queue'),
    resolveBillReview: (id, data) => apiFetch(`/api/xero/bills/${id}/review`, { method: 'PATCH', body: JSON.stringify(data) }),
    getBillableCandidates: (q) => apiFetch('/api/bills/billable-candidates?' + new URLSearchParams(q).toString()),
    createInvoiceFromBillable: (data) => apiFetch('/api/client-invoices/from-billable', { method: 'POST', body: JSON.stringify(data) }),
    exportHblBills: async (data) => {
        const token = localStorage.getItem('asil_hcm_token');
        const res = await fetch(`${API}/api/ap/bills/hbl-export`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const disp = res.headers.get('Content-Disposition') || '';
        const match = disp.match(/filename="([^"]+)"/);
        const filename = match ? match[1] : 'hbl-export.xlsx';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return { ok: true, filename };
    },
    markBillsPaid: (data) => apiFetch('/api/ap/bills/mark-paid', { method: 'POST', body: JSON.stringify(data) }),

    assignClaim: (id, employeeId) => apiFetch(`/api/claims/${id}`, { method: 'PATCH', body: JSON.stringify({ employeeId }) }),
};
