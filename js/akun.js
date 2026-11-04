// js/akun.js
// Halaman Kelola Akun. Hanya Ketua Kelas yang boleh membukanya; route #akun
// sudah dijaga script.js lewat can('kelola-akun'), init di sini tetap
// memeriksa ulang karena halaman bisa dirender ulang lewat initPage.

function akunCourseOptions(data) {
  // Mata kuliah diturunkan dari folder yang punya parent_id; tidak ada tabel courses.
  return (data.folders || []).filter((f) => f.parent_id != null);
}

function akunLabelRole(role) {
  return ROLE_LABELS[role] || role;
}

function akunEscape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function akunInitPage() {
  const root = document.getElementById('page-akun');
  if (!root || root.dataset.ready === '1') return;
  // Penjaga kedua: halaman ini hanya untuk Ketua Kelas.
  if (!can('kelola-akun', null)) { window.location.hash = '#home'; return; }
  root.dataset.ready = '1';

  const tbodyEl = root.querySelector('[data-tbody]');
  const emptyEl = root.querySelector('[data-empty]');
  const toastEl = root.querySelector('[data-toast]');
  const overlay = root.querySelector('[data-overlay]');
  const sheet = root.querySelector('[data-sheet]');
  const titleEl = root.querySelector('#akun-title');
  const form = root.querySelector('[data-form]');
  const errorEl = root.querySelector('[data-error]');
  const roleSel = form.elements.role;
  const courseWrap = root.querySelector('[data-course-wrap]');
  const courseSel = root.querySelector('[data-course]');
  const me = getCurrentUser();
  let editingId = null;
  let toastTimer = null;

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
  }

  function fillCourses(list) {
    courseSel.innerHTML = '<option value="">Pilih mata kuliah</option>' + list
      .map((c) => '<option value="' + c.id + '">' + akunEscape(c.name) + '</option>')
      .join('');
  }

  function render() {
    // Password ikut tampil apa adanya; listAccountsWithSecrets() sendiri sudah
    // dijaga canManageAccounts() di auth.js.
    const accounts = listAccountsWithSecrets();
    const pj = accounts.filter((a) => a.role === 'pj');
    const mhs = accounts.filter((a) => a.role === 'student');
    root.querySelector('[data-total]').textContent = String(accounts.length);
    root.querySelector('[data-pj]').textContent = String(pj.length);
    root.querySelector('[data-mhs]').textContent = String(mhs.length);
    emptyEl.hidden = accounts.length > 0;
    tbodyEl.innerHTML = accounts.map((a, i) => {
      // Baris akun sendiri tidak diberi tombol: mengubah atau menghapus akun
      // sendiri bisa mengunci kita keluar dari halaman ini.
      const isSelf = me && a.id === me.id;
      return '<tr>'
        + '<td>' + (i + 1) + '</td>'
        + '<td>' + akunEscape(a.username) + (isSelf ? ' <span class="badge">Anda</span>' : '') + '</td>'
        + '<td>' + akunEscape(a.password) + '</td>'
        + '<td><span class="badge badge--info">' + akunEscape(akunLabelRole(a.role)) + '</span></td>'
        + '<td><div class="jadwal-aksi">'
        + (isSelf
          ? '<span class="card-meta">akun sendiri</span>'
          : '<button class="icon-btn" type="button" data-edit="' + Number(a.id) + '" aria-label="Ubah akun">&#9998;</button>'
            + '<button class="icon-btn" type="button" data-delete="' + Number(a.id) + '" aria-label="Hapus akun">&#128465;</button>')
        + '</div></td>'
        + '</tr>';
    }).join('');
  }

  function syncCourse() {
    courseWrap.hidden = roleSel.value !== 'pj';
    if (courseWrap.hidden) courseSel.value = '';
  }

  function open(row) {
    editingId = row ? row.id : null;
    form.reset();
    errorEl.textContent = '';
    titleEl.textContent = row ? 'Ubah Akun' : 'Tambah Akun';
    if (row) {
      form.elements.name.value = row.name || '';
      form.elements.username.value = row.username || '';
      form.elements.password.value = row.password || '';
      // Nilai role 'student' disimpan sebagai 'mahasiswa' di form.
      roleSel.value = row.role === 'student' ? 'mahasiswa' : row.role;
      courseSel.value = row.course_id ? String(row.course_id) : '';
    }
    syncCourse();
    overlay.hidden = false;
    sheet.hidden = false;
    document.body.classList.add('is-locked');
    form.elements.username.focus();
  }

  function close() {
    overlay.hidden = true;
    sheet.hidden = true;
    document.body.classList.remove('is-locked');
    editingId = null;
  }

  function readForm() {
    return {
      name: form.elements.name.value,
      username: form.elements.username.value,
      password: form.elements.password.value,
      role: roleSel.value === 'mahasiswa' ? 'student' : roleSel.value,
      course_id: courseSel.value,
    };
  }

  function save() {
    const res = editingId === null ? createAccount(readForm()) : updateAccount(editingId, readForm());
    if (!res.ok) {
      errorEl.textContent = res.error;
      return;
    }
    close();
    render();
    showToast(res.message);
  }

  function remove(id) {
    const row = listAccountsWithSecrets().find((a) => a.id === id);
    if (!row) return;
    if (!window.confirm('Hapus akun ' + row.username + '? Perubahan ini hanya berlaku di perangkat ini.')) return;
    const res = deleteAccount(id);
    if (!res.ok) {
      showToast(res.error);
      return;
    }
    render();
    showToast(res.message);
  }

  root.querySelector('[data-open]').addEventListener('click', () => open(null));
  root.querySelector('[data-close]').addEventListener('click', close);
  root.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', close);
  root.querySelector('[data-save]').addEventListener('click', save);
  roleSel.addEventListener('change', syncCourse);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  // Delegasi: tombol aksi dibuat ulang setiap render.
  tbodyEl.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) { open(listAccountsWithSecrets().find((a) => a.id === Number(edit.dataset.edit))); return; }
    const del = e.target.closest('[data-delete]');
    if (del) remove(Number(del.dataset.delete));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) close();
  });

  render();
  fetch('data/contoh.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      fillCourses(akunCourseOptions(data));
    })
    .catch(() => {/* daftar tetap tampil walau data gagal dimuat */});
}

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.akun = { init: akunInitPage };
