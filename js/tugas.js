// js/tugas.js
// Mockup halaman Tugas: file manager hierarkis (folder + tugas + file).
// Data dibaca dari data/contoh.json. Semua perubahan hanya ada di memori,
// jadi hilang saat halaman di-refresh.
// PART 16+: sumber data diganti Cloudflare Workers + D1 + R2,
// tanpa mengubah struktur di file ini.

const VIEW_KEY = 'sh_view_mode';

const fm = {
  data: { folders: [], tasks: [], files: [], users: [] },
  folderId: null, // null = folder paling atas
  query: '',
  sort: 'name-asc',
  view: 'list',
  sheetItem: null,
  lastFocus: null,
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function fmEscape(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function fmFormatDate(iso) {
  const d = iso ? new Date(`${iso}T00:00:00`) : null;
  if (!d || Number.isNaN(d.getTime())) return '-';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fmFormatSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fmIcon(item) {
  if (item.type === 'folder') return '📁';
  if (item.type === 'task') return '📌';
  const ext = (item.name.split('.').pop() || '').toLowerCase();
  if (['zip', 'rar', '7z'].includes(ext)) return '📦';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '🖼️';
  if (['doc', 'docx', 'odt'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📽️';
  if (['mp3', 'wav'].includes(ext)) return '🎵';
  if (['mp4', 'mkv', 'mov'].includes(ext)) return '🎬';
  if (['txt', 'md'].includes(ext)) return '📃';
  return '📄';
}

// ---------- Pohon folder ----------

function fmToItem(row, type) {
  return { ...row, type, name: type === 'task' ? row.title : row.name };
}

function fmFolderById(id) {
  return fm.data.folders.find((f) => f.id === id) || null;
}

function fmPath(folderId) {
  const chain = [];
  let current = fmFolderById(folderId);
  while (current) {
    chain.unshift(current);
    current = fmFolderById(current.parent_id);
  }
  return chain;
}

function fmChildren(folderId) {
  return [
    ...fm.data.folders.filter((f) => f.parent_id === folderId).map((f) => fmToItem(f, 'folder')),
    ...fm.data.tasks.filter((t) => t.folder_id === folderId).map((t) => fmToItem(t, 'task')),
    ...fm.data.files.filter((f) => f.folder_id === folderId).map((f) => fmToItem(f, 'file')),
  ];
}

function fmFind(type, id) {
  const source = { folder: 'folders', task: 'tasks', file: 'files' }[type];
  const row = (fm.data[source] || []).find((r) => r.id === id);
  return row ? fmToItem(row, type) : null;
}

function fmLocation(folderId) {
  return ['Tugas', ...fmPath(folderId).map((f) => f.name)].join(' / ');
}

// Pencarian menyisir seluruh pohon, bukan hanya folder yang sedang dibuka.
function fmSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hit = (text) => String(text || '').toLowerCase().includes(q);
  return [
    ...fm.data.folders.filter((f) => hit(f.name)).map((f) => fmToItem(f, 'folder')),
    ...fm.data.tasks.filter((t) => hit(t.title) || hit(t.description)).map((t) => fmToItem(t, 'task')),
    ...fm.data.files.filter((f) => hit(f.name)).map((f) => fmToItem(f, 'file')),
  ];
}

function fmSortItems(items) {
  const byName = (a, b) => a.name.localeCompare(b.name, 'id');
  const byTime = (a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || ''));
  const cmp = {
    'name-asc': byName,
    'name-desc': (a, b) => byName(b, a),
    newest: (a, b) => byTime(b, a),
    oldest: byTime,
    size: (a, b) => (b.size || 0) - (a.size || 0),
  }[fm.sort] || byName;

  // Folder selalu di atas, tapi urutan di dalam tiap grup mengikuti pilihan sort.
  return [
    ...items.filter((i) => i.type === 'folder').sort(cmp),
    ...items.filter((i) => i.type !== 'folder').sort(cmp),
  ];
}

function fmMeta(item) {
  if (item.type === 'folder') return `${fmChildren(item.id).length} item`;
  if (item.type === 'task') return `Deadline ${fmFormatDate(item.deadline)}`;
  return `${fmFormatSize(item.size)} • ${ownerName(item, fm.data.users)}`;
}

// ---------- Tampilan ----------

function fmItemHtml(item) {
  return `
    <div class="fm-item" data-type="${item.type}" data-id="${item.id}">
      <button class="fm-item-open" type="button" data-open="${item.id}">
        <span class="fm-item-icon" aria-hidden="true">${fmIcon(item)}</span>
        <span class="fm-item-main">
          <span class="fm-item-name">${fmEscape(item.name)}</span>
          <span class="fm-item-meta">${fmEscape(fmMeta(item))}</span>
        </span>
        ${item.type === 'task' ? '<span class="badge badge--warning">Tugas</span>' : ''}
      </button>
      <button class="fm-item-more" type="button" data-more="${item.id}" aria-label="Menu untuk ${fmEscape(item.name)}">⋮</button>
    </div>`;
}

function fmRender() {
  const listEl = document.getElementById('fm-items');
  if (!listEl) return;

  const searching = fm.query.trim() !== '';
  const items = fmSortItems(searching ? fmSearch(fm.query) : fmChildren(fm.folderId));
  const path = fmPath(fm.folderId);

  document.getElementById('fm-title').textContent = searching
    ? 'Pencarian'
    : path.length ? path[path.length - 1].name : 'Tugas';

  document.getElementById('fm-back').disabled = !fm.folderId;
  // Tamu tidak punya tombol tambah sama sekali.
  document.getElementById('fm-add').hidden = !can('create-folder', null) && !can('upload', null);
  document.getElementById('fm-count').textContent = searching
    ? `${items.length} hasil ditemukan`
    : `${items.length} item`;

  document.getElementById('fm-breadcrumb').innerHTML = searching
    ? `<span class="fm-crumb is-current">&quot;${fmEscape(fm.query.trim())}&quot;</span>`
    : ['<button class="fm-crumb" type="button" data-crumb="">Tugas</button>']
        .concat(path.map((f) => `<button class="fm-crumb" type="button" data-crumb="${f.id}">${fmEscape(f.name)}</button>`))
        .join('<span class="fm-crumb-sep" aria-hidden="true">/</span>');

  listEl.classList.toggle('is-grid', fm.view === 'grid');
  listEl.innerHTML = items.length
    ? items.map(fmItemHtml).join('')
    : `<p class="fm-empty">${searching ? 'Tidak ada yang cocok dengan pencarian ini.' : 'Folder ini masih kosong.'}</p>`;

  document.querySelectorAll('.fm .segmented-btn').forEach((btn) => {
    const active = btn.dataset.view === fm.view;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// ---------- Sheet bawah (menu / detail / tambah) ----------

function fmCloseSheet() {
  document.getElementById('fm-sheet').hidden = true;
  document.getElementById('fm-overlay').hidden = true;
  document.body.classList.remove('is-locked');
  fm.sheetItem = null;
  if (fm.lastFocus) fm.lastFocus.focus();
  fm.lastFocus = null;
}

function fmOpenSheet(item, title, bodyHtml, footHtml) {
  fm.lastFocus = document.activeElement;
  fm.sheetItem = item || null;
  document.getElementById('fm-sheet-title').textContent = title;
  document.getElementById('fm-sheet-body').innerHTML = bodyHtml;
  document.getElementById('fm-sheet-foot').innerHTML = footHtml || '';
  document.getElementById('fm-sheet').hidden = false;
  document.getElementById('fm-overlay').hidden = false;
  document.body.classList.add('is-locked');
}

function fmDetailBody(item) {
  const isFile = item.type === 'file';
  const ext = isFile ? (item.name.split('.').pop() || '').toUpperCase() : '';
  const rows = [['Nama', item.name], ['Tipe', ext || (item.type === 'folder' ? 'Folder' : 'Tugas')]];
  if (isFile) rows.push(['Ukuran', fmFormatSize(item.size)]);
  rows.push(['Pemilik', ownerName(item, fm.data.users)], ['Tanggal diperbarui', fmFormatDate(item.updated_at)]);
  // Folder tidak punya folder_id; lokasinya ditelusuri lewat parent_id.
  const parentId = item.type === 'folder' ? item.parent_id : item.folder_id;
  rows.push(['Lokasi folder', fmLocation(parentId)]);
  return rows
    .map(([key, val]) => `<div class="info-row"><span class="fm-kv-key">${fmEscape(key)}</span><span class="fm-kv-val">${fmEscape(val)}</span></div>`)
    .join('');
}

function fmOpenDetail(item) {
  const foot = item.type === 'file' && can('download', item)
    ? '<button class="button" type="button" data-action="download">Download</button>'
    : '';
  fmOpenSheet(item, item.name, fmDetailBody(item), foot);
}

// Isi menu aksi mengikuti role: lihat can() di js/auth.js.
function fmMenuActions(item) {
  const actions = [
    { key: 'open', label: 'Buka' },
    { key: 'detail', label: 'Detail' },
  ];
  // Hanya admin & mahasiswa yang boleh mengunduh; tamu dibatasi file public.
  if (can('download', item)) actions.push({ key: 'download', label: 'Download' });
  if (can('rename', item)) actions.push({ key: 'rename', label: 'Rename' });
  if (can('delete', item)) actions.push({ key: 'delete', label: 'Delete', danger: true });
  return actions;
}

function fmOpenMenu(item) {
  const body = fmMenuActions(item)
    .map((a) => `<button class="fm-menu-item${a.danger ? ' fm-menu-item--danger' : ''}" type="button" data-action="${a.key}">${a.label}</button>`)
    .join('');
  const role = getRoleLabel();
  fmOpenSheet(item, item.name, body, `<p class="fm-hint">Menu ini menyesuaikan role ${role}.</p>`);
}

function fmOpenAdd() {
  const rows = [];
  if (can('create-folder', null)) rows.push('<button class="fm-menu-item" type="button" data-action="create-folder">📁 Buat folder baru</button>');
  if (can('upload', null)) rows.push('<button class="fm-menu-item" type="button" data-action="upload">📄 Upload file</button>');
  if (!rows.length) rows.push('<p class="fm-hint">Tidak ada aksi yang tersedia untuk role ini.</p>');
  fmOpenSheet(null, 'Tambah', rows.join(''), '<p class="fm-hint">Semua perubahan hanya ada di memori browser dan hilang saat refresh.</p>');
}

// ---------- CRUD mockup (hanya di memori) ----------

const ITEM_SOURCE = { folder: 'folders', task: 'tasks', file: 'files' };

function fmToday() {
  return new Date().toISOString().slice(0, 10);
}

function fmNextId(list) {
  return list.reduce((max, row) => Math.max(max, row.id || 0), 0) + 1;
}

function fmOpenRename(item) {
  const body = `
    <div class="form-field">
      <label class="label" for="fm-rename-input">Nama baru</label>
      <input class="input" id="fm-rename-input" name="name" type="text"
             value="${fmEscape(item.name)}" autocomplete="off" spellcheck="false">
    </div>`;
  const foot = `
    <button class="button" type="button" data-action="rename-save">Simpan</button>
    <button class="button button--ghost" type="button" data-sheet-close>Batal</button>`;
  fmOpenSheet(item, 'Rename', body, foot);
  const input = document.getElementById('fm-rename-input');
  input.focus();
  input.select();
}

function fmOpenCreateFolder() {
  const body = `
    <div class="form-field">
      <label class="label" for="fm-folder-input">Nama folder</label>
      <input class="input" id="fm-folder-input" name="name" type="text"
             placeholder="mis. Tugas Praktikum" autocomplete="off" spellcheck="false">
    </div>
    <p class="fm-hint">Dibuat di dalam: ${fmEscape(fmLocation(fm.folderId))}</p>`;
  const foot = `
    <button class="button" type="button" data-action="create-folder-save">Buat</button>
    <button class="button button--ghost" type="button" data-sheet-close>Batal</button>`;
  fmOpenSheet(null, 'Buat Folder', body, foot);
  document.getElementById('fm-folder-input').focus();
}

function fmOpenUpload() {
  const body = '<p class="fm-hint">Pilih satu file dari perangkat. Datanya hanya dibaca di browser, tidak ada yang diunggah ke server.</p>';
  const foot = `
    <button class="button" type="button" data-action="pick-file">Pilih File</button>
    <p class="fm-hint">Tujuan: ${fmEscape(fmLocation(fm.folderId))}</p>`;
  fmOpenSheet(null, 'Upload File', body, foot);
}

function fmCreateFolder(name) {
  const clean = String(name || '').trim();
  if (!clean) return;
  fm.data.folders.push({
    id: fmNextId(fm.data.folders),
    parent_id: fm.folderId,
    name: clean,
    created_by: getCurrentUser().id,
    created_at: fmToday(),
    updated_at: fmToday(),
  });
  fmRender();
  fmToast(`Folder "${clean}" dibuat.`);
}

function fmRenameItem(item, name) {
  const clean = String(name || '').trim();
  if (!clean || clean === item.name) return;
  const row = (fm.data[ITEM_SOURCE[item.type]] || []).find((r) => r.id === item.id);
  if (!row) return;
  if (item.type === 'task') row.title = clean;
  else row.name = clean;
  row.updated_at = fmToday();
  fmRender();
  fmToast(`Nama diubah jadi "${clean}".`);
}

function fmDeleteItem(item) {
  const kind = item.type === 'folder' ? 'folder' : item.type === 'task' ? 'tugas' : 'file';
  if (!window.confirm(`Hapus ${kind} "${item.name}"? Perubahan ini hanya berlaku di sesi ini.`)) return;
  const list = fm.data[ITEM_SOURCE[item.type]] || [];
  const index = list.findIndex((r) => r.id === item.id);
  if (index === -1) return;
  list.splice(index, 1);
  // Isi folder ikut terhapus supaya tidak ada anak yatim menunjuk ke folder hilang.
  if (item.type === 'folder') {
    ['folders', 'tasks', 'files'].forEach((key) => {
      fm.data[key] = fm.data[key].filter((row) => row.parent_id !== item.id && row.folder_id !== item.id);
    });
  }
  if (fm.folderId === item.id) fm.folderId = item.parent_id;
  fmRender();
  fmToast(`"${item.name}" dihapus.`);
}

function fmAddFile(file) {
  if (!file) return;
  fm.data.files.push({
    id: fmNextId(fm.data.files),
    folder_id: fm.folderId,
    user_id: getCurrentUser().id,
    name: file.name,
    file_type: file.type || 'application/octet-stream',
    // File Ketua Kelas boleh dilihat tamu, file mahasiswa tidak.
    visibility: isAdmin() ? 'public' : 'private',
    size: file.size,
    created_at: fmToday(),
    updated_at: fmToday(),
  });
  fmRender();
  fmToast(`"${file.name}" ditambahkan (hilang saat refresh).`);
}

let fmToastTimer;

function fmToast(message) {
  let el = document.getElementById('fm-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fm-toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(fmToastTimer);
  fmToastTimer = setTimeout(() => el.classList.remove('is-visible'), 2200);
}

function fmRunAction(action, item) {
  if (action === 'open') {
    if (!item) return fmOpenAdd();
    // File dan tugas belum bisa dipreview, jadi detail dulu (PART 16+).
    if (item.type === 'folder') {
      fmCloseSheet();
      fm.folderId = item.id;
      fmRender();
      return;
    }
    return fmOpenDetail(item);
  }
  if (action === 'detail') return fmOpenDetail(item);
  if (action === 'rename') return fmOpenRename(item);
  if (action === 'create-folder') return fmOpenCreateFolder();
  if (action === 'upload') return fmOpenUpload();

  // Aksi di bawah menutup sheet dulu, jadi nilai input harus dibaca sebelum itu.
  if (action === 'rename-save') {
    const value = document.getElementById('fm-rename-input').value;
    const target = item;
    fmCloseSheet();
    return fmRenameItem(target, value);
  }
  if (action === 'create-folder-save') {
    const value = document.getElementById('fm-folder-input').value;
    fmCloseSheet();
    return fmCreateFolder(value);
  }
  if (action === 'pick-file') {
    fmCloseSheet();
    return document.getElementById('fm-file-input').click();
  }
  if (action === 'delete') {
    const target = item;
    fmCloseSheet();
    return fmDeleteItem(target);
  }
  if (action === 'download') {
    fmCloseSheet();
    return fmToast('Mockup: file belum ada di server.');
  }
  fmCloseSheet();
  return fmToast('Aksi belum tersedia.');
}

function fmToggleSearch(open) {
  const bar = document.getElementById('fm-searchbar');
  const input = document.getElementById('fm-search-input');
  bar.hidden = !open;
  document.getElementById('fm-search-toggle').setAttribute('aria-expanded', String(open));
  if (open) input.focus();
  else { fm.query = ''; input.value = ''; fmRender(); }
}

// ---------- Event (delegasi, satu pasang listener) ----------

function fmOnClick(event) {
  const target = event.target;

  const crumb = target.closest('[data-crumb]');
  if (crumb) {
    fm.folderId = crumb.dataset.crumb === '' ? null : Number(crumb.dataset.crumb);
    fmRender();
    return;
  }

  const more = target.closest('[data-more]');
  if (more) {
    const row = more.closest('.fm-item');
    fmOpenMenu(fmFind(row.dataset.type, Number(row.dataset.id)));
    return;
  }

  const openBtn = target.closest('[data-open]');
  if (openBtn) {
    const row = openBtn.closest('.fm-item');
    fmRunAction('open', fmFind(row.dataset.type, Number(row.dataset.id)));
    return;
  }

  const viewBtn = target.closest('.fm [data-view]');
  if (viewBtn) {
    fm.view = viewBtn.dataset.view === 'grid' ? 'grid' : 'list';
    localStorage.setItem(VIEW_KEY, fm.view);
    fmRender();
    return;
  }

  const actionBtn = target.closest('[data-action]');
  if (actionBtn) {
    fmRunAction(actionBtn.dataset.action, fm.sheetItem);
    return;
  }

  if (target.closest('[data-sheet-close]') || target.id === 'fm-overlay') return fmCloseSheet();
  if (target.closest('#fm-search-toggle')) return fmToggleSearch(true);
  if (target.closest('#fm-search-close')) return fmToggleSearch(false);
  if (target.closest('#fm-add')) return fmOpenAdd();

  if (target.closest('#fm-back')) {
    const current = fmFolderById(fm.folderId);
    fm.folderId = current ? current.parent_id : null;
    fmRender();
  }
}

function initTugasPage() {
  const root = document.querySelector('.fm');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  fm.view = localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';

  root.addEventListener('click', fmOnClick);
  root.addEventListener('change', (e) => {
    if (e.target.id === 'fm-sort') { fm.sort = e.target.value; fmRender(); return; }
    if (e.target.id === 'fm-file-input') {
      fmAddFile(e.target.files && e.target.files[0]);
      e.target.value = ''; // biar file yang sama bisa dipilih lagi
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'fm-search-input') { fm.query = e.target.value; fmRender(); }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return fmCloseSheet();
    // Enter di sheet Rename / Buat Folder sama saja dengan menekan tombolnya.
    if (e.key === 'Enter' && e.target.id === 'fm-rename-input') fmRunAction('rename-save', fm.sheetItem);
    if (e.key === 'Enter' && e.target.id === 'fm-folder-input') fmRunAction('create-folder-save', null);
  });

  fetch('data/contoh.json')
    .then((res) => res.json())
    .then((data) => { fm.data = data; fmRender(); })
    .catch(() => {
      document.getElementById('fm-items').innerHTML =
        '<p class="fm-empty">Gagal memuat data/contoh.json. Buka lewat http://localhost:8000, bukan file://.</p>';
    });
}

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.tugas = { init: initTugasPage };

