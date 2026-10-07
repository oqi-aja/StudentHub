// tests/catatan-update.test.js
// Fokus: updateNote harus menggabungkan field lama SEBELUM validasi, supaya
// perubahan sebagian (pin/warna/arsip/sampah/label/pengingat/foto) tidak
// tersandung validasi judul-isi yang kosong, dan judul/isi lama tidak hilang.
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
global.document = { getElementById: () => null, addEventListener: () => {} };

const authSrc = fs.readFileSync(path.join(ROOT, "js", "auth.js"), "utf8")
  .replace(/window\.STUDENTHUB_PAGES[\s\S]*$/, "");
const catatanSrc = fs.readFileSync(path.join(ROOT, "js", "catatan.js"), "utf8")
  .replace(/window\.STUDENTHUB_PAGES[\s\S]*$/, "");

const api = new Function(authSrc + "\n" + catatanSrc + "\n" + [
  "return { login, logout, getCurrentUser, can,",
  "  listNotes, createNote, updateNote, deleteNote, validateNote };",
].join("\n"))();

api.login("budi", "budi123", "student");
const made = api.createNote({ title: "Asli", content: "Isi asli", image: "" });
assert.ok(made.ok, "catatan dibuat");

// Update sebagian: pin tidak boleh menuntut judul/isi lagi.
assert.ok(api.updateNote(made.id, { isPinned: true }).ok, "pin sebagian harus berhasil");
let n = api.listNotes()[0];
assert.strictEqual(n.isPinned, true, "pin tersimpan");
assert.strictEqual(n.title, "Asli", "judul lama tidak hilang saat update sebagian");
assert.strictEqual(n.content, "Isi asli", "isi lama tidak hilang");

assert.ok(api.updateNote(made.id, { color: "blue" }).ok, "ganti warna harus berhasil");
assert.strictEqual(api.listNotes()[0].color, "blue");

assert.ok(api.updateNote(made.id, { isArchived: true }).ok, "arsip harus berhasil");
assert.strictEqual(api.listNotes()[0].isArchived, true);
assert.ok(api.updateNote(made.id, { isTrashed: true }).ok, "sampah harus berhasil");
assert.strictEqual(api.listNotes()[0].isTrashed, true);

assert.ok(api.updateNote(made.id, { labels: ["kuliah"] }).ok, "label harus berhasil");
assert.deepStrictEqual(api.listNotes()[0].labels, ["kuliah"]);
assert.ok(api.updateNote(made.id, { reminder: "2026-01-01T08:00" }).ok, "pengingat harus berhasil");
assert.strictEqual(api.listNotes()[0].reminder, "2026-01-01T08:00");

// Update jujur: judul kosong tetap ditolak dan tidak merusak data lama.
assert.ok(!api.updateNote(made.id, { title: "", content: "x" }).ok, "judul kosong tetap ditolak");
assert.strictEqual(api.listNotes()[0].title, "Asli", "penolakan tidak mengubah data");

// Hapus foto sebagian tidak menghapus judul.
assert.ok(api.updateNote(made.id, { image: "" }).ok, "hapus foto harus berhasil");

console.log("catatan-update: semua uji lolos");
