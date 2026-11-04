// tests/csv-export.test.js
// Unit test murni untuk fungsi ekspor rekap CSV tugas & matriks StudentHub.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.window = {};
global.document = { querySelector: () => null, querySelectorAll: () => [] };

const src = fs.readFileSync(path.join(__dirname, "..", "js", "daftar-tugas.js"), "utf8");
new Function(src)();

const { csvEscapeCell, exportTaskSubmissionsToCSV, exportMatrixToCSV } = window.SH_CSV;

// 1. Uji escaping sel CSV (RFC 4180)
assert.strictEqual(csvEscapeCell("Budi"), '"Budi"');
assert.strictEqual(csvEscapeCell('Budi "Hebat"'), '"Budi ""Hebat"""');
assert.strictEqual(csvEscapeCell("Teknik, Informatika"), '"Teknik, Informatika"');
assert.strictEqual(csvEscapeCell(null), '""');
assert.strictEqual(csvEscapeCell(123), '"123"');

// 2. Uji Ekspor Rekap Submission Tugas Tunggal
const mockTask = { id: 1, title: "Tugas Algoritma 1" };
const mockFiles = [{ id: 101, name: "lap_algo_budi.pdf", file_type: "pdf" }];
const mockStudents = [
  {
    profile: { id: "u1", name: "Budi Santoso" },
    status: "sudah",
    submission: { file_id: 101, updated_at: "2026-11-01T10:00:00" },
  },
  {
    profile: { id: "u2", name: "Siti Rahma" },
    status: "terlambat",
    submission: { file_id: 999, updated_at: "2026-11-03T12:00:00" },
  },
  {
    profile: { id: "u3", name: "Ahmad Dani" },
    status: "belum",
    submission: null,
  },
];

const taskCSV = exportTaskSubmissionsToCSV(mockTask, mockStudents, mockFiles);
assert.ok(taskCSV.startsWith("\uFEFF"), "CSV wajib diawali UTF-8 BOM untuk kompatibilitas Excel");
assert.ok(taskCSV.includes('"No","Nama Mahasiswa","Status","File Terlampir","Waktu Pengumpulan"'));
assert.ok(taskCSV.includes('"Budi Santoso","Sudah","lap_algo_budi.pdf"'));
assert.ok(taskCSV.includes('"Siti Rahma","Terlambat"'));
assert.ok(taskCSV.includes('"Ahmad Dani","Belum","-","-"'));

// 3. Uji Ekspor Matriks Tugas
const mockTasks = [
  { id: 1, title: "Tugas 1" },
  { id: 2, title: "Tugas 2" },
];
const mockStudentsList = [
  { id: "u1", name: "Budi" },
  { id: "u2", name: "Siti" },
];
const mockMatrix = {
  u1: { 1: "sudah", 2: "sudah" },
  u2: { 1: "sudah", 2: "belum" },
};

const matrixCSV = exportMatrixToCSV("Pemrograman Web", mockTasks, mockStudentsList, mockMatrix);
assert.ok(matrixCSV.startsWith("\uFEFF"));
assert.ok(matrixCSV.includes('"No","Nama Mahasiswa","Tugas 1","Tugas 2","Total Tugas","Sudah Kumpul","Belum Kumpul","Persentase"'));
assert.ok(matrixCSV.includes('"Budi","Sudah","Sudah","2","2","0","100%"'));
assert.ok(matrixCSV.includes('"Siti","Sudah","Belum","2","1","1","50%"'));

console.log("csv-export.test.js lulus: escaping RFC 4180, BOM UTF-8, rekap tugas tunggal, matriks tugas.");
