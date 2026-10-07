// js/auth.js
// PART 1 — MOCKUP. Akun dan password di bawah hanya untuk demo lokal, bukan
// autentikasi sungguhan (lihat catatan password di README).
// PART 2+: bagian session diganti session asli dari Cloudflare Workers.
// Fungsi can() tetap dipakai, hanya sumber datanya yang berubah.

const SESSION_KEY = 'sh_mock_user';
const ACCOUNTS_KEY = 'sh_mock_accounts';

// Kata sandi disimpan apa adanya karena ini mockup lokal, bukan produksi.
const MOCK_ACCOUNTS = [
  { id: 1, username: 'admin', password: 'admin123', name: 'Oqi', role: 'admin' },
  { id: 2, username: 'budi', password: 'budi123', name: 'Budi', role: 'student' },
  { id: 3, username: 'andi', password: 'andi123', name: 'Andi', role: 'student' },
  { id: 4, username: 'dina', password: 'dina123', name: 'Dina', role: 'pj', course_id: 2 },
];

const ROLE_LABELS = { admin: 'Ketua Kelas', pj: 'PJ Mata Kuliah', student: 'Mahasiswa', guest: 'Tamu' };

// Tiga pintu login tetap; satu pintu boleh menerima beberapa role.
// PJ punya role sendiri tapi tidak punya pintu sendiri: dia masuk lewat
// pintu Mahasiswa, lalu role-nya yang menentukan menu yang tampil.
const LOGIN_GATES = { student: ['student', 'pj'], admin: ['admin'] };

// ---------- Session mockup ----------

// Tamu tidak punya akun di MOCK_ACCOUNTS, jadi session-nya dibuat terpisah:
// tanpa id, username, dan password. Dipakai loginAsGuest() dan restoreSession()
// supaya isi session tamu hanya terdefinisi di satu tempat.
function guestSession() {
  return { id: null, username: null, name: ROLE_LABELS.guest, role: 'guest' };
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Tamu harus dipulihkan terpisah: dia tidak pernah ada di MOCK_ACCOUNTS.
    if (saved && saved.role === 'guest') return guestSession();
    const known = MOCK_ACCOUNTS.find((a) => a.id === saved.id && a.role === saved.role);
    if (!known) return null;
    // Sandi sengaja tidak ikut disimpan di localStorage.
    return { id: known.id, username: known.username, name: known.name, role: known.role,
      ...(known.course_id ? { course_id: known.course_id } : {}) };
  } catch (err) {
    return null;
  }
}

let currentUser = restoreSession();

function persistSession() {
  try {
    if (currentUser) localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    else localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    // localStorage bisa diblokir (mis. mode privat di sebagian browser).
  }
}

// gate: 'student' atau 'admin' — sesuai pintu login yang dipilih pengguna.
// Akun yang role-nya tidak ada di daftar pintu itu ditolak, jadi akun admin
// tetap tidak bisa masuk lewat pintu Mahasiswa.
function login(username, password, gate) {
  const name = String(username == null ? '' : username).trim().toLowerCase();
  const roles = LOGIN_GATES[gate] || [];
  const account = MOCK_ACCOUNTS.find(
    (a) => a.username === name && a.password === password && roles.includes(a.role)
  );
  if (!account) return null;
  currentUser = { id: account.id, username: account.username, name: account.name, role: account.role,
    ...(account.course_id ? { course_id: account.course_id } : {}) };
  persistSession();
  return currentUser;
}

function loginAsGuest() {
  currentUser = guestSession();
  persistSession();
  return currentUser;
}

function logout() {
  currentUser = null;
  persistSession();
}

// ---------- Kelola Akun (mockup, tanpa backend) ----------

// Daftar akun disimpan utuh ke localStorage supaya hasil tambah/edit/hapus
// tidak hilang saat refresh, termasuk perubahan pada akun bawaan file ini.
function loadStoredAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved) || !saved.length) return;
    // Tanpa akun admin berarti data versi lama (hanya akun tambahan). Data itu
    // diabaikan supaya akun bawaan tidak ikut hilang.
    if (!saved.some((a) => a && a.role === 'admin')) return;
    MOCK_ACCOUNTS.length = 0;
    MOCK_ACCOUNTS.push(...saved.filter((a) => a && a.username));
  } catch (err) {
    // localStorage bisa diblokir atau isinya rusak; akun bawaan tetap jalan.
  }
}

function persistAccounts() {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(MOCK_ACCOUNTS));
  } catch (err) {
    // Tidak fatal: akun tetap hidup di memori sampai halaman ditutup.
  }
}

loadStoredAccounts();

// Tanpa password — dipakai dashboard dan tempat lain yang tidak butuh sandi.
function listAccounts() {
  return MOCK_ACCOUNTS.map(({ password, ...rest }) => rest);
}

// Password ikut dikembalikan, tapi hanya untuk Ketua Kelas. Dipakai halaman
// Kelola Akun supaya kolom Password bisa ditampilkan apa adanya.
// ponytail: password plaintext hanya untuk mockup lokal ini. Di produksi,
// halaman seperti ini tidak boleh ada sama sekali.
function listAccountsWithSecrets() {
  if (!canManageAccounts()) return [];
  return MOCK_ACCOUNTS.map((a) => ({ ...a }));
}

// Satu-satunya sumber kebenaran untuk action ‘kelola-akun’. Dipakai juga
// oleh guard route #akun supaya halaman ini tidak punya daftar sendiri.
function canManageAccounts() {
  return can('kelola-akun', null);
}

// Field wajib per role. PJ wajib punya mata kuliah;-role lain tidak.
// editId dipakai saat ubah akun supaya username miliknya sendiri tidak dianggap
// bentrok dengan dirinya sendiri.
function validateAccount(input, editId) {
  const name = String(input.name || '').trim();
  const username = String(input.username || '').trim().toLowerCase();
  const password = String(input.password || '');
  const role = String(input.role || '').trim();
  const courseId = input.course_id === '' || input.course_id == null ? null : Number(input.course_id);

  if (!name) return { error: 'Nama lengkap wajib diisi.' };
  if (!username) return { error: 'Username wajib diisi.' };
  if (!password) return { error: 'Password wajib diisi.' };
  if (role !== 'pj' && role !== 'student' && role !== 'admin') return { error: 'Pilih role akun.' };
  if (role === 'pj' && !courseId) return { error: 'PJ Mata Kuliah wajib memilih mata kuliah.' };
  if (MOCK_ACCOUNTS.some((a) => a.username === username && a.id !== editId)) {
    return { error: `Username "${username}" sudah dipakai.` };
  }
  return { account: { name, username, password, role, ...(role === 'pj' ? { course_id: courseId } : {}) } };
}

function createAccount(input) {
  if (!canManageAccounts()) return { ok: false, error: 'Hanya Ketua Kelas yang bisa menambah akun.' };
  const v = validateAccount(input || {});
  if (v.error) return { ok: false, error: v.error };
  const account = { id: Math.max(0, ...MOCK_ACCOUNTS.map((a) => a.id)) + 1, ...v.account };
  MOCK_ACCOUNTS.push(account);
  persistAccounts();
  return { ok: true, account: { ...account, password: undefined }, message: `✓ Akun ${account.name} berhasil dibuat sebagai ${ROLE_LABELS[account.role]}.` };
}

function updateAccount(id, input) {
  if (!canManageAccounts()) return { ok: false, error: 'Hanya Ketua Kelas yang bisa mengubah akun.' };
  const index = MOCK_ACCOUNTS.findIndex((a) => a.id === id);
  if (index === -1) return { ok: false, error: 'Akun tidak ditemukan.' };
  // Akun sendiri tidak boleh diubah lewat halaman ini: mengubah role atau
  // password sendiri bisa mengunci kita keluar dari Kelola Akun.
  if (currentUser && currentUser.id === id) return { ok: false, error: 'Akun yang sedang dipakai tidak bisa diubah dari sini.' };
  const v = validateAccount(input || {}, id);
  if (v.error) return { ok: false, error: v.error };
  const account = { id, ...v.account };
  MOCK_ACCOUNTS[index] = account;
  persistAccounts();
  return { ok: true, account: { ...account, password: undefined }, message: `✓ Akun ${account.name} berhasil diperbarui.` };
}

function deleteAccount(id) {
  if (!canManageAccounts()) return { ok: false, error: 'Hanya Ketua Kelas yang bisa menghapus akun.' };
  const index = MOCK_ACCOUNTS.findIndex((a) => a.id === id);
  if (index === -1) return { ok: false, error: 'Akun tidak ditemukan.' };
  if (currentUser && currentUser.id === id) return { ok: false, error: 'Akun yang sedang dipakai tidak bisa dihapus dari sini.' };
  const [removed] = MOCK_ACCOUNTS.splice(index, 1);
  persistAccounts();
  return { ok: true, message: `✓ Akun ${removed.name} (${removed.username}) berhasil dihapus.` };
}

function isLoggedIn() {
  return currentUser !== null;
}

function getCurrentUser() {
  return currentUser;
}

function getRole() {
  return currentUser ? currentUser.role : null;
}

function getRoleLabel() {
  return ROLE_LABELS[getRole()] || 'Tamu';
}

function isAdmin() {
  return getRole() === 'admin';
}

function isGuest() {
  return getRole() === 'guest';
}

// ---------- Hak akses ----------

// Aksi read-only, termasuk untuk tamu.
const READ_ACTIONS = ['buka', 'detail'];

// Mahasiswa hanya boleh mengubah file miliknya sendiri. Folder dan tugas
// milik kelas tidak boleh disentuh mahasiswa.
function ownsFile(item) {
  return Boolean(item) && item.type === 'file' && currentUser !== null && item.user_id === currentUser.id;
}

// Catatan bersifat pribadi: setiap akun hanya menyentuh catatannya sendiri,
// termasuk Ketua Kelas. Berbeda dari file yang dijaga lewat cabang
// 'rename'/'delete', aturan ini diperiksa sebelum cabang role mana pun.
function ownsNote(item) {
  return Boolean(item) && currentUser !== null && item.user_id === currentUser.id;
}

// action: 'buka' | 'detail' | 'download' | 'rename' | 'delete' | 'upload' | 'create-folder'
//         | 'catatan' | 'catatan-ubah'
function can(action, item) {
  if (!currentUser) return false;

  // Catatan pribadi. Dicek sebelum cabang admin supaya admin otomatis ikut
  // aturan yang sama: boleh bikin, tidak boleh membuka catatan orang lain.
  if (action === 'catatan') return currentUser.role !== 'guest';
  if (action === 'catatan-ubah') return ownsNote(item);

    if (currentUser.role === 'admin') {
      if (action === 'kelola-akun' || action === 'buat-akun') return true;
      return true;
    }

  if (currentUser.role === 'guest') {
    // Tamu hanya boleh mengunduh file milik kelas (visibility public).
    if (action === 'download') return Boolean(item) && item.type === 'file' && item.visibility === 'public';
    return READ_ACTIONS.includes(action);
  }

  // PJ bebas mengelola jadwal semua matkul, sama seperti Ketua Kelas.
  // Dicek sebelum blok hak Mahasiswa supaya PJ tetap dapat upload/download.
  if (currentUser.role === 'pj' && action === 'kelola-jadwal') return true;

  // Mahasiswa
  if (action === 'download' || action === 'upload') return true;
  if (action === 'rename' || action === 'delete') return ownsFile(item);
  return READ_ACTIONS.includes(action);
}

// Nama orang yang memiliki item ini (untuk ditampilkan di detail).
function ownerName(item, users) {
  const ownerId = item.user_id ?? item.created_by;
  const found = (users || []).find((u) => u.id === ownerId);
  return found ? found.name : '-';
}

// ---------- Halaman login (#login) ----------
// UI-nya ikut di file ini supaya tidak perlu menambah js/login.js baru.

// which: 'student' | 'admin' | null (null = kembali ke daftar pintu masuk)
function showLoginPanel(root, which) {
  root.querySelector('[data-panel="gates"]').hidden = which !== null;
  root.querySelectorAll('.login-form').forEach((form) => {
    const active = form.dataset.form === which;
    form.hidden = !active;
    if (!active) return;
    form.reset();
    form.querySelector('[data-error]').textContent = '';
    form.querySelector('input[name="username"]').focus();
  });
}

function initLoginPage() {
  const root = document.querySelector('.login');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  root.querySelectorAll('[data-enter]').forEach((btn) => {
    btn.addEventListener('click', () => showLoginPanel(root, btn.dataset.enter));
  });
  root.querySelectorAll('[data-login-back]').forEach((btn) => {
    btn.addEventListener('click', () => showLoginPanel(root, null));
  });

  root.querySelector('[data-login-guest]').addEventListener('click', () => {
    loginAsGuest();
    window.location.hash = '#home';
  });

  root.querySelectorAll('.login-form').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const username = form.querySelector('input[name="username"]').value;
      const password = form.querySelector('input[name="password"]').value;
      if (!login(username, password, form.dataset.form)) {
        form.querySelector('[data-error]').textContent = 'Username atau password salah.';
        return;
      }
      window.location.hash = '#home';
    });
  });
}

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.login = { init: initLoginPage };
