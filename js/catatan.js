// js/catatan.js
const CATATAN_KEY = 'sh_mock_notes';
const CATATAN_MAX_IMAGE_BYTES = 300 * 1024;
const TITLE_MAX = 120;
const LABELS_KEY = 'sh_mock_labels';

function readNotes() {
  try {
    const raw = localStorage.getItem(CATATAN_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    // Migrasi catatan lama: flag sampah dulu bernama isTrashed.
    return data.map(function (n) {
      if (!n || typeof n !== 'object') return n;
      if (n.isDeleted === undefined) n.isDeleted = Boolean(n.isTrashed);
      if ('isTrashed' in n) delete n.isTrashed;
      if (!Array.isArray(n.collaborators)) n.collaborators = [];
      return n;
    });
  } catch (e) { return []; }
}

function persist(notes) {
  try {
    localStorage.setItem(CATATAN_KEY, JSON.stringify(notes));
  } catch (e) {}
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
  const newNote = {
    ...res.value,
    id: now + Math.floor(Math.random() * 1000),
    user_id: user.id,
    color: input.color || 'white',
    labels: Array.isArray(input.labels) ? input.labels : [],
    isPinned: Boolean(input.isPinned),
    isArchived: Boolean(input.isArchived),
    isDeleted: false,
    collaborators: Array.isArray(input.collaborators) ? input.collaborators : [],
    reminder: input.reminder || null,
    created_at: now,
    updated_at: now
  };
  notes.push(newNote);
  persist(notes);
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

  const nextArchived = input.isArchived !== undefined ? Boolean(input.isArchived) : Boolean(prev.isArchived);
  const nextDeleted = input.isDeleted !== undefined ? Boolean(input.isDeleted)
    : input.isTrashed !== undefined ? Boolean(input.isTrashed) : Boolean(prev.isDeleted);

  notes[idx] = {
    ...prev,
    ...res.value,
    color: input.color !== undefined ? input.color : prev.color,
    labels: Array.isArray(input.labels) ? input.labels : (prev.labels || []),
    collaborators: Array.isArray(input.collaborators) ? input.collaborators : (prev.collaborators || []),
    isPinned: input.isPinned !== undefined ? Boolean(input.isPinned) : prev.isPinned,
    // Arsip dan sampah saling eksklusif.
    isArchived: nextDeleted ? false : nextArchived,
    isDeleted: nextArchived ? false : nextDeleted,
    reminder: input.reminder !== undefined ? input.reminder : prev.reminder,
    updated_at: Date.now()
  };
  persist(notes);
  return { ok: true, note: notes[idx] };
}

function deleteNote(id) {
  const notes = readNotes();
  const idx = notes.findIndex(n => n.id === id);
  if (idx === -1) return { ok: false, error: 'Catatan tidak ditemukan.' };
  if (typeof can === 'function' && !can('catatan-ubah', notes[idx])) return { ok: false, error: 'Catatan tidak ditemukan.' };
  notes.splice(idx, 1);
  persist(notes);
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


let catatanDocClickHandler = null;

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
      title: root.querySelector('[data-note-title]'),
      content: root.querySelector('[data-note-content]'),
      image: root.querySelector('[data-note-image]'),
      file: root.querySelector('[data-note-file]'),
      photoBtn: root.querySelector('[data-note-photo]'),
      removeBtn: root.querySelector('[data-note-remove-photo]'),
      pinBtn: root.querySelector('[data-editor-pin]'),
      archiveBtn: root.querySelector('[data-editor-archive]'),
      status: root.querySelector('[data-status]'),
      statusBottom: root.querySelector('[data-status-bottom]'),
      error: root.querySelector('.note-editor-error')
    },
    popoverColor: root.querySelector('[data-popover-color]'),
    popoverLabel: root.querySelector('[data-popover-label]'),
    popoverReminder: root.querySelector('[data-popover-reminder]'),
    overlay: root.querySelector('[data-overlay]'),
    labelSheet: root.querySelector('[data-label-sheet]'),
    deleteSheet: root.querySelector('[data-delete-sheet]'),
    snackbar: { wrap: root.querySelector('[data-snackbar]'), text: root.querySelector('[data-snackbar-text]'), undo: root.querySelector('[data-snackbar-undo]') },
    snackbarTimeout: null
  };

  function render() {
    const all = listNotes();
    let filtered = [];
    if (state.view === 'catatan') filtered = all.filter(n => !n.isArchived && !n.isTrashed);
    else if (state.view === 'pengingat') filtered = all.filter(n => n.reminder && !n.isTrashed);
    else if (state.view === 'arsip') filtered = all.filter(n => n.isArchived && !n.isTrashed);
    else if (state.view === 'sampah') filtered = all.filter(n => n.isTrashed);
    else if (state.view.startsWith('label:')) {
      const lbl = state.view.replace('label:', '');
      filtered = all.filter(n => n.labels && n.labels.includes(lbl) && !n.isTrashed);
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
    card.innerHTML = `
      ${safeImage ? `<img src="${safeImage}" class="note-card-img" alt="">` : ''}
      <div class="note-card-title">${escapeHtml(note.title || '(Tanpa judul)')}</div>
      <div class="note-card-preview">${escapeHtml((note.content || '').substring(0, 160))}</div>
      <button class="icon-btn note-card-actions" type="button" data-card-pin title="Sematkan">📌</button>
      <div class="catatan-menu-wrap">
        <button class="icon-btn note-card-menu-btn" type="button" data-card-menu-btn title="Lainnya" aria-label="Lainnya">⋮</button>
        <div class="catatan-menu" data-card-menu hidden>
          <button class="catatan-menu-item" type="button" data-card-action="duplicate">Duplikasi</button>
          <button class="catatan-menu-item" type="button" data-card-action="trash">Hapus ke Sampah</button>
        </div>
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
        if (b.dataset.cardAction === 'duplicate') duplicateNote(note);
        else if (b.dataset.cardAction === 'trash') trashNote(note);
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
    const res = updateNote(note.id, { isTrashed: true });
    if (!res.ok) return showSnackbar(res.error);
    showSnackbar('Dipindahkan ke Sampah.', function () {
      updateNote(note.id, { isTrashed: false });
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

  let autosaveTimer = null;
  function setStatus(text) {
    if (els.editor.status) els.editor.status.textContent = text;
    if (els.editor.statusBottom) els.editor.statusBottom.textContent = text;
  }
  function scheduleAutosave() {
    if (!state.selectedNote) return;
    setStatus('Menyimpan…');
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
      const res = updateNote(state.selectedNote.id, {
        title: els.editor.title.value,
        content: els.editor.content.value,
        image: els.editor.image && !els.editor.image.hidden ? els.editor.image.src : ''
      });
      if (res.ok) setStatus('Tersimpan ✓');
      else { setStatus('Gagal menyimpan.'); if (els.editor.error) els.editor.error.textContent = res.error; }
    }, 700);
  }

  function openEditor(note) {
    state.selectedNote = note;
    if (els.shell) els.shell.dataset.mode = 'editor';
    if (els.editor.wrap) els.editor.wrap.hidden = false;
    if (els.editor.title) els.editor.title.value = note.title || '';
    if (els.editor.content) els.editor.content.value = note.content || '';
    if (els.editor.image) {
      els.editor.image.src = note.image || '';
      els.editor.image.hidden = !note.image;
    }
    if (els.editor.removeBtn) els.editor.removeBtn.hidden = !note.image;
    if (els.editor.wrap) els.editor.wrap.dataset.color = note.color || 'white';
    if (els.editor.error) els.editor.error.textContent = '';
    setStatus('Tersimpan ✓');
    updateEditorPin(note.isPinned);
    if (els.editor.title) els.editor.title.focus();
  }

  function updateEditorPin(pinned) {
    if (els.editor.pinBtn) els.editor.pinBtn.classList.toggle('is-active', Boolean(pinned));
    if (els.quick.pinBtn) els.quick.pinBtn.classList.toggle('is-active', state.quickPinned);
  }

  function closeEditor() {
    if (state.selectedNote) {
      const res = updateNote(state.selectedNote.id, {
        title: els.editor.title.value,
        content: els.editor.content.value,
        image: els.editor.image && !els.editor.image.hidden ? els.editor.image.src : ''
      });
      if (!res.ok) { if (els.editor.error) els.editor.error.textContent = res.error; return; }
    }
    clearTimeout(autosaveTimer);
    state.selectedNote = null;
    if (els.shell) els.shell.dataset.mode = 'grid';
    if (els.editor.wrap) els.editor.wrap.hidden = true;
    render();
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
  };
  document.addEventListener('click', catatanDocClickHandler);

  function togglePopover(pop, anchor) {
    if (!pop) return;
    if (pop.hidden) {
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 240)) + 'px';
      pop.style.top = (r.bottom + 6) + 'px';
      pop.hidden = false;
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
  root.querySelectorAll('[data-action="reminder-popover"]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    if (!els.popoverReminder || !state.selectedNote) return;
    const input = els.popoverReminder.querySelector('[data-popover-reminder-time]');
    if (input) input.value = state.selectedNote.reminder || '';
    togglePopover(els.popoverReminder, b);
  });
  if (els.popoverReminder) {
    const save = els.popoverReminder.querySelector('[data-action="save-reminder"]');
    const clr = els.popoverReminder.querySelector('[data-action="clear-reminder"]');
    if (save) save.onclick = function () {
      if (!state.selectedNote) return;
      const input = els.popoverReminder.querySelector('[data-popover-reminder-time]');
      const val = input ? input.value : '';
      const res = updateNote(state.selectedNote.id, { reminder: val || null });
      if (!res.ok) return showSnackbar(res.error);
      state.selectedNote.reminder = val || null;
      els.popoverReminder.hidden = true;
      showSnackbar(val ? 'Pengingat disetel.' : 'Pengingat dihapus.');
    };
    if (clr) clr.onclick = function () {
      if (!state.selectedNote) return;
      updateNote(state.selectedNote.id, { reminder: null });
      state.selectedNote.reminder = null;
      els.popoverReminder.hidden = true;
      showSnackbar('Pengingat dihapus.');
    };
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
      if (state.selectedNote && state.selectedNote.id === id) closeEditor();
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

  // --- Editor: kembali menyimpan ---
  root.querySelectorAll('[data-back]').forEach(b => b.onclick = closeEditor);

  // --- Editor: autosave ---
  if (els.editor.title) els.editor.title.addEventListener('input', scheduleAutosave);
  if (els.editor.content) els.editor.content.addEventListener('input', scheduleAutosave);

  // --- Editor: pin ---
  if (els.editor.pinBtn) els.editor.pinBtn.onclick = () => {
    if (!state.selectedNote) return;
    const res = updateNote(state.selectedNote.id, { isPinned: !state.selectedNote.isPinned });
    if (!res.ok) return showSnackbar(res.error);
    state.selectedNote.isPinned = !state.selectedNote.isPinned;
    updateEditorPin(state.selectedNote.isPinned);
    showSnackbar(state.selectedNote.isPinned ? 'Disematkan.' : 'Semat dilepas.');
  };

  // --- Editor: arsip ---
  if (els.editor.archiveBtn) els.editor.archiveBtn.onclick = () => {
    if (!state.selectedNote) return;
    const note = state.selectedNote;
    const toggled = !note.isArchived;
    updateNote(note.id, { isArchived: toggled });
    showSnackbar(toggled ? 'Diarsipkan.' : 'Dikeluarkan dari arsip.', () => {
      updateNote(note.id, { isArchived: !toggled });
      render();
    });
    closeEditor();
  };

  // --- Editor: foto ---
  if (els.editor.photoBtn) els.editor.photoBtn.onclick = () => { if (els.editor.file) els.editor.file.click(); };
  if (els.editor.file) els.editor.file.onchange = () => readFileAsImage(els.editor.file, (data) => {
    if (!state.selectedNote) return;
    const res = updateNote(state.selectedNote.id, { image: data });
    if (!res.ok) return showSnackbar(res.error);
    state.selectedNote.image = data;
    if (els.editor.image) { els.editor.image.src = data; els.editor.image.hidden = false; }
    if (els.editor.removeBtn) els.editor.removeBtn.hidden = false;
    setStatus('Tersimpan ✓');
  });
  if (els.editor.removeBtn) els.editor.removeBtn.onclick = () => {
    if (!state.selectedNote) return;
    updateNote(state.selectedNote.id, { image: '' });
    state.selectedNote.image = '';
    if (els.editor.image) { els.editor.image.src = ''; els.editor.image.hidden = true; }
    if (els.editor.removeBtn) els.editor.removeBtn.hidden = true;
    setStatus('Tersimpan ✓');
  };

  // --- Popover warna ---
  function toggleColorPopover(anchor) {
    if (!els.popoverColor) return;
    if (els.popoverColor.hidden) {
      const r = anchor.getBoundingClientRect();
      els.popoverColor.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 240)) + 'px';
      els.popoverColor.style.top = (r.bottom + 6) + 'px';
      els.popoverColor.hidden = false;
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
      setStatus('Tersimpan ✓');
    }
    hideColorPopover();
  });

  // --- Menu editor (⋮): Duplikasi / Hapus ke Sampah / Hapus Permanen ---
  root.querySelectorAll('[data-note-menu-btn]').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const m = root.querySelector('[data-note-menu]');
    if (m) m.hidden = !m.hidden;
  });
  root.querySelectorAll('[data-note-action]').forEach(b => b.onclick = () => {
    if (!state.selectedNote) return;
    const note = state.selectedNote;
    closeNoteMenu();
    if (b.dataset.action === 'duplicate') duplicateNote(note);
    else if (b.dataset.action === 'trash') { trashNote(note); closeEditor(); }
    else if (b.dataset.action === 'delete') openDeleteSheet(note);
  });

  render();
}

window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
window.STUDENTHUB_PAGES.catatan = { init: initCatatanPage };
