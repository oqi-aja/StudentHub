# StudentHub

Website manajemen tugas & informasi untuk siswa/mahasiswa.

## Teknologi

- **Frontend**: HTML + CSS + JavaScript vanilla (tanpa framework)
- **Backend**: Cloudflare Workers
- **Database**: Cloudflare D1
- **File storage**: Cloudflare R2
- **Deployment**: Cloudflare

## Menjalankan di laptop (development)

Project ini adalah file statis, jadi cukup pakai server bawaan Python:

```bash
cd studenthub
python -m http.server 8000
```

Lalu buka di browser: <http://localhost:8000>

> Harus lewat `http://localhost:8000`. Membuka `index.html` langsung lewat `file://`
> akan membuat halaman gagal dimuat, karena halaman dimuat dengan `fetch()`.

### Menghentikan server

Klik jendela terminal tempat server berjalan, lalu tekan `Ctrl + C`.

### Menjalankan ulang

Ulangi perintah di atas.

### Menjalankan cek logika

```bash
node tests/file-manager.test.js
node tests/akun.test.js
node tests/dashboard.test.js
node tests/jadwal.test.js
```

Menguji pohon folder, pencarian, pengurutan, session, hak akses per role, role PJ,
dan CRUD jadwal. Tidak butuh browser.

## Cara login (mockup)

Buka <http://localhost:8000> tanpa session akan diarahkan ke halaman login. Ada dua pintu
masuk terpisah — satu untuk mahasiswa, satu untuk Ketua Kelas — bukan satu form dengan
pilihan role. Akun yang tersedia:

| Pintu masuk | Username | Password | Role |
| --- | --- | --- | --- |
| Login Mahasiswa | `budi` | `budi123` | Mahasiswa |
| Login Mahasiswa | `andi` | `andi123` | Mahasiswa |
| Login Mahasiswa | `dina` | `dina123` | PJ Mata Kuliah (Pemrograman) |
| Login Ketua Kelas | `admin` | `admin123` | Ketua Kelas |
| Masuk Tanpa Akun | — | — | Tamu |

Batas tiap role:

| Aksi | Ketua Kelas | PJ | Mahasiswa | Tamu |
| --- | --- | --- | --- | --- |
| Buka & Detail folder/tugas/file | ya | ya | ya | ya |
| Buat folder | ya | tidak | tidak | tidak |
| Rename / Delete | file, folder & tugas milik siapa pun | file miliknya sendiri | file miliknya sendiri | tidak |
| Upload | ya | ya | ya | tidak |
| Download | ya | ya | ya | hanya file `visibility: public` |
| Kelola Akun (`#akun`) | ya (CRUD semua akun) | tidak | tidak | tidak |
| Kelola Jadwal (`#jadwal`) | ya | ya | tidak | tidak |
| Catatan Pribadi (`#catatan`) | ya (catatan sendiri) | ya (catatan sendiri) | ya (catatan sendiri) | tidak |

Catatan bersifat pribadi: setiap akun hanya membaca, mengubah, dan menghapus catatannya
sendiri. **`can('catatan-ubah')` tidak pernah berlaku untuk catatan akun lain, termasuk
Ketua Kelas** — berbeda dari Rename/Delete file yang di atas memang milik siapa pun.
Tamu tidak punya halaman `#catatan` sama sekali.

Kelola Akun hanya milik Ketua Kelas: tambah, ubah, dan hapus akun apa pun (termasuk akun
bawaan), dengan username yang wajib unik. Akun yang sedang dipakai sendiri tidak bisa
diubah atau dihapus dari halaman ini supaya tidak terkunci keluar. Tabelnya menampilkan
kolom **Username dan Password apa adanya**.

Jadwal disimpan di `localStorage` dengan key `sh_mock_schedules`, daftar akun dengan
key `sh_mock_accounts`, dan catatan pribadi dengan key `sh_mock_notes`. Semuanya hanya
berlaku di perangkat ini dan hilang kalau storage dibersihkan.

Navigasi bawah ikut menyesuaikan role (Tamu hanya melihat Home, Daftar Tugas, Informasi).
Alamat halaman yang tidak boleh diakses otomatis dialihkan ke `#home`.

Ganti role dilakukan lewat **Logout → pilih pintu masuk lain**, bukan lewat tombol di
halaman Profil.

## Catatan penting

- `data/contoh.json` hanya berisi **data contoh** untuk development. Ini **BUKAN** database.
- `js/auth.js` menyimpan sesi mockup di `localStorage` dengan key `sh_mock_user`.
  **Password di `MOCK_ACCOUNTS` disimpan apa adanya dan sama sekali tidak aman** — jangan
  pernah dipakai di produksi. Part 2+ menggantinya dengan session asli dari Worker.
- Session yang disimpan hanya berisi `{ id, username, name, role }`; password tidak
  pernah ikut ditulis ke `localStorage` **session**. Yang berbeda: daftar akun
  (`sh_mock_accounts`) memang memuat password apa adanya, karena halaman Kelola Akun
  menampilkan kolom Password dan user hasil tambah/ubah harus bisa login. Kalau
  application-nya nanti sudah pakai database, halaman ini harus menampilkan password
  dalam bentuk lain (mis. tombol "reset password"), bukan plaintext.
- Semua perubahan di halaman Tugas (buat folder/rename/delete/upload) **hanya ada di
  memori** dan hilang saat refresh.
- `visibility` pada file: file Ketua Kelas ber-`public` boleh diunduh Tamu, file
  mahasiswa ber-`private` tidak.
- Foto catatan disimpan sebagai **data URL base64** di `localStorage` (`sh_mock_notes`),
  bukan file terpisah. `localStorage` berkuota sekitar 5 MB untuk seluruh origin dan
  key lain sudah memakainya, jadi satu foto dibatasi **300 KB** dan `validateNote()`
  menolak data URL yang bukan gambar atau kelewat besar. Kalau nanti ada backend,
  ganti dengan URL object storage dan batas ini hilang dengan sendirinya.
- Database final akan memakai **Cloudflare D1**.
- File unggahan akan disimpan di **Cloudflare R2**.
- `worker/index.js` adalah tempat backend API akan dibuat.

## Struktur Folder

```text
studenthub/
├── index.html          # Halaman utama + bottom navigation
├── style.css           # Styling & responsive
├── script.js           # Routing (hash) + auth guard + navigasi per role
├── pages/              # Template HTML tiap halaman
├── js/                 # Logic per fitur
│   ├── auth.js         # Session mockup, login, dan can() per role
│   ├── tugas.js        # File manager halaman Tugas
│   └── profil.js       # Halaman Profil + tombol Logout
├── tests/              # Cek logika tanpa browser
├── data/contoh.json    # Data contoh (bukan database)
├── assets/             # Gambar & ikon
└── worker/index.js     # Backend API Cloudflare Workers
```
