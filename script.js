const PAGE_MAP = {
  login: 'pages/login.html',
  home: 'pages/home.html',
  tugas: 'pages/tugas.html',
  daftar: 'pages/daftar-tugas.html',
  informasi: 'pages/informasi.html',
  jadwal: 'pages/jadwal.html',
  catatan: 'pages/catatan.html',
  profil: 'pages/profil.html',
  akun: 'pages/akun.html',
}

// Tamu tidak punya akun, jadi hanya halaman baca-baca yang boleh dibuka.
const GUEST_PAGES = ['home', 'daftar', 'informasi', 'detail-tugas'];

function getPageKey(hash) {
  const key = (hash || '').replace('#', '').trim();
  if (key === 'login') return 'login';
  if (!key) return isLoggedIn() ? 'home' : 'login';
  return PAGE_MAP[key] ? key : 'home';
}

async function loadPageContent(name) {
  const file = PAGE_MAP[name] || PAGE_MAP.home;
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`Gagal memuat ${file}`);
    return await res.text();
  } catch (err) {
    console.error(err);
    return `<section class="page-section"><header class="page-header"><h2 class="page-title">Halaman tidak dapat dimuat</h2><p class="page-subtitle">Coba muat ulang halaman.</p></header></section>`;
  }
}

// Setiap nav item punya data-roles; item yang role-nya tidak cocok disembunyikan
// supaya tamu tidak punya jalan masuk lewat navigasi bawah.
function renderNav(activeKey) {
  const header = document.querySelector('.app-header');
  const nav = document.querySelector('.bottom-nav');
  const withChrome = activeKey !== 'login';
  if (header) header.hidden = !withChrome;
  if (!nav) return;
  nav.hidden = !withChrome;
  if (!withChrome) return;

  let shown = 0;
  nav.querySelectorAll('.nav-item').forEach((el) => {
    const roles = (el.dataset.roles || '').split(',').map((s) => s.trim()).filter(Boolean);
    const allowed = roles.length === 0 || roles.includes(getRole());
    el.hidden = !allowed;
    if (!allowed) {
      el.classList.remove('is-active');
      el.removeAttribute('aria-current');
      return;
    }
    shown += 1;
    if ((el.dataset.page || '') === activeKey) {
      el.classList.add('is-active');
      el.setAttribute('aria-current', 'page');
    } else {
      el.classList.remove('is-active');
      el.removeAttribute('aria-current');
    }
  });
  nav.style.setProperty('--nav-count', String(Math.max(shown, 1)));
}

// Setiap js/<halaman>.js boleh mendaftarkan init-nya lewat
// window.STUDENTHUB_PAGES[key] = { init }, lalu dipanggil di sini
// setelah HTML halamannya selesai dimuat ke #app.
function initPage(key) {
  const pageModule = (window.STUDENTHUB_PAGES || {})[key];
  if (pageModule && typeof pageModule.init === 'function') pageModule.init();
}

// Aturan akses satu tempat. Mengembalikan hash tujuan kalau halaman ditolak,
// atau null kalau boleh dibuka. Target selalu berbeda dari hash asal supaya
// tidak pernah berputar tanpa henti.
function accessRedirect(key) {
  if (!isLoggedIn() && key !== 'login') return '#login';
  if (isLoggedIn() && key === 'login') return '#home';
  if (isGuest() && !GUEST_PAGES.includes(key)) return '#home';
  if (key === 'akun' && !can('kelola-akun', null)) return '#home';
  return null;
}

async function renderPage(hash) {
  const key = getPageKey(hash);
  const blocked = accessRedirect(key);
  // Mengubah hash memicu hashchange lagi; disitulah halaman sebenarnya dirender.
  if (blocked) {
    window.location.hash = blocked;
    return;
  }

  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = await loadPageContent(key);
  renderNav(key);
  initPage(key);
}

// Membuka aplikasi lewat URL tanpa hash selalu dimulai dari #login, walau
// masih ada session tersimpan. Sesi dibuang supaya halaman login benar-benar
// tampil (accessRedirect akan memantulkan balik ke #home bila masih login).
// Refresh di #home/#tugas tidak terpengaruh karena hash-nya sudah ada.
function initialHash() {
  if (isLoggedIn()) logout();
  return '#login';
}

function init() {
  if (!window.location.hash) {
    window.location.hash = initialHash();
  } else {
    renderPage(window.location.hash);
  }
  window.addEventListener('hashchange', () => renderPage(window.location.hash));
}

document.addEventListener('DOMContentLoaded', init);