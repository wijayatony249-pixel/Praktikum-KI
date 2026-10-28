const jwt = require('jsonwebtoken');

const GATEWAY_SECRET = process.env.GATEWAY_SECRET || 'zt-gateway-super-secret-key-2026';
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'zt-access-token-secret-10m-key';
const JWT_SERVICE_SECRET = process.env.JWT_SERVICE_SECRET || 'zt-service-token-secret-5m-key';

/**
 * Middleware Zero Trust: Defense in Depth / Assume Breach
 * 1. Memeriksa keberadaan dan keabsahan header X-Gateway-Secret.
 * 2. Memverifikasi ulang keaslian dan masa berlaku JWT token.
 */
function verifyGatewayAndToken(req, res, next) {
    const incomingSecret = req.headers['x-gateway-secret'];

    // 1. Verifikasi Gateway Secret
    if (!incomingSecret || incomingSecret !== GATEWAY_SECRET) {
        console.warn(`[SERVICE NILAI] Direct access attempt blocked! Header X-Gateway-Secret missing or mismatch.`);
        return res.status(403).json({
            status: 'DENY',
            error: 'Direct access forbidden: Service Nilai hanya dapat diakses melalui API Gateway resmi (Port 3000). Header X-Gateway-Secret tidak valid.'
        });
    }

    // 2. Verifikasi Ulang Token JWT di level Service
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
                error: 'Token tidak valid atau telah kedaluwarsa saat diverifikasi ulang oleh Service Nilai'
            });
        }
    }

    req.user = decoded;
    next();
}

module.exports = {
    verifyGatewayAndToken
};

