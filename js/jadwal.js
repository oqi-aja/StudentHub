// js/jadwal.js
// Halaman Jadwal. Semua orang yang sudah login boleh membaca; yang boleh
// create/edit/delete hanya Ketua Kelas dan PJ lewat can('kelola-jadwal').
// Perubahan disimpan ke localStorage supaya tidak hilang saat halaman di-refresh.

const SCHEDULES_KEY = 'sh_mock_schedules';
const JADWAL_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

// Seed diisi dari data/contoh.json setelah halaman dimuat. Dipakai hanya
// selama localStorage masih kosong, jadi data contoh tidak menimpa hasil edit.
let jadwalSeed = [];

function jadwalReadStored() {
  try {
    const raw = localStorage.getItem(SCHEDULES_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return Array.isArray(saved) ? saved : null;
  } catch (err) {
    return null;
  }
}

function jadwalPersist(list) {
  try {
    localStorage.setItem(SCHEDULES_KEY, JSON.stringify(list));
  } catch (err) {
    // localStorage bisa diblokir (mis. mode privat di sebagian browser).
    // Sesi ini tetap jalan, hanya perubahan tidak akan bertahan.
  }
}

function listSchedules() {
  const saved = jadwalReadStored();
  return saved === null ? jadwalSeed.slice() : saved;
}

function setScheduleSeed(list) {
  jadwalSeed = Array.isArray(list) ? list : [];
  renderJadwal();
}

// ---------- Validasi ----------

function jadwalTimeOk(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return false;
  const [h, m] = String(value).split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

// editId dipakai saat mengubah: baris yang sedang diedit tidak boleh
// bentrok dengan dirinya sendiri.
function validateSchedule(input, list, editId) {
  const day = String((input && input.day) || '').trim();
  if (!day) return { ok: false, error: 'Hari wajib diisi.' };
  if (!JADWAL_HARI.includes(day)) return { ok: false, error: 'Hari tidak dikenal.' };

  const start = String((input && input.start) || '').trim();
  const end = String((input && input.end) || '').trim();
  if (!jadwalTimeOk(start)) return { ok: false, error: 'Jam mulai wajib format HH:MM.' };
  if (!jadwalTimeOk(end)) return { ok: false, error: 'Jam selesai wajib format HH:MM.' };
  // Sesi yang berakhir sebelum dimulai akan tampil apa adanya tanpa
  // memberi tahu siapa pun, jadi ditolak di sini.
  if (end <= start) return { ok: false, error: 'Jam selesai harus setelah jam mulai.' };

  const course = String((input && input.course) || '').trim();
  if (!course) return { ok: false, error: 'Nama mata kuliah wajib diisi.' };

  const clash = (list || []).find((s) => s.day === day && s.id !== editId
    && s.start < end && start < s.end);
  if (clash) {
    return { ok: false, error: 'Jam bentrok dengan sesi lain di hari ' + day + '.' };
  }

  // Hanya field yang dikenal yang dikembalikan, jadi field asing dari form
  // yang dimanipulasi tidak ikut tersimpan.
  return { ok: true, value: {
    day,
    start,
    end,
    course,
    room: String((input && input.room) || '').trim(),
    lecturer: String((input && input.lecturer) || '').trim(),
  } };
}

// ---------- CRUD ----------

// Id dibuat dari state tersimpan, bukan ikut dari input form.
function jadwalNextId(list) {
  return list.reduce((max, s) => Math.max(max, Number(s.id) || 0), 0) + 1;
}

function createSchedule(input) {
  if (!can('kelola-jadwal', null)) return { ok: false, error: 'Tidak punya hak menambah jadwal.' };
  const list = listSchedules();
  const res = validateSchedule(input, list, null);
  if (!res.ok) return res;

  const now = new Date().toISOString().slice(0, 10);
  const row = { id: jadwalNextId(list), ...res.value, created_by: getCurrentUser().id,
    created_at: now, updated_at: now };
  jadwalPersist([...list, row]);
  renderJadwal();
  return { ok: true, message: 'Jadwal ' + row.day + ' ditambahkan.' };
}

function updateSchedule(id, input) {
  if (!can('kelola-jadwal', null)) return { ok: false, error: 'Tidak punya hak mengubah jadwal.' };
  const list = listSchedules();
  const index = list.findIndex((s) => s.id === id);
  if (index === -1) return { ok: false, error: 'Jadwal tidak ditemukan.' };

  const res = validateSchedule(input, list, id);
  if (!res.ok) return res;

  const row = { ...list[index], ...res.value, updated_at: new Date().toISOString().slice(0, 10) };
  list[index] = row;
  jadwalPersist(list);
  renderJadwal();
  return { ok: true, message: 'Jadwal ' + row.day + ' diperbarui.' };
}

function deleteSchedule(id) {
  if (!can('kelola-jadwal', null)) return { ok: false, error: 'Tidak punya hak menghapus jadwal.' };
  const list = listSchedules();
  const index = list.findIndex((s) => s.id === id);
  if (index === -1) return { ok: false, error: 'Jadwal tidak ditemukan.' };

  const [row] = list.splice(index, 1);
  jadwalPersist(list);
  renderJadwal();
  return { ok: true, message: 'Jadwal ' + row.day + ' dihapus.' };
}

// Mengembalikan array: [{ day, items: [...] }] urut hari lalu jam mulai.
// Hari tanpa sesi tidak ikut, supaya daftar tidak dipenuhi hari kosong.
function jadwalGroup(list) {
  return JADWAL_HARI
    .map((day) => ({ day, items: (list || [])
      .filter((s) => s.day === day)
      .sort((a, b) => String(a.start).localeCompare(String(b.start))) }))
    .filter((group) => group.items.length > 0);
}

function jadwalTodayName() {
  return JADWAL_HARI[(new Date().getDay() + 6) % 7];
}

// ---------- Tampilan ----------

function renderJadwal() {
  const root = document.getElementById('page-jadwal');
  if (!root) return;

  const list = listSchedules();
  const groups = jadwalGroup(list);
  root.querySelector('[data-total]').textContent = String(list.length);
  root.querySelector('[data-days]').textContent = String(groups.length);

  const listEl = root.querySelector('[data-list]');
  if (!groups.length) {
    listEl.innerHTML = '<p class="card-meta">Belum ada jadwal.</p>';
    return;
  }

  const canManage = can('kelola-jadwal', null);

  listEl.innerHTML = groups.map((group) => {
    const items = group.items.map((s) => {
      const bits = [s.start + ' – ' + s.end, s.room, s.lecturer].filter(Boolean).join(' • ');
      return '<div class="list-item"><div class="list-item-main">'
        + '<span class="list-item-title">' + dashEscape(s.course || '-') + '</span>'
        + '<span class="list-item-subtitle">' + dashEscape(bits) + '</span>'
        + '</div>'
        // Tombol aksi disembunyikan lewat hidden, bukan dihapus, supaya
        // mahasiswa melihat daftar yang sama persis minus kontrolnya.
        + '<div class="jadwal-aksi" data-crud-bar' + (canManage ? '' : ' hidden') + '>'
        + '<button class="icon-btn" type="button" data-edit="' + Number(s.id) + '" aria-label="Ubah jadwal">✎</button>'
        + '<button class="icon-btn" type="button" data-delete="' + Number(s.id) + '" aria-label="Hapus jadwal">🗑</button>'
        + '</div></div>';
    }).join('');

    const head = '<div class="list-item"><div class="list-item-main">'
      + '<span class="list-item-title">' + dashEscape(group.day) + '</span></div>'
      + (group.day === jadwalTodayName() ? '<span class="badge badge--info">Hari ini</span>' : '')
      + '</div>';
    return '<div class="list">' + head + items + '</div>';
  }).join('');
}

function jadwalInitPage() {
  const root = document.getElementById('page-jadwal');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const toastEl = root.querySelector('[data-toast]');
  const overlay = root.querySelector('[data-overlay]');
  const sheet = root.querySelector('[data-sheet]');
  const form = root.querySelector('[data-form]');
  const errorEl = root.querySelector('[data-error]');
  const titleEl = root.querySelector('[data-sheet-title]');
  const daySel = form.elements.day;
  let editingId = null;
  let toastTimer = null;

  // Tombol tambah disembunyikan di HTML juga; ini pengaman kedua kalau
  // halaman dirender ulang untuk role lain.
  if (!can('kelola-jadwal', null)) {
    root.querySelectorAll('[data-crud-bar]').forEach((el) => { el.hidden = true; });
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
  }

  function open(row) {
    editingId = row ? row.id : null;
    form.reset();
    errorEl.textContent = '';
    titleEl.textContent = row ? 'Ubah Jadwal' : 'Tambah Jadwal';
    if (row) {
      daySel.value = row.day;
      form.elements.start.value = row.start;
      form.elements.end.value = row.end;
      form.elements.course.value = row.course || '';
      form.elements.room.value = row.room || '';
      form.elements.lecturer.value = row.lecturer || '';
    }
    overlay.hidden = false;
    sheet.hidden = false;
    document.body.classList.add('is-locked');
    daySel.focus();
  }

  function close() {
    overlay.hidden = true;
    sheet.hidden = true;
    document.body.classList.remove('is-locked');
    editingId = null;
  }

  function save() {
    const input = {
      day: daySel.value,
      start: form.elements.start.value,
      end: form.elements.end.value,
      course: form.elements.course.value,
      room: form.elements.room.value,
      lecturer: form.elements.lecturer.value,
    };
    const res = editingId === null ? createSchedule(input) : updateSchedule(editingId, input);
    if (!res.ok) {
      errorEl.textContent = res.error;
      return;
    }
    close();
    showToast(res.message);
  }

  function remove(id) {
    const row = listSchedules().find((s) => s.id === id);
    if (!row) return;
    if (!window.confirm('Hapus jadwal ' + row.day + ' (' + row.start + ')? Perubahan ini hanya berlaku di perangkat ini.')) return;
    const res = deleteSchedule(id);
    if (!res.ok) {
      errorEl.textContent = res.error;
      return;
    }
    showToast(res.message);
  }


root.querySelector('[data-open]').addEventListener('click', () => open(null));
  root.querySelector('[data-close]').addEventListener('click', close);
  root.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', close);
  root.querySelector('[data-save]').addEventListener('click', save);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) close();
  });

  // Delegasi: baris digambar ulang setiap render, jadi listener tidak bisa
  // dipasang langsung ke tiap tombol.
  root.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) {
      const row = listSchedules().find((s) => s.id === Number(editBtn.dataset.edit));
      if (row) open(row);
      return;
    }
    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) remove(Number(delBtn.dataset.delete));
  });

  renderJadwal();
  fetch('data/contoh.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      // Seed hanya dipakai selama localStorage kosong; kalau sudah ada
      // hasil edit, listSchedules() mengabaikannya.
      setScheduleSeed(data.schedules || []);
    })
    .catch(() => {/* daftar tetap tampil walau data gagal dimuat */});
}

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.jadwal = { init: jadwalInitPage };

