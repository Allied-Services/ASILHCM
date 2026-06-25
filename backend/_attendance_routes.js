// ─── ATTENDANCE ROUTES ─────────────────────────────────────────────────────────
// Append this file to server.js via the loader pattern OR inline it directly.
// Tables needed (auto-created on first run):
//   supervisor_teams   — supervisor_email → list of employee_ids at a site
//   attendance_records — one row per employee per date

// ── Table setup (idempotent) ──────────────────────────────────────────────────
async function setupAttendanceTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS supervisor_teams (
            id              SERIAL PRIMARY KEY,
            supervisor_email TEXT NOT NULL,
            employee_id      TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            site             TEXT,
            client           TEXT,
            contract_id      TEXT,
            active           BOOLEAN DEFAULT TRUE,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(supervisor_email, employee_id)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS attendance_records (
            id          SERIAL PRIMARY KEY,
            employee_id TEXT NOT NULL,
            date        DATE NOT NULL,
            status      TEXT NOT NULL CHECK (status IN ('present','absent','half_day','leave','ot')),
            marked_by   TEXT NOT NULL,
            remarks     TEXT,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(employee_id, date)
        )
    `);
    // Indexes for fast lookups
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_att_emp_date ON attendance_records(employee_id, date)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_att_marked_by ON attendance_records(marked_by, date)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_att_date ON attendance_records(date)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sup_team_email ON supervisor_teams(supervisor_email) WHERE active=true`).catch(() => {});
    console.log('Attendance tables: OK');
}
setupAttendanceTables().catch(e => console.warn('Attendance table setup warning:', e.message));

// ── GET /api/attendance/my-team — supervisor's assigned team ─────────────────
app.get('/api/attendance/my-team', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT st.employee_id, st.site, st.client, st.contract_id,
                   e.name, e.designation, e.location, e.client AS emp_client
            FROM supervisor_teams st
            JOIN employees e ON e.id = st.employee_id
            WHERE st.supervisor_email = $1 AND st.active = true
            ORDER BY e.name
        `, [req.user.email]);
        res.json({ team: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/attendance/today — today's records for supervisor's team ─────────
app.get('/api/attendance/today', requireAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const { rows } = await pool.query(`
            SELECT ar.employee_id, ar.status, ar.remarks, ar.updated_at
            FROM attendance_records ar
            JOIN supervisor_teams st ON st.employee_id = ar.employee_id
            WHERE st.supervisor_email = $1 AND ar.date = $2 AND st.active = true
        `, [req.user.email, today]);
        const map = {};
        rows.forEach(r => { map[r.employee_id] = { status: r.status, remarks: r.remarks }; });
        res.json({ date: today, attendance: map });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/attendance/mark — submit/update daily attendance (bulk) ─────────
app.post('/api/attendance/mark', requireAuth, async (req, res) => {
    const { date, records } = req.body; // records: [{ employee_id, status, remarks }]
    if (!date || !records?.length) return res.status(400).json({ error: 'date and records are required' });

    // Only allow today or yesterday (prevent retroactive falsification)
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (date !== today && date !== yesterday) {
        return res.status(403).json({ error: 'Attendance can only be marked for today or yesterday.' });
    }

    // Verify supervisor owns these employees
    const { rows: teamRows } = await pool.query(
        `SELECT employee_id FROM supervisor_teams WHERE supervisor_email=$1 AND active=true`,
        [req.user.email]
    );
    const teamIds = new Set(teamRows.map(r => r.employee_id));
    const invalid = records.filter(r => !teamIds.has(r.employee_id));
    if (invalid.length) return res.status(403).json({ error: 'One or more employees not in your team.' });

    try {
        // Bulk UPSERT attendance records
        const empIds   = records.map(r => r.employee_id);
        const statuses = records.map(r => r.status);
        const remarks  = records.map(r => r.remarks || null);
        const dates    = records.map(() => date);
        const markers  = records.map(() => req.user.email);

        await pool.query(`
            INSERT INTO attendance_records (employee_id, date, status, marked_by, remarks, updated_at)
            SELECT unnest($1::text[]), unnest($2::date[]), unnest($3::text[]),
                   unnest($4::text[]), unnest($5::text[]), NOW()
            ON CONFLICT (employee_id, date)
            DO UPDATE SET status=EXCLUDED.status, remarks=EXCLUDED.remarks,
                          marked_by=EXCLUDED.marked_by, updated_at=NOW()
        `, [empIds, dates, statuses, markers, remarks]);

        res.json({ ok: true, saved: records.length, date });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/attendance/report/monthly — monthly summary for HR/Finance ───────
app.get('/api/attendance/report/monthly', requireAuth, requireRole('hr_manager','finance_manager','finance_approver','superadmin','admin'), async (req, res) => {
    const { month, year, client, site } = req.query;
    const mo = parseInt(month) || new Date().getMonth() + 1;
    const yr = parseInt(year)  || new Date().getFullYear();

    try {
        // Working days in the month (Mon-Fri, simplified — future: exclude public holidays)
        const daysInMonth = new Date(yr, mo, 0).getDate();
        const workingDays = Array.from({ length: daysInMonth }, (_, i) => {
            const d = new Date(yr, mo - 1, i + 1);
            return d.getDay() !== 0 && d.getDay() !== 6; // Exclude Sun/Sat
        }).filter(Boolean).length;

        let q = `
            SELECT
                e.id AS employee_id, e.name, e.location AS site, e.client,
                e.designation, e.salary,
                COUNT(*) FILTER (WHERE ar.status = 'present') AS present,
                COUNT(*) FILTER (WHERE ar.status = 'absent')  AS absent,
                COUNT(*) FILTER (WHERE ar.status = 'half_day') AS half_day,
                COUNT(*) FILTER (WHERE ar.status = 'leave')   AS on_leave,
                COUNT(*) FILTER (WHERE ar.status = 'ot')      AS overtime,
                COUNT(ar.id)                                   AS total_marked
            FROM employees e
            LEFT JOIN attendance_records ar
                ON ar.employee_id = e.id
                AND EXTRACT(MONTH FROM ar.date) = $1
                AND EXTRACT(YEAR  FROM ar.date) = $2
            WHERE e.active = 'Yes'
        `;
        const params = [mo, yr];
        if (client && client !== 'All') { params.push(client); q += ` AND e.client = $${params.length}`; }
        if (site   && site   !== 'All') { params.push(site);   q += ` AND e.location = $${params.length}`; }
        q += ' GROUP BY e.id, e.name, e.location, e.client, e.designation, e.salary ORDER BY e.name';

        const { rows } = await pool.query(q, params);

        // Compute attendance % and salary deduction
        const summary = rows.map(r => {
            const pres     = parseInt(r.present)   || 0;
            const abs      = parseInt(r.absent)    || 0;
            const half     = parseInt(r.half_day)  || 0;
            const leave    = parseInt(r.on_leave)  || 0;
            const effPres  = pres + (half * 0.5); // half-day counts as 0.5
            const pct      = workingDays > 0 ? Math.round((effPres / workingDays) * 100) : null;
            const dailyRate = parseFloat(r.salary || 0) / workingDays;
            const deduction = Math.round(abs * dailyRate + half * dailyRate * 0.5);
            return { ...r, working_days: workingDays, attendance_pct: pct, salary_deduction: deduction };
        });

        res.json({ month: mo, year: yr, working_days: workingDays, employees: summary });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/attendance/report/weekly — day-by-day for a specific week ────────
app.get('/api/attendance/report/weekly', requireAuth, requireRole('hr_manager','finance_manager','finance_approver','superadmin','admin','supervisor'), async (req, res) => {
    const { week_start } = req.query; // ISO date string YYYY-MM-DD (Monday)
    if (!week_start) return res.status(400).json({ error: 'week_start required (YYYY-MM-DD)' });

    try {
        const weekDates = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(week_start);
            d.setDate(d.getDate() + i);
            return d.toISOString().slice(0, 10);
        });

        const { rows } = await pool.query(`
            SELECT ar.employee_id, e.name, e.designation, e.location, ar.date, ar.status, ar.remarks
            FROM attendance_records ar
            JOIN employees e ON e.id = ar.employee_id
            WHERE ar.date >= $1 AND ar.date <= $2
            ORDER BY e.name, ar.date
        `, [weekDates[0], weekDates[6]]);

        // Pivot: { employee_id: { name, dates: { YYYY-MM-DD: status } } }
        const pivot = {};
        rows.forEach(r => {
            if (!pivot[r.employee_id]) {
                pivot[r.employee_id] = { employee_id: r.employee_id, name: r.name, designation: r.designation, site: r.location, dates: {} };
            }
            pivot[r.employee_id].dates[r.date] = { status: r.status, remarks: r.remarks };
        });

        res.json({ week_start, week_dates: weekDates, employees: Object.values(pivot) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/attendance/export — CSV download ─────────────────────────────────
app.get('/api/attendance/export', requireAuth, requireRole('hr_manager','finance_manager','superadmin','admin'), async (req, res) => {
    const { month, year, client } = req.query;
    const mo = parseInt(month) || new Date().getMonth() + 1;
    const yr = parseInt(year)  || new Date().getFullYear();

    try {
        let q = `
            SELECT e.id, e.name, e.client, e.location, e.designation, e.salary,
                   ar.date, ar.status, ar.remarks, ar.marked_by
            FROM attendance_records ar
            JOIN employees e ON e.id = ar.employee_id
            WHERE EXTRACT(MONTH FROM ar.date) = $1 AND EXTRACT(YEAR FROM ar.date) = $2
        `;
        const params = [mo, yr];
        if (client && client !== 'All') { params.push(client); q += ` AND e.client = $${params.length}`; }
        q += ' ORDER BY e.name, ar.date';

        const { rows } = await pool.query(q, params);
        const headers = ['Employee ID','Name','Client','Site','Designation','Salary','Date','Status','Remarks','Marked By'];
        const csv = [
            headers.join(','),
            ...rows.map(r => [
                r.id, `"${r.name}"`, `"${r.client||''}"`, `"${r.location||''}"`,
                `"${r.designation||''}"`, r.salary, r.date, r.status,
                `"${(r.remarks||'').replace(/"/g,'""')}"`, r.marked_by
            ].join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="attendance_${yr}_${String(mo).padStart(2,'0')}.csv"`);
        res.send(csv);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/attendance/teams — list all supervisor teams (admin) ─────────────
app.get('/api/attendance/teams', requireAuth, requireRole('hr_manager','superadmin','admin'), async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT st.supervisor_email, st.employee_id, st.site, st.client,
                   st.active, st.id AS assignment_id,
                   e.name AS employee_name, e.designation
            FROM supervisor_teams st
            JOIN employees e ON e.id = st.employee_id
            ORDER BY st.supervisor_email, e.name
        `);
        // Group by supervisor
        const grouped = {};
        rows.forEach(r => {
            if (!grouped[r.supervisor_email]) {
                grouped[r.supervisor_email] = { supervisor_email: r.supervisor_email, site: r.site, client: r.client, active: r.active, team: [] };
            }
            grouped[r.supervisor_email].team.push({ id: r.assignment_id, employee_id: r.employee_id, name: r.employee_name, designation: r.designation });
        });
        res.json({ teams: Object.values(grouped) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/attendance/teams/assign — assign employees to a supervisor ───────
app.post('/api/attendance/teams/assign', requireAuth, requireRole('hr_manager','superadmin','admin'), async (req, res) => {
    const { supervisor_email, employee_ids, site, client, contract_id } = req.body;
    if (!supervisor_email || !employee_ids?.length) return res.status(400).json({ error: 'supervisor_email and employee_ids required' });

    try {
        const emails  = employee_ids.map(() => supervisor_email);
        const ids     = employee_ids;
        const sites   = employee_ids.map(() => site || null);
        const clients = employee_ids.map(() => client || null);
        const ctIds   = employee_ids.map(() => contract_id || null);

        await pool.query(`
            INSERT INTO supervisor_teams (supervisor_email, employee_id, site, client, contract_id)
            SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), unnest($4::text[]), unnest($5::text[])
            ON CONFLICT (supervisor_email, employee_id)
            DO UPDATE SET site=$3[1], client=$4[1], contract_id=$5[1], active=true
        `, [emails, ids, sites, clients, ctIds]);

        res.json({ ok: true, assigned: employee_ids.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/attendance/teams/:id — remove assignment ─────────────────────
app.delete('/api/attendance/teams/:id', requireAuth, requireRole('hr_manager','superadmin','admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM supervisor_teams WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
