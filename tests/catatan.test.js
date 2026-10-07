// tests/catatan.test.js
// Cek CRUD catatan pribadi: validasi, batas foto, isolasi antar akun,
// dan persistensi lintas-"refresh".
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.window = {};
// Dipanggil setiap create/update/delete; di Node tidak ada DOM.
global.document = { getElementById: () => null, addEventListener: () => {} };

const authSrc = fs.readFileSync(path.join(ROOT, "js", "auth.js"), "utf8")
  .replace(/window\.STUDENTHUB_PAGES[\s\S]*$/, "");
const catatanSrc = fs.readFileSync(path.join(ROOT, "js", "catatan.js"), "utf8")
  .replace(/window\.STUDENTHUB_PAGES[\s\S]*$/, "");

// Instance baru membaca localStorage yang sama, dipakai untuk simulasi refresh.
const makeApi = () => new Function(authSrc + "\n" + catatanSrc + "\n" + [
  "return { login, loginAsGuest, logout, getCurrentUser, can,",
  "  listNotes, createNote, updateNote, deleteNote, validateNote,",
  "  CATATAN_MAX_IMAGE_BYTES };",
].join("\n"))();

// Data URL gambar palsu yang cukup kecil untuk lolos batas ukuran.
const smallImage = "data:image/png;base64," + "A".repeat(64);

// --- Validasi ---
const api = makeApi();
api.login("budi", "budi123", "student");

assert.ok(!api.validateNote({ title: "", content: "isi" }).ok, "judul wajib diisi");
assert.ok(!api.validateNote({ title: "  ", content: "isi" }).ok, "judul kosong ditolak");
assert.ok(!api.validateNote({ title: "x".repeat(121), content: "isi" }).ok, "judul terlalu panjang ditolak");
assert.ok(!api.validateNote({ title: "Judul", content: "" }).ok, "isi wajib diisi");
assert.ok(!api.validateNote({ title: "Judul", content: "   " }).ok, "isi kosong ditolak");

// Field asing dari form yang dimanipulasi tidak boleh ikut tersimpan.
const trimmed = api.validateNote({ title: "  Judul  ", content: " isi ", image: "", user_id: 99, id: 77 });
assert.deepStrictEqual(trimmed.value, { title: "Judul", content: "isi", image: "" },
  "hanya field yang dikenal yang dikembalikan");

// --- Batas foto ---
assert.ok(api.validateNote({ title: "a", content: "b", image: smallImage }).ok, "foto kecil diterima");
assert.ok(!api.validateNote({ title: "a", content: "b", image: "javascript:alert(1)" }).ok,
  "bukan data URL ditolak");
const bigImage = "data:image/png;base64," + "A".repeat(api.CATATAN_MAX_IMAGE_BYTES * 2);
const bigRes = api.validateNote({ title: "a", content: "b", image: bigImage });
assert.ok(!bigRes.ok, "foto melebihi 300 KB ditolak");
assert.match(bigRes.error, /300 KB/, "pesan batas ukuran jelas");
assert.ok(!api.createNote({ title: "a", content: "b", image: bigImage }).ok,
  "create juga menolak foto besar");

// --- CRUD dasar ---
const made = api.createNote({ title: "Catatan Budi", content: "Isi catatan budi.", image: "" });
assert.ok(made.ok, "catatan pertama tersimpan");
assert.strictEqual(api.listNotes().length, 1);

const upd = api.updateNote(made.id, { title: "Judul Baru", content: "Isi baru.", image: smallImage });
assert.ok(upd.ok, "catatan bisa diubah");
assert.strictEqual(api.listNotes()[0].title, "Judul Baru");
assert.strictEqual(api.listNotes()[0].image, smallImage, "foto ikut tersimpan");
assert.ok(api.listNotes()[0].updated_at >= api.listNotes()[0].created_at, "updated_at diperbarui");

assert.ok(api.deleteNote(made.id).ok, "catatan bisa dihapus");
assert.strictEqual(api.listNotes().length, 0);
assert.ok(!api.updateNote(made.id, { title: "x", content: "y" }).ok, "id yang sudah dihapus ditolak");
assert.ok(!api.deleteNote(999).ok, "id tidak dikenal ditolak");

// --- Isolasi antar akun ---
const budiNote = api.createNote({ title: "Catatan Budi", content: "Isi catatan budi.", image: "" });
assert.ok(budiNote.ok, "catatan budi tersimpan");

// Ganti ke akun lain di perangkat yang sama: catatan lama tidak boleh muncul.
api.login("andi", "andi123", "student");
assert.strictEqual(api.listNotes().length, 0, "catatan budi tidak terlihat oleh andi");

const andiNote = api.createNote({ title: "Catatan Andi", content: "Isi andi.", image: "" });
assert.ok(andiNote.ok, "andi boleh membuat catatan sendiri");
assert.strictEqual(api.listNotes().length, 1, "andi hanya melihat catatannya sendiri");
assert.strictEqual(api.listNotes()[0].title, "Catatan Andi");

// Id milik orang lain tidak boleh bisa diubah atau dihapus.
const cross = api.updateNote(budiNote.id, { title: "Dibajak", content: "x" });
assert.ok(!cross.ok, "andi tidak boleh mengubah catatan budi");
assert.strictEqual(cross.error, "Catatan tidak ditemukan.",
  "pesan sama dengan id tak dikenal, tidak membocorkan kepemilikan");
assert.ok(!api.deleteNote(budiNote.id).ok, "andi tidak boleh menghapus catatan budi");
assert.ok(!api.can("catatan-ubah", { id: budiNote.id, user_id: 2 }), "can() menolak catatan milik orang");
assert.ok(store["sh_mock_notes"].includes("Catatan Budi"), "catatan budi tidak rusak oleh percobaan andi");

// --- Admin juga tidak boleh membuka catatan akun lain ---
const simpanNotes = store["sh_mock_notes"];
api.login("admin", "admin123", "admin");
assert.strictEqual(api.listNotes().length, 0, "admin punya catatan sendiri, bukan milik andi");
assert.strictEqual(store["sh_mock_notes"], simpanNotes, "hanya membaca tidak mengubah storage");
assert.ok(api.createNote({ title: "Catatan Admin", content: "Isi admin.", image: "" }).ok,
  "admin boleh membuat catatan sendiri");
assert.ok(!api.updateNote(andiNote.id, { title: "x", content: "y" }).ok,
  "admin tidak boleh mengubah catatan mahasiswa");
assert.ok(!api.updateNote(budiNote.id, { title: "x", content: "y" }).ok,
  "admin tidak boleh mengubah catatan mahasiswa lain");

// --- Role PJ boleh, tamu tidak ---
api.login("dina", "dina123", "student");
assert.ok(api.can("catatan", null), "pj boleh membuat catatan");
assert.ok(api.createNote({ title: "Catatan Dina", content: "Isi dina.", image: "" }).ok,
  "pj boleh menyimpan catatan");
api.logout();

api.loginAsGuest();
assert.ok(!api.can("catatan", null), "tamu tidak boleh membuat catatan");
assert.ok(!api.createNote({ title: "x", content: "y" }).ok, "create ditolak untuk tamu");
assert.ok(!api.can("catatan-ubah", { id: 1, user_id: 2 }), "tamu tidak boleh mengubah catatan");
assert.strictEqual(api.listNotes().length, 0, "tamu tidak melihat catatan siapa pun");
api.logout();

// --- Persistensi lintas-"refresh" ---
const apiRefresh = makeApi();
apiRefresh.login("budi", "budi123", "student");
const setelahRefresh = apiRefresh.listNotes();
assert.strictEqual(setelahRefresh.length, 1, "catatan budi masih ada setelah refresh");
assert.strictEqual(setelahRefresh[0].title, "Catatan Budi", "isi catatan tetap sama");
assert.ok(setelahRefresh[0].user_id === 2, "catatan tetap terikat ke akun budi");

// Storage rusak tidak boleh membuat halaman crash.
store["sh_mock_notes"] = "{bukan json";
assert.strictEqual(apiRefresh.listNotes().length, 0, "storage rusak dibaca sebagai daftar kosong");
store["sh_mock_notes"] = JSON.stringify({ bukan: "array" });
assert.strictEqual(apiRefresh.listNotes().length, 0, "bukan array dibaca sebagai daftar kosong");

console.log("catatan: semua uji lolos");
