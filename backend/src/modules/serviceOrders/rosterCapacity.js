'use strict';

const { designationsMatch, normalizeDesignation } = require('./designationMatch');
const { listServiceOrders } = require('./crud');
const { isEmployeeCurrentlyActive } = require('../../core/employeeActive');

function roleCount(role) {
    const n = Number(role?.count);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function lineRoles(line) {
    if (Array.isArray(line?.roles)) return line.roles;
    if (typeof line?.roles === 'string') {
        try { return JSON.parse(line.roles || '[]'); } catch { return []; }
    }
    return [];
}

function isManpower(line) {
    return !!(line?.is_manpower_dependent || line?.isManpowerDependent);
}

function sameSite(a, b) {
    if (!a || !b) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function allowedForDesignation(orders, designation, site) {
    let contractTotal = 0;
    let siteTotal = 0;
    let matched = false;
    for (const so of orders || []) {
        const soSite = so.site_code || so.siteCode || '';
        for (const line of so.lines || []) {
            if (!isManpower(line)) continue;
            for (const role of lineRoles(line)) {
                if (!designationsMatch(designation, role.designation || role.role)) continue;
                matched = true;
                const n = roleCount(role);
                contractTotal += n;
                if (site && sameSite(soSite, site)) siteTotal += n;
            }
        }
    }
    if (!matched || contractTotal <= 0) return null;
    if (site && siteTotal > 0) return { allowed: siteTotal, scope: 'site', site };
    return { allowed: contractTotal, scope: 'contract', site: null };
}

function employeeMatchesRole(emp, designation, siteFilter) {
    if (!designationsMatch(emp.designation, designation)) return false;
    if (siteFilter && emp.site && !sameSite(emp.site, siteFilter)) return false;
    return true;
}

async function loadContractRoster(pool, contractId) {
    const { rows } = await pool.query(
        `SELECT id, name, designation, site, contract_id, active, last_working_day
         FROM employees
         WHERE contract_id = $1`,
        [contractId]
    );
    return rows;
}

async function summarizeRosterCapacity(pool, contractId) {
    if (!contractId) return { enabled: false, roles: [], orders: 0 };
    const orders = await listServiceOrders(pool, { contractId });
    if (!orders.length) return { enabled: false, roles: [], orders: 0 };
    const roster = await loadContractRoster(pool, contractId);
    const seen = new Map();
    for (const so of orders) {
        const soSite = so.site_code || so.siteCode || '';
        for (const line of so.lines || []) {
            if (!isManpower(line)) continue;
            for (const role of lineRoles(line)) {
                const designation = role.designation || role.role || '';
                if (!normalizeDesignation(designation)) continue;
                const key = `${normalizeDesignation(designation)}|${soSite || '*'}`;
                const prev = seen.get(key) || {
                    designation,
                    site: soSite || null,
                    allowed: 0,
                    assigned: 0,
                };
                prev.allowed += roleCount(role);
                seen.set(key, prev);
            }
        }
    }
    const roles = [...seen.values()].map((row) => {
        const siteFilter = row.site || null;
        const assigned = roster.filter((e) => (
            isEmployeeCurrentlyActive(e)
            && employeeMatchesRole(e, row.designation, siteFilter)
        )).length;
        return {
            ...row,
            assigned,
            over: assigned > row.allowed,
        };
    });
    return { enabled: roles.some((r) => r.allowed > 0), roles, orders: orders.length };
}

function capacityError(designation, allowed, assigned) {
    const label = designation || 'this role';
    const err = new Error(
        `Service Order allows ${allowed} ${label}${allowed === 1 ? '' : 's'}; ${assigned} already assigned.`
    );
    err.status = 409;
    err.code = 'SO_HEADCOUNT_EXCEEDED';
    err.details = { designation, allowed, assigned };
    return err;
}

async function assertEmployeeFitsRoster(pool, emp, { excludeEmployeeId } = {}) {
    const contractId = emp?.contract_id || emp?.contractId;
    const designation = emp?.designation;
    if (!contractId || !designation) return null;
    if (!isEmployeeCurrentlyActive(emp)) return null;

    const orders = await listServiceOrders(pool, { contractId });
    if (!orders.length) return null;
    const cap = allowedForDesignation(orders, designation, emp.site);
    if (!cap) return null;

    const roster = await loadContractRoster(pool, contractId);
    const exclude = excludeEmployeeId || emp.id;
    const assigned = roster.filter((e) => (
        e.id !== exclude
        && isEmployeeCurrentlyActive(e)
        && employeeMatchesRole(e, designation, cap.scope === 'site' ? cap.site : null)
    )).length;
    if (assigned >= cap.allowed) {
        throw capacityError(designation, cap.allowed, assigned);
    }
    return { allowed: cap.allowed, assigned, scope: cap.scope };
}

function roleTotalsFromLines(lines, site) {
    const totals = new Map();
    for (const line of lines || []) {
        if (!isManpower(line)) continue;
        for (const role of lineRoles(line)) {
            const designation = role.designation || role.role || '';
            const key = normalizeDesignation(designation);
            if (!key) continue;
            const prev = totals.get(key) || { designation, site: site || null, allowed: 0 };
            prev.allowed += roleCount(role);
            totals.set(key, prev);
        }
    }
    return [...totals.values()];
}

async function assertLinesRespectRoster(pool, { contractId, siteCode, lines }) {
    if (!contractId) return;
    const roster = await loadContractRoster(pool, contractId);
    for (const row of roleTotalsFromLines(lines, siteCode)) {
        if (row.allowed <= 0) continue;
        const assigned = roster.filter((e) => (
            isEmployeeCurrentlyActive(e)
            && employeeMatchesRole(e, row.designation, siteCode || null)
        )).length;
        if (assigned > row.allowed) {
            const err = new Error(
                `Cannot set ${row.designation} to ${row.allowed}: ${assigned} active employees already hold that role.`
            );
            err.status = 409;
            err.code = 'SO_HEADCOUNT_BELOW_ROSTER';
            err.details = { designation: row.designation, allowed: row.allowed, assigned };
            throw err;
        }
    }
}

module.exports = {
    roleCount,
    allowedForDesignation,
    summarizeRosterCapacity,
    assertEmployeeFitsRoster,
    assertLinesRespectRoster,
};
