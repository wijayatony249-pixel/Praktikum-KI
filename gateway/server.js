require('dotenv').config();
const express = require('express');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');
const auth = require('./auth');
const { evaluatePolicy } = require('./policy');
const { logAudit } = require('./audit');
const db = require('../database/db');

const app = express();
const PORT = process.env.PORT_GATEWAY || 3000;
const PORT_NILAI = process.env.PORT_NILAI || 3001;
const PORT_TRANSKRIP = process.env.PORT_TRANSKRIP || 3002;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || 'zt-gateway-super-secret-key-2026';

app.use(express.json());

// Banner Logging saat request masuk
app.use((req, res, next) => {
    console.log(`\n[GATEWAY INCOMING] ${req.method} ${req.url} | Device: ${req.headers['x-device-id'] || '-'}`);
    next();
});

// ==========================================
// 1. ROUTE AUTENTIKASI (DITANGANI LANGSUNG OLEH GATEWAY)
// ==========================================
app.post('/auth/login', auth.login);
app.post('/auth/refresh', auth.refresh);
app.post('/auth/logout', auth.logout);
app.post('/auth/service', auth.serviceAuth);

// Endpoint tambahan untuk mempermudah demonstrasi Audit Log
app.get('/audit-logs', (req, res) => {
    try {
        const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50').all();
        res.json({ status: 'success', total: logs.length, logs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint untuk cek status gateway
app.get('/health', (req, res) => {
    res.json({
        service: 'API Gateway (Policy Enforcement Point)',
        port: PORT,
        status: 'UP',
        zero_trust_pep: 'ACTIVE'
    });
});

// ==========================================
// 2. MIDDLEWARE POLICY ENFORCEMENT POINT (PEP)
// ==========================================
const pepMiddleware = (req, res, next) => {
    const policyResult = evaluatePolicy(req);

    if (!policyResult.allowed) {
        // Catat ke Audit Log sebagai DENY
        logAudit({
            subject: policyResult.subject,
            role: policyResult.role,
            endpoint: req.originalUrl,
            method: req.method,
            device_id: policyResult.device_id,
            decision: 'DENY',
            reason: policyResult.reason
        });

        return res.status(policyResult.status || 403).json({
            status: 'DENY',
            error: 'Akses Ditolak oleh Zero Trust Policy Engine',
            code: policyResult.status || 403,
            reason: policyResult.reason
        });
    }

    // Catat ke Audit Log sebagai ALLOW
    logAudit({
        subject: policyResult.subject,
        role: policyResult.role,
        endpoint: req.originalUrl,
        method: req.method,
        device_id: policyResult.device_id,
        decision: 'ALLOW',
        reason: policyResult.reason
    });

    // Tempelkan decoded user ke req untuk diteruskan jika perlu
    req.user = policyResult.user;
    next();
};

// ==========================================
// 3. REVERSE PROXY KE RESOURCE SERVICES
// ==========================================

// Proxy ke Service Nilai (Port 3001) untuk path /nilai dan /kelas
const nilaiProxy = createProxyMiddleware({
    target: `http://127.0.0.1:${PORT_NILAI}`,
    changeOrigin: true,
    pathRewrite: (path, req) => req.originalUrl,
    on: {
        proxyReq: (proxyReq, req, res) => {
            // SISIPKAN HEADER X-Gateway-Secret (Mencegah direct access ke service)
            proxyReq.setHeader('X-Gateway-Secret', GATEWAY_SECRET);
            fixRequestBody(proxyReq, req);
        },
        error: (err, req, res) => {
            console.error('[GATEWAY PROXY ERROR to Service Nilai]', err.message);
            res.status(502).json({
                status: 'DENY',
                error: 'Bad Gateway: Gagal menghubungi Service Nilai (Port ' + PORT_NILAI + ')'
            });
        }
    }
});

// Proxy ke Service Transkrip (Port 3002) untuk path /transkrip
const transkripProxy = createProxyMiddleware({
    target: `http://127.0.0.1:${PORT_TRANSKRIP}`,
    changeOrigin: true,
    pathRewrite: (path, req) => req.originalUrl,
    on: {
        proxyReq: (proxyReq, req, res) => {
            // SISIPKAN HEADER X-Gateway-Secret
            proxyReq.setHeader('X-Gateway-Secret', GATEWAY_SECRET);
            fixRequestBody(proxyReq, req);
        },
        error: (err, req, res) => {
            console.error('[GATEWAY PROXY ERROR to Service Transkrip]', err.message);
            res.status(502).json({
                status: 'DENY',
                error: 'Bad Gateway: Gagal menghubungi Service Transkrip (Port ' + PORT_TRANSKRIP + ')'
            });
        }
    }
});

// Terapkan PEP Middleware sebelum Proxy
app.use(['/nilai', '/kelas'], pepMiddleware, nilaiProxy);
app.use('/transkrip', pepMiddleware, transkripProxy);

// Fallback untuk route yang tidak ditemukan
app.use((req, res) => {
    res.status(404).json({
        status: 'DENY',
        error: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan pada API Gateway`
    });
});

app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`[API GATEWAY - PEP] Berjalan di http://localhost:${PORT}`);
    console.log(`- Meneruskan /nilai & /kelas ke Port ${PORT_NILAI} (Service Nilai)`);
    console.log(`- Meneruskan /transkrip ke Port ${PORT_TRANSKRIP} (Service Transkrip)`);
    console.log(`- Policy Enforcement Point & Policy Administrator AKTIF`);
    console.log(`=======================================================`);
});
