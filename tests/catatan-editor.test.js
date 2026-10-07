// tests/catatan-editor.test.js
// Fokus: kontrak persistence editor Keep-style (isDeleted kanonik + alias
// isTrashed, arsip/sampah eksklusif, migrasi data lama, kolaborator) dan
// helper murni (formatEditedTime, reminderPresets, wrapSelection, stripFormat).
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
  "return { login, getCurrentUser, can,",
  "  listNotes, createNote, updateNote, deleteNote, readNotes,",
  "  formatEditedTime, reminderPresets, formatReminderLabel,",
  "  wrapSelection, stripFormat, FORMAT_MARKERS };",
].join("\n"))();

api.login("budi", "budi123", "student");

// --- Helper: formatEditedTime ---
const base = new Date(2026, 0, 5, 18, 19, 30).getTime(); // 5 Jan 2026, 18:19
assert.strictEqual(api.formatEditedTime(base - 30000, base), "Diedit baru saja", "baru saja (< 1 menit)");
assert.strictEqual(api.formatEditedTime(base - 5 * 60000, base), "Diedit 18.14", "hari ini pakai jam");
assert.strictEqual(api.formatEditedTime(new Date(2026, 0, 4, 20, 5).getTime(), base),
  "Diedit kemarin 20.05", "kemarin pakai tanggal relatif");

// --- Helper: reminderPresets ---
const presets = api.reminderPresets(new Date(2026, 0, 5, 10, 0).getTime());
assert.deepStrictEqual(presets.map((p) => p.label), ["Nanti hari ini", "Besok", "Minggu depan"],
  "tiga preset pengingat");
assert.strictEqual(presets[0].value, "2026-01-05T20:00", "nanti hari ini = 20:00");
assert.strictEqual(presets[1].value, "2026-01-06T08:00", "besok = 08:00");
assert.strictEqual(presets[2].value, "2026-01-12T08:00", "minggu depan = +7 hari 08:00");
assert.strictEqual(api.reminderPresets(new Date(2026, 0, 5, 23, 0).getTime())[0].value, "2026-01-06T20:00",
  "lewat jam 20:00, 'nanti hari ini' digeser ke besok");

assert.strictEqual(api.formatReminderLabel("2026-01-05T20:00"), "05/01 20.00", "label chip pengingat");
assert.strictEqual(api.formatReminderLabel(""), "", "pengingat kosong aman");

// --- Helper: wrapSelection ---
assert.deepStrictEqual(api.wrapSelection("abc", 0, 3, "**", "**"),
  { value: "**abc**", selStart: 2, selEnd: 5 }, "tebal membungkus seleksi");
assert.deepStrictEqual(api.wrapSelection("**abc**", 0, 7, "**", "**"),
  { value: "abc", selStart: 0, selEnd: 3 }, "toggle marker yang sama = lepas");
assert.deepStrictEqual(api.wrapSelection("halo dunia", 0, 0, "*", "*"),
  { value: "**halo dunia", selStart: 1, selEnd: 1 }, "seleksi kosong menyisipkan marker");
assert.deepStrictEqual(api.wrapSelection("abc", 1, 1, "<u>", "</u>"),
  { value: "a<u></u>bc", selStart: 4, selEnd: 4 }, "marker beda panjang tetap presisi");
assert.ok(api.FORMAT_MARKERS.bold && api.FORMAT_MARKERS.italic && api.FORMAT_MARKERS.strike,
  "marker format lengkap");

// --- Helper: stripFormat ---
assert.strictEqual(api.stripFormat("**tebal** dan *miring* <u>garis</u> ~~coret~~"),
  "tebal dan miring garis coret", "hapus format membersihkan semua penanda");
assert.strictEqual(api.stripFormat(""), "", "teks kosong aman");

// --- Kontrak persistence ---
const made = api.createNote({ title: "Asli", content: "Isi", image: "" });
assert.ok(made.ok, "catatan dibuat");
let note = api.listNotes()[0];
assert.strictEqual(note.isDeleted, false, "isDeleted default false");
assert.strictEqual(note.isTrashed, undefined, "tidak lagi menyimpan isTrashed");
assert.deepStrictEqual(note.collaborators, [], "collaborators default array");

// Alias input lama (isTrashed) tetap dihormati.
assert.ok(api.updateNote(made.id, { isTrashed: true }).ok, "alias isTrashed diterima");
assert.strictEqual(api.listNotes()[0].isDeleted, true, "alias dipetakan ke isDeleted");
assert.strictEqual(api.listNotes()[0].isTrashed, undefined, "field lama tidak ditulis ulang");

// Arsip dan sampah saling eksklusif.
assert.ok(api.updateNote(made.id, { isArchived: true }).ok, "arsipkan catatan sampah");
note = api.listNotes()[0];
assert.strictEqual(note.isArchived, true, "isArchived tersimpan");
assert.strictEqual(note.isDeleted, false, "masuk arsip = keluar dari sampah");
assert.ok(api.updateNote(made.id, { isDeleted: true }).ok, "buang ke sampah catatan arsip");
note = api.listNotes()[0];
assert.strictEqual(note.isDeleted, true, "isDeleted tersimpan");
assert.strictEqual(note.isArchived, false, "masuk sampah = keluar dari arsip");

assert.ok(api.updateNote(made.id, { collaborators: ["andi", "dina"] }).ok, "bagikan catatan");
assert.deepStrictEqual(api.listNotes()[0].collaborators, ["andi", "dina"], "kolaborator tersimpan");
assert.ok(api.updateNote(made.id, { color: "gray" }).ok, "warna abu-abu baru diterima");
assert.strictEqual(api.listNotes()[0].color, "gray");

assert.ok(!store["sh_mock_notes"].includes("isTrashed"), "storage bersih dari field lama");

// --- Migrasi catatan lama (isTrashed -> isDeleted) ---
store["sh_mock_notes"] = JSON.stringify([
  { id: 901, user_id: 2, title: "Lama", content: "Isi lama", image: "", isTrashed: true, created_at: 1, updated_at: 1 },
  { id: 902, user_id: 2, title: "Baru", content: "Isi baru", image: "", created_at: 2, updated_at: 2 },
]);
const mig = api.listNotes();
assert.strictEqual(mig[0].isDeleted, true, "catatan lama isTrashed dibaca sebagai isDeleted");
assert.strictEqual(mig[0].isTrashed, undefined, "field lama dibuang saat dibaca");
assert.strictEqual(mig[1].isDeleted, false, "catatan tanpa flag dianggap aktif");
assert.deepStrictEqual(mig[1].collaborators, [], "collaborators lama diberi default");
assert.strictEqual(api.readNotes().length, 2, "migrasi tidak menghilangkan catatan");

assert.ok(api.updateNote(902, { title: "Baru" }).ok, "catatan lama tetap bisa diubah");
assert.ok(!store["sh_mock_notes"].includes("isTrashed"), "migrasi tertulis permanen setelah simpan");

console.log("catatan-editor: semua uji lolos");

assert.strictEqual(api.formatEditedTime(new Date(2026, 0, 1, 7, 5).getTime(), base),
  "Diedit 01/01 07.05", "lebih lama pakai tanggal");
assert.strictEqual(api.formatEditedTime(0, base), "", "tanpa timestamp kosong");
assert.strictEqual(api.formatEditedTime(base + 60000, base), "Diedit baru saja", "waktu masa depan aman");