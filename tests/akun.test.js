// tests/akun.test.js
// Cek role PJ, pintu login, hak kelola-akun, dan CRUD akun lengkap.
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

const authSrc = fs.readFileSync(path.join(ROOT, "js", "auth.js"), "utf8")
  .replace(/window\.STUDENTHUB_PAGES[\s\S]*$/, "");

const api = new Function(authSrc + "\n" + [
  "return { login, loginAsGuest, logout, getCurrentUser, getRole, getRoleLabel,",
  "  can, canManageAccounts, listAccounts, listAccountsWithSecrets,",
  "  createAccount, updateAccount, deleteAccount, validateAccount,",
  "  ROLE_LABELS, LOGIN_GATES };",
].join("\n"))();

// --- Role PJ masuk lewat pintu Mahasiswa ---
let u = api.login("dina", "dina123", "student");
assert.strictEqual(u.role, "pj", "dina harus punya role pj");
assert.strictEqual(u.course_id, 2, "course_id ikut session");
assert.strictEqual(api.getRoleLabel(), "PJ Mata Kuliah");
api.logout();

assert.strictEqual(api.login("budi", "budi123", "student").role, "student");
api.logout();
assert.strictEqual(api.login("admin", "admin123", "admin").role, "admin");
api.logout();

// Akun admin tidak boleh bocor lewat pintu Mahasiswa, dan sebaliknya.
assert.strictEqual(api.login("dina", "dina123", "admin"), null, "pj tidak boleh lewat pintu admin");
api.logout();
assert.strictEqual(api.login("admin", "admin123", "student"), null, "admin tidak boleh lewat pintu mahasiswa");
api.logout();
assert.strictEqual(api.login("dina", "salah", "student"), null, "password salah ditolak");
api.logout();
assert.ok(api.LOGIN_GATES.student.includes("pj"), "pintu student menerima pj");
assert.ok(!api.LOGIN_GATES.admin.includes("pj"), "pintu admin tidak menerima pj");

// --- Hak kelola akun ---
api.login("admin", "admin123", "admin");
assert.ok(api.canManageAccounts(), "admin boleh kelola akun");
api.logout();

api.login("dina", "dina123", "student");
assert.ok(!api.can("kelola-akun", null), "pj tidak boleh kelola akun");
api.logout();

api.login("budi", "budi123", "student");
assert.ok(!api.can("kelola-akun", null), "mahasiswa tidak boleh kelola akun");
api.logout();

// --- daftarAkun biasa tidak boleh bocorkan password ---
api.login("admin", "admin123", "admin");
const all = api.listAccounts();
assert.strictEqual(all.length, 4, "4 akun bawaan");
assert.ok(all.every((a) => a.password === undefined), "listAccounts() tidak boleh memuat password");
assert.ok(all.some((a) => a.role === "pj"), "ada satu akun pj");

// --- Halaman Kelola Akun boleh melihat password, tapi hanya Ketua Kelas ---
const secrets = api.listAccountsWithSecrets();
assert.strictEqual(secrets.length, 4, "daftar lengkap ikut dikembalikan");
assert.ok(secrets.every((a) => typeof a.password === "string" && a.password.length > 0),
  "password ditampilkan apa adanya untuk Ketua Kelas");

api.logout();
api.login("dina", "dina123", "student");
assert.strictEqual(api.listAccountsWithSecrets().length, 0, "pj tidak boleh melihat daftar password");
api.logout();
api.loginAsGuest();
assert.strictEqual(api.listAccountsWithSecrets().length, 0, "tamu tidak boleh melihat daftar password");
api.logout();

// --- Buat akun ---
api.login("admin", "admin123", "admin");
let res = api.createAccount({ name: "P", username: "p1", password: "pw", role: "pj" });
assert.ok(!res.ok, "pj wajib punya mata kuliah");
assert.ok(/mata kuliah/i.test(res.error), "pesan error menyebut mata kuliah");

res = api.createAccount({ name: "P", username: "p1", password: "pw", role: "pj", course_id: 1 });
assert.ok(res.ok, "berhasil buat akun pj: " + res.error);
assert.strictEqual(res.account.role, "pj");
assert.strictEqual(res.account.course_id, 1);
assert.ok(res.message.includes("berhasil"), "ada pesan sukses");
const pjId = res.account.id;

res = api.createAccount({ name: "S", username: "s1", password: "pw", role: "student" });
assert.ok(res.ok, "berhasil buat akun mahasiswa: " + res.error);
assert.ok(!res.account.course_id, "mahasiswa tidak punya course_id");

res = api.createAccount({ name: "S2", username: "s1", password: "pw", role: "student" });
assert.ok(!res.ok, "username ganda ditolak");
assert.ok(/sudah dipakai/.test(res.error), "pesan error username bentrok");

res = api.createAccount({ name: "", username: "x", password: "pw", role: "student" });
assert.ok(!res.ok, "nama kosong ditolak");

res = api.createAccount({ name: "X", username: "x", password: "", role: "student" });
assert.ok(!res.ok, "password kosong ditolak");

res = api.createAccount({ name: "X", username: "x", password: "pw", role: "bogus" });
assert.ok(!res.ok, "role tidak dikenal ditolak");

assert.strictEqual(api.listAccounts().length, 6, "6 akun setelah 2 tambahan");

// --- Ubah akun ---
res = api.updateAccount(pjId, { name: "P Baru", username: "p1", password: "pw2", role: "student" });
assert.ok(res.ok, "berhasil ubah akun: " + res.error);
let row = api.listAccounts().find((a) => a.id === pjId);
assert.strictEqual(row.name, "P Baru");
assert.strictEqual(row.role, "student");
assert.ok(!row.course_id, "course_id hilang saat role diubah ke mahasiswa");
// Cek password baru harus logout dulu: login di sini mengganti session admin.
api.login("p1", "pw2", "student");
assert.strictEqual(api.getRole(), "student", "password baru dipakai saat login");
api.logout();
api.login("admin", "admin123", "admin");

// Username sendiri tidak dianggap bentrok, tapi username milik orang lain tetap ditolak.
res = api.updateAccount(pjId, { name: "P Baru", username: "p1", password: "pw2", role: "student" });
assert.ok(res.ok, "simpan ulang tanpa ganti username tetap boleh: " + res.error);
res = api.updateAccount(pjId, { name: "P Baru", username: "s1", password: "pw2", role: "student" });
assert.ok(!res.ok, "update ke username milik akun lain ditolak");
assert.ok(/sudah dipakai/.test(res.error), "pesan error username bentrok saat update");

res = api.updateAccount(9999, { name: "Hantu", username: "hantu", password: "pw", role: "student" });
assert.ok(!res.ok, "update id yang tidak ada ditolak");
assert.ok(/tidak ditemukan/i.test(res.error), "pesan error akun tidak ditemukan");

// --- Hapus akun ---
res = api.deleteAccount(pjId);
assert.ok(res.ok, "berhasil hapus akun: " + res.error);
assert.strictEqual(api.listAccounts().length, 5, "kembali ke 5 akun");
assert.strictEqual(api.login("p1", "pw2", "student"), null, "akun yang dihapus tidak bisa login lagi");
assert.ok(!api.deleteAccount(pjId).ok, "hapus dua kali ditolak");

// --- Akun sendiri tidak boleh diubah atau dihapus (anti lockout) ---
const selfId = api.getCurrentUser().id;
res = api.updateAccount(selfId, { name: "Oqi", username: "admin", password: "admin123", role: "admin" });
assert.ok(!res.ok, "tidak boleh mengubah akun sendiri");
res = api.deleteAccount(selfId);
assert.ok(!res.ok, "tidak boleh menghapus akun sendiri");
assert.ok(api.getCurrentUser(), "session tetap hidup setelah mencoba hapus diri sendiri");

// --- Non-admin tidak boleh mengelola akun walau fungsi dipanggil langsung ---
api.logout();
api.login("budi", "budi123", "student");
const before = api.listAccounts().length;
res = api.createAccount({ name: "X", username: "x1", password: "pw", role: "student" });
assert.ok(!res.ok, "mahasiswa tidak boleh membuat akun");
res = api.updateAccount(2, { name: "X", username: "budi2", password: "pw", role: "student" });
assert.ok(!res.ok, "mahasiswa tidak boleh mengubah akun");
res = api.deleteAccount(2);
assert.ok(!res.ok, "mahasiswa tidak boleh menghapus akun");
assert.strictEqual(api.listAccounts().length, before, "tidak ada akun yang berubah");
api.logout();

api.login("dina", "dina123", "student");
res = api.createAccount({ name: "X", username: "x3", password: "pw", role: "student" });
assert.ok(!res.ok, "pj tidak boleh membuat akun");
res = api.deleteAccount(2);
assert.ok(!res.ok, "pj tidak boleh menghapus akun");
api.logout();

api.loginAsGuest();
res = api.createAccount({ name: "X", username: "x4", password: "pw", role: "student" });
assert.ok(!res.ok, "tamu tidak boleh membuat akun");
res = api.deleteAccount(2);
assert.ok(!res.ok, "tamu tidak boleh menghapus akun");
api.logout();

// --- Perubahan bertahan setelah "refresh" (dimuat ulang dari storage) ---
assert.ok(store["sh_mock_accounts"], "daftar akun disimpan di localStorage");
const revived = new Function(authSrc + "\nreturn { login, listAccounts };")();
assert.strictEqual(revived.listAccounts().length, 5, "5 akun terbaca ulang dari storage");
assert.ok(revived.listAccounts().some((a) => a.username === "admin"), "akun bawaan tetap ada setelah refresh");
assert.strictEqual(revived.login("p1", "pw2", "student"), null, "akun terhapus tetap terhapus setelah refresh");

console.log("akun.test.js lulus: role pj, 3 pintu login, hak kelola-akun, CRUD akun, password Ketua Kelas, persistensi.");