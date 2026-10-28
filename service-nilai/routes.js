const express = require('express');
const router = express.Router();
const db = require('../database/db');

const GATEWAY_URL = process.env.GATEWAY_URL || `http://127.0.0.1:${process.env.PORT_GATEWAY || 3000}`;
const CLIENT_ID = process.env.SERVICE_NILAI_CLIENT_ID || 'service-nilai-client';
const CLIENT_SECRET = process.env.SERVICE_NILAI_CLIENT_SECRET || 'service-nilai-secret-2026';

// 1. GET /nilai
// Mahasiswa: hanya nilai miliknya sendiri
// Dosen: hanya nilai pada kelas-kelas yang diampunya
router.get('/nilai', (req, res) => {
    const user = req.user;

    try {
        if (user.role === 'mahasiswa') {
            const dataNilai = db.prepare(`
                SELECT n.id as nilai_id, k.id as kelas_id, k.kode_mk, k.nama_mk,
                       d.nama as dosen_pengampu, n.nilai_angka, n.nilai_huruf, k.status as status_kelas
                FROM nilai n
                JOIN kelas k ON k.id = n.kelas_id
                JOIN users d ON d.id = k.dosen_id
                WHERE n.mahasiswa_id = ?
            `).all(user.id);

            return res.json({
                status: 'ALLOW',
                role: 'mahasiswa',
                mahasiswa: user.nama,
                nim: user.nomor_induk,
                total_data: dataNilai.length,
                data: dataNilai
            });
        }

        if (user.role === 'dosen') {
            const dataNilai = db.prepare(`
                SELECT k.id as kelas_id, k.kode_mk, k.nama_mk, k.status as status_kelas,
                       n.id as nilai_id, m.nomor_induk as nim, m.nama as nama_mahasiswa,
                       n.nilai_angka, n.nilai_huruf
                FROM nilai n
                JOIN kelas k ON k.id = n.kelas_id
                JOIN users m ON m.id = n.mahasiswa_id
                WHERE k.dosen_id = ?
                ORDER BY k.id, m.nomor_induk
            `).all(user.id);

            return res.json({
                status: 'ALLOW',
                role: 'dosen',
                dosen: user.nama,
                nidn: user.nomor_induk,
                total_data: dataNilai.length,
                data: dataNilai
            });
        }

        return res.status(403).json({
            status: 'DENY',
            error: `Role ${user.role} tidak memiliki hak akses melihat data nilai`
        });
    } catch (err) {
        console.error('[SERVICE NILAI ERROR]', err);
        return res.status(500).json({ error: 'Internal Server Error pada Service Nilai', details: err.message });
    }
});

// 2. PUT /nilai/:id
// Mengubah nilai pada kelas yang diampu (belum final dan dalam jam akses)
router.put('/nilai/:id', (req, res) => {
    const nilaiId = req.params.id;
    const { nilai_angka, nilai_huruf } = req.body || {};

    if (nilai_angka === undefined || !nilai_huruf) {
        return res.status(400).json({
            status: 'DENY',
            error: 'Field nilai_angka dan nilai_huruf wajib disertakan'
        });
    }

    try {
        db.prepare(`
            UPDATE nilai
            SET nilai_angka = ?, nilai_huruf = ?
            WHERE id = ?
        `).run(parseFloat(nilai_angka), String(nilai_huruf).toUpperCase(), nilaiId);

        const updated = db.prepare(`
            SELECT n.id, n.nilai_angka, n.nilai_huruf, k.nama_mk, m.nama as nama_mahasiswa, m.nomor_induk as nim
            FROM nilai n
            JOIN kelas k ON k.id = n.kelas_id
            JOIN users m ON m.id = n.mahasiswa_id
            WHERE n.id = ?
        `).get(nilaiId);

        return res.json({
            status: 'ALLOW',
            message: 'Nilai mahasiswa berhasil diperbarui oleh dosen pengampu',
            data: updated
        });
    } catch (err) {
        console.error('[SERVICE NILAI ERROR]', err);
        return res.status(500).json({ error: 'Gagal memperbarui nilai', details: err.message });
    }
});

// 3. POST /kelas/:id/finalisasi
// Finalisasi nilai kelas oleh dosen dan otomatis memanggil sinkronisasi ke Service Transkrip via Gateway
router.post('/kelas/:id/finalisasi', async (req, res) => {
    const kelasId = req.params.id;

    try {
        // 1. Update status kelas menjadi 'final'
        db.prepare(`UPDATE kelas SET status = 'final' WHERE id = ?`).run(kelasId);

        const kelas = db.prepare('SELECT * FROM kelas WHERE id = ?').get(kelasId);
        const daftarNilai = db.prepare(`
            SELECT n.mahasiswa_id, n.nilai_huruf as nilai_akhir, k.kode_mk, k.nama_mk
            FROM nilai n
            JOIN kelas k ON k.id = n.kelas_id
            WHERE n.kelas_id = ?
        `).all(kelasId);

        console.log(`[SERVICE NILAI] Kelas ${kelas.nama_mk} berhasil difinalisasi.`);
        console.log(`[SERVICE NILAI] Menghubungi Gateway untuk otentikasi Service Token (M2M)...`);

        // 2. Meminta Service Token ke Gateway (POST /auth/service)
        const authResponse = await fetch(`${GATEWAY_URL}/auth/service`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            })
        });

        const authData = await authResponse.json();
        if (!authResponse.ok || !authData.access_token) {
            return res.status(500).json({
                status: 'ERROR',
                error: 'Service Nilai gagal mendapatkan Service Token dari Gateway',
                details: authData
            });
        }

        const serviceToken = authData.access_token;
        console.log(`[SERVICE NILAI] Service Token diperoleh (role: service). Mengirim sinkronisasi ke Gateway...`);

        // 3. Mengirim sinkronisasi nilai ke Service Transkrip MELALUI GATEWAY (POST /transkrip/sinkron)
        const syncResponse = await fetch(`${GATEWAY_URL}/transkrip/sinkron`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceToken}`
            },
            body: JSON.stringify({
                kelas_id: kelas.id,
                kode_mk: kelas.kode_mk,
                nama_mk: kelas.nama_mk,
                data_nilai: daftarNilai
            })
        });

        const syncData = await syncResponse.json();
        if (!syncResponse.ok) {
            return res.status(500).json({
                status: 'ERROR',
                error: 'Sinkronisasi ke Service Transkrip via Gateway gagal',
                details: syncData
            });
        }

        console.log(`[SERVICE NILAI] Sinkronisasi nilai ke Transkrip berhasil diselesaikan via Gateway!`);

        return res.json({
            status: 'ALLOW',
            message: `Nilai kelas '${kelas.nama_mk}' berhasil difinalisasi dan disinkronkan ke Service Transkrip melalui API Gateway.`,
            kelas: {
                id: kelas.id,
                kode_mk: kelas.kode_mk,
                nama_mk: kelas.nama_mk,
                status: 'final'
            },
            sync_result: syncData
        });
    } catch (err) {
        console.error('[SERVICE NILAI FINALISASI ERROR]', err);
        return res.status(500).json({ error: 'Gagal melakukan finalisasi dan sinkronisasi', details: err.message });
    }
});

module.exports = router;
