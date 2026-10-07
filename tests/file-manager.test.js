// tests/file-manager.test.js
// Jalankan: node tests/file-manager.test.js
// Menguji logika murni halaman Tugas (pohon folder, search, sort, session & permission).
// Tidak butuh browser maupun framework.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'contoh.json'), 'utf8'));

// Stub browser: auth.js membaca localStorage dan mendaftarkan diri ke window.
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.window = {};

// auth.js + bagian tugas.js yang tidak menyentuh DOM.
const source = [
  fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8'),
  fs.readFileSync(path.join(ROOT, 'js', 'tugas.js'), 'utf8')
    .replace(/window\.STUDENTHUB_PAGES[\s\S]*$/, ''),
].join('\n');

const api = new Function(`${source}
return { fm, fmChildren, fmPath, fmSearch, fmSortItems, fmMeta, fmLocation, fmIcon, fmFind, can, ownerName,
         login, loginAsGuest, logout, getCurrentUser, getRole, isAdmin, isGuest };`)();
api.fm.data = data;

const names = (items) => items.map((i) => i.name);

// ---------- Pohon folder ----------

assert.deepStrictEqual(names(api.fmChildren(null)), ['Semester 1']);
assert.deepStrictEqual(names(api.fmChildren(1)), ['Pemrograman', 'Basis Data', 'Jaringan'], 'urutan asli dari JSON; pengurutan dilakukan oleh fmSortItems');
assert.deepStrictEqual(names(api.fmChildren(2)), ['Tugas 1 - Algoritma', 'Tugas-Algoritma.pdf', 'Laporan-Algoritma.docx']);
assert.deepStrictEqual(api.fmChildren(4), []); // folder kosong

// Breadcrumb jalan dari folder terdalam ke root.
assert.deepStrictEqual(api.fmPath(2).map((f) => f.name), ['Semester 1', 'Pemrograman']);
assert.deepStrictEqual(api.fmPath(null), []);
assert.strictEqual(api.fmLocation(1), 'Tugas / Semester 1');
assert.strictEqual(api.fmLocation(null), 'Tugas');

// Folder selalu di atas, apa pun pilihan urutannya.
api.fm.sort = 'name-desc';
assert.deepStrictEqual(names(api.fmSortItems(api.fmChildren(1))), ['Pemrograman', 'Jaringan', 'Basis Data']);
// Sort pilihan lain; item tanpa ukuran (tugas) di akhir.
api.fm.sort = 'size';
assert.deepStrictEqual(
  names(api.fmSortItems(api.fmChildren(2))),
  ['Tugas-Algoritma.pdf', 'Laporan-Algoritma.docx', 'Tugas 1 - Algoritma'],
  'ukuran terbesar dulu; item tanpa ukuran (tugas) di akhir',
);
api.fm.sort = 'newest';
const folderDanFile = api.fmSortItems([...api.fmChildren(1), ...api.fmChildren(3)]);
assert.strictEqual(folderDanFile[0].type, 'folder', 'folder tidak pernah tenggelam di antara file');
api.fm.sort = 'name-asc';

// Search menyisir seluruh pohon, bukan cuma folder aktif.
assert.deepStrictEqual(names(api.fmSearch('algoritma')), ['Tugas 1 - Algoritma', 'Tugas-Algoritma.pdf', 'Laporan-Algoritma.docx']);
assert.deepStrictEqual(names(api.fmSearch('zzz')), []);

// Metadata dan ikon.
assert.strictEqual(api.fmMeta(api.fmChildren(1)[0]), '3 item');
assert.strictEqual(api.fmIcon({ type: 'file', name: 'Project-Akhir.zip' }), '📦');
assert.strictEqual(api.fmIcon({ type: 'task', name: 'x' }), '📌');

const folderPemrograman = api.fmFind('folder', 2);
const fileOqi = api.fmFind('file', 1);   // visibility public
const fileBudi = api.fmFind('file', 2);  // visibility private
const fileTeks = api.fmFind('file', 5);  // txt milik Ketua Kelas, public

// Setiap file wajib punya visibility; tanpa itu aturan download tamu bocor.
data.files.forEach((f) => assert.ok(['public', 'private'].includes(f.visibility), `${f.name} tanpa visibility`));
// Aturannya satu kalimat: file Ketua Kelas public, file mahasiswa private.
data.files.forEach((f) => {
  const dariKetuaKelas = f.user_id === 1;
  assert.strictEqual(f.visibility, dariKetuaKelas ? 'public' : 'private', f.name);
});
// ---------- Session ----------

assert.strictEqual(api.getCurrentUser(), null, 'belum ada sesi');
assert.ok(!api.can('buka', folderPemrograman), 'tanpa sesi semua aksi tertutup');

assert.ok(api.login('admin', 'salah', 'admin') === null, 'password salah ditolak');
assert.ok(api.login('budi', 'admin123', 'student') === null, 'password admin tidak jalan di pintu mahasiswa');
assert.ok(api.login('admin', 'admin123', 'student') === null, 'akun admin tidak bisa lewat pintu mahasiswa');
assert.strictEqual(api.getCurrentUser(), null, 'gagal login tidak meninggalkan sesi');

// Admin / Ketua Kelas
assert.strictEqual(api.login('admin', 'admin123', 'admin').role, 'admin');
assert.ok(api.isAdmin());
assert.ok(api.can('create-folder', null));
assert.ok(api.can('delete', folderPemrograman));
assert.ok(api.can('rename', fileBudi), 'admin boleh ubah file orang lain');

// Mahasiswa
const budi = api.login('budi', 'budi123', 'student');
assert.strictEqual(budi.name, 'Budi');
assert.strictEqual(budi.id, 2);
assert.ok(!api.can('create-folder', null), 'mahasiswa tidak boleh buat folder');
assert.ok(!api.can('rename', folderPemrograman), 'mahasiswa tidak boleh ubah folder admin');
assert.ok(api.can('rename', fileBudi), 'mahasiswa boleh ubah file sendiri');
assert.ok(!api.can('rename', fileOqi), 'mahasiswa tidak boleh ubah file orang lain');
assert.ok(api.can('buka', folderPemrograman) && api.can('download', fileOqi), 'buka & download untuk semua');
assert.strictEqual(api.ownerName(fileBudi, data.users), 'Budi');

// Sesi yang disimpan tidak boleh membocorkan sandi.
const saved = JSON.parse(store.sh_mock_user);
assert.deepStrictEqual(saved, { id: 2, username: 'budi', name: 'Budi', role: 'student' });
assert.ok(!('password' in saved), 'password tidak ikut tersimpan di localStorage');

// Tamu
const tamu = api.loginAsGuest();
assert.strictEqual(tamu.role, 'guest');
assert.strictEqual(tamu.id, null);
assert.ok(api.isGuest());
assert.ok(api.can('buka', folderPemrograman), 'tamu boleh buka folder');
assert.ok(api.can('detail', folderPemrograman));
assert.ok(api.can('download', fileOqi), 'tamu boleh unduh file public');
assert.ok(api.can('download', fileTeks), 'tamu boleh unduh txt public');
assert.ok(!api.can('download', fileBudi), 'tamu tidak boleh unduh file private');
assert.ok(!api.can('rename', fileBudi) && !api.can('delete', fileBudi));
assert.ok(!api.can('upload', null) && !api.can('create-folder', null), 'tamu tidak boleh menambah apa pun');

// Logout membersihkan sesi.
api.logout();
assert.strictEqual(api.getCurrentUser(), null);
assert.strictEqual(store.sh_mock_user, undefined, 'sesi dibuang dari localStorage');
assert.ok(!api.can('buka', folderPemrograman));

// ---------- Routing & auth guard ----------

const scriptSrc = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const routerFor = (isLoggedIn, isGuest) => new Function(
  'document', 'window', 'fetch', 'isLoggedIn', 'isGuest',
  `${scriptSrc}\nreturn { getPageKey, accessRedirect };`
)({ addEventListener() {} }, {}, null, isLoggedIn, isGuest);

const routers = {
  belum: routerFor(() => false, () => false),
  admin: routerFor(() => true, () => false),
  mahasiswa: routerFor(() => true, () => false),
  tamu: routerFor(() => true, () => true),
};

for (const [who, router] of Object.entries(routers)) {
  const guard = (hash) => router.accessRedirect(router.getPageKey(hash));
  assert.strictEqual(guard('#login'), who === 'belum' ? null : '#home', `${who}: halaman login hanya untuk yang belum masuk`);
  assert.strictEqual(guard('#tugas'), who === 'belum' ? '#login' : (who === 'tamu' ? '#home' : null), `${who}: Tugas`);
  assert.strictEqual(guard('#profil'), who === 'belum' ? '#login' : (who === 'tamu' ? '#home' : null), `${who}: Profil`);
  assert.strictEqual(guard('#daftar'), who === 'belum' ? '#login' : null, `${who}: Daftar Tugas terbuka untuk semua yang punya sesi`);

  for (const page of ['home', 'tugas', 'daftar', 'informasi', 'jadwal', 'catatan', 'profil', 'detail-tugas']) {
    const first = guard(`#${page}`);
    // Guard yang mengembalikan hash asal = redirect berputar tanpa henti.
    assert.notStrictEqual(first, `#${page}`, `${who}: #${page} tidak boleh mengarahkan ke dirinya sendiri`);
    if (first) assert.strictEqual(guard(first), null, `${who}: #${page} -> ${first} harus settles`);
  }
}

// Tanpa sesi, semua hash—even yang ngawur—dipaksa ke login.
for (const hash of ['#home', '#tugas', '#profil', '#zzz']) {
  assert.strictEqual(routers.belum.accessRedirect(routers.belum.getPageKey(hash)), '#login', `tanpa sesi, ${hash}`);
}
// Hash kosong tanpa sesi sudah berarti halaman login, jadi tidak dialihkan lagi.
assert.strictEqual(routers.belum.accessRedirect(routers.belum.getPageKey('')), null, 'hash kosong -> login');

// Membuka aplikasi lewat URL tanpa hash selalu #login, walau session masih ada.
// Menguji init() (bukan initialHash()) karena bug ada di sambungannya:
// initialHash() harus dipanggil dan harus membersihkan session.
function startup(initialLoggedIn, startHash) {
  let sesi = initialLoggedIn;
  const win = {
    location: { hash: startHash },
    pendengar: {},
    addEventListener(tipe, fn) {
      (this.pendengar[tipe] = this.pendengar[tipe] || []).push(fn);
    },
  };
  const app = { innerHTML: '' };
  const router = new Function(
    'document', 'window', 'fetch', 'isLoggedIn', 'isGuest', 'logout',
    `${scriptSrc}\nreturn { init, isStillLoggedIn: isLoggedIn, hash: () => window.location.hash };`
  )(
    {
      addEventListener() {},
      getElementById: (id) => (id === 'app' ? app : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    },
    win,
    (file) => Promise.resolve({ ok: true, text: () => Promise.resolve('HALAMAN ' + file) }),
    () => sesi,
    () => false,
    () => { sesi = false; }
  );
  return Object.assign({}, router, {
    app,
    // Browser memanggil listener hashchange dengan objek HashChangeEvent.
    fireHashChange() {
      const ev = { type: 'hashchange', newURL: 'http://localhost:8000/' + win.location.hash };
      return Promise.all((win.pendengar.hashchange || []).map((fn) => fn(ev)));
    },
  });
}

// Root (tanpa hash) -> #login, session dibuang, walau sebelumnya masih aktif.
for (const awal of [true, false]) {
  const app = startup(awal, '');
  app.init();
  assert.strictEqual(app.hash(), '#login', `URL tanpa hash harus #login (session awal: ${awal})`);
  assert.strictEqual(app.isStillLoggedIn(), false, 'init() di root harus membersihkan session');
}

// Refresh di #home/#tugas/#profil:
//  - session aktif  -> hash dibiarkan apa adanya (aturan 6)
//  - tanpa session  -> guard memaksa #login
for (const halaman of ['#home', '#tugas', '#profil']) {
  const denganSesi = startup(true, halaman);
  denganSesi.init();
  assert.strictEqual(denganSesi.hash(), halaman, `session aktif: ${halaman} harus bertahan`);

  const tanpaSesi = startup(false, halaman);
  tanpaSesi.init();
  assert.strictEqual(tanpaSesi.hash(), '#login', `tanpa session: ${halaman} harus ke #login`);
}

// ---------- Guest: session pulih setelah refresh ----------

// restoreSession() berjalan saat module di-load, jadi perlu muat ulang auth.js
// dengan localStorage yang sudah berisi session. Parameter localStorage pada
// new Function men-shadow global, jadi blok di atas tidak terpengaruh.
function restoreWith(raw) {
  const seed = {};
  if (raw !== undefined) seed.sh_mock_user = raw;
  return new Function(
    'localStorage',
    `${fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8')}
     return { getCurrentUser, getRole, isGuest, isLoggedIn, can };`
  )({
    getItem: (k) => (k in seed ? seed[k] : null),
    setItem() {},
    removeItem() {},
  });
}

const publicFile = { type: 'file', user_id: 1, visibility: 'public' };
const privateFile = { type: 'file', user_id: 2, visibility: 'private' };

// Tamu yang login ulang lewat tombol "Masuk Tanpa Akun".
const tamuBaru = api.loginAsGuest();
assert.deepStrictEqual(tamuBaru, { id: null, username: null, name: 'Tamu', role: 'guest' });
const rawGuest = store.sh_mock_user;
assert.ok(rawGuest, 'session tamu tersimpan di localStorage');
assert.ok(!/password/.test(rawGuest), 'session tamu tidak menyimpan password');

// Refresh: session tamu harus dipulihkan, bukan dianggap user tak dikenal.
const sesudahRefresh = restoreWith(rawGuest);
assert.ok(sesudahRefresh.isLoggedIn(), 'session tamu harus tetap aktif setelah refresh');
assert.ok(sesudahRefresh.isGuest(), 'role tetap guest setelah refresh');
assert.strictEqual(sesudahRefresh.getRole(), 'guest');
assert.deepStrictEqual(sesudahRefresh.getCurrentUser(), { id: null, username: null, name: 'Tamu', role: 'guest' });

// Routing setelah refresh: halaman baca-baca tetap boleh, sisanya dialihkan.
const guestGuard = routers.tamu;
for (const halaman of ['#home', '#daftar', '#informasi', '#detail-tugas']) {
  assert.strictEqual(guestGuard.accessRedirect(guestGuard.getPageKey(halaman)), null, `tamu boleh ${halaman}`);
}
for (const halaman of ['#tugas', '#profil', '#jadwal', '#catatan', '#login']) {
  assert.strictEqual(guestGuard.accessRedirect(guestGuard.getPageKey(halaman)), '#home', `tamu dialihkan dari ${halaman}`);
}

// Guest tetap read-only: tidak boleh mutasi apa pun.
for (const aksi of ['upload', 'create-folder']) {
  assert.ok(!sesudahRefresh.can(aksi, null), `tamu tidak boleh ${aksi}`);
}
for (const aksi of ['rename', 'delete']) {
  assert.ok(!sesudahRefresh.can(aksi, privateFile), `tamu tidak boleh ${aksi}`);
}
assert.ok(sesudahRefresh.can('buka', publicFile) && sesudahRefresh.can('detail', publicFile), 'tamu boleh buka/detail');
assert.ok(sesudahRefresh.can('download', publicFile), 'tamu boleh unduh file public');
assert.ok(!sesudahRefresh.can('download', privateFile), 'tamu tidak boleh unduh file private');

// Jalur guest tidak boleh jadi celah untuk session rusak.
assert.strictEqual(restoreWith(undefined).getCurrentUser(), null, 'tanpa session tetap null');
assert.strictEqual(restoreWith('{ rusak').getCurrentUser(), null, 'JSON rusak tetap null');
assert.strictEqual(restoreWith(JSON.stringify({ role: 'student', id: 99 })).getCurrentUser(), null, 'id tak dikenal tetap null');
assert.strictEqual(restoreWith(JSON.stringify({ role: 'admin' })).getCurrentUser(), null, 'admin tanpa id tetap null');
assert.strictEqual(restoreWith(JSON.stringify({ role: 'superadmin' })).getCurrentUser(), null, 'role ngawur tetap null');

async function cekNavigasi() {
  const root = startup(false, '');
  root.init();
  await root.fireHashChange();
  assert.strictEqual(root.hash(), '#login', 'root harus #login');
  assert.ok(root.app.innerHTML.length > 0, 'halaman login harus muncul, tidak boleh kosong');

  api.login('budi', 'budi123', 'student');
  for (const key of ['home', 'tugas', 'daftar', 'informasi', 'jadwal', 'catatan', 'profil', 'detail-tugas']) {
    const hal = startup(true, '#' + key);
    hal.init();
    await hal.fireHashChange();
    assert.strictEqual(hal.hash(), '#' + key, key + ': hash harus bertahan setelah login');
    assert.ok(hal.app.innerHTML.length > 0, key + ': halaman harus muncul, tidak boleh kosong');
  }
}

cekNavigasi().then(() => {
  console.log('Semua cek lulus: pohon folder, search, sort, session, permission 3 role, routing, guest refresh, navigasi hashchange.');
}).catch((err) => {
  console.error('GAGAL: ' + err.message);
  process.exit(1);
});
