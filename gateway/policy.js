const jwt = require('jsonwebtoken');
const db = require('../database/db');

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'zt-access-token-secret-10m-key';
const JWT_SERVICE_SECRET = process.env.JWT_SERVICE_SECRET || 'zt-service-token-secret-5m-key';

function getOperationalHour(req) {
    if (req && req.headers['x-simulate-hour']) {
        const sim = parseInt(req.headers['x-simulate-hour'], 10);
        if (!isNaN(sim)) return sim;
    }
    if (process.env.ACCESS_HOURS_SIMULATED_ENABLED === 'true') {
        const simHour = parseInt(process.env.ACCESS_HOURS_SIMULATED_HOUR, 10);
        return isNaN(simHour) ? new Date().getHours() : simHour;
    }
    return new Date().getHours();
}

function evaluatePolicy(req) {
    const authHeader = req.headers['authorization'];
    const deviceId = req.headers['x-device-id'];
    const path = (req.originalUrl || req.url).split('?')[0];
    const method = req.method.toUpperCase();

    // 1. Verifikasi Header Authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
            allowed: false,
            status: 401,
            reason: 'Token autentikasi tidak ditemukan (Header Authorization: Bearer <token> wajib)',
            subject: 'ANONYMOUS',
            role: null,
            device_id: deviceId
        };
    }

    const token = authHeader.split(' ')[1];
    let decoded = null;
    let isServiceToken = false;

    // Coba verifikasi dengan Access Secret, jika gagal coba Service Secret
    try {
        decoded = jwt.verify(token, JWT_ACCESS_SECRET);
    } catch (e1) {
        try {
            decoded = jwt.verify(token, JWT_SERVICE_SECRET);
            isServiceToken = true;
        } catch (e2) {
            return {
                allowed: false,
                status: 401,
                reason: 'Token JWT tidak valid atau telah kedaluwarsa (Expired/Invalid Signature)',
                subject: 'UNKNOWN',
                role: null,
                device_id: deviceId
            };
        }
    }

    const subject = decoded.sub;
    const role = decoded.role;

    // 2. Evaluasi Request dari Service (M2M)
    if (role === 'service' || isServiceToken) {
        if (path === '/transkrip/sinkron' && method === 'POST') {
            return {
                allowed: true,
                status: 200,
                reason: 'Akses M2M diizinkan: Service Nilai memanggil sinkronisasi transkrip dengan token service valid',
                subject,
                role,
                device_id: null,
                user: decoded
            };
        } else {
            return {
                allowed: false,
                status: 403,
                reason: `Service token (${subject}) dilarang mengakses endpoint selain /transkrip/sinkron`,
                subject,
                role,
                device_id: null
            };
        }
    }

    // 3. Evaluasi Request dari User (Admin, Dosen, Mahasiswa)
    // 3.1 Verifikasi Konteks: Device ID Terdaftar (Bagian 4.3)
    if (!deviceId) {
        return {
            allowed: false,
            status: 403,
            reason: 'Header X-Device-ID wajib disertakan untuk setiap request user',
            subject,
            role,
            device_id: null
        };
    }

    const device = db.prepare('SELECT * FROM devices WHERE user_id = ? AND device_id = ?').get(decoded.id, deviceId);
    if (!device) {
        return {
            allowed: false,
            status: 403,
            reason: `Device '${deviceId}' tidak terdaftar untuk user '${subject}'`,
            subject,
            role,
            device_id: deviceId
        };
    }

    // 3.2 Verifikasi Konteks: Jam Akses Operasional (07.00 - 21.00) (Bagian 4.3)
    // Jam akses berlaku untuk perubahan (PUT /nilai/:id) dan finalisasi (POST /kelas/:id/finalisasi)
    const isModificationOrFinalization = (method === 'PUT' && path.startsWith('/nilai/')) ||
                                         (method === 'POST' && path.includes('/finalisasi'));

    if (isModificationOrFinalization) {
        const startHour = parseInt(process.env.ACCESS_HOURS_START || '7', 10);
        const endHour = parseInt(process.env.ACCESS_HOURS_END || '21', 10);
        const currentHour = getOperationalHour(req);

        if (currentHour < startHour || currentHour >= endHour) {
            return {
                allowed: false,
                status: 403,
                reason: `Akses ditolak di luar jam operasional (${startHour}.00 - ${endHour}.00). Jam terdeteksi sistem: ${currentHour}.00`,
                subject,
                role,
                device_id: deviceId
            };
        }
    }

    // 3.3 Verifikasi Hak Akses & Kepemilikan Data (ABAC) sesuai Tabel 3
    // Matriks: GET /nilai
    if (method === 'GET' && path === '/nilai') {
        if (role === 'mahasiswa' || role === 'dosen') {
            return {
                allowed: true,
                status: 200,
                reason: `Akses GET /nilai diizinkan untuk role ${role}`,
                subject,
                role,
                device_id: deviceId,
                user: decoded
            };
        }
        return {
            allowed: false,
            status: 403,
            reason: `Role '${role}' tidak diizinkan mengakses GET /nilai (Hanya Mahasiswa dan Dosen)`,
            subject,
            role,
            device_id: deviceId
        };
    }

    // Matriks: PUT /nilai/:id
    const putNilaiMatch = path.match(/^\/nilai\/(\d+)$/);
    if (method === 'PUT' && putNilaiMatch) {
        const nilaiId = parseInt(putNilaiMatch[1], 10);

        if (role !== 'dosen') {
            return {
                allowed: false,
                status: 403,
                reason: `Hanya role dosen yang dapat mengubah nilai`,
                subject,
                role,
                device_id: deviceId
            };
        }

        // Cek Kepemilikan Data (ABAC): Kelas yang diampu dosen
        const record = db.prepare(`
            SELECT n.id as nilai_id, k.id as kelas_id, k.dosen_id, k.status as status_kelas, k.nama_mk
            FROM nilai n
            JOIN kelas k ON k.id = n.kelas_id
            WHERE n.id = ?
        `).get(nilaiId);

        if (!record) {
            return {
                allowed: false,
                status: 404,
                reason: `Data nilai dengan ID ${nilaiId} tidak ditemukan`,
                subject,
                role,
                device_id: deviceId
            };
        }

        if (record.dosen_id !== decoded.id) {
            return {
                allowed: false,
                status: 403,
                reason: `Akses ditolak: Anda bukan dosen pengampu untuk kelas ini '${record.nama_mk}'`,
                subject,
                role,
                device_id: deviceId
            };
        }

        if (record.status_kelas === 'final') {
            return {
                allowed: false,
                status: 403,
                reason: `Nilai pada kelas '${record.nama_mk}' telah difinalisasi dan tidak dapat diubah lagi`,
                subject,
                role,
                device_id: deviceId
            };
        }

        return {
            allowed: true,
            status: 200,
            reason: `Akses PUT /nilai/${nilaiId} diizinkan untuk dosen pengampu (dalam jam operasional & status draft)`,
            subject,
            role,
            device_id: deviceId,
            user: decoded
        };
    }

    // Matriks: POST /kelas/:id/finalisasi
    const postFinalisasiMatch = path.match(/^\/kelas\/(\d+)\/finalisasi$/);
    if (method === 'POST' && postFinalisasiMatch) {
        const kelasId = parseInt(postFinalisasiMatch[1], 10);

        if (role !== 'dosen') {
            return {
                allowed: false,
                status: 403,
                reason: `Hanya role dosen yang dapat memfinalisasi nilai kelas`,
                subject,
                role,
                device_id: deviceId
            };
        }

        const kelas = db.prepare('SELECT * FROM kelas WHERE id = ?').get(kelasId);
        if (!kelas) {
            return {
                allowed: false,
                status: 404,
                reason: `Kelas dengan ID ${kelasId} tidak ditemukan`,
                subject,
                role,
                device_id: deviceId
            };
        }

        if (kelas.dosen_id !== decoded.id) {
            return {
                allowed: false,
                status: 403,
                reason: `Akses ditolak: Anda bukan dosen pengampu kelas '${kelas.nama_mk}'`,
                subject,
                role,
                device_id: deviceId
            };
        }

        if (kelas.status === 'final') {
            return {
                allowed: false,
                status: 400,
                reason: `Kelas '${kelas.nama_mk}' sudah berstatus final (sudah pernah difinalisasi)`,
                subject,
                role,
                device_id: deviceId
            };
        }

        return {
            allowed: true,
            status: 200,
            reason: `Akses POST /kelas/${kelasId}/finalisasi diizinkan untuk dosen pengampu`,
            subject,
            role,
            device_id: deviceId,
            user: decoded
        };
    }

    // Matriks: GET /transkrip/:nim
    const getTranskripMatch = path.match(/^\/transkrip\/([a-zA-Z0-9]+)$/);
    if (method === 'GET' && getTranskripMatch) {
        const requestedNim = getTranskripMatch[1];

        if (role === 'admin') {
            return {
                allowed: true,
                status: 200,
                reason: `Akses transkrip NIM ${requestedNim} diizinkan untuk Admin (melihat seluruh mahasiswa)`,
                subject,
                role,
                device_id: deviceId,
                user: decoded
            };
        }

        if (role === 'mahasiswa') {
            if (decoded.nomor_induk !== requestedNim) {
                return {
                    allowed: false,
                    status: 403,
                    reason: `Akses ditolak: Mahasiswa hanya berhak melihat transkrip miliknya sendiri (${decoded.nomor_induk}), bukan NIM ${requestedNim}`,
                    subject,
                    role,
                    device_id: deviceId
                };
            }
            return {
                allowed: true,
                status: 200,
                reason: `Akses transkrip sendiri diizinkan untuk mahasiswa ${subject} (${requestedNim})`,
                subject,
                role,
                device_id: deviceId,
                user: decoded
            };
        }

        return {
            allowed: false,
            status: 403,
            reason: `Role '${role}' tidak diizinkan mengakses transkrip mahasiswa`,
            subject,
            role,
            device_id: deviceId
        };
    }

    // Matriks: POST /transkrip/sinkron (dipanggil user biasa -> WAJIB TOLAK)
    if (method === 'POST' && path === '/transkrip/sinkron') {
        return {
            allowed: false,
            status: 403,
            reason: 'Hanya token role service yang diizinkan untuk sinkronisasi transkrip. Token user ditolak.',
            subject,
            role,
            device_id: deviceId
        };
    }

    // Endpoint tidak dikenali
    return {
        allowed: false,
        status: 404,
        reason: `Endpoint ${method} ${path} tidak didefinisikan dalam kebijakan akses`,
        subject,
        role,
        device_id: deviceId
    };
}

module.exports = {
    evaluatePolicy,
    getOperationalHour
};
