const jwt = require('jsonwebtoken');

const GATEWAY_SECRET = process.env.GATEWAY_SECRET || 'zt-gateway-super-secret-key-2026';
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'zt-access-token-secret-10m-key';
const JWT_SERVICE_SECRET = process.env.JWT_SERVICE_SECRET || 'zt-service-token-secret-5m-key';

/**
 * Middleware Zero Trust pada Service Transkrip:
 * 1. Memeriksa keabsahan header X-Gateway-Secret.
 * 2. Memverifikasi ulang tanda tangan JWT access token atau service token.
 */
function verifyGatewayAndToken(req, res, next) {
    const incomingSecret = req.headers['x-gateway-secret'];

    // 1. Verifikasi Gateway Secret (Mencegah Direct Access)
    if (!incomingSecret || incomingSecret !== GATEWAY_SECRET) {
        console.warn(`[SERVICE TRANSKRIP] Direct access attempt blocked! Missing or invalid X-Gateway-Secret.`);
        return res.status(403).json({
            status: 'DENY',
            error: 'Direct access forbidden: Service Transkrip hanya dapat diakses melalui API Gateway resmi (Port 3000).'
        });
    }

    // 2. Verifikasi Ulang Token JWT
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            status: 'DENY',
            error: 'Token autentikasi tidak ditemukan pada request'
        });
    }

    const token = authHeader.split(' ')[1];
    let decoded = null;

    try {
        decoded = jwt.verify(token, JWT_ACCESS_SECRET);
    } catch (e1) {
        try {
            decoded = jwt.verify(token, JWT_SERVICE_SECRET);
        } catch (e2) {
            return res.status(401).json({
                status: 'DENY',
                error: 'Token tidak valid atau telah kedaluwarsa saat diverifikasi ulang oleh Service Transkrip'
            });
        }
    }

    req.user = decoded;
    next();
}

module.exports = {
    verifyGatewayAndToken
};

