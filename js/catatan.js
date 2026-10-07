// js/catatan.js
const CATATAN_KEY = 'sh_mock_notes';
const CATATAN_MAX_IMAGE_BYTES = 300 * 1024;
const TITLE_MAX = 120;
const LABELS_KEY = 'sh_mock_labels';

function normalizeReminder(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    return { enabled: true, dateTime: s };
  }
  if (typeof v === 'object') {
    const dt = typeof v.dateTime === 'string' ? v.dateTime.trim() : '';
    const enabled = v.enabled !== false && !!dt;
    if (!dt) return null;
    return { enabled: enabled, dateTime: dt };
  }
  return null;
}

function isReminderActive(note) {
  if (!note) return false;
  const r = normalizeReminder(note.reminder);
  return !!(r && r.enabled);
}

function normalizeNote(n) {
  if (!n || typeof n !== 'object') return n;
  if (n.isDeleted === undefined) n.isDeleted = Boolean(n.isTrashed);
  if ('isTrashed' in n) delete n.isTrashed;
  if (!Array.isArray(n.labels)) n.labels = [];
  if (!n.color || typeof n.color !== 'string') n.color = 'white';
  if (n.isPinned === undefined) n.isPinned = false;
  if (n.isArchived === undefined) n.isArchived = false;
  if (n.isDeleted === undefined) n.isDeleted = false;
  if (!Array.isArray(n.collaborators)) n.collaborators = [];
  n.reminder = normalizeReminder(n.reminder);
  if (n.isArchived && n.isDeleted) n.isArchived = false;
  return n;
}

function readNotes() {
  try {
    const raw = localStorage.getItem(CATATAN_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    let changed = false;
    const mapped = data.map(function (n) {
      if (!n || typeof n !== 'object') return n;
      const before = JSON.stringify(n);
      const nn = normalizeNote(n);
      if (JSON.stringify(nn) !== before) changed = true;
      return nn;
    });
    if (changed) {
      try { localStorage.setItem(CATATAN_KEY, JSON.stringify(mapped)); } catch (e) {}
    }
    return mapped;
  } catch (e) { return []; }
}

function persist(notes) {
  try {
    localStorage.setItem(CATATAN_KEY, JSON.stringify(notes));
    return true;
  } catch (e) {
    return false;
  }
}

function readLabels() {
  try {
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!user) return [];
    const raw = localStorage.getItem(LABELS_KEY);
    const all = raw ? JSON.parse(raw) : {};
    return Array.isArray(all[user.id]) ? all[user.id] : [];
  } catch (e) { return []; }
}

function persistLabels(labels) {
  try {
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!user) return;
    const raw = localStorage.getItem(LABELS_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[user.id] = labels;
    localStorage.setItem(LABELS_KEY, JSON.stringify(all));
  } catch (e) {}
}

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str || '').replace(/[&<>"']/g, m => map[m]);
}

function validateNote(input) {
  if (!input) return { ok: false, error: 'Data tidak valid.' };
  const title = String(input.title || '').trim();
  const content = String(input.content || '').trim();
  const image = String(input.image || '').trim();

  if (!title) return { ok: false, error: 'Judul wajib diisi.' };
  if (title.length > TITLE_MAX) return { ok: false, error: 'Judul terlalu panjang (maks ' + TITLE_MAX + ' karakter).' };
  if (!content) return { ok: false, error: 'Isi catatan tidak boleh kosong.' };

  if (image) {
    if (!image.startsWith('data:image/')) return { ok: false, error: 'Hanya mendukung data URL gambar.' };
    if (image.length * 0.75 > CATATAN_MAX_IMAGE_BYTES) {
      return { ok: false, error: 'Ukuran foto melebihi 300 KB.' };
    }
  }

  return { ok: true, value: { title, content, image } };
}

function listNotes() {
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  if (!user || !user.id) return [];
  return readNotes().filter(n => n.user_id === user.id);
}

function createNote(input) {
  if (typeof can === 'function' && !can('catatan')) return { ok: false, error: 'Akses ditolak.' };
  const res = validateNote(input);
  if (!res.ok) return res;

  const user = getCurrentUser();
  const notes = readNotes();
  const now = Date.now();
  const newNote = normalizeNote({
    ...res.value,
    id: now + Math.floor(Math.random() * 1000),
    user_id: user.id,
    color: input.color || 'white',
    labels: Array.isArray(input.labels) ? input.labels : [],
    isPinned: Boolean(input.isPinned),
    isArchived: Boolean(input.isArchived),
    isDeleted: false,
    collaborators: Array.isArray(input.collaborators) ? input.collaborators : [],
    reminder: input.reminder,
    created_at: now,
    updated_at: now
  });
  notes.push(newNote);
  const okp = persist(notes);
  if (!okp) return { ok: false, error: 'Gagal menyimpan catatan.' };
  return { ok: true, note: newNote, id: newNote.id };
}


function updateNote(id, input) {
  const notes = readNotes();
  const idx = notes.findIndex(n => n.id === id);
  if (idx === -1) return { ok: false, error: 'Catatan tidak ditemukan.' };
  if (typeof can === 'function' && !can('catatan-ubah', notes[idx])) return { ok: false, error: 'Catatan tidak ditemukan.' };

  const prev = notes[idx];
  const mergedForValidation = {
    title: input.title !== undefined ? input.title : prev.title,
    content: input.content !== undefined ? input.content : prev.content,
    image: input.image !== undefined ? input.image : prev.image
  };
  const res = validateNote(mergedForValidation);
  if (!res.ok) return res;

  const archivedGiven = input.isArchived !== undefined;
  const deletedGiven = input.isDeleted !== undefined || input.isTrashed !== undefined;
  let nextArchived = archivedGiven ? Boolean(input.isArchived) : Boolean(prev.isArchived);
  let nextDeleted = input.isDeleted !== undefined ? Boolean(input.isDeleted)
    : input.isTrashed !== undefined ? Boolean(input.isTrashed) : Boolean(prev.isDeleted);
  // Arsip dan sampah saling eksklusif: flag yang diubah eksplisit menang.
  if (archivedGiven && !deletedGiven && nextArchived) nextDeleted = false;
  if (deletedGiven && !archivedGiven && nextDeleted) nextArchived = false;

  const noteNext = normalizeNote({
    ...prev,
    ...res.value,
    color: input.color !== undefined ? input.color : prev.color,
    labels: Array.isArray(input.labels) ? input.labels : (prev.labels || []),
    collaborators: Array.isArray(input.collaborators) ? input.collaborators : (prev.collaborators || []),
    isPinned: input.isPinned !== undefined ? Boolean(input.isPinned) : prev.isPinned,
    isArchived: nextArchived,
    isDeleted: nextDeleted,
    reminder: input.reminder !== undefined ? input.reminder : prev.reminder,
    updated_at: Date.now()
  });
  notes[idx] = noteNext;
  const okp = persist(notes);
  if (!okp) return { ok: false, error: 'Gagal menyimpan catatan.' };
  return { ok: true, note: notes[idx] };
}

function deleteNote(id) {
  const notes = readNotes();
  const idx = notes.findIndex(n => n.id === id);
  if (idx === -1) return { ok: false, error: 'Catatan tidak ditemukan.' };
  if (typeof can === 'function' && !can('catatan-ubah', notes[idx])) return { ok: false, error: 'Catatan tidak ditemukan.' };
  notes.splice(idx, 1);
  const okp = persist(notes);
  if (!okp) return { ok: false, error: 'Gagal menyimpan catatan.' };
  return { ok: true };
}

function searchNotes(notes, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return notes;
  return notes.filter(n =>
    String(n.title || '').toLowerCase().includes(q) ||
    String(n.content || '').toLowerCase().includes(q)
  );
}

function sortNotes(notes, criteria) {
  const sorted = [...notes];
  if (criteria === 'updated_asc') sorted.sort((a, b) => a.updated_at - b.updated_at);
  else if (criteria === 'title_asc') sorted.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  else if (criteria === 'title_desc') sorted.sort((a, b) => String(b.title).localeCompare(String(a.title)));
  else sorted.sort((a, b) => b.updated_at - a.updated_at);
  return sorted;
}

// ---------- Helper murni editor (diletakkan sebelum marker STUDENTHUB_PAGES
// supaya bisa diuji langsung lewat Node) ----------

function formatClock(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return hh + '.' + mm;
}

// Format "Diedit …" sesuai spec §7: baru saja / jam / kemarin jam / tgl jam.
function formatEditedTime(ts, nowTs) {
  if (!ts) return '';
  const now = nowTs || Date.now();
  const diff = now - ts;
  if (diff < 0 || diff < 60000) return 'Diedit baru saja';
  const d = new Date(ts);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return 'Diedit ' + formatClock(ts);
  const startToday = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  if (ts >= startToday - 86400000) return 'Diedit kemarin ' + formatClock(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return 'Diedit ' + dd + '/' + mm + ' ' + formatClock(ts);
}

function toDatetimeLocal(date) {
  const p = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) + 'T' + p(date.getHours()) + ':' + p(date.getMinutes());
}

// Preset pengingat: Nanti hari ini (20:00), Besok (08:00), Minggu depan (08:00).
function reminderPresets(nowTs) {
  const now = new Date(nowTs || Date.now());
  const later = new Date(now);
  later.setHours(20, 0, 0, 0);
  if (later.getTime() <= now.getTime()) later.setDate(later.getDate() + 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const week = new Date(now);
  week.setDate(week.getDate() + 7);
  week.setHours(8, 0, 0, 0);
  return [
    { label: 'Nanti hari ini', value: toDatetimeLocal(later) },
    { label: 'Besok', value: toDatetimeLocal(tomorrow) },
    { label: 'Minggu depan', value: toDatetimeLocal(week) }
  ];
}

function formatReminderLabel(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!m) return String(value || '');
  return m[3] + '/' + m[2] + ' ' + m[4] + '.' + m[5];
}

// Bungkus seleksi plain-text dengan penanda formatting (toggle bila sudah ada).
function wrapSelection(text, start, end, before, after) {
  const s = String(text == null ? '' : text);
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(s.length, Math.max(start, end));
  const close = after === undefined ? before : after;
  const selected = s.slice(a, b);
  // Sudah terbungkus penanda yang sama -> lepaskan.
  if (selected.length >= before.length + close.length && selected.startsWith(before) && selected.endsWith(close)) {
    const inner = selected.slice(before.length, selected.length - close.length);
    return { value: s.slice(0, a) + inner + s.slice(b), selStart: a, selEnd: a + inner.length };
  }
  const wrapped = before + selected + close;
  return { value: s.slice(0, a) + wrapped + s.slice(b), selStart: a + before.length, selEnd: b + before.length };
}

function stripFormat(input) {
  return String(input == null ? '' : input)
    .replace(/\*\*/g, '')
    .replace(/~~/g, '')
    .replace(/<\/?u>/gi, '')
    .replace(/\*/g, '');
}

const EMPTY_STATES = {
  catatan: {
    icon: '💡',
    title: 'Belum ada catatan',
    subtitle: 'Mulai dengan membuat catatan pertama Anda'
  },
  tersemat: {
    icon: '📌',
    title: 'Tidak ada catatan yang disematkan',
    subtitle: 'Sematkan catatan penting agar mudah ditemukan'
  },
  pengingat: {
    icon: '🔔',
    title: 'Tidak ada pengingat aktif',
    subtitle: 'Atur pengingat pada catatan untuk melihatnya di sini'
  },
  label: {
    icon: '🏷️',
    title: 'Tidak ada catatan dengan label ini',
    subtitle: 'Tambahkan label ke catatan untuk mengelompokkannya'
  },
  arsip: {
    icon: '📥',
    title: 'Arsip kosong',
    subtitle: 'Catatan yang diarsipkan akan muncul di sini'
  },
  sampah: {
    icon: '🗑️',
    title: 'Sampah kosong',
    subtitle: 'Catatan yang dihapus akan masuk ke Sampah'
  }
};

const FORMAT_MARKERS = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<u>', '</u>'],
  strike: ['~~', '~~']
};


let catatanDocClickHandler = null;
let catatanKeyHandler = null;

function initCatatanPage() {
  const root = document.getElementById('page-catatan');
  if (!root) return;
  const state = { view: 'catatan', layout: 'grid', searchQuery: '', sortBy: 'updated_desc', labels: readLabels(), selectedNote: null, quickColor: 'white', quickPinned: false, quickImage: '' };
  const els = {
    shell: root.querySelector('[data-shell]'),
    gridPinned: root.querySelector('[data-grid-pinned]'),
    gridOthers: root.querySelector('[data-grid-others]'),
    sectionPinned: root.querySelector('[data-section-pinned]'),
    titleOthers: root.querySelector('[data-title-others]'),
    empty: root.querySelector('[data-empty]'),
    sidebar: root.querySelector('[data-sidebar]'),
    sidebarLabels: root.querySelector('[data-sidebar-labels-list]'),
    scrim: root.querySelector('[data-scrim]'),
    search: root.querySelector('[data-search]'),
    sort: root.querySelector('[data-sort]'),
    quick: {
      wrap: root.querySelector('[data-quick-note]'),
      collapsed: root.querySelector('[data-quick-collapsed]'),
      expanded: root.querySelector('[data-quick-expanded]'),
      placeholder: root.querySelector('[data-quick-placeholder]'),
      title: root.querySelector('[data-quick-title]'),
      content: root.querySelector('[data-quick-content]'),
      preview: root.querySelector('[data-quick-preview]'),
      previewWrap: root.querySelector('[data-quick-preview-wrap]'),
      file: root.querySelector('[data-quick-file]'),
      photoBtn: root.querySelector('[data-quick-photo-btn]'),
      pinBtn: root.querySelector('[data-quick-pin]'),
      colorBtn: root.querySelector('.quick-note .quick-color-btn'),
      color: 'white'
    },
    editor: {
      wrap: root.querySelector('[data-note-editor]'),
      backdrop: root.querySelector('[data-note-backdrop]'),
      title: root.querySelector('[data-note-title]'),
      content: root.querySelector('[data-note-content]'),
      image: root.querySelector('[data-note-image]'),
      file: root.querySelector('[data-note-file]'),
      photoBtn: root.querySelector('[data-note-photo]'),
      removeBtn: root.querySelector('[data-note-remove-photo]'),
      pinBtn: root.querySelector('[data-editor-pin]'),
      archiveBtn: root.querySelector('[data-editor-archive]'),
      restoreBtn: root.querySelector('[data-editor-restore]'),
      deleteBtn: root.querySelector('[data-editor-delete]'),
      collaboratorBtn: root.querySelector('[data-editor-collaborator]'),
      undoBtn: root.querySelector('[data-editor-undo]'),
      redoBtn: root.querySelector('[data-editor-redo]'),
      saveRetry: root.querySelector('[data-save-retry]'),
      status: root.querySelector('[data-status]'),
      error: root.querySelector('.note-editor-error'),
      chips: root.querySelector('[data-editor-chips]'),
      formatMenu: root.querySelector('[data-format-menu]'),
      noteMenu: root.querySelector('[data-note-menu]')
    },
    popoverColor: root.querySelector('[data-popover-color]'),
    popoverLabel: root.querySelector('[data-popover-label]'),
    popoverReminder: root.querySelector('[data-popover-reminder]'),
    reminderPresets: root.querySelector('[data-reminder-presets]'),
    overlay: root.querySelector('[data-overlay]'),
    labelSheet: root.querySelector('[data-label-sheet]'),
    deleteSheet: root.querySelector('[data-delete-sheet]'),
    collaboratorSheet: root.querySelector('[data-collaborator-sheet]'),
    snackbar: { wrap: root.querySelector('[data-snackbar]'), text: root.querySelector('[data-snackbar-text]'), undo: root.querySelector('[data-snackbar-undo]') },
    snackbarTimeout: null
  };

  function render() {
    const all = listNotes();
    let filtered = [];
    if (state.view === 'catatan') filtered = all.filter(n => !n.isArchived && !n.isDeleted);
    else if (state.view === 'pengingat') filtered = all.filter(n => n.reminder && !n.isDeleted);
    else if (state.view === 'arsip') filtered = all.filter(n => n.isArchived && !n.isDeleted);
    else if (state.view === 'sampah') filtered = all.filter(n => n.isDeleted);
    else if (state.view.startsWith('label:')) {
      const lbl = state.view.replace('label:', '');
      filtered = all.filter(n => n.labels && n.labels.includes(lbl) && !n.isDeleted);
    }
    filtered = sortNotes(searchNotes(filtered, state.searchQuery), state.sortBy);
    const pinned = filtered.filter(n => n.isPinned);
    const others = filtered.filter(n => !n.isPinned);

    if (els.gridPinned) els.gridPinned.innerHTML = '';
    if (els.gridOthers) els.gridOthers.innerHTML = '';

    if (filtered.length === 0) {
      if (els.empty) els.empty.hidden = false;
      if (els.sectionPinned) els.sectionPinned.hidden = true;
      if (els.titleOthers) els.titleOthers.hidden = true;
    } else {
      if (els.empty) els.empty.hidden = true;
      if (pinned.length > 0 && state.view === 'catatan') {
        if (els.sectionPinned) els.sectionPinned.hidden = false;
        if (els.titleOthers) els.titleOthers.hidden = (others.length === 0);
        pinned.forEach(n => els.gridPinned.appendChild(createNoteCard(n)));
        others.forEach(n => els.gridOthers.appendChild(createNoteCard(n)));
      } else {
        if (els.sectionPinned) els.sectionPinned.hidden = true;
        if (els.titleOthers) els.titleOthers.hidden = true;
        filtered.forEach(n => els.gridOthers.appendChild(createNoteCard(n)));
      }
    }
    renderSidebarLabels();
  }

  function renderSidebarLabels() {
    if (!els.sidebarLabels) return;
    els.sidebarLabels.innerHTML = '';
    state.labels.forEach(function (lbl) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'catatan-nav-item';
      b.dataset.nav = 'label:' + lbl;
      b.innerHTML = '<span class="catatan-nav-ico">🏷️</span><span class="catatan-nav-text">' + escapeHtml(lbl) + '</span>';
      els.sidebarLabels.appendChild(b);
    });
  }

  function createNoteCard(note) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.color = note.color || 'white';
    if (note.isPinned) card.classList.add('is-pinned');
    const safeImage = note.image && String(note.image).startsWith('data:image/') ? escapeHtml(note.image) : '';
    const trashed = Boolean(note.isDeleted);
    const chips = [];
    if (note.reminder) chips.push('<span class="note-chip">🔔 ' + escapeHtml(formatReminderLabel(note.reminder)) + '</span>');
    (note.labels || []).slice(0, 3).forEach(function (lbl) { chips.push('<span class="note-chip">' + escapeHtml(lbl) + '</span>'); });
    const meta = trashed ? 'Di Sampah' : (note.isArchived ? 'Diarsipkan' : '');
    const menuItems = trashed
      ? '<button class="catatan-menu-item" type="button" data-card-action="restore">Pulihkan</button>' +
        '<button class="catatan-menu-item" type="button" data-card-action="delete">Hapus Permanen</button>'
      : '<button class="catatan-menu-item" type="button" data-card-action="duplicate">Duplikasi</button>' +
        '<button class="catatan-menu-item" type="button" data-card-action="trash">Hapus ke Sampah</button>';
    card.innerHTML = `
      ${safeImage ? `<img src="${safeImage}" class="note-card-img" alt="">` : ''}
      <div class="note-card-title">${escapeHtml(note.title || '(Tanpa judul)')}</div>
      <div class="note-card-preview">${escapeHtml((note.content || '').substring(0, 160))}</div>
      ${chips.length ? `<div class="note-card-chips">${chips.join('')}</div>` : ''}
      <div class="note-card-meta">${meta}</div>
      <button class="icon-btn note-card-actions" type="button" data-card-pin title="Sematkan" ${trashed ? 'hidden' : ''}>📌</button>
      <div class="catatan-menu-wrap">
        <button class="icon-btn note-card-menu-btn" type="button" data-card-menu-btn title="Lainnya" aria-label="Lainnya">⋮</button>
        <div class="catatan-menu" data-card-menu hidden>${menuItems}</div>
      </div>`;
    card.addEventListener('click', function () { openEditor(note); });
    const pin = card.querySelector('[data-card-pin]');
    if (pin) pin.addEventListener('click', function (e) { e.stopPropagation(); togglePin(note); });
    const menuBtn = card.querySelector('[data-card-menu-btn]');
    const menu = card.querySelector('[data-card-menu]');
    if (menuBtn && menu) menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      const show = menu.hidden;
      closeAllCardMenus();
      menu.hidden = !show;
    });
    card.querySelectorAll('[data-card-action]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (menu) menu.hidden = true;
        const act = b.dataset.cardAction;
        if (act === 'duplicate') duplicateNote(note);
        else if (act === 'trash') trashNote(note);
        else if (act === 'restore') restoreNote(note);
        else if (act === 'delete') openDeleteSheet(note);
      });
    });
    return card;
  }

  function closeAllCardMenus() {
    root.querySelectorAll('[data-card-menu]').forEach(function (m) { m.hidden = true; });
  }
  function closeNoteMenu() {
    const m = root.querySelector('[data-note-menu]');
    if (m) m.hidden = true;
  }

  function togglePin(note) {
    const res = updateNote(note.id, { isPinned: !note.isPinned });
    if (!res.ok) return showSnackbar(res.error);
    note.isPinned = !note.isPinned;
    showSnackbar(note.isPinned ? 'Disematkan.' : 'Semat dilepas.');
    render();
  }

  function duplicateNote(note) {
    const res = createNote({
      title: (note.title || 'Tanpa judul') + ' (salinan)',
      content: note.content,
      image: note.image,
      color: note.color,
      labels: note.labels,
      isPinned: note.isPinned
    });
    if (!res.ok) return showSnackbar(res.error);
    showSnackbar('Catatan diduplikasi.');
    render();
  }

  function trashNote(note) {
    const res = updateNote(note.id, { isDeleted: true });
    if (!res.ok) return showSnackbar(res.error);
    if (state.selectedNote && state.selectedNote.id === note.id) closeEditor(true);
    showSnackbar('Dipindahkan ke Sampah.', function () {
      updateNote(note.id, { isDeleted: false });
      render();
    });
    render();
  }

  function restoreNote(note) {
    const res = updateNote(note.id, { isDeleted: false });
    if (!res.ok) return showSnackbar(res.error);
    showSnackbar('Catatan dipulihkan.', function () {
      updateNote(note.id, { isDeleted: true });
      render();
    });
    render();
  }


  function showSnackbar(msg, undoFn) {
    if (!els.snackbar.wrap) return;
    els.snackbar.text.textContent = msg;
    if (els.snackbar.undo) {
      if (undoFn) {
        els.snackbar.undo.hidden = false;
        els.snackbar.undo.onclick = function () {
          undoFn();
          els.snackbar.undo.onclick = null;
          els.snackbar.undo.hidden = true;
          showSnackbar('Selesai.');
        };
      } else {
        els.snackbar.undo.hidden = true;
        els.snackbar.undo.onclick = null;
      }
    }
    els.snackbar.wrap.hidden = false;
    clearTimeout(els.snackbarTimeout);
    els.snackbarTimeout = setTimeout(function () {
      if (els.snackbar.wrap) els.snackbar.wrap.hidden = true;
    }, 3200);
  }

  function readFileAsImage(input, done) {
    if (!input || !input.files || !input.files[0]) return;
    const f = input.files[0];
    if (!f.type || !f.type.startsWith('image/')) return showSnackbar('Hanya file gambar.');
    const reader = new FileReader();
    reader.onload = function () {
      const res = validateNote({ title: 'x', content: 'x', image: String(reader.result) });
      if (!res.ok) return showSnackbar(res.error);
      done(String(reader.result));
    };
    reader.readAsDataURL(f);
    input.value = '';
  }

  // ---------- Editor: dialog floating, autosave, undo/redo ----------
  let autosaveTimer = null;
  const editorHistory = { stack: [], index: -1, timer: null };

  function setStatus(text) { if (els.editor.status) els.editor.status.textContent = text; }
  function setError(text) {
    if (els.editor.error) els.editor.error.textContent = text || '';
    if (els.editor.saveRetry) els.editor.saveRetry.hidden = !text;
  }
  function showEditedTime() {
    if (!state.selectedNote) return;
    setStatus(formatEditedTime(state.selectedNote.updated_at) || 'Tersimpan ✓');
  }

  function autosizeContent() {
    const ta = els.editor.content;
    if (!ta) return;
    ta.style.height = 'auto';
    const max = Math.round(window.innerHeight * 0.4);
    const needed = ta.scrollHeight + 4;
    ta.style.height = Math.min(needed, max) + 'px';
    ta.style.overflowY = needed > max ? 'auto' : 'hidden';
  }

  function currentDraft() {
    return {
      title: els.editor.title ? els.editor.title.value : '',
      content: els.editor.content ? els.editor.content.value : '',
      image: els.editor.image && !els.editor.image.hidden ? els.editor.image.src : ''
    };
  }

  // Judul/isi kosong diganti placeholder supaya lolos validateNote (seperti quick note).
  function saveDraft() {
    if (!state.selectedNote) return { ok: true };
    const d = currentDraft();
    const res = updateNote(state.selectedNote.id, {
      title: d.title.trim() || 'Tanpa judul',
      content: d.content.trim() ? d.content : ' ',
      image: d.image
    });
    if (res.ok) {
      state.selectedNote = res.note;
      setError('');
      showEditedTime();
    } else {
      setStatus('Gagal menyimpan.');
      setError(res.error);
    }
    return res;
  }

  function flushAutosave() {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
  }

  function scheduleAutosave() {
    if (!state.selectedNote) return;
    setError('');
    setStatus('Menyimpan…');
    flushAutosave();
    autosaveTimer = setTimeout(function () {
      autosaveTimer = null;
      saveDraft();
    }, 700);
  }

  // --- Riwayat undo/redo (snapshot {title, content}, coalesce 500 ms, maks 50) ---
  function snapshot() { const d = currentDraft(); return { title: d.title, content: d.content }; }
  function updateHistoryButtons() {
    if (els.editor.undoBtn) els.editor.undoBtn.disabled = editorHistory.index <= 0;
    if (els.editor.redoBtn) els.editor.redoBtn.disabled = editorHistory.index >= editorHistory.stack.length - 1;
  }
  function pushHistory() {
    const snap = snapshot();
    const top = editorHistory.stack[editorHistory.index];
    if (top && top.title === snap.title && top.content === snap.content) return;
    editorHistory.stack = editorHistory.stack.slice(0, editorHistory.index + 1);
    editorHistory.stack.push(snap);
    if (editorHistory.stack.length > 50) editorHistory.stack.shift();
    editorHistory.index = editorHistory.stack.length - 1;
    updateHistoryButtons();
  }
  function scheduleHistoryPush() {
    clearTimeout(editorHistory.timer);
    editorHistory.timer = setTimeout(function () { editorHistory.timer = null; pushHistory(); }, 500);
  }
  function resetHistory() {
    clearTimeout(editorHistory.timer);
    editorHistory.timer = null;
    editorHistory.stack = [snapshot()];
    editorHistory.index = 0;
    updateHistoryButtons();
  }
  function applyHistory(i) {
    if (i < 0 || i >= editorHistory.stack.length || i === editorHistory.index) return;
    editorHistory.index = i;
    const snap = editorHistory.stack[i];
    if (els.editor.title) els.editor.title.value = snap.title;
    if (els.editor.content) els.editor.content.value = snap.content;
    autosizeContent();
    updateHistoryButtons();
    scheduleAutosave();
  }
  function undoEditor() {
    // Ketikan yang masih debounce dimasukkan dulu supaya tidak ikut hilang.
    if (editorHistory.timer) { clearTimeout(editorHistory.timer); editorHistory.timer = null; pushHistory(); }
    applyHistory(editorHistory.index - 1);
  }
  function redoEditor() {
    if (editorHistory.timer) { clearTimeout(editorHistory.timer); editorHistory.timer = null; }
    applyHistory(editorHistory.index + 1);
  }

  function renderEditorChips() {
    if (!els.editor.chips) return;
    els.editor.chips.innerHTML = '';
    const note = state.selectedNote;
    if (!note) return;
    const add = function (text) {
      const span = document.createElement('span');
      span.className = 'note-chip';
      span.textContent = text;
      els.editor.chips.appendChild(span);
    };
    (note.labels || []).forEach(function (lbl) { add('🏷️ ' + lbl); });
    if (note.reminder) add('🔔 ' + formatReminderLabel(note.reminder));
    (note.collaborators || []).forEach(function (u) { add('👤 ' + u); });
  }

  function openEditor(note) {
    state.selectedNote = note;
    if (els.editor.title) els.editor.title.value = note.title || '';
    if (els.editor.content) els.editor.content.value = note.content || '';
    if (els.editor.image) {
      els.editor.image.src = note.image || '';
      els.editor.image.hidden = !note.image;
    }
    if (els.editor.removeBtn) els.editor.removeBtn.hidden = !note.image;
    if (els.editor.wrap) {
      els.editor.wrap.dataset.color = note.color || 'white';
      els.editor.wrap.hidden = false;
    }
    if (els.editor.backdrop) els.editor.backdrop.hidden = false;
    document.body.classList.add('catatan-modal-open');
    const trashed = Boolean(note.isDeleted);
    if (els.editor.archiveBtn) els.editor.archiveBtn.hidden = trashed;
    if (els.editor.restoreBtn) els.editor.restoreBtn.hidden = !trashed;
    if (els.editor.deleteBtn) els.editor.deleteBtn.hidden = !trashed;
    setError('');
    updateEditorPin(note.isPinned);
    renderEditorChips();
    resetHistory();
    autosizeContent();
    showEditedTime();
    if (els.editor.content) els.editor.content.focus();
  }

  function updateEditorPin(pinned) {
    if (els.editor.pinBtn) els.editor.pinBtn.classList.toggle('is-active', Boolean(pinned));
    if (els.quick.pinBtn) els.quick.pinBtn.classList.toggle('is-active', state.quickPinned);
  }

  function hideAllPopovers() {
    if (els.popoverColor) hideColorPopover();
    if (els.popoverLabel) els.popoverLabel.hidden = true;
    if (els.popoverReminder) els.popoverReminder.hidden = true;
  }

  // force=true: catatan sudah dipindah/dihapus, jangan coba menyimpan.
  function closeEditor(force) {
    if (state.selectedNote && !force) {
      flushAutosave();
      const res = saveDraft();
      if (!res.ok) return; // jangan buang perubahan yang belum tersimpan
    }
    flushAutosave();
    if (editorHistory.timer) { clearTimeout(editorHistory.timer); editorHistory.timer = null; }
    state.selectedNote = null;
    if (els.editor.wrap) els.editor.wrap.hidden = true;
    if (els.editor.backdrop) els.editor.backdrop.hidden = true;
    if (els.editor.file) els.editor.file.value = '';
    if (els.editor.noteMenu) els.editor.noteMenu.hidden = true;
    if (els.editor.formatMenu) els.editor.formatMenu.hidden = true;
    hideAllPopovers();
    document.body.classList.remove('catatan-modal-open');
    render();
  }

  // Escape / klik backdrop: tutup lapisan paling atas dulu.
  function closeTopmost() {
    if (els.editor.noteMenu && !els.editor.noteMenu.hidden) { els.editor.noteMenu.hidden = true; return true; }
    if (els.editor.formatMenu && !els.editor.formatMenu.hidden) { els.editor.formatMenu.hidden = true; return true; }
    if (els.popoverColor && !els.popoverColor.hidden) { hideColorPopover(); return true; }
    if (els.popoverLabel && !els.popoverLabel.hidden) { els.popoverLabel.hidden = true; return true; }
    if (els.popoverReminder && !els.popoverReminder.hidden) { els.popoverReminder.hidden = true; return true; }
    if (els.collaboratorSheet && !els.collaboratorSheet.hidden) { closeSheets(); return true; }
    if (els.labelSheet && !els.labelSheet.hidden) { closeSheets(); return true; }
    if (els.deleteSheet && !els.deleteSheet.hidden) { closeSheets(); return true; }
    if (state.selectedNote) { closeEditor(); return true; }
    return false;
  }

  // --- Format teks (penanda Markdown + <u> pada plain text) ---
  function applyFormat(kind) {
    const ta = els.editor.content;
    if (!state.selectedNote || !ta) return;
    if (kind === 'clear') {
      ta.value = stripFormat(ta.value);
    } else {
      const pair = FORMAT_MARKERS[kind];
      if (!pair) return;
      const r = wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, pair[0], pair[1]);
      ta.value = r.value;
      if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(r.selStart, r.selEnd);
    }
    if (els.editor.formatMenu) els.editor.formatMenu.hidden = true;
    if (els.editor.noteMenu) els.editor.noteMenu.hidden = true;
    autosizeContent();
    pushHistory();
    scheduleAutosave();
    ta.focus();
  }

  // --- Kolaborator (state lokal; belum tersambung backend) ---
  function renderCollaboratorSheet() {
    if (!els.collaboratorSheet) return;
    const list = els.collaboratorSheet.querySelector('[data-collaborator-list]');
    if (!list) return;
    list.innerHTML = '';
    const note = state.selectedNote;
    const accounts = (typeof listAccounts === 'function' ? listAccounts() : []).filter(function (a) {
      return a && (!note || a.id !== note.user_id);
    });
    if (!accounts.length) {
      const p = document.createElement('p');
      p.className = 'card-meta';
      p.textContent = 'Belum ada akun lain untuk dibagikan.';
      list.appendChild(p);
      return;
    }
    const shared = note && Array.isArray(note.collaborators) ? note.collaborators : [];
    accounts.forEach(function (acc) {
      const row = document.createElement('div');
      row.className = 'modal-label-row';
      const name = document.createElement('span');
      name.className = 'modal-label-name';
      name.textContent = (acc.name || acc.username || 'Pengguna') + ' · @' + (acc.username || '-');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'button button--ghost button--sm';
      const on = shared.indexOf(acc.username) !== -1;
      btn.textContent = on ? 'Batalkan' : 'Bagikan';
      btn.onclick = function () {
        if (!state.selectedNote) return;
        const cur = Array.isArray(state.selectedNote.collaborators) ? state.selectedNote.collaborators.slice() : [];
        const i = cur.indexOf(acc.username);
        if (i === -1) cur.push(acc.username); else cur.splice(i, 1);
        const res = updateNote(state.selectedNote.id, { collaborators: cur });
        if (!res.ok) return showSnackbar(res.error);
        state.selectedNote.collaborators = cur;
        renderCollaboratorSheet();
        renderEditorChips();
      };
      row.appendChild(name);
      row.appendChild(btn);
      list.appendChild(row);
    });
  }
  function openCollaboratorSheet() {
    if (!els.collaboratorSheet || !state.selectedNote) return;
    renderCollaboratorSheet();
    if (els.overlay) els.overlay.hidden = false;
    els.collaboratorSheet.hidden = false;
  }

  function expandQuick() {
    if (els.quick.collapsed) els.quick.collapsed.hidden = true;
    if (els.quick.expanded) els.quick.expanded.hidden = false;
    if (els.quick.title) els.quick.title.focus();
  }

  function collapseQuick() {
    const t = (els.quick.title ? els.quick.title.value : '').trim();
    const c = (els.quick.content ? els.quick.content.value : '').trim();
    const img = state.quickImage;
    if (t || c || img) {
      const res = createNote({ title: t || 'Tanpa judul', content: c || ' ', image: img, color: state.quickColor, isPinned: state.quickPinned });
      if (!res.ok) { showSnackbar(res.error); return; }
      showSnackbar('Catatan dibuat.');
    }
    state.quickPinned = false;
    state.quickImage = '';
    if (els.quick.collapsed) els.quick.collapsed.hidden = false;
    if (els.quick.expanded) els.quick.expanded.hidden = true;
    if (els.quick.title) els.quick.title.value = '';
    if (els.quick.content) els.quick.content.value = '';
    if (els.quick.previewWrap) els.quick.previewWrap.hidden = true;
    if (els.quick.preview) els.quick.preview.src = '';
    if (els.quick.wrap) els.quick.wrap.dataset.color = 'white';
    updateEditorPin(false);
    render();
  }

  function toggleSidebar(s) { const v = s !== undefined ? s : !els.sidebar.classList.contains('is-open'); els.sidebar.classList.toggle('is-open', v); if (els.scrim) els.scrim.hidden = !v; }
  function updateActiveNav() { root.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('is-active', b.dataset.nav === state.view)); }

  // --- Quick note ---
  if (els.quick.placeholder) els.quick.placeholder.onclick = expandQuick;
  root.querySelectorAll('[data-quick-new]').forEach(b => b.onclick = expandQuick);
  if (els.quick.pinBtn) els.quick.pinBtn.onclick = () => { state.quickPinned = !state.quickPinned; updateEditorPin(); };
  if (els.quick.photoBtn) els.quick.photoBtn.onclick = () => { expandQuick(); if (els.quick.file) els.quick.file.click(); };
  if (els.quick.file) els.quick.file.onchange = () => readFileAsImage(els.quick.file, (data) => {
    state.quickImage = data;
    if (els.quick.preview) els.quick.preview.src = data;
    if (els.quick.previewWrap) els.quick.previewWrap.hidden = false;
  });
  root.querySelectorAll('[data-quick-remove-photo]').forEach(b => b.onclick = () => {
    state.quickImage = '';
    if (els.quick.preview) els.quick.preview.src = '';
    if (els.quick.previewWrap) els.quick.previewWrap.hidden = true;
  });
  // Satu listener dokumen untuk semua "klik di luar". Listener lama dilepas dulu
  // supaya tidak menumpuk setiap router memuat ulang halaman catatan.
  if (catatanDocClickHandler) document.removeEventListener('click', catatanDocClickHandler);
  catatanDocClickHandler = function (e) {
    if (els.quick.wrap && els.quick.expanded && !els.quick.expanded.hidden && !els.quick.wrap.contains(e.target)) collapseQuick();
    if (els.popoverColor && !els.popoverColor.hidden && !els.popoverColor.contains(e.target)) hideColorPopover();
    if (els.popoverLabel && !els.popoverLabel.hidden && !els.popoverLabel.contains(e.target)) els.popoverLabel.hidden = true;
    if (els.popoverReminder && !els.popoverReminder.hidden && !els.popoverReminder.contains(e.target)) els.popoverReminder.hidden = true;
    closeAllCardMenus();
    closeNoteMenu();
    if (els.editor.formatMenu) els.editor.formatMenu.hidden = true;
  };
  document.addEventListener('click', catatanDocClickHandler);

  // Tempatkan popover: di bawah anchor, pindah ke atas bila tidak muat.
  function placePopover(pop, anchor) {
    const r = anchor.getBoundingClientRect();
    pop.hidden = false;
    const w = pop.offsetWidth || 220;
    const h = pop.offsetHeight || 160;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function togglePopover(pop, anchor) {
    if (!pop) return;
    if (pop.hidden) {
      hideAllPopovers();
      if (els.editor.noteMenu) els.editor.noteMenu.hidden = true;
      if (els.editor.formatMenu) els.editor.formatMenu.hidden = true;
      placePopover(pop, anchor);
    } else {
      pop.hidden = true;
    }
  }

  // --- Popover label: tandai/lepas label pada catatan terpilih ---
  function renderLabelPopover() {
    if (!els.popoverLabel) return;
    const list = els.popoverLabel.querySelector('[data-popover-label-list]');
    if (!list) return;
    list.innerHTML = '';
    const note = state.selectedNote;
    const active = note && Array.isArray(note.labels) ? note.labels : [];
    state.labels.forEach(function (lbl) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'popover-label-item' + (active.includes(lbl) ? ' is-active' : '');
      b.innerHTML = '<span>' + escapeHtml(lbl) + '</span><span>' + (active.includes(lbl) ? '✓' : '') + '</span>';
      b.onclick = function () {
        if (!state.selectedNote) return;
        const cur = Array.isArray(state.selectedNote.labels) ? state.selectedNote.labels.slice() : [];
        const i = cur.indexOf(lbl);
        if (i === -1) cur.push(lbl); else cur.splice(i, 1);
        const res = updateNote(state.selectedNote.id, { labels: cur });
        if (!res.ok) return showSnackbar(res.error);
        state.selectedNote.labels = cur;
        renderLabelPopover();
        renderEditorChips();
        render();
      };
      list.appendChild(b);
    });
  }
  root.querySelectorAll('[data-action="label-popover"]').forEach(b => b.onclick = (e) => { e.stopPropagation(); renderLabelPopover(); togglePopover(els.popoverLabel, b); });
  if (els.popoverLabel) {
    const input = els.popoverLabel.querySelector('[data-popover-new-label]');
    const addBtn = els.popoverLabel.querySelector('[data-popover-add-label]');
    const addLabel = function () {
      const v = input ? input.value.trim() : '';
      if (!v) return;
      if (!state.labels.includes(v)) { state.labels.push(v); persistLabels(state.labels); }
      if (input) input.value = '';
      renderLabelPopover();
      render();
    };
    if (addBtn) addBtn.onclick = addLabel;
    if (input) input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel(); } };
  }

  // --- Popover pengingat ---
  function renderReminderPresets() {
    if (!els.reminderPresets) return;
    els.reminderPresets.innerHTML = '';
    const input = els.popoverReminder ? els.popoverReminder.querySelector('[data-popover-reminder-time]') : null;
    reminderPresets().forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'button button--ghost button--sm';
      b.textContent = p.label;
      b.onclick = function () { if (input) input.value = p.value; };
      els.reminderPresets.appendChild(b);
    });
  }
  function saveReminder(val) {
    if (!state.selectedNote) return;
    const res = updateNote(state.selectedNote.id, { reminder: val || null });
    if (!res.ok) return showSnackbar(res.error);
    state.selectedNote.reminder = val || null;
    renderEditorChips();
    els.popoverReminder.hidden = true;
    showEditedTime();
    showSnackbar(val ? 'Pengingat disetel.' : 'Pengingat dihapus.');
  }
  root.querySelectorAll('[data-action="reminder-popover"]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    if (!els.popoverReminder || !state.selectedNote) return;
    const input = els.popoverReminder.querySelector('[data-popover-reminder-time]');
    if (input) input.value = state.selectedNote.reminder || '';
    renderReminderPresets();
    togglePopover(els.popoverReminder, b);
  });
  if (els.popoverReminder) {
    const save = els.popoverReminder.querySelector('[data-action="save-reminder"]');
    const clr = els.popoverReminder.querySelector('[data-action="clear-reminder"]');
    if (save) save.onclick = function () {
      const input = els.popoverReminder.querySelector('[data-popover-reminder-time]');
      saveReminder(input ? input.value : '');
    };
    if (clr) clr.onclick = function () { saveReminder(''); };
  }

  // --- Sheet label: kelola (tambah/hapus) daftar label ---
  function renderLabelSheet() {
    if (!els.labelSheet) return;
    const list = els.labelSheet.querySelector('[data-modal-label-list]');
    if (!list) return;
    list.innerHTML = '';
    state.labels.forEach(function (lbl) {
      const row = document.createElement('div');
      row.className = 'modal-label-row';
      const span = document.createElement('span');
      span.className = 'modal-label-name';
      span.textContent = lbl;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn';
      del.title = 'Hapus label';
      del.setAttribute('aria-label', 'Hapus label ' + lbl);
      del.textContent = '✕';
      del.onclick = function () {
        state.labels = state.labels.filter(x => x !== lbl);
        persistLabels(state.labels);
        renderLabelSheet();
        render();
      };
      row.appendChild(span);
      row.appendChild(del);
      list.appendChild(row);
    });
  }
  function openLabelSheet() {
    if (!els.labelSheet) return;
    renderLabelSheet();
    if (els.overlay) els.overlay.hidden = false;
    els.labelSheet.hidden = false;
  }
  if (els.labelSheet) {
    const input = els.labelSheet.querySelector('[data-modal-new-label]');
    const addBtn = els.labelSheet.querySelector('[data-modal-add-label]');
    const add = function () {
      const v = input ? input.value.trim() : '';
      if (!v) return;
      if (!state.labels.includes(v)) { state.labels.push(v); persistLabels(state.labels); }
      if (input) input.value = '';
      renderLabelSheet();
      render();
    };
    if (addBtn) addBtn.onclick = add;
    if (input) input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    els.labelSheet.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheets);
  }

  // --- Sheet hapus permanen + overlay ---
  function closeSheets() {
    if (els.labelSheet) els.labelSheet.hidden = true;
    if (els.deleteSheet) els.deleteSheet.hidden = true;
    if (els.collaboratorSheet) els.collaboratorSheet.hidden = true;
    if (els.overlay) els.overlay.hidden = true;
  }
  function openDeleteSheet(note) {
    if (!els.deleteSheet) return;
    const txt = els.deleteSheet.querySelector('[data-delete-text]');
    if (txt) txt.textContent = note && note.title ? note.title : '(Tanpa judul)';
    els.deleteSheet.dataset.noteId = note ? String(note.id) : '';
    if (els.overlay) els.overlay.hidden = false;
    els.deleteSheet.hidden = false;
  }
  if (els.deleteSheet) {
    const save = els.deleteSheet.querySelector('[data-delete-save]');
    if (save) save.onclick = function () {
      const id = Number(els.deleteSheet.dataset.noteId);
      const res = deleteNote(id);
      closeSheets();
      if (!res.ok) return showSnackbar(res.error);
      showSnackbar('Catatan dihapus permanen.');
      if (state.selectedNote && state.selectedNote.id === id) closeEditor(true);
      else render();
    };
    els.deleteSheet.querySelectorAll('[data-cancel],[data-close]').forEach(b => b.onclick = closeSheets);
  }
  if (els.overlay) els.overlay.onclick = closeSheets;

  // --- Navigasi & toolbar ---
  // Delegasi: tombol nav label dibuat ulang tiap render, jadi listener cukup di
  // kontainer sidebar sekali saja (tidak ikut hilang saat render).
  if (els.sidebar) els.sidebar.addEventListener('click', function (e) {
    const t = e.target;
    const b = t && t.closest ? t.closest('[data-nav]') : null;
    if (!b) return;
    if (b.dataset.nav === 'label-manage') {
      if (window.innerWidth < 1024) toggleSidebar(false);
      openLabelSheet();
      return;
    }
    state.view = b.dataset.nav;
    updateActiveNav();
    render();
    if (window.innerWidth < 1024) toggleSidebar(false);
  });
  root.querySelectorAll('[data-sidebar-toggle]').forEach(b => b.onclick = () => toggleSidebar());
  if (els.scrim) els.scrim.onclick = () => toggleSidebar(false);
  if (els.search) els.search.oninput = (e) => { state.searchQuery = e.target.value; render(); };
  if (els.sort) els.sort.onchange = (e) => { state.sortBy = e.target.value; render(); };
  root.querySelectorAll('[data-action="toggle-view"]').forEach(b => b.onclick = () => { state.layout = (state.layout === 'grid' ? 'list' : 'grid'); if (els.shell) els.shell.dataset.layout = state.layout; });
  root.querySelectorAll('[data-action="refresh"]').forEach(b => b.onclick = () => render());

  // --- Editor: tutup (draft disimpan dulu) ---
  root.querySelectorAll('[data-back]').forEach(b => b.onclick = () => closeEditor());
  if (els.editor.backdrop) els.editor.backdrop.onclick = function () {
    if (els.editor.noteMenu && !els.editor.noteMenu.hidden) { els.editor.noteMenu.hidden = true; return; }
    if (els.editor.formatMenu && !els.editor.formatMenu.hidden) { els.editor.formatMenu.hidden = true; return; }
    hideAllPopovers();
    closeEditor();
  };
  if (els.editor.saveRetry) els.editor.saveRetry.onclick = function () {
    flushAutosave();
    saveDraft();
  };

  // --- Editor: autosave + riwayat + tinggi otomatis ---
  function onEditorInput() {
    autosizeContent();
    scheduleHistoryPush();
    scheduleAutosave();
  }
  if (els.editor.title) els.editor.title.addEventListener('input', onEditorInput);
  if (els.editor.content) els.editor.content.addEventListener('input', onEditorInput);
  if (els.editor.undoBtn) els.editor.undoBtn.onclick = undoEditor;
  if (els.editor.redoBtn) els.editor.redoBtn.onclick = redoEditor;

  // --- Editor: shortcut keyboard ---
  if (catatanKeyHandler) document.removeEventListener('keydown', catatanKeyHandler);
  catatanKeyHandler = function (e) {
    if (e.key === 'Escape') { if (closeTopmost()) e.preventDefault(); return; }
    const open = els.editor.wrap && !els.editor.wrap.hidden;
    if (!open) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redoEditor(); else undoEditor(); return; }
    if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redoEditor(); return; }
    if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); applyFormat('bold'); return; }
    if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); applyFormat('italic'); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); closeEditor(); }
  };
  document.addEventListener('keydown', catatanKeyHandler);

  // --- Editor: format teks ---
  root.querySelectorAll('[data-action="format-menu"]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    if (!els.editor.formatMenu) return;
    const show = els.editor.formatMenu.hidden;
    closeNoteMenu();
    hideAllPopovers();
    els.editor.formatMenu.hidden = !show;
  });
  root.querySelectorAll('[data-format]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    applyFormat(b.dataset.format);
  });

  // --- Editor: pin ---
  if (els.editor.pinBtn) els.editor.pinBtn.onclick = () => {
    if (!state.selectedNote) return;
    const res = updateNote(state.selectedNote.id, { isPinned: !state.selectedNote.isPinned });
    if (!res.ok) return showSnackbar(res.error);
    state.selectedNote.isPinned = !state.selectedNote.isPinned;
    updateEditorPin(state.selectedNote.isPinned);
    showSnackbar(state.selectedNote.isPinned ? 'Disematkan.' : 'Semat dilepas.');
  };

  // --- Editor: arsip / pulihkan / hapus permanen ---
  if (els.editor.archiveBtn) els.editor.archiveBtn.onclick = () => {
    if (!state.selectedNote) return;
    const note = state.selectedNote;
    const toggled = !note.isArchived;
    const res = updateNote(note.id, { isArchived: toggled, isDeleted: false });
    if (!res.ok) return showSnackbar(res.error);
    showSnackbar(toggled ? 'Diarsipkan.' : 'Dikeluarkan dari arsip.', () => {
      updateNote(note.id, { isArchived: !toggled });
      render();
    });
    closeEditor(true);
  };
  if (els.editor.restoreBtn) els.editor.restoreBtn.onclick = () => {
    if (!state.selectedNote) return;
    restoreNote(state.selectedNote);
    closeEditor(true);
  };
  if (els.editor.deleteBtn) els.editor.deleteBtn.onclick = () => {
    if (state.selectedNote) openDeleteSheet(state.selectedNote);
  };

  // --- Editor: kolaborator (state lokal, belum ada backend) ---
  if (els.editor.collaboratorBtn) els.editor.collaboratorBtn.onclick = () => openCollaboratorSheet();
  if (els.collaboratorSheet) els.collaboratorSheet.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheets);

  // --- Editor: foto ---
  if (els.editor.photoBtn) els.editor.photoBtn.onclick = () => { if (els.editor.file) els.editor.file.click(); };
  if (els.editor.file) els.editor.file.onchange = () => readFileAsImage(els.editor.file, (data) => {
    if (!state.selectedNote) return;
    const res = updateNote(state.selectedNote.id, { image: data });
    if (!res.ok) return showSnackbar(res.error);
    state.selectedNote.image = data;
    if (els.editor.image) { els.editor.image.src = data; els.editor.image.hidden = false; }
    if (els.editor.removeBtn) els.editor.removeBtn.hidden = false;
    showEditedTime();
  });
  if (els.editor.removeBtn) els.editor.removeBtn.onclick = () => {
    if (!state.selectedNote) return;
    updateNote(state.selectedNote.id, { image: '' });
    state.selectedNote.image = '';
    if (els.editor.image) { els.editor.image.src = ''; els.editor.image.hidden = true; }
    if (els.editor.removeBtn) els.editor.removeBtn.hidden = true;
    showEditedTime();
  };

  // --- Popover warna ---
  function toggleColorPopover(anchor) {
    if (!els.popoverColor) return;
    if (els.popoverColor.hidden) {
      hideAllPopovers();
      if (els.editor.noteMenu) els.editor.noteMenu.hidden = true;
      if (els.editor.formatMenu) els.editor.formatMenu.hidden = true;
      placePopover(els.popoverColor, anchor);
    } else {
      hideColorPopover();
    }
  }
  function hideColorPopover() {
    if (els.popoverColor) els.popoverColor.hidden = true;
  }
  root.querySelectorAll('[data-action="color-popover"]').forEach(b => b.onclick = (e) => { e.stopPropagation(); toggleColorPopover(b); });
  if (els.popoverColor) els.popoverColor.querySelectorAll('.color-circle').forEach(c => c.onclick = () => {
    const color = c.dataset.color;
    if (state.selectedNote && state.selectedNote.id) {
      updateNote(state.selectedNote.id, { color: color });
      state.selectedNote.color = color;
      if (els.editor.wrap) els.editor.wrap.dataset.color = color;
      showEditedTime();
    }
    hideColorPopover();
  });

  // --- Menu editor (⋮): Label / Duplikasi / Hapus ke Sampah / Hapus Permanen ---
  root.querySelectorAll('[data-note-menu-btn]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    if (!els.editor.noteMenu) return;
    const show = els.editor.noteMenu.hidden;
    if (els.editor.formatMenu) els.editor.formatMenu.hidden = true;
    hideAllPopovers();
    els.editor.noteMenu.hidden = !show;
  });
  root.querySelectorAll('[data-note-action]').forEach(b => b.onclick = () => {
    if (!state.selectedNote) return;
    const note = state.selectedNote;
    closeNoteMenu();
    if (b.dataset.action === 'duplicate') duplicateNote(note);
    else if (b.dataset.action === 'trash') { trashNote(note); closeEditor(true); }
    else if (b.dataset.action === 'delete') openDeleteSheet(note);
  });

  render();
}

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.catatan = { init: initCatatanPage };
