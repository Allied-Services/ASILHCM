// ATTENDANCE + KPI MODULE
const crypto = require("crypto");

// ═══ TABLES (self-healing) ═══
async function initAttendanceKPITables(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS attendance_records (
        id SERIAL PRIMARY KEY,
        employee_id TEXT NOT NULL,
        date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Present',
        ot_hours NUMERIC DEFAULT 0,
        remarks TEXT,
        marked_by TEXT,
        marked_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(employee_id, date)
    )`);
    await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS supervisor_email TEXT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS contract_obligations (
        id SERIAL PRIMARY KEY,
        client_id TEXT,
        contract_id TEXT,
        obligation_type VARCHAR(100) NOT NULL DEFAULT 'Custom',
        title VARCHAR(200) NOT NULL,
        description TEXT,
        frequency_months INT NOT NULL DEFAULT 1,
        lead_time_days INT NOT NULL DEFAULT 30,
        reminder_every_days INT NOT NULL DEFAULT 7,
        escalation_after_days INT NOT NULL DEFAULT 14,
        responsible_email TEXT NOT NULL,
        escalation_email TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        last_fulfilled_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS obligation_instances (
        id SERIAL PRIMARY KEY,
        obligation_id INT REFERENCES contract_obligations(id) ON DELETE CASCADE,
        due_date DATE NOT NULL,
        status VARCHAR(50) DEFAULT 'Upcoming',
        assigned_to TEXT,
        reminder_count INT DEFAULT 0,
        last_reminder_at TIMESTAMPTZ,
        actioned_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        completed_by TEXT,
        completion_notes TEXT,
        action_token TEXT UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS reminder_log (
        id SERIAL PRIMARY KEY,
        instance_id INT,
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        sent_to TEXT,
        email_subject TEXT,
        status VARCHAR(20) DEFAULT 'sent'
    )`);
    console.log("Attendance + KPI tables ready");
}

// ═══ EMAIL HELPER ═══
async function sendReminderEmail(resend, emailFrom, instance, obligation, action) {
    const daysLeft = Math.ceil((new Date(instance.due_date) - new Date()) / 86400000);
    const isOverdue = daysLeft < 0;
    const subject = isOverdue
        ? `OVERDUE (${Math.abs(daysLeft)}d): ${obligation.title}`
        : `[Action Required] ${obligation.title} — Due in ${daysLeft} days`;
    const actionUrl = `${process.env.FRONTEND_URL || "https://asilhcm.onrender.com"}?action_token=${instance.action_token}&action=${action}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:${isOverdue?"#dc2626":"#6366f1"};color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
            <h2 style="margin:0">${isOverdue?"🔴 OVERDUE":"⏰ Action Required"}: ${obligation.title}</h2>
        </div>
        <div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
            <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:6px 0;color:#64748b;width:140px">Obligation</td><td style="padding:6px 0;font-weight:600">${obligation.title}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b">Type</td><td style="padding:6px 0">${obligation.obligation_type}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b">Due Date</td><td style="padding:6px 0;font-weight:600;color:${isOverdue?"#dc2626":"#16a34a"}">${new Date(instance.due_date).toDateString()} ${isOverdue?"(OVERDUE)":""}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b">Reminders Sent</td><td style="padding:6px 0">${instance.reminder_count}</td></tr>
            </table>
            <div style="margin-top:24px;display:flex;gap:12px">
                <a href="${actionUrl}&result=inprogress" style="background:#6366f1;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;margin-right:12px">Mark In Progress</a>
                <a href="${actionUrl}&result=completed" style="background:#16a34a;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">Mark Complete</a>
            </div>
            <p style="margin-top:20px;color:#64748b;font-size:0.85rem">You will receive reminders every ${obligation.reminder_every_days} days until this is marked complete.<br>ASIL HCM — Allied Services (Pvt.) Ltd.</p>
        </div>
    </div>`;
    await resend.emails.send({ from: emailFrom, to: instance.assigned_to || obligation.responsible_email, subject, html });
    return subject;
}

// ═══ CRON ENGINE (runs daily) ═══
async function runReminderEngine(pool, resend, emailFrom) {
    const today = new Date(); today.setHours(0,0,0,0);
    const { rows: obligations } = await pool.query(`SELECT o.*, c.name AS client_name, ct.contract_name FROM contract_obligations o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN contracts ct ON ct.id::text=o.contract_id WHERE o.is_active=TRUE`);
    let sent = 0;
    for (const ob of obligations) {
        // Calculate next_due_date
        const base = ob.last_fulfilled_date ? new Date(ob.last_fulfilled_date) : new Date(ob.created_at);
        const nextDue = new Date(base);
        nextDue.setMonth(nextDue.getMonth() + (ob.frequency_months || 1));
        const daysUntilDue = Math.ceil((nextDue - today) / 86400000);
        // Create instance if within lead time and none exists
        if (daysUntilDue <= (ob.lead_time_days || 30)) {
            const existing = await pool.query(`SELECT id FROM obligation_instances WHERE obligation_id=$1 AND due_date=$2`, [ob.id, nextDue.toISOString().split("T")[0]]);
            if (!existing.rows.length) {
                const token = crypto.randomBytes(24).toString("hex");
                await pool.query(`INSERT INTO obligation_instances (obligation_id,due_date,assigned_to,action_token) VALUES ($1,$2,$3,$4)`, [ob.id, nextDue.toISOString().split("T")[0], ob.responsible_email, token]);
            }
        }
        // Process open instances
        const { rows: instances } = await pool.query(`SELECT * FROM obligation_instances WHERE obligation_id=$1 AND status NOT IN ('Completed','Waived')`, [ob.id]);
        for (const inst of instances) {
            const dueDate = new Date(inst.due_date);
            if (dueDate < today && inst.status !== "Overdue") {
                await pool.query(`UPDATE obligation_instances SET status='Overdue' WHERE id=$1`, [inst.id]);
            }
            const lastReminder = inst.last_reminder_at ? new Date(inst.last_reminder_at) : null;
            const daysSinceLast = lastReminder ? Math.floor((today - lastReminder) / 86400000) : 999;
            if (daysSinceLast >= (ob.reminder_every_days || 7)) {
                try {
                    const subject = await sendReminderEmail(resend, emailFrom, inst, ob, "remind");
                    await pool.query(`UPDATE obligation_instances SET reminder_count=reminder_count+1, last_reminder_at=NOW() WHERE id=$1`, [inst.id]);
                    await pool.query(`INSERT INTO reminder_log (instance_id,sent_to,email_subject) VALUES ($1,$2,$3)`, [inst.id, inst.assigned_to || ob.responsible_email, subject]);
                    // Escalate if overdue and escalation_email set
                    if (inst.status === "Overdue" && ob.escalation_email) {
                        await resend.emails.send({ from: emailFrom, to: ob.escalation_email, subject: "[ESCALATION] " + subject, html: `<p>The following obligation is overdue and escalated to you.</p><p><strong>${ob.title}</strong> was due ${new Date(inst.due_date).toDateString()}. Assigned to: ${inst.assigned_to || ob.responsible_email}. Reminder #${inst.reminder_count + 1}.</p>` });
                    }
                    sent++;
                } catch(e) { console.warn("Reminder email failed:", e.message); }
            }
        }
    }
    return sent;
}

module.exports = { initAttendanceKPITables, runReminderEngine };
