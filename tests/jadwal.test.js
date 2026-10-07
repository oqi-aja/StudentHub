                                      // tests/jadwal.test.js
// Cek CRUD jadwal: hak akses per role, validasi, persistensi, dan pengelompokan.
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
// Dipanggil setiap create/update/delete; di Node tidak ada DOM, jadi cukup
// dihitung lewat global (badan new Function tidak melihat scope modul).
globalThis.__renders = 0;
global.document = {
  getElementById: () => null,
  addEventListener: () => {},
  body: { classList: { add: () => {}, remove: () => {} } },
};

const authSrc = fs.readFileSync(path.join(ROOT, "js", "auth.js"), "utf8")
  .replace(/window\.STUDENTHUB_PAGES[\s\S]*$/, "");
const jadwalSrc = fs.readFileSync(path.join(ROOT, "js", "jadwal.js"), "utf8")
  .replace(/window\.STUDENTHUB_PAGES[\s\S]*$/, "");

const api = new Function(authSrc + "\n" + jadwalSrc + "\n" + [
  "renderJadwal = () => { globalThis.__renders += 1; };",
  "return { login, loginAsGuest, logout, can, listSchedules, setScheduleSeed,",
  "  validateSchedule, createSchedule, updateSchedule, deleteSchedule,",
  "  jadwalGroup, jadwalTodayName, jadwalTimeOk, JADWAL_HARI, SCHEDULES_KEY,",
  "  renders: () => globalThis.__renders };",
].join("\n"))();

const RESET = () => {
  delete store[api.SCHEDULES_KEY];
  api.setScheduleSeed([]);
};
const OK = { day: "Senin", start: "08:00", end: "10:00", course: "Pemrograman" };

// --- Hak kelola-jadwal per role ---
api.login("admin", "admin123", "admin");
assert.ok(api.can("kelola-jadwal", null), "admin boleh kelola jadwal");
api.logout();

api.login("dina", "dina123", "student");
assert.ok(api.can("kelola-jadwal", null), "pj boleh kelola jadwal semua matkul");
assert.ok(api.can("upload", null), "pj tetap punya hak upload mahasiswa");
assert.ok(!api.can("kelola-akun", null), "pj tetap tidak boleh kelola akun");
api.logout();

api.login("budi", "budi123", "student");
assert.ok(!api.can("kelola-jadwal", null), "mahasiswa tidak boleh kelola jadwal");
assert.ok(api.can("buka", null), "mahasiswa tetap boleh membaca");
api.logout();

api.loginAsGuest();
assert.ok(!api.can("kelola-jadwal", null), "tamu tidak boleh kelola jadwal");
api.logout();

// --- Validasi ---
assert.ok(api.validateSchedule(OK, [], null).ok, "input valid diterima");
assert.ok(!api.validateSchedule({ ...OK, day: "" }, [], null).ok, "hari wajib");
assert.ok(!api.validateSchedule({ ...OK, day: "Sabtu-Doa" }, [], null).ok, "hari asing ditolak");
assert.ok(!api.validateSchedule({ ...OK, start: "8:00" }, [], null).ok, "jam harus 2 digit");
// --- Create: hak, validasi, persistensi ---
RESET();
api.login("budi", "budi123", "student");
assert.ok(!api.createSchedule(OK).ok, "mahasiswa tidak bisa membuat walau form diretak");
assert.strictEqual(api.listSchedules().length, 0, "create gagal tidak menyimpan apa pun");
api.logout();

api.login("dina", "dina123", "student");
const before = api.renders();
assert.ok(api.createSchedule(OK).ok, "pj bisa membuat jadwal");
assert.ok(api.renders() > before, "create memanggil render ulang");
assert.strictEqual(api.listSchedules().length, 1, "1 baris tersimpan");

const saved = api.listSchedules()[0];
assert.strictEqual(saved.id, 1, "id mulai dari 1");
assert.strictEqual(saved.day, "Senin");
assert.strictEqual(saved.course, "Pemrograman", "nama matkul disimpan sebagai teks");
assert.ok(saved.created_at && saved.updated_at, "ada stempel waktu");
assert.strictEqual(saved.created_by, 4, "dina sebagai pembuat");

api.createSchedule({ ...OK, day: "Selasa", room: "  D203  ", lecturer: "  Bu E  " });
assert.strictEqual(api.listSchedules()[1].room, "D203", "spasi room dipangkas");
assert.strictEqual(api.listSchedules()[1].lecturer, "Bu E", "spasi lecturer dipangkas");

assert.ok(!api.createSchedule(OK).ok, "create yang bentrok dengan sesi lain ditolak");
assert.strictEqual(api.listSchedules().length, 2, "create gagal tidak menambah baris");

// Field asing dari form yang dimanipulasi tidak ikut tersimpan.
assert.ok(api.createSchedule({ ...OK, day: "Kamis", is_admin: true, id: 999 }).ok);
const injected = api.listSchedules().find((s) => s.day === "Kamis");
assert.strictEqual(injected.is_admin, undefined, "field asing dibuang");
assert.strictEqual(injected.id, 3, "id dibuat sendiri, bukan ikut dari input");

// --- Update ---
assert.ok(!api.updateSchedule(999, OK).ok, "update id tak dikenal ditolak");
assert.ok(!api.updateSchedule(1, { ...OK, end: "07:00" }).ok, "update tidak boleh invalid");
assert.ok(api.updateSchedule(1, { ...OK, day: "Rabu", room: "Z999" }).ok, "update berhasil");
const updated = api.listSchedules().find((s) => s.id === 1);
assert.strictEqual(updated.day, "Rabu");
assert.strictEqual(updated.room, "Z999");
assert.strictEqual(api.listSchedules().length, 3, "update tidak menambah baris");

// Baris yang sedang diedit boleh menabrak jadwal lamanya sendiri.
assert.ok(api.updateSchedule(1, { ...OK, day: "Rabu", start: "08:00", end: "10:30" }).ok,
  "edit tidak bentrok dengan dirinya sendiri");
// Tapi tetap ditolak kalau menabrak sesi lain (id 2 = Selasa 08:00-10:00).
assert.ok(!api.updateSchedule(1, { ...OK, day: "Selasa", start: "09:00", end: "11:00" }).ok,
  "edit yang menabrak sesi lain tetap ditolak");

// --- Delete ---
assert.ok(!api.deleteSchedule(999).ok, "delete id tak dikenal ditolak");
assert.ok(api.deleteSchedule(1).ok, "delete berhasil");
assert.strictEqual(api.listSchedules().length, 2, "1 baris hilang");
assert.ok(!api.listSchedules().some((s) => s.id === 1), "baris yang dihapus tidak ada lagi");
api.logout();

// --- Pengelompokan ---
RESET();
const groups = api.jadwalGroup([
  { id: 3, day: "Jumat", start: "09:00", end: "11:00" },
  { id: 1, day: "Senin", start: "13:00", end: "15:00" },
  { id: 2, day: "Senin", start: "08:00", end: "10:00" },
]);
assert.strictEqual(groups.length, 2, "hanya hari yang punya sesi");
assert.strictEqual(groups[0].day, "Senin", "Senin sebelum Jumat");
assert.strictEqual(groups[0].items[0].id, 2, "08:00 diurutkan sebelum 13:00");
assert.strictEqual(groups[0].items[1].id, 1);
assert.strictEqual(groups[1].day, "Jumat");
assert.strictEqual(api.jadwalGroup([]).length, 0, "daftar kosong tidak crash");
assert.strictEqual(api.jadwalGroup(null).length, 0, "null tidak crash");

assert.ok(api.JADWAL_HARI.includes(api.jadwalTodayName()), "nama hari ini valid");
assert.strictEqual(new Set(api.JADWAL_HARI).size, 7, "7 hari unik");

// --- Seed hanya dipakai saat localStorage kosong ---
RESET();
const seed = [{ id: 1, day: "Senin", start: "08:00", end: "10:00", course: "Pemrograman" }];
api.setScheduleSeed(seed);
assert.strictEqual(api.listSchedules().length, 1, "seed dipakai saat store kosong");

api.login("admin", "admin123", "admin");
api.createSchedule({ ...OK, day: "Rabu" });
assert.strictEqual(api.listSchedules().length, 2, "create menulis ke localStorage");
delete store[api.SCHEDULES_KEY];
api.setScheduleSeed(seed);
assert.strictEqual(api.listSchedules().length, 1, "store kosong kembali pakai seed");
api.logout();

console.log("jadwal.test.js lulus: hak 4 role, validasi, create/update/delete, persistensi, pengelompokan.");

assert.ok(!api.validateSchedule({ ...OK, start: "24:00" }, [], null).ok, "jam 24 ditolak");
assert.ok(!api.validateSchedule({ ...OK, end: "99:99" }, [], null).ok, "menit 99 ditolak");
assert.ok(!api.validateSchedule({ ...OK, end: "07:00" }, [], null).ok, "selesai sebelum mulai");
assert.ok(!api.validateSchedule({ ...OK, end: "08:00" }, [], null).ok, "selesai sama dengan mulai");
assert.ok(!api.validateSchedule({ ...OK, course: "" }, [], null).ok, "nama matkul wajib");
assert.ok(!api.validateSchedule({ ...OK, course: "   " }, [], null).ok, "spasi doang dianggap kosong");
// Nama bebas, bukan referensi ke folder: dua sesi boleh punya nama sama.
assert.ok(api.validateSchedule({ ...OK, course: "Matematika" }, [], null).ok,
  "nama matkul bebas, tidak harus dari daftar");
assert.ok(!api.validateSchedule(undefined, [], null).ok, "input undefined tidak crash");
assert.ok(api.jadwalTimeOk("00:00"), "tengah malam sah");
assert.ok(api.jadwalTimeOk("23:59"), "23:59 sah");
