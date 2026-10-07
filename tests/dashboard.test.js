// tests/dashboard.test.js
// Cek fungsi murni di js/dashboard.js: format tanggal, sisa hari, dan escaping.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

global.window = {};
const src = fs.readFileSync(path.join(ROOT, "js", "dashboard.js"), "utf8")
  .replace(/window\.STUDENTHUB_PAGES[\s\S]*$/, "");

const dash = new Function(src + "\n" + [
  "return { dashFormatDate, dashDaysLeft, dashDeadlineNote, dashCourseName,",
  "  dashEscape, dashList, BULAN };",
].join("\n"))();

// --- Format tanggal ---
assert.strictEqual(dash.dashFormatDate("2026-10-05"), "5 Oktober 2026");
assert.strictEqual(dash.dashFormatDate("2026-01-01"), "1 Januari 2026");
assert.strictEqual(dash.dashFormatDate("2026-12-31"), "31 Desember 2026");
assert.strictEqual(dash.dashFormatDate(""), "-");
assert.strictEqual(dash.dashFormatDate("bukan tanggal"), "bukan tanggal");
assert.strictEqual(dash.BULAN.length, 12, "12 nama bulan");

// --- Sisa hari, relatif ke hari ini ---
const iso = (offset) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return [d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0")].join("-");
};

assert.strictEqual(dash.dashDaysLeft(iso(0)), 0, "deadline hari ini = 0");
assert.strictEqual(dash.dashDaysLeft(iso(3)), 3);
assert.strictEqual(dash.dashDaysLeft(iso(-5)), -5, "lewat deadline bernilai negatif");
assert.strictEqual(dash.dashDaysLeft(""), null, "tanpa deadline = null");
assert.strictEqual(dash.dashDaysLeft("ngawur"), null, "tanggal rusak tidak crash");

assert.strictEqual(dash.dashDeadlineNote(iso(0)), "Deadline hari ini");
assert.strictEqual(dash.dashDeadlineNote(iso(7)), "\u23f0 7 hari lagi");
assert.strictEqual(dash.dashDeadlineNote(iso(-2)), "Terlambat 2 hari");
assert.strictEqual(dash.dashDeadlineNote(""), "Tanpa deadline");

// --- Nama mata kuliah dari folder ---
const data = { folders: [
  { id: 1, parent_id: null, name: "Semester 1" },
  { id: 2, parent_id: 1, name: "Pemrograman" },
] };
assert.strictEqual(dash.dashCourseName(data, 2), "Pemrograman");
assert.strictEqual(dash.dashCourseName(data, 99), "-", "folder tak dikenal tidak crash");
assert.strictEqual(dash.dashCourseName({}, 1), "-", "folders kosong tidak crash");
assert.strictEqual(dash.dashCourseName(data, null), "-");

// --- Escaping wajib: nama akun ikut ke innerHTML ---
assert.strictEqual(dash.dashEscape("<img src=x onerror=alert(1)>"),
  "&lt;img src=x onerror=alert(1)&gt;");
assert.strictEqual(dash.dashEscape('a"b'), "a&quot;b");
assert.strictEqual(dash.dashEscape(null), "");
assert.strictEqual(dash.dashEscape(undefined), "");

// --- Empty state ---
assert.ok(dash.dashList([]).includes("Belum ada data"));
assert.strictEqual(dash.dashList(["<b>a</b>", "<i>b</i>"]), "<b>a</b><i>b</i>", "dashList menyambung item");

console.log("dashboard.test.js lulus: format tanggal, sisa hari, nama matkul, escaping, empty state.");