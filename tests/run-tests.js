const db = require('../database/db');
const seedDatabase = require('../database/seed');

const GATEWAY_URL = 'http://127.0.0.1:3000';
const NILAI_URL = 'http://127.0.0.1:3001';
const TRANSKRIP_URL = 'http://127.0.0.1:3002';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let passed = 0;
let failed = 0;

function assert(condition, testName, detail = '') {
    if (condition) {
        console.log(`\x1b[32m✔ [PASS]\x1b[0m ${testName}`);
        passed++;
    } else {
        console.error(`\x1b[31m✖ [FAIL]\x1b[0m ${testName} ${detail ? `-> ${detail}` : ''}`);
        failed++;
    }
}

async function runTestSuite() {
    console.log('\n=============================================================');
    console.log('   MENJALANKAN RANGKAIAN PENGUJIAN OTOMATIS ZERO TRUST');
    console.log('=============================================================\n');

    // Reset database to initial seed state
    seedDatabase();

    // -------------------------------------------------------------
    // SKENARIO 1: AUTENTIKASI & VERIFIKASI KONTEKS DEVICE (4.1 & 4.3)
    // -------------------------------------------------------------
    console.log('\n--- [1. PENGUJIAN LOGIN & DEVICE ID] ---');

    // 1.1 Login Dosen 1 dengan Device Sah
    const resLoginDosen1 = await fetch(`${GATEWAY_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': 'DEV-DOSEN-1' },
        body: JSON.stringify({ username: 'dosen1', password: 'dosen123' })
    });
    const dataLoginDosen1 = await resLoginDosen1.json();
    assert(resLoginDosen1.status === 200 && dataLoginDosen1.access_token, '1.1 Dosen 1 login dengan kredensial & device terdaftar berhasil (200 OK)');
    const tokenDosen1 = dataLoginDosen1.access_token;
    const refreshDosen1 = dataLoginDosen1.refresh_token;

    // 1.2 Login Dosen 1 dengan Device Tidak Terdaftar
    const resLoginFakeDevice = await fetch(`${GATEWAY_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': 'DEV-HACKER-DEVICE' },
        body: JSON.stringify({ username: 'dosen1', password: 'dosen123' })
    });
    const dataLoginFakeDevice = await resLoginFakeDevice.json();
    assert(resLoginFakeDevice.status === 403 && dataLoginFakeDevice.status === 'DENY', '1.2 Login ditolak saat menggunakan Device ID tidak terdaftar (403 Forbidden)');

    // 1.3 Login Mahasiswa 1
    const resLoginMhs1 = await fetch(`${GATEWAY_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': 'DEV-MHS-1' },
        body: JSON.stringify({ username: 'mhs1', password: 'mhs123' })
    });
    const dataLoginMhs1 = await resLoginMhs1.json();
    assert(resLoginMhs1.status === 200, '1.3 Mahasiswa 1 login berhasil');
    const tokenMhs1 = dataLoginMhs1.access_token;

    // 1.4 Login Dosen 2
    const resLoginDosen2 = await fetch(`${GATEWAY_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': 'DEV-DOSEN-2' },
        body: JSON.stringify({ username: 'dosen2', password: 'dosen123' })
    });
    const dataLoginDosen2 = await resLoginDosen2.json();
    const tokenDosen2 = dataLoginDosen2.access_token;

    // 1.5 Login Admin 1
    const resLoginAdmin = await fetch(`${GATEWAY_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-ID': 'DEV-ADMIN-1' },
        body: JSON.stringify({ username: 'admin1', password: 'admin123' })
    });
    const dataLoginAdmin = await resLoginAdmin.json();
    const tokenAdmin = dataLoginAdmin.access_token;

    // -------------------------------------------------------------
    // SKENARIO 2: VERIFIKASI KONTEKS HEADER DEVICE PADA ENDPOINT
    // -------------------------------------------------------------
    console.log('\n--- [2. PENGUJIAN DEVICE BINDING PADA REQUEST API] ---');

    // 2.1 Request tanpa header X-Device-ID
    const resNoDevHeader = await fetch(`${GATEWAY_URL}/nilai`, {
        headers: { 'Authorization': `Bearer ${tokenMhs1}` }
    });
    assert(resNoDevHeader.status === 403, '2.1 Request tanpa header X-Device-ID ditolak (403 Forbidden)');

    // 2.2 Request dengan X-Device-ID milik orang lain
    const resWrongDevHeader = await fetch(`${GATEWAY_URL}/nilai`, {
        headers: { 'Authorization': `Bearer ${tokenMhs1}`, 'X-Device-ID': 'DEV-DOSEN-1' }
    });
    assert(resWrongDevHeader.status === 403, '2.2 Mahasiswa 1 memakai Device ID Dosen 1 ditolak (403 Forbidden)');

    // 2.3 Mahasiswa 1 dengan Device ID miliknya sendiri
    const resValidMhsNilai = await fetch(`${GATEWAY_URL}/nilai`, {
        headers: { 'Authorization': `Bearer ${tokenMhs1}`, 'X-Device-ID': 'DEV-MHS-1' }
    });
    const dataValidMhsNilai = await resValidMhsNilai.json();
    console.log('DEBUG 2.3 Status:', resValidMhsNilai.status, 'Body:', dataValidMhsNilai);
    assert(resValidMhsNilai.status === 200 && dataValidMhsNilai.total_data >= 1, '2.3 Mahasiswa 1 melihat nilai sendiri dengan device valid berhasil (200 OK)');

    // -------------------------------------------------------------
    // SKENARIO 3: LEAST PRIVILEGE & ABAC (KEPEMILIKAN DATA)
    // -------------------------------------------------------------
    console.log('\n--- [3. PENGUJIAN LEAST PRIVILEGE & ABAC DATA OWNERSHIP] ---');

    // 3.1 Dosen 2 mencoba mengedit nilai pada Kelas 1 (milik Dosen 1) -> Nilai ID 1
    const resDosen2EditKelas1 = await fetch(`${GATEWAY_URL}/nilai/1`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${tokenDosen2}`,
            'X-Device-ID': 'DEV-DOSEN-2',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ nilai_angka: 95, nilai_huruf: 'A' })
    });
    const dataDosen2EditKelas1 = await resDosen2EditKelas1.json();
    assert(resDosen2EditKelas1.status === 403, '3.1 Dosen 2 ditolak saat ingin mengedit nilai kelas milik Dosen 1 (403 Forbidden)');

    // 3.2b Dosen 1 mencoba mengedit nilai di luar jam akses (simulasi jam 23:00)
    const resDosen1Malam = await fetch(`${GATEWAY_URL}/nilai/1`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${tokenDosen1}`,
            'X-Device-ID': 'DEV-DOSEN-1',
            'X-Simulate-Hour': '23',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ nilai_angka: 92.0, nilai_huruf: 'A' })
    });
    const dataDosen1Malam = await resDosen1Malam.json();
    assert(resDosen1Malam.status === 403, '3.2b Dosen ditolak saat mengubah nilai di luar jam operasional (simulasi 23.00 malam) (403 Forbidden)');

    // 3.2 Dosen 1 mengedit nilai pada kelas miliknya sendiri (Nilai ID 1) (dalam jam operasional)
    const resDosen1EditKelas1 = await fetch(`${GATEWAY_URL}/nilai/1`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${tokenDosen1}`,
            'X-Device-ID': 'DEV-DOSEN-1',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ nilai_angka: 90.0, nilai_huruf: 'A' })
    });
    const dataDosen1EditKelas1 = await resDosen1EditKelas1.json();
    assert(resDosen1EditKelas1.status === 200, '3.2 Dosen 1 berhasil mengedit nilai pada kelas miliknya (200 OK)');

    // 3.3 Mahasiswa 1 melihat transkrip NIM sendiri (22001)
    const resMhs1TranskripOwn = await fetch(`${GATEWAY_URL}/transkrip/22001`, {
        headers: { 'Authorization': `Bearer ${tokenMhs1}`, 'X-Device-ID': 'DEV-MHS-1' }
    });
    assert(resMhs1TranskripOwn.status === 200, '3.3 Mahasiswa 1 melihat transkrip NIM miliknya sendiri berhasil (200 OK)');

    // 3.4 Mahasiswa 1 mencoba mengintip transkrip Mahasiswa 2 (22002)
    const resMhs1TranskripOther = await fetch(`${GATEWAY_URL}/transkrip/22002`, {
        headers: { 'Authorization': `Bearer ${tokenMhs1}`, 'X-Device-ID': 'DEV-MHS-1' }
    });
    assert(resMhs1TranskripOther.status === 403, '3.4 Mahasiswa 1 ditolak saat mencoba melihat transkrip Mahasiswa 2 (403 Forbidden)');

    // 3.5 Admin melihat transkrip Mahasiswa 2 (22002)
    const resAdminTranskripMhs2 = await fetch(`${GATEWAY_URL}/transkrip/22002`, {
        headers: { 'Authorization': `Bearer ${tokenAdmin}`, 'X-Device-ID': 'DEV-ADMIN-1' }
    });
    assert(resAdminTranskripMhs2.status === 200, '3.5 Admin diizinkan melihat transkrip mahasiswa mana pun (200 OK)');

    // -------------------------------------------------------------
    // SKENARIO 4: FINALISASI & PANGGILAN ANTAR-SERVICE (M2M)
    // -------------------------------------------------------------
    console.log('\n--- [4. PENGUJIAN FINALISASI & PANGGILAN ANTAR-SERVICE M2M] ---');

    // 4.1 User biasa (Dosen/Admin) mencoba menembak POST /transkrip/sinkron langsung
    const resUserTembakSync = await fetch(`${GATEWAY_URL}/transkrip/sinkron`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenDosen1}`,
            'X-Device-ID': 'DEV-DOSEN-1',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ kelas_id: 1, data_nilai: [] })
    });
    assert(resUserTembakSync.status === 403, '4.1 User biasa ditolak memanggil /transkrip/sinkron (Wajib token role service)');

    // 4.2 Dosen 1 memfinalisasi Kelas 1
    const resFinalisasiKelas1 = await fetch(`${GATEWAY_URL}/kelas/1/finalisasi`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenDosen1}`, 'X-Device-ID': 'DEV-DOSEN-1' }
    });
    const dataFinalisasi = await resFinalisasiKelas1.json();
    assert(resFinalisasiKelas1.status === 200 && dataFinalisasi.sync_result, '4.2 Dosen 1 finalisasi kelas memicu M2M sinkronisasi via Gateway berhasil (200 OK)');

    // 4.3 Verifikasi hasil sinkronisasi ada di transkrip Mahasiswa 1
    const resCheckTranskripAfterSync = await fetch(`${GATEWAY_URL}/transkrip/22001`, {
        headers: { 'Authorization': `Bearer ${tokenMhs1}`, 'X-Device-ID': 'DEV-MHS-1' }
    });
    const dataCheckTranskrip = await resCheckTranskripAfterSync.json();
    assert(dataCheckTranskrip.transkrip.length >= 1, '4.3 Nilai mata kuliah Keamanan Informasi telah masuk ke transkrip Mahasiswa 1');

    // 4.4 Coba edit nilai pada kelas yang sudah difinalisasi
    const resEditAfterFinal = await fetch(`${GATEWAY_URL}/nilai/1`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${tokenDosen1}`,
            'X-Device-ID': 'DEV-DOSEN-1',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ nilai_angka: 99, nilai_huruf: 'A' })
    });
    assert(resEditAfterFinal.status === 403, '4.4 Dosen ditolak mengedit nilai pada kelas yang sudah difinalisasi (403 Forbidden)');

    // -------------------------------------------------------------
    // SKENARIO 5: PRINCIPLE OF ASSUME BREACH / DEFENSE IN DEPTH
    // -------------------------------------------------------------
    console.log('\n--- [5. PENGUJIAN DEFENSE IN DEPTH (BYPASS GATEWAY)] ---');

    // 5.1 Penyerang mencoba akses langsung ke Service Nilai (Port 3001) tanpa lewat Gateway
    const resDirectNilaiNoSecret = await fetch(`${NILAI_URL}/nilai`, {
        headers: { 'Authorization': `Bearer ${tokenMhs1}` }
    });
    assert(resDirectNilaiNoSecret.status === 403, '5.1 Akses langsung ke Service Nilai (Port 3001) tanpa X-Gateway-Secret ditolak (403 Forbidden)');

    // 5.2 Penyerang mencoba akses langsung ke Service Transkrip (Port 3002) tanpa lewat Gateway
    const resDirectTranskripNoSecret = await fetch(`${TRANSKRIP_URL}/transkrip/22001`, {
        headers: { 'Authorization': `Bearer ${tokenMhs1}` }
    });
    assert(resDirectTranskripNoSecret.status === 403, '5.2 Akses langsung ke Service Transkrip (Port 3002) tanpa X-Gateway-Secret ditolak (403 Forbidden)');

    // 5.3 Penyerang menebak secret tapi token tidak valid
    const resDirectSecretInvalidToken = await fetch(`${NILAI_URL}/nilai`, {
        headers: {
            'X-Gateway-Secret': 'zt-gateway-super-secret-key-2026',
            'Authorization': 'Bearer token-palsu-ngawur'
        }
    });
    assert(resDirectSecretInvalidToken.status === 401, '5.3 Bawa X-Gateway-Secret tapi token JWT palsu tetap ditolak Service Nilai (401 Unauthorized)');

    // -------------------------------------------------------------
    // SKENARIO 6: REFRESH TOKEN & LOGOUT REVOCATION (4.1)
    // -------------------------------------------------------------
    console.log('\n--- [6. PENGUJIAN REFRESH TOKEN & LOGOUT] ---');

    // 6.1 Refresh Token berhasil
    const resRefresh = await fetch(`${GATEWAY_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshDosen1 })
    });
    const dataRefresh = await resRefresh.json();
    assert(resRefresh.status === 200 && dataRefresh.access_token, '6.1 Memperbarui access token dengan refresh token valid berhasil (200 OK)');

    // 6.2 Logout mencabut refresh token
    const resLogout = await fetch(`${GATEWAY_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshDosen1 })
    });
    assert(resLogout.status === 200, '6.2 Logout berhasil mencabut refresh token di database (200 OK)');

    // 6.3 Menggunakan kembali refresh token yang telah dicabut
    const resReuseRevoked = await fetch(`${GATEWAY_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshDosen1 })
    });
    assert(resReuseRevoked.status === 403, '6.3 Refresh token yang telah dicabut (revoked) ditolak sistem (403 Forbidden)');

    // -------------------------------------------------------------
    // SKENARIO 7: AUDIT LOG (4.4)
    // -------------------------------------------------------------
    console.log('\n--- [7. PENGUJIAN AUDIT LOG] ---');
    const logs = db.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN decision = 'ALLOW' THEN 1 ELSE 0 END) as allows,
               SUM(CASE WHEN decision = 'DENY' THEN 1 ELSE 0 END) as denies
        FROM audit_logs
    `).get();
    assert(logs.total > 0 && logs.allows > 0 && logs.denies > 0, `7.1 Gateway berhasil mencatat audit logs (Total: ${logs.total}, ALLOW: ${logs.allows}, DENY: ${logs.denies})`);

    // Ambil contoh log dari database
    const sampleLog = db.prepare('SELECT subject, endpoint, decision, reason FROM audit_logs ORDER BY id DESC LIMIT 1').get();
    console.log(`[INFO] Contoh audit log terakhir: [${sampleLog.decision}] ${sampleLog.subject} -> ${sampleLog.endpoint} (${sampleLog.reason})`);

    console.log('\n=============================================================');
    console.log(`HASIL AKHIR PENGUJIAN: ${passed} LULUS, ${failed} GAGAL`);
    console.log('=============================================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

runTestSuite().catch(err => {
    console.error('Test Suite encountered an error:', err);
    process.exit(1);
});
