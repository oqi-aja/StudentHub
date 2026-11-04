// js/auth.js
// ============================================================
// StudentHub — Authentication layer (dual-mode).
// ============================================================
// Mendukung dua mode:
//   - mock   : pakai MOCK_ACCOUNTS di-memori + localStorage (default).
//              Cocok untuk development, demo, dan test suite.
//   - supabase : pakai Supabase Auth (signUp/signInWithPassword/signOut/
//                getSession). Setelah login, profile di-fetch dari tabel
//                `profiles` (id = auth.users.id = UUID). Role + course_id
//                datang dari profile, BUKAN dari JWT claim.
//
// Kontrak API (preserve sync behavior untuk pemanggil lama):
//   - getCurrentUser() SINKRON. Return currentUser (bisa null kalau
//     init Supabase belum selesai). Caller yang butuh "pastikan ready"
//     bisa `await window.SH_AUTH_READY` sebelum akses.
//   - login() SINKRON di mock mode (return user). ASYNC (return Promise)
//     di Supabase mode. Caller pakai `await login(...)` di kedua mode.
//   - logout() SINKRON. Clear state lokal segera. Supabase `signOut()`
//     fire-and-forget (tidak ditunggu).
//   - loginAsGuest() SINKRON.
//
// Constraint keamanan:
//   - JANGAN pernah pakai service_role/secret key di frontend.
//   - Username mock ("budi") di-mapped ke email ("budi@supabase.local")
//     saat login Supabase. Admin set up user Supabase Auth dengan email
//     format yang sama.
//   - Profile (role, course_id) datang dari tabel `profiles`, BUKAN dari
//     JWT. RLS `profiles_write_admin` menjaga hanya admin yang bisa CRUD.
//
// Halaman Kelola Akun (#akun) TIDAK dirombak di Tahap 2:
//   - createAccount/updateAccount/deleteAccount tetap mock-only.
//   - Di Supabase mode, fungsi-fungsi ini hanya modifikasi in-memory mock,
//     TIDAK membuat user nyata di Supabase Auth.
//   - Mekanisme aman untuk membuat user Supabase Auth asli: via Supabase
//     Dashboard atau Edge Function server-side (out of scope Tahap 2).
// ============================================================

const SESSION_KEY = 'sh_mock_user';
const ACCOUNTS_KEY = 'sh_mock_accounts';
const PROFILE_CACHE_KEY = 'sh_supabase_profile';

// Kata sandi disimpan apa adanya karena ini mockup lokal, bukan produksi.
// JANGAN hapus — masih dipakai untuk development dan test (mock mode).
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

// ---------- State ----------
let currentUser = null;
let _mode = 'mock'; // 'mock' | 'supabase'
let _supabaseClient = null;

// Promise yang resolve setelah session restore selesai (mock: sync resolve;
// Supabase: setelah getSession + fetch profile). Dipakai oleh script.js
// untuk delay routing awal sampai currentUser konsisten.
let _readyResolve;
const _readyPromise = new Promise((resolve) => { _readyResolve = resolve; });

// ---------- Mode helpers ----------
function isSupabaseMode() { return _mode === 'supabase' && _supabaseClient !== null; }
function getAuthMode() { return _mode; }

// ---------- Session mockup ----------

// Tamu tidak punya akun di MOCK_ACCOUNTS, jadi session-nya dibuat terpisah:
// tanpa id, username, dan password. Dipakai loginAsGuest() dan restoreSession()
// supaya isi session tamu hanya terdefinisi di satu tempat.
function guestSession() {
  return { id: null, username: null, name: ROLE_LABELS.guest, role: 'guest' };
}

function restoreSessionMock() {
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

function persistSessionMock() {
  try {
    if (currentUser) localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
    else localStorage.removeItem(SESSION_KEY);
  } catch (err) {
    // localStorage bisa diblokir (mis. mode privat di sebagian browser).
  }
}

// ---------- Supabase session restore ----------
// Ambil session dari Supabase Auth, lalu fetch profile dari tabel profiles.
// Set currentUser dengan UUID + role + course_id dari profile.
async function restoreSessionSupabase() {
  if (!_supabaseClient) return;
  try {
    // 1) Cache sync: kalau ada profile di localStorage (dari login sebelumnya),
    //    pakai dulu supaya getCurrentUser() tidak null selama init async.
    try {
      const cached = localStorage.getItem(PROFILE_CACHE_KEY);
      if (cached) {
        const cachedUser = JSON.parse(cached);
        if (cachedUser && cachedUser.id) currentUser = cachedUser;
      }
    } catch (_) { /* ignore */ }

    // 2) Cek session asli dari Supabase
    const { data: { session }, error } = await _supabaseClient.auth.getSession();
    if (error || !session) {
      // Tidak ada session → bersihkan cache + state
      currentUser = null;
      try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch (_) {}
      return;
    }

    // 3) Fetch profile dari tabel profiles (RLS profiles_select_logged_in)
    const user = session.user;
    const { data: profile, error: profErr } = await _supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    if (profErr || !profile) {
      // User ada di auth.users tapi belum ada profile row.
      // (Harusnya tidak terjadi kalau admin sudah insert profile.)
      // eslint-disable-next-line no-console
      console.warn('[auth.js] Profile tidak ditemukan untuk user', user.id);
      currentUser = null;
      try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch (_) {}
      return;
    }

    // 4) Set currentUser dari profile
    currentUser = {
      id: profile.id,           // UUID string
      username: profile.username,
      name: profile.name,
      role: profile.role,
      ...(profile.course_id != null ? { course_id: profile.course_id } : {}),
    };
    // Cache sync untuk next reload
    try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(currentUser)); } catch (_) {}
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[auth.js] restoreSessionSupabase gagal:', e);
  }
}

// ---------- Supabase init ----------
// Dipanggil sekali di IIFE. Deteksi konfigurasi dari window.SH_SUPABASE.
// Kalau gagal (config hilang / SDK tidak load), fallback ke mock.
function initSupabase() {
  const cfg = (typeof window !== 'undefined' && window.SH_SUPABASE) || null;
  if (!cfg || !cfg.enabled || !cfg.url || !cfg.anonKey) {
    _mode = 'mock';
    currentUser = restoreSessionMock();
    _readyResolve();
    return;
  }
  if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
    try {
      _supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey, cfg.clientOptions || {});
      _mode = 'supabase';
      // Async: restore session, then resolve ready
      restoreSessionSupabase().finally(() => _readyResolve());
      // eslint-disable-next-line no-console
      console.info('[auth.js] Supabase Auth mode aktif. URL:', cfg.url);
      return;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[auth.js] Supabase init gagal, fallback ke mock:', e);
      _mode = 'mock';
      _supabaseClient = null;
      currentUser = restoreSessionMock();
      _readyResolve();
      return;
    }
  }
  _mode = 'mock';
  currentUser = restoreSessionMock();
  _readyResolve();
}

// ---------- Login ----------

// Mock mode: SINKRON. Return currentUser atau null.
// Supabase mode: ASYNC. Return Promise<currentUser | null>.
// Caller pakai `await login(...)` di kedua mode (await non-Promise = value).
function login(username, password, gate) {
  if (!isSupabaseMode()) {
    return loginMock(username, password, gate);
  }
  return loginSupabase(username, password, gate);
}

function loginMock(username, password, gate) {
  const name = String(username == null ? '' : username).trim().toLowerCase();
  const roles = LOGIN_GATES[gate] || [];
  const account = MOCK_ACCOUNTS.find(
    (a) => a.username === name && a.password === password && roles.includes(a.role)
  );
  if (!account) return null;
  currentUser = { id: account.id, username: account.username, name: account.name, role: account.role,
    ...(account.course_id ? { course_id: account.course_id } : {}) };
  persistSessionMock();
  return currentUser;
}

async function loginSupabase(username, password, gate) {
  if (!_supabaseClient) return null;
  // Username di-mapped ke email: kalau tidak ada '@', append '@supabase.local'.
  // Admin set up user di Supabase Auth dengan email format yang sama.
  const trimmed = String(username == null ? '' : username).trim().toLowerCase();
  if (!trimmed) return null;
  const email = trimmed.includes('@') ? trimmed : `${trimmed}@supabase.local`;
  const roles = LOGIN_GATES[gate] || [];

  // 1) signInWithPassword
  const { data, error } = await _supabaseClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) return null;

  // 2) Fetch profile dari tabel profiles
  const { data: profile, error: profErr } = await _supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profErr || !profile) return null;

  // 3) Gate check: role profile harus cocok dengan pintu login yang dipilih
  if (!roles.includes(profile.role)) {
    // Sign out user ini karena tidak boleh lewat pintu ini
    try { await _supabaseClient.auth.signOut(); } catch (_) {}
    return null;
  }

  // 4) Set currentUser dari profile
  currentUser = {
    id: profile.id,
    username: profile.username,
    name: profile.name,
    role: profile.role,
    ...(profile.course_id != null ? { course_id: profile.course_id } : {}),
  };
  // Cache sync untuk next reload
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(currentUser)); } catch (_) {}
  return currentUser;
}

function loginAsGuest() {
  currentUser = guestSession();
  if (!isSupabaseMode()) {
    persistSessionMock();
  } else {
    // Supabase mode: tamu tidak ada di auth.users. Cukup clear local state.
    try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch (_) {}
    // Optional: signOut dari Supabase kalau ada session lama
    if (_supabaseClient) {
      _supabaseClient.auth.signOut().catch(() => {});
    }
  }
  return currentUser;
}

// ---------- Logout ----------
// SINKRON: clear state lokal segera. Supabase `signOut()` fire-and-forget
// (tidak ditunggu) supaya UI redirect ke #login cepat.
function logout() {
  currentUser = null;
  try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch (_) {}
  if (!isSupabaseMode()) {
    persistSessionMock();
  } else if (_supabaseClient) {
    // Fire-and-forget. State lokal sudah bersih.
    _supabaseClient.auth.signOut().catch(() => {});
  }
}

// ---------- Kelola Akun (mockup, tanpa backend) ----------
// Catatan: di Supabase mode, fungsi-fungsi ini HANYA modifikasi MOCK_ACCOUNTS
// in-memory. TIDAK membuat user nyata di Supabase Auth. Untuk membuat user
// Supabase Auth asli, admin harus:
//   1) Buat user via Supabase Dashboard → Authentication → Users → Add user
//   2) Insert row ke `profiles` (id = auth.users.id, role, course_id)
// Mekanisme server-side (Edge Function dengan service_role) di luar scope Tahap 2.

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

// Satu-satunya sumber kebenaran untuk action 'kelola-akun'. Dipakai juga
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
  const note = isSupabaseMode()
    ? ' (mock only — belum terdaftar di Supabase Auth)'
    : '';
  return { ok: true, account: { ...account, password: undefined },
    message: `Akun ${account.name} berhasil dibuat sebagai ${ROLE_LABELS[account.role]}.${note}` };
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
  return { ok: true, account: { ...account, password: undefined }, message: `Akun ${account.name} berhasil diperbarui.` };
}

function deleteAccount(id) {
  if (!canManageAccounts()) return { ok: false, error: 'Hanya Ketua Kelas yang bisa menghapus akun.' };
  const index = MOCK_ACCOUNTS.findIndex((a) => a.id === id);
  if (index === -1) return { ok: false, error: 'Akun tidak ditemukan.' };
  if (currentUser && currentUser.id === id) return { ok: false, error: 'Akun yang sedang dipakai tidak bisa dihapus dari sini.' };
  const [removed] = MOCK_ACCOUNTS.splice(index, 1);
  persistAccounts();
  return { ok: true, message: `Akun ${removed.name} (${removed.username}) berhasil dihapus.` };
}

// ---------- Public sync getters ----------

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
//         | 'kelola-akun' | 'buat-akun' | 'kelola-jadwal'
//         | 'kelola-tugas' (admin/PJ manage daftar tugas)
//         | 'kelola-folder' (admin/PJ manage struktur folder)
//         | 'submission-upload' (mahasiswa upload ke folder pengumpulan)
function can(action, item) {
  if (!currentUser) return false;

  // Catatan pribadi. Dicek sebelum cabang admin supaya admin otomatis ikut
  // aturan yang sama: boleh bikin, tidak boleh membuka catatan orang lain.
  if (action === 'catatan') return currentUser.role !== 'guest';
  if (action === 'catatan-ubah') return ownsNote(item);

  if (currentUser.role === 'admin') {
    if (action === 'kelola-akun' || action === 'buat-akun') return true;
    return true; // admin bisa semua (folder, file, tugas, jadwal, akun)
  }

  if (currentUser.role === 'guest') {
    // Tamu hanya boleh mengunduh file milik kelas (visibility public).
    if (action === 'download') return Boolean(item) && item.type === 'file' && item.visibility === 'public';
    return READ_ACTIONS.includes(action);
  }

  // PJ: kelola jadwal semua matkul + kelola folder/file + kelola daftar tugas
  // (gating per course_id dilakukan di level data, bukan di can() ini, karena
  // can() tidak tahu struktur task. Lihat ownsCourse() di bawah.)
  if (currentUser.role === 'pj') {
    if (action === 'kelola-jadwal') return true;
    if (action === 'kelola-folder') return true; // create/rename/delete folder
    if (action === 'create-folder') return true; // untuk fmOpenAdd()
    if (action === 'upload') return true;       // PJ boleh upload materi
    if (action === 'kelola-tugas') return true;  // PJ boleh CRUD daftar tugas (course-gating di data layer)
    if (action === 'rename' || action === 'delete') return true; // PJ bebas rename/delete folder/file
    if (action === 'download') return true;
    return READ_ACTIONS.includes(action);
  }

  // Mahasiswa
  if (action === 'download' || action === 'upload') return true;
  if (action === 'submission-upload') return true; // mahasiswa upload ke folder pengumpulan
  if (action === 'rename' || action === 'delete') return ownsFile(item);
  return READ_ACTIONS.includes(action);
}

// Helper: apakah course_id ini milik PJ yang sedang login?
// Dipakai di daftar-tugas.js untuk gating edit/delete task per course.
function ownsCourse(courseId) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true; // admin bebas
  if (currentUser.role === 'pj') return Number(currentUser.course_id) === Number(courseId);
  return false;
}

// Helper: apakah user saat ini boleh manage task ini?
// task: { course_id, ... } | null (null = create new)
function canManageTask(task) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'pj') {
    if (!task) return true; // create: form yang cek course_id
    return ownsCourse(task.course_id);
  }
  return false;
}

// Nama orang yang memiliki item ini (untuk ditampilkan di detail).
function ownerName(item, users) {
  const ownerId = item.user_id ?? item.created_by;
  const found = (users || []).find((u) => String(u.id) === String(ownerId));
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
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = form.querySelector('input[name="username"]').value;
      const password = form.querySelector('input[name="password"]').value;
      const errorEl = form.querySelector('[data-error]');
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        // login() sync di mock, async di Supabase. await kompatibel keduanya.
        const user = await login(username, password, form.dataset.form);
        if (!user) {
          errorEl.textContent = 'Username atau password salah.';
          return;
        }
        window.location.hash = '#home';
      } catch (e) {
        errorEl.textContent = 'Login gagal: ' + (e && e.message ? e.message : 'unknown error');
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });
}

// ---------- Init ----------
// Deteksi mode + restore session. Di mock mode, sync resolve. Di Supabase
// mode, async via getSession + fetch profile. _readyPromise resolve setelah
// selesai; script.js pakai `await window.SH_AUTH_READY` untuk delay routing.
initSupabase();

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.login = { init: initLoginPage };

// Promise yang resolve setelah session restore selesai. Dipakai oleh script.js
// supaya routing awal tidak berjalan sebelum currentUser konsisten.
window.SH_AUTH_READY = _readyPromise;
