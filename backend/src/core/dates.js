'use strict';

function formatDate(d = new Date()) {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toISOString().slice(0, 10);
}

function addDays(d, days) {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + days);
    return dt;
}

function startOfWeek(d = new Date()) {
    const dt = new Date(d);
    const day = dt.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    dt.setDate(dt.getDate() + diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

function addWeeks(d, weeks) {
    return addDays(d, weeks * 7);
}

function monthYear(d = new Date()) {
    const dt = new Date(d);
    return { month: dt.getMonth() + 1, year: dt.getFullYear() };
}

module.exports = { formatDate, addDays, startOfWeek, addWeeks, monthYear };
