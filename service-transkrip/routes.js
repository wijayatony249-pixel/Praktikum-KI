const express = require('express');
const router = express.Router();
const db = require('../database/db');

// 1. GET /transkrip/:nim
// Mahasiswa: hanya NIM miliknya sendiri
// Admin: semua NIM
router.get('/transkrip/:nim', (req, res) => {
    const nim = req.params.nim;
    const user = req.user;

    try {
        const targetStudent = db.prepare("SELECT id, username, nomor_induk, nama FROM users WHERE nomor_induk = ? AND role = 'mahasiswa'").get(nim);
        if (!targetStudent) {
            return res.status(404).json({
                status: 'DENY',
                error: `Data mahasiswa dengan NIM ${nim} tidak ditemukan`
            });
        }

        const transcriptList = db.prepare(`
            SELECT id, kode_mk, nama_mk, nilai_akhir, updated_at
            FROM transkrip
            WHERE mahasiswa_id = ?
            ORDER BY kode_mk
        `).all(targetStudent.id);

        return res.json({
            status: 'ALLOW',
            requested_by: {
                username: user.sub,
                role: user.role
            },
            mahasiswa: {
                nim: targetStudent.nomor_induk,
                nama: targetStudent.nama
            },
            total_mata_kuliah: transcriptList.length,
            transkrip: transcriptList
        });
    } catch (err) {
        console.error('[SERVICE TRANSKRIP ERROR]', err);
        return res.status(500).json({ error: 'Internal Server Error pada Service Transkrip', details: err.message });
    }
});

// 2. POST /transkrip/sinkron
// HANYA SERVICE NILAI (M2M Token dengan role: 'service')
// Token user mana pun DITOLAK
router.post('/transkrip/sinkron', (req, res) => {
    const user = req.user;

    // Verifikasi ketat role service
    if (user.role !== 'service') {
        console.warn(`[SERVICE TRANSKRIP] Attempted access to /transkrip/sinkron by non-service role: ${user.role}`);
        return res.status(403).json({
            status: 'DENY',
            error: 'Akses ditolak: Endpoint sinkronisasi transkrip hanya dapat diakses oleh Service Nilai menggunakan token service'
        });
    }

    const { kelas_id, kode_mk, nama_mk, data_nilai } = req.body || {};

    if (!kelas_id || !Array.isArray(data_nilai)) {
        return res.status(400).json({
            status: 'DENY',
            error: 'Format data sinkronisasi tidak valid (kelas_id dan data_nilai array diperlukan)'
        });
    }

    try {
        const upsertStmt = db.prepare(`
            INSERT INTO transkrip (mahasiswa_id, kelas_id, kode_mk, nama_mk, nilai_akhir, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(mahasiswa_id, kelas_id) DO UPDATE SET
                nilai_akhir = excluded.nilai_akhir,
                updated_at = CURRENT_TIMESTAMP
        `);

        let count = 0;
        const transaction = db.transaction((list) => {
            for (const item of list) {
                upsertStmt.run(item.mahasiswa_id, kelas_id, kode_mk, nama_mk, item.nilai_akhir);
                count++;
            }
        });

        transaction(data_nilai);

        console.log(`[SERVICE TRANSKRIP] Berhasil menyinkronkan ${count} nilai akhir untuk mata kuliah '${nama_mk}'`);

        return res.json({
            status: 'ALLOW',
            message: `Sinkronisasi transkrip berhasil diterima untuk mata kuliah '${nama_mk}'`,
            kelas_id,
            total_disinkronkan: count
        });
    } catch (err) {
        console.error('[SERVICE TRANSKRIP SYNC ERROR]', err);
        return res.status(500).json({ error: 'Gagal memproses sinkronisasi transkrip', details: err.message });
    }
});

module.exports = router;
