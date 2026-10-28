# Sistem Nilai Akademik Berbasis Zero Trust Security (NIST SP 800-207)

**Mata Kuliah:** Keamanan Informasi (KP70065004)  
**Program Studi:** Informatika, Fakultas Teknik, Universitas Siliwangi  

---

## 1. Pendahuluan & Prinsip Zero Trust

Aplikasi ini menerapkan prinsip **Zero Trust Architecture (ZTA)** sesuai standar **NIST SP 800-207** di level aplikasi backend:
1. **Never Trust, Always Verify:** Setiap request (baik dari user luar maupun antar-service internal) wajib diautentikasi dan diverifikasi.
2. **Least Privilege:** Pengguna hanya diberikan hak akses minimum sesuai perannya (*Role-Based Access Control*) dan kepemilikan datanya (*Attribute-Based Access Control*).
3. **Assume Breach & Defense in Depth:** Service internal (Service Nilai & Service Transkrip) tidak mempercayai begitu saja request dari Gateway. Setiap service memverifikasi *gateway secret* serta memvalidasi ulang tanda tangan dan masa berlaku token JWT.

---

## 2. Arsitektur Sistem

Sistem terdiri atas 3 aplikasi mandiri (*microservices*) dan 1 database bersama (*SQLite*):

```
+-------------------------------------------------------------+
| CLIENT (Postman / cURL)                                     |
| Header: Authorization (Bearer Token) + X-Device-ID          |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| API GATEWAY (Port 3000)                                     |
| - Policy Enforcement Point (PEP)                            |
| - Policy Engine / Administrator (PE/PA)                     |
| - Evaluasi: Token, Device ID, Jam Akses (07.00-21.00), ABAC |
| - Audit Logger: Mencatat setiap ALLOW / DENY                |
+-------------------------------------------------------------+
                               |
             +-----------------+-----------------+
             | Forwarding:                       | Forwarding:
             | X-Gateway-Secret + Bearer Token   | X-Gateway-Secret + Bearer Token
             v                                   v
+-----------------------------+     +-----------------------------+
| SERVICE NILAI (Port 3001)   |     | SERVICE TRANSKRIP (Port 3002)|
| - Resource: Nilai & Kelas   |     | - Resource: Transkrip Mhs   |
| - Verifikasi Secret & Token |     | - Verifikasi Secret & Token |
+-----------------------------+     +-----------------------------+
             |                                   ^
             | Panggilan Sinkronisasi via        |
             | API Gateway (Port 3000)           |
             +-------------> [ GATEWAY ] --------+
```

---

## 3. Data Awal (Seed Data)

Database diinisialisasi dengan data akun dan device ID bawaan berikut:

### Tabel Akun & Device Terdaftar

| Role | Username | Password | NIM / NIDN | Nama Lengkap | Device ID Terdaftar |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin** | `admin1` | `admin123` | `ADM001` | Administrator Sistem | `DEV-ADMIN-1` |
| **Dosen** | `dosen1` | `dosen123` | `NIDN001` | Dr. Budi Setiawan, M.T. | `DEV-DOSEN-1` |
| **Dosen** | `dosen2` | `dosen123` | `NIDN002` | Siti Rahma, M.Kom. | `DEV-DOSEN-2` |
| **Mahasiswa** | `mhs1` | `mhs123` | `22001` | Ahmad Pratama | `DEV-MHS-1` |
| **Mahasiswa** | `mhs2` | `mhs123` | `22002` | Bunga Lestari | `DEV-MHS-2` |
| **Mahasiswa** | `mhs3` | `mhs123` | `22003` | Citra Dewi | `DEV-MHS-3` |

### Tabel Kelas & Pengampu

| ID Kelas | Kode MK | Nama Mata Kuliah | Dosen Pengampu | Mahasiswa Terdaftar | Status Awal |
| :---: | :--- | :--- | :--- | :--- | :---: |
| `1` | `KI7006` | Keamanan Informasi | `dosen1` (Dr. Budi) | `mhs1` (85.5, A), `mhs2` (78.0, B+) | `draft` |
| `2` | `JK7004` | Jaringan Komputer | `dosen2` (Siti Rahma) | `mhs2` (82.0, A-), `mhs3` (72.5, B) | `draft` |

### Kredensial Machine-to-Machine (Service Nilai)
* **Client ID:** `service-nilai-client`
* **Client Secret:** `service-nilai-secret-2026`

---

## 4. Cara Menjalankan Sistem

### Prasyarat
* Node.js versi 18+ (disarankan Node.js 20 atau 24)
* npm

### Langkah Menjalankan:
1. **Instalasi Dependensi:**
   ```bash
   npm install
   ```

2. **Reset & Inisialisasi Database (Seed Data):**
   ```bash
   npm run seed
   ```

3. **Menjalankan Seluruh Service Sekaligus (Port 3000, 3001, 3002):**
   ```bash
   npm start
   ```
   *Output terminal akan menampilkan log dari Gateway, Service Nilai, dan Service Transkrip.*

4. **Menjalankan Pengujian Otomatis (Opsional):**
   Buka terminal lain lalu jalankan:
   ```bash
   npm test
   ```
   *Seluruh 23 skenario Zero Trust akan diuji secara otomatis dan menampilkan status PASS/FAIL.*

---

## 5. Matriks Endpoint & Kebijakan Keamanan

| Endpoint | Ditangani Oleh | Role Diizinkan | Kondisi / Kebijakan Zero Trust |
| :--- | :---: | :---: | :--- |
| `POST /auth/login` | Gateway | Semua | Kredensial valid + `X-Device-ID` terdaftar untuk akun tersebut. |
| `POST /auth/refresh` | Gateway | Semua | `refresh_token` valid dan belum dicabut di database. |
| `POST /auth/logout` | Gateway | Semua | Mencabut (*revoke*) `refresh_token` di database. |
| `POST /auth/service` | Gateway | Service Nilai | Client ID & Client Secret M2M valid (Service Token 5 menit). |
| `GET /nilai` | Service Nilai | Mahasiswa, Dosen | **Mahasiswa:** hanya nilai sendiri. **Dosen:** hanya kelas yang diampu. |
| `PUT /nilai/:id` | Service Nilai | Dosen | Kelas diampu dosen tersebut, nilai belum `final`, jam 07.00–21.00. |
| `POST /kelas/:id/finalisasi`| Service Nilai | Dosen | Kelas diampu dosen, jam 07.00–21.00. Memicu M2M sinkronisasi via Gateway. |
| `GET /transkrip/:nim` | Service Transkrip | Mahasiswa, Admin | **Mahasiswa:** hanya NIM sendiri. **Admin:** semua mahasiswa. |
| `POST /transkrip/sinkron` | Service Transkrip | Service Nilai | **Hanya token role `service`**. Token user apa pun ditolak. |
| `GET /audit-logs` | Gateway | Admin / Demo | Melihat rekam jejak keputusan `ALLOW` dan `DENY` beserta alasan. |

---

## 6. Pengujian Menggunakan Postman

File koleksi Postman siap pakai tersedia pada:  
📁 `tests/ZeroTrust_Security_KP70065004.postman_collection.json`

### Cara Penggunaan di Postman:
1. Buka Postman -> Klik tombol **Import** -> Pilih file JSON di atas.
2. Koleksi telah terbagi menjadi 7 folder skenario yang berurutan sesuai alur video demo.
3. Begitu Anda menjalankan request **Login Dosen 1** atau **Login Mahasiswa 1**, token akan **otomatis tersimpan** ke variabel Postman.
4. Anda dapat langsung menguji skenario positif (200 OK) maupun skenario negatif Zero Trust (403 Forbidden / 401 Unauthorized).

