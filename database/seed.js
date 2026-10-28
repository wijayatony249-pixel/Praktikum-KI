const fs = require('fs');
const path = require('path');
const db = require('./db');

function seedDatabase() {
    console.log('[SEED] Memulai inisialisasi skema dan data awal database...');

    // 1. Eksekusi Schema
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    db.exec(schemaSql);
    console.log('[SEED] Tabel database berhasil dibuat.');

    // 2. Insert Users (1 Admin, 2 Dosen, 3 Mahasiswa)
    const insertUser = db.prepare(`
        INSERT INTO users (username, password, role, nomor_induk, nama)
        VALUES (?, ?, ?, ?, ?)
    `);

    insertUser.run('admin1', 'admin123', 'admin', 'ADM001', 'Administrator Sistem');
    insertUser.run('dosen1', 'dosen123', 'dosen', 'NIDN001', 'Dr. Budi Setiawan, M.T.');
    insertUser.run('dosen2', 'dosen123', 'dosen', 'NIDN002', 'Siti Rahma, M.Kom.');
    insertUser.run('mhs1', 'mhs123', 'mahasiswa', '22001', 'Ahmad Pratama');
    insertUser.run('mhs2', 'mhs123', 'mahasiswa', '22002', 'Bunga Lestari');
    insertUser.run('mhs3', 'mhs123', 'mahasiswa', '22003', 'Citra Dewi');

    console.log('[SEED] Data users berhasil ditambahkan.');

    // 3. Insert Devices (Setiap user memiliki 1 device terdaftar)
    const insertDevice = db.prepare(`
        INSERT INTO devices (user_id, device_id, device_name)
        VALUES (?, ?, ?)
    `);

    // user id 1 = admin1, 2 = dosen1, 3 = dosen2, 4 = mhs1, 5 = mhs2, 6 = mhs3
    insertDevice.run(1, 'DEV-ADMIN-1', 'Laptop Admin IT');
    insertDevice.run(2, 'DEV-DOSEN-1', 'Laptop ThinkPad Dosen 1');
    insertDevice.run(3, 'DEV-DOSEN-2', 'MacBook Air Dosen 2');
    insertDevice.run(4, 'DEV-MHS-1', 'Smartphone Ahmad');
    insertDevice.run(5, 'DEV-MHS-2', 'Laptop Asus Bunga');
    insertDevice.run(6, 'DEV-MHS-3', 'Tablet Citra');

    console.log('[SEED] Data devices terdaftar berhasil ditambahkan.');

    // 4. Insert Kelas (2 Kelas yang diampu dosen berbeda)
    const insertKelas = db.prepare(`
        INSERT INTO kelas (kode_mk, nama_mk, dosen_id, status)
        VALUES (?, ?, ?, ?)
    `);

    // Kelas 1 diampu Dosen 1 (user_id = 2)
    insertKelas.run('KI7006', 'Keamanan Informasi', 2, 'draft');
    // Kelas 2 diampu Dosen 2 (user_id = 3)
    insertKelas.run('JK7004', 'Jaringan Komputer', 3, 'draft');

    console.log('[SEED] Data kelas berhasil ditambahkan.');

    // 5. Insert Nilai (Draft nilai kelas 1 & 2)
    const insertNilai = db.prepare(`
        INSERT INTO nilai (kelas_id, mahasiswa_id, nilai_angka, nilai_huruf)
        VALUES (?, ?, ?, ?)
    `);

    // Nilai Kelas 1 (Keamanan Informasi - Dosen 1)
    // Mahasiswa 1 (user_id = 4) & Mahasiswa 2 (user_id = 5)
    insertNilai.run(1, 4, 85.5, 'A');
    insertNilai.run(1, 5, 78.0, 'B+');

    // Nilai Kelas 2 (Jaringan Komputer - Dosen 2)
    // Mahasiswa 2 (user_id = 5) & Mahasiswa 3 (user_id = 6)
    insertNilai.run(2, 5, 82.0, 'A-');
    insertNilai.run(2, 6, 72.5, 'B');

    console.log('[SEED] Data nilai mahasiswa berhasil ditambahkan.');

    // 6. Insert Service Client (M2M Client ID & Secret untuk Service Nilai)
    const insertClient = db.prepare(`
        INSERT INTO service_clients (client_id, client_secret, service_name)
        VALUES (?, ?, ?)
    `);

    insertClient.run('service-nilai-client', 'service-nilai-secret-2026', 'Service Nilai');
    console.log('[SEED] Data service client M2M berhasil ditambahkan.');

    console.log('[SEED] Inisialisasi database dan data awal SELESAI dengan sukses!\n');
}

if (require.main === module) {
    seedDatabase();
}

module.exports = seedDatabase;

