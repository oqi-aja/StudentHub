// js/dashboard.js
// Dashboard Home — ringkasan tugas, jadwal kuliah hari ini, progres mahasiswa,
// pengumuman terbaru, dan KPI metrik kelas.
// Kompatibel dengan mode mock lokal maupun Supabase.

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function dashTodayDayName(d) {
  const date = d || new Date();
  return HARI[date.getDay()];
}

function dashTodayFormatted(d) {
  const date = d || new Date();
  const dayName = HARI[date.getDay()];
  const dayNum = date.getDate();
  const monthName = BULAN[date.getMonth()];
  const year = date.getFullYear();
  return dayName + ', ' + dayNum + ' ' + monthName + ' ' + year;
}

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
  return days + ' hari lagi';
}

function dashBadgeClass(deadline) {
  const days = dashDaysLeft(deadline);
  if (days === null) return 'badge';
  if (days <= 0) return 'badge badge--danger';
  if (days <= 3) return 'badge badge--warning';
  return 'badge badge--info';
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

function dashList(items) {
  if (!items.length) return '<p class="card-meta">Belum ada data.</p>';
  return items.join('');
}

function dashInitPage() {
  const root = document.getElementById('page-home');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const isG = typeof isGuest === 'function' ? isGuest() : false;
  const isA = typeof isAdmin === 'function' ? isAdmin() : false;
  const isPJ = Boolean(user && user.role === 'pj');
  const isStudent = Boolean(user && user.role === 'student');

  const greeting = root.querySelector('[data-greeting]');
  if (greeting) {
    greeting.textContent = 'Selamat datang, ' + (user ? user.name : 'Tamu');
  }

  const todayDateEl = root.querySelector('[data-today-date]');
  if (todayDateEl) {
    todayDateEl.textContent = dashTodayFormatted();
  }

  const roleBadge = root.querySelector('[data-role-badge]');
  if (roleBadge) {
    const roleLabel = typeof getRoleLabel === 'function' ? getRoleLabel() : 'Tamu';
    roleBadge.textContent = roleLabel;
    if (isA) roleBadge.className = 'dash-user-badge dash-user-badge--admin';
    else if (isPJ) roleBadge.className = 'dash-user-badge dash-user-badge--pj';
    else if (isG) roleBadge.className = 'dash-user-badge dash-user-badge--guest';
    else roleBadge.className = 'dash-user-badge';
  }

  // Sembunyikan elemen akun untuk tamu
  root.querySelectorAll('[data-needs-account]').forEach((el) => { el.hidden = isG; });

  const guestBlock = root.querySelector('[data-guest-block]');
  if (guestBlock) guestBlock.hidden = !isG;

  const adminBlock = root.querySelector('[data-admin-block]');
  if (adminBlock) adminBlock.hidden = !isA;

  const pjBlock = root.querySelector('[data-pj-block]');
  if (pjBlock) pjBlock.hidden = !isPJ;

  const studentBlock = root.querySelector('[data-student-progress]');
  if (studentBlock) studentBlock.hidden = !isStudent;

  const notifPrompt = root.querySelector('[data-notif-prompt]');
  if (notifPrompt) {
    const showPrompt = Boolean(isStudent && 'Notification' in window && Notification.permission === 'default');
    notifPrompt.hidden = !showPrompt;
    const notifBtn = notifPrompt.querySelector('[data-enable-notif]');
    if (notifBtn) {
      notifBtn.addEventListener('click', () => {
        if (typeof window.shRequestNotificationPermission === 'function') {
          window.shRequestNotificationPermission().then(() => {
            notifPrompt.hidden = true;
          });
        }
      });
    }
  }

  // Sumber data: prioritas SH_API.loadAll() (sudah sync Supabase/mock + local storage)
  // Fallback: fetch('data/contoh.json')
  const dataPromise = (window.SH_API && typeof window.SH_API.loadAll === 'function')
    ? window.SH_API.loadAll()
    : fetch('data/contoh.json').then((r) => (r.ok ? r.json() : null));

  dataPromise
    .then((data) => {
      if (data) dashRender(root, data);
    })
    .catch((err) => {
      console.error('[Dashboard] Gagal memuat data:', err);
    });
}

function dashRender(root, data) {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const isA = typeof isAdmin === 'function' ? isAdmin() : false;
  const isPJ = Boolean(user && user.role === 'pj');
  const isStudent = Boolean(user && user.role === 'student');

  const tasks = data.tasks || [];
  const files = data.files || [];
  const submissions = data.task_submissions || [];
  const accounts = typeof listAccounts === 'function' ? listAccounts() : (data.users || []);
  const allSchedules = typeof listSchedules === 'function' ? listSchedules() : (data.schedules || []);

  const setStat = (key, value) => {
    const el = root.querySelector('[data-stat="' + key + '"]');
    if (el) el.textContent = String(value);
  };

  // --- KPI Metrics ---
  setStat('tugas', tasks.length);
  setStat('file', files.length);

  // Filter submisi milik mahasiswa yang login
  const mySubmissions = user
    ? submissions.filter((s) => String(s.student_id) === String(user.id))
    : [];

  // Hitung jadwal hari ini
  const todayName = typeof jadwalTodayName === 'function' ? jadwalTodayName() : dashTodayDayName();
  const todayClasses = (allSchedules || [])
    .filter((s) => s.day === todayName)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  if (isStudent) {
    // KPI Mahasiswa: fokus pada progres tugas dan jadwal
    const label3 = root.querySelector('[data-stat-label-3]');
    const label4 = root.querySelector('[data-stat-label-4]');
    if (label3) label3.textContent = 'Tugas Selesai';
    if (label4) label4.textContent = 'Kuliah Hari Ini';
    setStat('akun', mySubmissions.length);
    setStat('mahasiswa', todayClasses.length);
  } else {
    // KPI Admin, PJ, Tamu
    const label3 = root.querySelector('[data-stat-label-3]');
    const label4 = root.querySelector('[data-stat-label-4]');
    if (label3) label3.textContent = 'Total Akun';
    if (label4) label4.textContent = 'Mahasiswa';
    setStat('akun', accounts.length);
    setStat('mahasiswa', accounts.filter((a) => a.role === 'student').length);
  }

  // --- Student Progress Bar ---
  if (isStudent) {
    const totalT = tasks.length;
    const doneT = mySubmissions.length;
    const pct = totalT > 0 ? Math.round((doneT / totalT) * 100) : 0;

    const ratioEl = root.querySelector('[data-progress-ratio]');
    if (ratioEl) ratioEl.textContent = doneT + '/' + totalT + ' Selesai (' + pct + '%)';

    const barEl = root.querySelector('[data-progress-bar]');
    if (barEl) barEl.setAttribute('aria-valuenow', String(pct));

    const fillEl = root.querySelector('[data-progress-fill]');
    if (fillEl) fillEl.style.width = pct + '%';

    const metaEl = root.querySelector('[data-progress-meta]');
    if (metaEl) {
      const remaining = totalT - doneT;
      if (remaining > 0) {
        metaEl.textContent = remaining + ' tugas belum dikumpulkan';
      } else if (totalT === 0) {
        metaEl.textContent = 'Belum ada tugas aktif';
      } else {
        metaEl.textContent = 'Hebat! Semua tugas telah selesai dikumpulkan ✓';
      }
    }
  }

  // --- PJ Information Banner ---
  if (isPJ && user.course_id) {
    const courseFolder = (data.folders || []).find((f) => String(f.id) === String(user.course_id));
    const courseName = courseFolder ? courseFolder.name : 'Mata Kuliah';
    const pjTitle = root.querySelector('[data-pj-title]');
    if (pjTitle) pjTitle.textContent = 'PJ: ' + courseName;

    const pjDesc = root.querySelector('[data-pj-desc]');
    if (pjDesc) {
      const courseTasks = tasks.filter((t) => String(t.folder_id) === String(user.course_id));
      pjDesc.textContent = 'Terdapat ' + courseTasks.length + ' tugas aktif untuk mata kuliah ' + courseName + '.';
    }
  }

  // --- Kuliah Hari Ini (Today Schedule) ---
  const scheduleEl = root.querySelector('[data-today-schedule]');
  const scheduleMeta = root.querySelector('[data-today-schedule-meta]');
  if (scheduleMeta) {
    scheduleMeta.textContent = 'Hari ini: ' + todayName + ' (' + todayClasses.length + ' mata kuliah)';
  }
  if (scheduleEl) {
    if (!todayClasses.length) {
      scheduleEl.innerHTML = '<div class="dash-empty">'
        + '<svg class="dash-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>'
        + '<span class="dash-empty-title">Tidak ada jadwal kuliah hari ini (' + dashEscape(todayName) + ')</span>'
        + '<span class="dash-empty-desc">Waktunya belajar mandiri atau menyelesaikan tugas kelas.</span>'
        + '</div>';
    } else {
      scheduleEl.innerHTML = todayClasses.map((s) => {
        const timeRange = dashEscape(s.start || '') + ' – ' + dashEscape(s.end || '');
        const details = [
          s.room ? 'Ruang: ' + dashEscape(s.room) : '',
          s.lecturer ? 'Dosen: ' + dashEscape(s.lecturer) : '',
        ].filter(Boolean).join(' • ');

        return '<div class="list-item">'
          + '<div class="list-item-main">'
          + '<span class="list-item-title">' + dashEscape(s.course || 'Mata Kuliah') + '</span>'
          + '<span class="list-item-subtitle">' + (details || '-') + '</span>'
          + '</div>'
          + '<span class="badge badge--info">' + timeRange + '</span>'
          + '</div>';
      }).join('');
    }
  }

  // --- Tugas Terdekat: deadline paling awal ---
  const nearest = tasks
    .filter((t) => t.deadline)
    .slice()
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .slice(0, 4);

  const nearestEl = root.querySelector('[data-nearest]');
  if (nearestEl) {
    if (!nearest.length) {
      nearestEl.innerHTML = '<div class="dash-empty">'
        + '<svg class="dash-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
        + '<span class="dash-empty-title">Tidak ada tugas aktif</span>'
        + '<span class="dash-empty-desc">Semua tugas telah selesai atau belum ada tugas baru.</span>'
        + '</div>';
    } else {
      nearestEl.innerHTML = nearest.map((t) => {
        // Cek apakah mahasiswa yang login sudah submit tugas ini
        const isDone = isStudent && mySubmissions.some((s) => String(s.task_id) === String(t.id));
        const badgeMarkup = isDone
          ? '<span class="badge badge--success">✓ Diserahkan</span>'
          : '<span class="' + dashBadgeClass(t.deadline) + '">' + dashEscape(dashDeadlineNote(t.deadline)) + '</span>';

        return '<a class="list-item" href="#detail-tugas?id=' + dashEscape(t.id) + '">'
          + '<div class="list-item-main">'
          + '<span class="list-item-title">' + dashEscape(t.title) + '</span>'
          + '<span class="list-item-subtitle">' + dashEscape(dashCourseName(data, t.folder_id))
          + ' • Deadline: ' + dashEscape(dashFormatDate(t.deadline)) + '</span>'
          + '</div>'
          + badgeMarkup
          + '</a>';
      }).join('');
    }
  }

  // --- Pengumuman terbaru: created_at paling baru ---
  const news = (data.announcements || [])
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 3);

  const newsEl = root.querySelector('[data-news]');
  if (newsEl) {
    if (!news.length) {
      newsEl.innerHTML = '<div class="dash-empty">'
        + '<span class="dash-empty-title">Belum ada pengumuman</span>'
        + '<span class="dash-empty-desc">Pengumuman penting kelas akan ditampilkan di sini.</span>'
        + '</div>';
    } else {
      newsEl.innerHTML = news.map((a) => {
        return '<article class="list-item">'
          + '<div class="list-item-main">'
          + '<span class="list-item-title">' + dashEscape(a.title) + '</span>'
          + '<span class="list-item-subtitle">' + dashEscape(dashFormatDate(a.created_at))
          + (a.category ? ' • ' + dashEscape(a.category) : '') + '</span>'
          + (a.content ? '<p class="card-meta" style="margin-top:.25rem;">' + dashEscape(a.content) + '</p>' : '')
          + '</div>'
          + '</article>';
      }).join('');
    }
  }
}

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.home = { init: dashInitPage };
