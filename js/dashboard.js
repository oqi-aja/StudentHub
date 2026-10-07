// js/dashboard.js
// Angka ringkasan Home dihitung dari data/contoh.json + listAccounts().
// Blok khusus Ketua Kelas disembunyikan lewat hidden, bukan dihapus, sehingga
// blok lama di home.html tetap utuh untuk role lain.

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function dashFormatDate(iso) {
  if (!iso) return '-';
  const parts = String(iso).slice(0, 10).split('-');
  if (parts.length !== 3) return String(iso);
  return Number(parts[2]) + ' ' + BULAN[Number(parts[1]) - 1] + ' ' + parts[0];
}

function dashDaysLeft(deadline) {
  if (!deadline) return null;
  const target = new Date(String(deadline).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function dashDeadlineNote(deadline) {
  const days = dashDaysLeft(deadline);
  if (days === null) return 'Tanpa deadline';
  if (days < 0) return 'Terlambat ' + Math.abs(days) + ' hari';
  if (days === 0) return 'Deadline hari ini';
  return '⏰ ' + days + ' hari lagi';
}

function dashCourseName(data, folderId) {
  const folder = (data.folders || []).find((f) => f.id === folderId);
  return folder ? folder.name : '-';
}

function dashEscape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dashInitPage() {
  const root = document.getElementById('page-home');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const user = getCurrentUser();
  const greeting = root.querySelector('[data-greeting]');
  if (greeting) greeting.textContent = 'Selamat datang, ' + (user ? user.name : 'Tamu') + ' 👋';

  // Kartu cepat yang butuh akun disembunyikan untuk tamu.
  root.querySelectorAll('[data-needs-account]').forEach((el) => { el.hidden = isGuest(); });

  const adminBlock = root.querySelector('[data-admin-block]');
  if (adminBlock) adminBlock.hidden = !isAdmin();

  fetch('data/contoh.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => { if (data) dashRender(root, data); })
    .catch(() => { /* biarkan angka bawaan di HTML */ });
}

function dashRender(root, data) {
  const tasks = data.tasks || [];
  const files = data.files || [];
  const accounts = listAccounts();

  const set = (key, value) => {
    const el = root.querySelector('[data-stat="' + key + '"]');
    if (el) el.textContent = String(value);
  };
  set('tugas', tasks.length);
  set('file', files.length);
  set('akun', accounts.length);
  set('mahasiswa', accounts.filter((a) => a.role === 'student').length);

  // Tugas terdekat: deadline paling awal.
  const nearest = tasks
    .filter((t) => t.deadline)
    .slice()
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .slice(0, 3);
  const nearestEl = root.querySelector('[data-nearest]');
  if (nearestEl) {
    nearestEl.innerHTML = dashList(nearest.map((t) => {
      return '<a class="list-item" href="#detail-tugas">'
        + '<span class="list-item-main">'
        + '<span class="list-item-title">' + dashEscape(t.title) + '</span>'
        + '<span class="list-item-subtitle">' + dashEscape(dashCourseName(data, t.folder_id))
        + ' • Deadline: ' + dashEscape(dashFormatDate(t.deadline)) + '</span>'
        + '</span>'
        + '<span class="badge badge--warning">' + dashEscape(dashDeadlineNote(t.deadline)) + '</span>'
        + '</a>';
    }));
  }

  // Pengumuman terbaru: created_at paling baru.
  const news = (data.announcements || [])
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 3);
  const newsEl = root.querySelector('[data-news]');
  if (newsEl) {
    newsEl.innerHTML = dashList(news.map((a) => {
      return '<div class="list-item">'
        + '<span class="list-item-main">'
        + '<span class="list-item-title">' + dashEscape(a.title) + '</span>'
        + '<span class="list-item-subtitle">' + dashEscape(dashFormatDate(a.created_at)) + '</span>'
        + '</span>'
        + '</div>';
    }));
  }

  // Daftar akun sengaja tidak dirender di sini: halaman Kelola Akun yang
  // menampilkannya. Home cukup angka ringkas di KPI.
}

function dashList(items) {
  if (!items.length) return '<p class="card-meta">Belum ada data.</p>';
  return items.join('');
}

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.home = { init: dashInitPage };