-- Skema Database Sistem Nilai & Transkrip (Zero Trust Architecture)

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS transkrip;
DROP TABLE IF EXISTS nilai;
DROP TABLE IF EXISTS kelas;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS service_clients;
DROP TABLE IF EXISTS users;

-- 1. Tabel Users
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'dosen', 'mahasiswa')),
    nomor_induk TEXT UNIQUE NOT NULL, -- NIM untuk mahasiswa, NIDN untuk dosen, ID untuk admin
    nama TEXT NOT NULL
);

-- 2. Tabel Devices (Verifikasi Konteks: Device Terdaftar)
CREATE TABLE devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, device_id)
);

-- 3. Tabel Refresh Tokens (Dapat dicabut / revoked)
CREATE TABLE refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 4. Tabel Kelas
CREATE TABLE kelas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kode_mk TEXT NOT NULL,
    nama_mk TEXT NOT NULL,
    dosen_id INTEGER NOT NULL,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'final')),
    FOREIGN KEY (dosen_id) REFERENCES users(id)
);

-- 5. Tabel Nilai
CREATE TABLE nilai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelas_id INTEGER NOT NULL,
    mahasiswa_id INTEGER NOT NULL,
    nilai_angka REAL NOT NULL,
    nilai_huruf TEXT NOT NULL,
    FOREIGN KEY (kelas_id) REFERENCES kelas(id),
    FOREIGN KEY (mahasiswa_id) REFERENCES users(id),
    UNIQUE(kelas_id, mahasiswa_id)
);

-- 6. Tabel Transkrip (Resource Service Transkrip)
CREATE TABLE transkrip (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mahasiswa_id INTEGER NOT NULL,
    kelas_id INTEGER NOT NULL,
    kode_mk TEXT NOT NULL,
    nama_mk TEXT NOT NULL,
    nilai_akhir TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mahasiswa_id) REFERENCES users(id),
    FOREIGN KEY (kelas_id) REFERENCES kelas(id),
    UNIQUE(mahasiswa_id, kelas_id)
);

-- 7. Tabel Service Clients (M2M Service Nilai -> Gateway)
CREATE TABLE service_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT UNIQUE NOT NULL,
    client_secret TEXT NOT NULL,
    service_name TEXT NOT NULL
);

-- 8. Tabel Audit Log (Mencatat semua keputusan allow/deny PEP Gateway)
CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    subject TEXT NOT NULL,
    role TEXT,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    device_id TEXT,
    decision TEXT NOT NULL CHECK(decision IN ('ALLOW', 'DENY')),
    reason TEXT NOT NULL
);

