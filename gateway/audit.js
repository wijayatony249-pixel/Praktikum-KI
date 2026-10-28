const db = require('../database/db');

function logAudit({ subject, role = null, endpoint, method, device_id = null, decision, reason }) {
    try {
        const stmt = db.prepare(`
            INSERT INTO audit_logs (subject, role, endpoint, method, device_id, decision, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(subject || 'ANONYMOUS', role, endpoint, method, device_id, decision, reason);

        const color = decision === 'ALLOW' ? '\x1b[32m[PEP ALLOW]\x1b[0m' : '\x1b[31m[PEP DENY]\x1b[0m';
        console.log(`${color} [${method} ${endpoint}] Subject: ${subject || 'unknown'} (${role || 'none'}) | Device: ${device_id || '-'} | Decision: ${decision} | Reason: ${reason}`);
    } catch (err) {
        console.error('[AUDIT LOG ERROR]', err.message);
    }
}

module.exports = { logAudit };

