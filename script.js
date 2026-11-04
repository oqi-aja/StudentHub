const PAGE_MAP = {
  login: 'pages/login.html',
  home: 'pages/home.html',
  tugas: 'pages/tugas.html',
  daftar: 'pages/daftar-tugas.html',
  'detail-tugas': 'pages/detail-tugas.html',
  informasi: 'pages/informasi.html',
  jadwal: 'pages/jadwal.html',
  catatan: 'pages/catatan.html',
  profil: 'pages/profil.html',
  akun: 'pages/akun.html',
}

// Tamu tidak punya akun, jadi hanya halaman baca-baca yang boleh dibuka.
const GUEST_PAGES = ['home', 'daftar', 'informasi', 'detail-tugas'];

function getPageKey(hash) {
  // Strip query string (?folder=7, ?id=1) — dipakai oleh Page Tugas & Detail Tugas
  // untuk deep-link dari Daftar Tugas.
  let key = (hash || '').replace('#', '').trim();
  const qIdx = key.indexOf('?');
  if (qIdx !== -1) key = key.slice(0, qIdx);
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

// ---------- Theme Management ----------
function shGetTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

function shSetTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('sh_theme', theme);
  } catch (_) {}
}

function shToggleTheme() {
  const current = shGetTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  shSetTheme(next);
  return next;
}
window.shToggleTheme = shToggleTheme;
window.shGetTheme = shGetTheme;
window.shSetTheme = shSetTheme;

// ---------- Notification Management ----------
async function shRequestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      shCheckAndNotify();
    }
    return perm;
  } catch (err) {
    console.error('Notification error:', err);
    return 'denied';
  }
}
window.shRequestNotificationPermission = shRequestNotificationPermission;

async function shCheckAndNotify() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user || user.role === 'guest') return;

  const todayStr = new Date().toISOString().slice(0, 10);
  try {
    const lastNotifDate = localStorage.getItem('sh_last_notif_date');
    if (lastNotifDate === todayStr) {
      return;
    }
  } catch (_) {}

  try {
    const data = window.SH_API && typeof window.SH_API.loadAll === 'function'
      ? await window.SH_API.loadAll()
      : null;
    if (!data) return;

    const tasks = data.tasks || [];
    const subs = data.task_submissions || [];
    const mySubTaskIds = subs
      .filter((s) => String(s.student_id) === String(user.id))
      .map((s) => String(s.task_id));

    // Cek tugas H-1 atau hari ini yang belum dikumpulkan
    const urgentTasks = tasks.filter((t) => {
      if (!t.deadline || mySubTaskIds.includes(String(t.id))) return false;
      const days = typeof dashDaysLeft === 'function' ? dashDaysLeft(t.deadline) : null;
      return days !== null && days >= 0 && days <= 1;
    });

    if (urgentTasks.length > 0) {
      const task = urgentTasks[0];
      const countMore = urgentTasks.length - 1;
      const title = '⏰ Pengingat Deadline Tugas!';
      const body = `Tugas "${task.title}" mendekati batas waktu.`
        + (countMore > 0 ? ` (+${countMore} tugas lain)` : '');
      new Notification(title, {
        body,
        icon: 'icons/icon-192.png',
      });
      try { localStorage.setItem('sh_last_notif_date', todayStr); } catch (_) {}
    }
  } catch (err) {
    console.error('shCheckAndNotify error:', err);
  }
}
window.shCheckAndNotify = shCheckAndNotify;

async function init() {
  // Tunggu auth.js selesai restore session (mock: sync resolve; Supabase:
  // async via getSession + fetch profile). Tanpa ini, currentUser bisa null
  // saat routing awal → user salah-diarahkan ke #login walau ada session.
  if (window.SH_AUTH_READY && typeof window.SH_AUTH_READY.then === 'function') {
    try { await window.SH_AUTH_READY; } catch (_) { /* ignore */ }
  }

  // Pasang listener tombol theme toggle di header
  const themeToggle = document.getElementById('sh-theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      shToggleTheme();
    });
  }

  // Cek notifikasi berkala saat user membuka aplikasi
  if ('Notification' in window && Notification.permission === 'granted') {
    setTimeout(shCheckAndNotify, 2000);
  }

  // Daftarkan Service Worker jika didukung (PWA)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('[PWA] Service Worker registration failed:', err);
    });
  }

  if (!window.location.hash) {
    window.location.hash = initialHash();
  } else {
    renderPage(window.location.hash);
  }
  window.addEventListener('hashchange', () => renderPage(window.location.hash));
}

document.addEventListener('DOMContentLoaded', init);