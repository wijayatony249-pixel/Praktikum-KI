const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { logAudit } = require('./audit');

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'zt-access-token-secret-10m-key';
const JWT_SERVICE_SECRET = process.env.JWT_SERVICE_SECRET || 'zt-service-token-secret-5m-key';

// 1. POST /auth/login
function login(req, res) {
    const { username, password } = req.body || {};
    const deviceId = req.headers['x-device-id'] || req.body?.device_id;
    const endpoint = '/auth/login';
    const method = 'POST';

    if (!username || !password) {
        logAudit({
            subject: username || 'ANONYMOUS',
            endpoint,
            method,
            device_id: deviceId,
            decision: 'DENY',
            reason: 'Username dan password wajib diisi'
        });
        return res.status(400).json({ status: 'DENY', error: 'Username dan password wajib diisi' });
    }

    // 1. Verifikasi Kredensial User
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || user.password !== password) {
        logAudit({
            subject: username,
            endpoint,
            method,
            device_id: deviceId,
            decision: 'DENY',
            reason: 'Kredensial username atau password tidak valid'
        });
        return res.status(401).json({ status: 'DENY', error: 'Kredensial username atau password tidak valid' });
    }

    // 2. Verifikasi Konteks: Device Terdaftar (4.3)
    if (!deviceId) {
        logAudit({
            subject: username,
            role: user.role,
            endpoint,
            method,
            device_id: null,
            decision: 'DENY',
            reason: 'Header X-Device-ID wajib disertakan saat login'
        });
        return res.status(400).json({ status: 'DENY', error: 'Header X-Device-ID wajib disertakan' });
    }

    const device = db.prepare('SELECT * FROM devices WHERE user_id = ? AND device_id = ?').get(user.id, deviceId);
    if (!device) {
        logAudit({
            subject: username,
            role: user.role,
            endpoint,
            method,
            device_id: deviceId,
            decision: 'DENY',
            reason: `Device '${deviceId}' tidak terdaftar untuk user '${username}'`
        });
        return res.status(403).json({
            status: 'DENY',
            error: `Device '${deviceId}' tidak terdaftar untuk akun ini. Akses ditolak sesuai prinsip Zero Trust Context Verification.`
        });
    }

    // 3. Terbitkan Access Token (JWT berlaku 10 menit, minimal berisi sub dan role)
    const payload = {
        sub: user.username,
        role: user.role,
        id: user.id,
        nomor_induk: user.nomor_induk,
        nama: user.nama
    };
    const accessToken = jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: '10m' });

    // 4. Terbitkan Refresh Token (berlaku 1 hari, disimpan di DB agar bisa dicabut)
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
        INSERT INTO refresh_tokens (user_id, token, expires_at, revoked)
        VALUES (?, ?, ?, 0)
    `).run(user.id, refreshToken, expiresAt);

    logAudit({
        subject: username,
        role: user.role,
        endpoint,
        method,
        device_id: deviceId,
        decision: 'ALLOW',
        reason: 'Login berhasil, kredensial dan device terverifikasi valid'
    });

    return res.status(200).json({
        status: 'ALLOW',
        message: 'Login berhasil',
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: '10m',
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            nama: user.nama,
            nomor_induk: user.nomor_induk,
            device_id: deviceId
        }
    });
}

// 2. POST /auth/refresh
function refresh(req, res) {
    const { refresh_token } = req.body || {};
    const endpoint = '/auth/refresh';
    const method = 'POST';

    if (!refresh_token) {
        logAudit({
            subject: 'ANONYMOUS',
            endpoint,
            method,
            decision: 'DENY',
            reason: 'Field refresh_token wajib diisi'
        });
        return res.status(400).json({ status: 'DENY', error: 'Field refresh_token wajib diisi' });
    }

    const record = db.prepare(`
        SELECT rt.*, u.username, u.role, u.nomor_induk, u.nama
        FROM refresh_tokens rt
        JOIN users u ON u.id = rt.user_id
        WHERE rt.token = ?
    `).get(refresh_token);

    if (!record) {
        logAudit({
            subject: 'UNKNOWN',
            endpoint,
            method,
            decision: 'DENY',
            reason: 'Refresh token tidak ditemukan di database'
        });
        return res.status(401).json({ status: 'DENY', error: 'Refresh token tidak valid' });
    }

    if (record.revoked === 1) {
        logAudit({
            subject: record.username,
            role: record.role,
            endpoint,
            method,
            decision: 'DENY',
            reason: 'Refresh token telah dicabut (revoked / pernah logout)'
        });
        return res.status(403).json({ status: 'DENY', error: 'Refresh token telah dicabut (revoked). Silakan login kembali.' });
    }

    if (new Date(record.expires_at) < new Date()) {
        logAudit({
            subject: record.username,
            role: record.role,
            endpoint,
            method,
            decision: 'DENY',
            reason: 'Refresh token telah kedaluwarsa (> 1 hari)'
        });
        return res.status(401).json({ status: 'DENY', error: 'Refresh token telah kedaluwarsa' });
    }

    // Terbitkan Access Token baru (10 menit)
    const payload = {
        sub: record.username,
        role: record.role,
        id: record.user_id,
        nomor_induk: record.nomor_induk,
        nama: record.nama
    };
    const newAccessToken = jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: '10m' });

    logAudit({
        subject: record.username,
        role: record.role,
        endpoint,
        method,
        decision: 'ALLOW',
        reason: 'Access token berhasil diperbarui menggunakan refresh token valid'
    });

    return res.status(200).json({
        status: 'ALLOW',
        message: 'Access token berhasil diperbarui',
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: '10m'
    });
}

// 3. POST /auth/logout
function logout(req, res) {
    const { refresh_token } = req.body || {};
    const endpoint = '/auth/logout';
    const method = 'POST';

    if (!refresh_token) {
        logAudit({
            subject: 'ANONYMOUS',
            endpoint,
            method,
            decision: 'DENY',
            reason: 'Field refresh_token wajib diisi saat logout'
        });
        return res.status(400).json({ status: 'DENY', error: 'Field refresh_token wajib diisi' });
    }

    const record = db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(refresh_token);
    if (!record) {
        logAudit({
            subject: 'UNKNOWN',
            endpoint,
            method,
            decision: 'DENY',
            reason: 'Refresh token tidak ditemukan untuk dicabut'
        });
        return res.status(404).json({ status: 'DENY', error: 'Refresh token tidak ditemukan' });
    }

    // Cabut refresh token
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(refresh_token);

    const user = db.prepare('SELECT username, role FROM users WHERE id = ?').get(record.user_id);

    logAudit({
        subject: user ? user.username : 'USER',
        role: user ? user.role : null,
        endpoint,
        method,
        decision: 'ALLOW',
        reason: 'Logout berhasil, refresh token dicabut dari database'
    });

    return res.status(200).json({
        status: 'ALLOW',
        message: 'Logout berhasil, refresh token telah dicabut'
    });
}

// 4. POST /auth/service (Token Service Nilai - M2M)
function serviceAuth(req, res) {
    const { client_id, client_secret } = req.body || {};
    const endpoint = '/auth/service';
    const method = 'POST';

    if (!client_id || !client_secret) {
        logAudit({
            subject: client_id || 'ANONYMOUS_SERVICE',
            role: 'service',
            endpoint,
            method,
            decision: 'DENY',
            reason: 'Client ID dan Client Secret wajib diisi'
        });
        return res.status(400).json({ status: 'DENY', error: 'Client ID dan Client Secret wajib diisi' });
    }

    const client = db.prepare('SELECT * FROM service_clients WHERE client_id = ?').get(client_id);
    if (!client || client.client_secret !== client_secret) {
        logAudit({
            subject: client_id,
            role: 'service',
            endpoint,
            method,
            decision: 'DENY',
            reason: 'Client ID atau secret service tidak valid'
        });
        return res.status(401).json({ status: 'DENY', error: 'Client credentials service tidak valid' });
    }

    // Terbitkan Service Token: berlaku 5 menit, role: service
    const payload = {
        sub: client.client_id,
        role: 'service',
        service_name: client.service_name
    };
    const serviceToken = jwt.sign(payload, JWT_SERVICE_SECRET, { expiresIn: '5m' });

    logAudit({
        subject: client.client_id,
        role: 'service',
        endpoint,
        method,
        decision: 'ALLOW',
        reason: 'Autentikasi M2M Service Nilai berhasil, Service Token diterbitkan (5m)'
    });

    return res.status(200).json({
        status: 'ALLOW',
        message: 'Token service berhasil diterbitkan',
        access_token: serviceToken,
        token_type: 'Bearer',
        role: 'service',
        expires_in: '5m'
    });
}

module.exports = {
    login,
    refresh,
    logout,
    serviceAuth
};

