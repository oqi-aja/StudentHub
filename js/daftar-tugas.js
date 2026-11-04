// js/daftar-tugas.js
// Halaman Daftar Tugas — UX ala Google Classroom.
//
// Fitur:
//   - Card tugas: status badge, file submitted info, tombol Kumpulkan/Lihat File/Unggah Ulang, materi icons
//   - Grouping per topik (collapsible)
//   - Mahasiswa: "Kumpulkan Tugas" langsung dari card (tanpa perlu Buka Folder)
//   - PJ/Admin: counter "X/Y sudah submit" + sheet List Mahasiswa + sheet Status Matrix
//   - Form tambah/edit: Topik + Lampiran materi
//   - Lampiran materi: dosen/PJ bisa attach file materi ke task

(function () {
  'use strict';

  // ---------- State ----------

  let data = null;
  let toastTimer = null;

  // Filter & search state
  let searchQuery = '';
  let statusFilter = '';
  let courseFilter = '';

  // Sheet state
  let editingTaskId = null;
  let editingAttachments = []; // materi yang sudah ada (untuk edit existing task)
  let pendingSubmitTaskId = null; // task ID untuk student submit via "Kumpulkan Tugas"
  let lastStudentsTaskId = null;
  let lastStudentsStats = null;
  let lastMatrixData = null;

  // ---------- Helpers ----------

  function escape(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  function formatDate(iso) {
    if (!iso) return '-';
    const parts = String(iso).slice(0, 10).split('-');
    if (parts.length !== 3) return String(iso);
    return Number(parts[2]) + ' ' + BULAN[Number(parts[1]) - 1] + ' ' + parts[0];
  }

  function formatDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear()
      + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function daysUntil(iso) {
    if (!iso) return null;
    const target = new Date(String(iso).slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(target.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  function showToast(text) {
    const el = document.querySelector('#page-daftar [data-toast]');
    if (!el) return;
    el.textContent = text;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
  }

  // ---------- CSV Export Helpers ----------

  function csvEscapeCell(cell) {
    if (cell == null) return '""';
    const str = String(cell);
    return '"' + str.replace(/"/g, '""') + '"';
  }

  function exportTaskSubmissionsToCSV(task, students, files) {
    const header = ['No', 'Nama Mahasiswa', 'Status', 'File Terlampir', 'Waktu Pengumpulan'];
    const rows = [header.map(csvEscapeCell).join(',')];

    (students || []).forEach((s, idx) => {
      const file = s.submission
        ? ((files || []).find((f) => String(f.id) === String(s.submission.file_id)) || null)
        : null;
      const statusText = s.status === 'sudah' ? 'Sudah' : (s.status === 'terlambat' ? 'Terlambat' : 'Belum');
      const timeText = s.submission
        ? (formatDateTime(s.submission.updated_at || s.submission.submitted_at))
        : '-';

      const row = [
        idx + 1,
        s.profile ? s.profile.name : '-',
        statusText,
        file ? file.name : '-',
        timeText,
      ];
      rows.push(row.map(csvEscapeCell).join(','));
    });

    return '\uFEFF' + rows.join('\r\n');
  }

  function exportMatrixToCSV(courseName, tasks, students, matrix) {
    const taskTitles = (tasks || []).map((t) => t.title || 'Tugas');
    const header = ['No', 'Nama Mahasiswa', ...taskTitles, 'Total Tugas', 'Sudah Kumpul', 'Belum Kumpul', 'Persentase'];
    const rows = [header.map(csvEscapeCell).join(',')];

    const totalTasks = (tasks || []).length;

    (students || []).forEach((s, idx) => {
      const sid = String(s.id);
      let doneCount = 0;

      const taskCells = (tasks || []).map((t) => {
        const tid = String(t.id);
        const st = matrix && matrix[sid] && matrix[sid][tid];
        if (st === 'sudah' || st === 'terlambat') {
          doneCount++;
          return st === 'sudah' ? 'Sudah' : 'Terlambat';
        }
        return 'Belum';
      });

      const notDoneCount = totalTasks - doneCount;
      const pct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) + '%' : '0%';

      const row = [
        idx + 1,
        s.name,
        ...taskCells,
        totalTasks,
        doneCount,
        notDoneCount,
        pct,
      ];
      rows.push(row.map(csvEscapeCell).join(','));
    });

    return '\uFEFF' + rows.join('\r\n');
  }

  function triggerDownloadCSV(filename, csvString) {
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Course / Folder helpers ----------

  function courseName(courseId) {
    const c = (data.courses || []).find((c) => String(c.id) === String(courseId));
    return c ? c.name : '-';
  }

  function folderName(folderId) {
    const f = (data.folders || []).find((f) => String(f.id) === String(folderId));
    return f ? f.name : '-';
  }

  function folderPath(folderId) {
    if (window.SH_API) return window.SH_API.folderLocation(folderId);
    return folderName(folderId);
  }

  // ---------- Status logic ----------

  function getTaskStatusForStudent(task, studentId) {
    if (!data || !task) return { state: 'belum', submission: null, daysLeft: null };
    const sub = (data.task_submissions || []).find(
      (s) => String(s.task_id) === String(task.id) && String(s.student_id) === String(studentId),
    );
    const daysLeft = daysUntil(task.deadline);
    if (sub) {
      return { state: 'sudah', submission: sub, daysLeft };
    }
    if (daysLeft !== null && daysLeft < 0) {
      return { state: 'terlambat', submission: null, daysLeft };
    }
    return { state: 'belum', submission: null, daysLeft };
  }

  function statusBadge(status) {
    if (status.state === 'sudah') {
      return '<span class="badge badge--success"> Sudah dikumpulkan</span>';
    }
    if (status.state === 'terlambat') {
      return '<span class="badge badge--danger"> Terlambat ' + Math.abs(status.daysLeft) + ' hari</span>';
    }
    return '<span class="badge badge--warning"> Belum dikumpulkan</span>';
  }

  // ---------- Find submitted file info ----------

  function findSubmissionFile(task, studentId) {
    const sub = (data.task_submissions || []).find(
      (s) => String(s.task_id) === String(task.id) && String(s.student_id) === String(studentId),
    );
    if (!sub) return null;
    const file = (data.files || []).find((f) => String(f.id) === String(sub.file_id));
    return file ? { file, submission: sub } : null;
  }

  // ---------- Attachment materi render ----------

  function renderAttachments(attachments) {
    const arr = Array.isArray(attachments) ? attachments : [];
    if (!arr.length) return '';
    return '<div class="task-card-materi">'
      + '<span class="list-item-subtitle"> Materi:</span>'
      + '<div class="materi-list">'
      + arr.map((a) => '<span class="materi-chip" title="' + escape(a.file_type) + '">'
        + fileIcon(a.name, a.file_type) + ' '
        + '<span class="materi-name">' + escape(a.name) + '</span>'
        + '</span>').join('')
      + '</div></div>';
  }

  function fileIcon(name, type) {
    const ext = (String(name || '').split('.').pop() || '').toLowerCase();
    if (['zip', 'rar', '7z'].includes(ext)) return '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return '️';
    if (['doc', 'docx', 'odt'].includes(ext)) return '';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '';
    if (['ppt', 'pptx'].includes(ext)) return '️';
    if (['pdf'].includes(ext)) return '';
    if (['mp3', 'wav'].includes(ext)) return '';
    if (['mp4', 'mkv', 'mov'].includes(ext)) return '';
    if (['txt', 'md'].includes(ext)) return '';
    return '';
  }

  // ---------- Filtering ----------

  function getVisibleTasks() {
    if (!data) return [];
    const me = getCurrentUser();
    let tasks = (data.tasks || []).slice();

    if (me && me.role === 'pj') {
      tasks = tasks.filter((t) => String(t.course_id) === String(me.course_id));
    }

    if (courseFilter) {
      tasks = tasks.filter((t) => String(t.course_id) === String(courseFilter));
    }

    if (me && me.role === 'student' && statusFilter) {
      tasks = tasks.filter((t) => {
        const st = getTaskStatusForStudent(t, me.id);
        return st.state === statusFilter;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      tasks = tasks.filter((t) => {
        const course = courseName(t.course_id);
        return (t.title || '').toLowerCase().includes(q)
          || (t.description || '').toLowerCase().includes(q)
          || (t.dosen || '').toLowerCase().includes(q)
          || (t.topic || '').toLowerCase().includes(q)
          || course.toLowerCase().includes(q);
      });
    }

    tasks.sort((a, b) => String(a.deadline || '').localeCompare(String(b.deadline || '')));
    return tasks;
  }

  // ---------- Grouping per topic ----------

  function groupByTopic(tasks) {
    const groups = new Map(); // topic -> [tasks]
    const orderedTopicKeys = [];
    tasks.forEach((t) => {
      const key = t.topic || 'Umum';
      if (!groups.has(key)) {
        groups.set(key, []);
        orderedTopicKeys.push(key);
      }
      groups.get(key).push(t);
    });
    return orderedTopicKeys.map((key) => ({ topic: key, tasks: groups.get(key) }));
  }

  // ---------- Render ----------

  function render() {
    if (!data) return;
    const root = document.getElementById('page-daftar');
    if (!root) return;

    const me = getCurrentUser();
    const canManage = me && (me.role === 'admin' || me.role === 'pj');
    const isMahasiswa = me && me.role === 'student';

    // Toggle visibility tombol "+ Tambah" + "Status Mahasiswa"
    const addBtn = root.querySelector('[data-open]');
    if (addBtn) addBtn.hidden = !canManage;
    const matrixBtn = root.querySelector('[data-open-matrix]');
    if (matrixBtn) matrixBtn.hidden = !canManage;

    // Populate filter course
    const courseSel = root.querySelector('[data-filter-course]');
    if (courseSel) {
      const courses = me.role === 'pj'
        ? (data.courses || []).filter((c) => String(c.id) === String(me.course_id))
        : (data.courses || []);
      const optionsHtml = '<option value="">Semua mata kuliah</option>'
        + courses.map((c) => '<option value="' + c.id + '">' + escape(c.name) + '</option>').join('');
      if (courseSel.innerHTML !== optionsHtml) courseSel.innerHTML = optionsHtml;
      if (me.role === 'pj' && !courseSel.disabled) {
        courseSel.value = String(me.course_id);
        courseSel.disabled = true;
      }
    }

    const tasks = getVisibleTasks();
    const listEl = root.querySelector('[data-list]');
    if (!listEl) return;

    // Update counter
    const countEl = root.querySelector('[data-count]');
    if (countEl) {
      countEl.textContent = tasks.length + ' tugas'
        + (me && me.role === 'pj' ? ' (mata kuliah Anda)' : '');
    }

    if (tasks.length === 0) {
      listEl.innerHTML = '<p class="card-meta">Belum ada tugas yang cocok.</p>';
      return;
    }

    // Group by topic, render as collapsible <details>
    const groups = groupByTopic(tasks);
    listEl.innerHTML = groups.map((g) => renderTopicGroup(g, me)).join('');
  }

  function renderTopicGroup(group, me) {
    const topicLabel = group.topic === 'Umum' ? ' Umum' : ' ' + escape(group.topic);
    return '<details class="topic-group" open>'
      + '<summary class="topic-group-summary">'
        + '<span class="topic-group-label">' + topicLabel + '</span>'
        + '<span class="topic-group-count">' + group.tasks.length + ' tugas</span>'
      + '</summary>'
      + '<div class="topic-group-body">'
        + group.tasks.map((t) => renderTaskCard(t, me)).join('')
      + '</div>'
    + '</details>';
  }

  function renderTaskCard(t, me) {
    const course = courseName(t.course_id);
    const isMahasiswa = me && me.role === 'student';
    const canEdit = me && (me.role === 'admin' || (me.role === 'pj' && String(me.course_id) === String(t.course_id)));
    const isPjOrAdmin = me && (me.role === 'admin' || me.role === 'pj');

    let status = null;
    let submittedFile = null;
    if (isMahasiswa) {
      status = getTaskStatusForStudent(t, me.id);
      submittedFile = findSubmissionFile(t, me.id);
    }

    // ----- Action buttons -----
    let actionButtons = '';
    if (isMahasiswa) {
      actionButtons = '<div class="task-card-actions">'
        + '<a class="button button--ghost button--sm" href="#detail-tugas?id=' + Number(t.id) + '"> Detail</a>';
      if (status && status.state === 'sudah') {
        // Already submitted — show file info + Lihat File + Unggah Ulang
        actionButtons += '<button class="button button--ghost button--sm" type="button" data-lihat-file="' + Number(t.id) + '">️ Lihat File</button>'
          + '<button class="button button--ghost button--sm" type="button" data-unggah-ulang="' + Number(t.id) + '">↻ Unggah Ulang</button>';
      } else {
        // Not submitted — Kumpulkan Tugas + Buka Folder
        actionButtons += '<button class="button button--sm" type="button" data-kumpulkan="' + Number(t.id) + '"> Kumpulkan Tugas</button>';
      }
      actionButtons += '<a class="button button--ghost button--sm" href="#tugas?folder=' + Number(t.submission_folder_id) + '"> Buka Folder</a>'
        + '</div>';
    } else if (canEdit) {
      actionButtons = '<div class="task-card-actions">'
        + '<a class="button button--ghost button--sm" href="#detail-tugas?id=' + Number(t.id) + '"> Detail</a>'
        + '<button class="button button--ghost button--sm" type="button" data-edit="' + Number(t.id) + '">✎ Edit</button>'
        + '<button class="button button--ghost button--sm" type="button" data-delete="' + Number(t.id) + '" aria-label="Hapus"></button>'
        + '<a class="button button--ghost button--sm" href="#tugas?folder=' + Number(t.submission_folder_id) + '"> Buka Folder</a>'
        + '</div>';
    } else if (me && me.role === 'pj') {
      actionButtons = '<div class="task-card-actions">'
        + '<a class="button button--ghost button--sm" href="#detail-tugas?id=' + Number(t.id) + '"> Detail</a>'
        + '<span class="card-meta">read-only</span>'
        + '</div>';
    }

    // ----- Submitted file info (mahasiswa only) -----
    let submittedFileInfo = '';
    if (isMahasiswa && submittedFile) {
      submittedFileInfo = '<div class="task-card-submitted">'
        + '<span class="list-item-subtitle"> File terkumpul:</span>'
        + '<div class="submitted-file-row">'
          + '<span class="submitted-file-name">' + fileIcon(submittedFile.file.name, submittedFile.file.file_type) + ' ' + escape(submittedFile.file.name) + '</span>'
          + '<span class="submitted-file-time">' + escape(formatDateTime(submittedFile.submission.updated_at || submittedFile.submission.submitted_at)) + '</span>'
        + '</div></div>';
    }

    // ----- Materi (attachments dari dosen/PJ) -----
    const materiHtml = renderAttachments(t.attachments);

    // ----- PJ/Admin counter + Lihat List Mahasiswa button -----
    let pjCounter = '';
    if (isPjOrAdmin && canEdit) {
      pjCounter = '<div class="task-card-pj-counter" data-pj-counter="' + Number(t.id) + '">'
        + '<span class="card-meta"> Memuat status...</span>'
        + '</div>';
    }

    return '<article class="task-card">'
      + '<div class="task-card-main">'
        + '<h3 class="task-card-title">' + escape(t.title) + '</h3>'
        + '<div class="task-card-meta">'
          + '<span> ' + escape(course) + '</span>'
          + '<span> ' + escape(t.dosen || '-') + '</span>'
          + '<span> ' + escape(formatDate(t.deadline)) + '</span>'
          + (t.topic ? '<span> ' + escape(t.topic) + '</span>' : '')
        + '</div>'
        + (t.description ? '<p class="task-card-desc">' + escape(t.description) + '</p>' : '')
        + materiHtml
        + submittedFileInfo
        + pjCounter
        + '<div class="task-card-folder">'
          + '<span class="list-item-subtitle"> Dikumpulkan di:</span>'
          + '<span class="task-card-folder-path">' + escape(folderPath(t.submission_folder_id)) + '</span>'
        + '</div>'
      + '</div>'
      + '<div class="task-card-side">'
        + (isMahasiswa && status ? statusBadge(status) : '')
        + (isPjOrAdmin ? '<span class="badge badge--info">' + (canEdit ? '✎ Kelola' : '️ Lihat') + '</span>' : '')
        + actionButtons
      + '</div>'
    + '</article>';
  }

  // ---------- Sheet: Form Tambah/Edit Tugas ----------

  function openForm(task) {
    const root = document.getElementById('page-daftar');
    if (!root) return;
    const me = getCurrentUser();
    if (!me || !(me.role === 'admin' || me.role === 'pj')) return;

    editingTaskId = task ? task.id : null;
    editingAttachments = task && Array.isArray(task.attachments) ? task.slice() : [];
    const sheet = root.querySelector('[data-sheet]');
    const form = root.querySelector('[data-form]');
    const titleEl = root.querySelector('[data-sheet-title]');
    const errorEl = root.querySelector('[data-error]');

    titleEl.textContent = task ? 'Ubah Tugas' : 'Tambah Tugas';
    errorEl.textContent = '';
    form.reset();

    // Populate course select (PJ: lock ke course sendiri)
    const courseSel = form.elements.course_id;
    const courses = (data.courses || []);
    courseSel.innerHTML = '<option value="">Pilih mata kuliah</option>'
      + courses.map((c) => '<option value="' + c.id + '">' + escape(c.name) + '</option>').join('');
    if (me.role === 'pj') {
      courseSel.value = String(me.course_id);
      courseSel.disabled = true;
    } else {
      courseSel.disabled = false;
    }

    if (task) {
      form.elements.title.value = task.title || '';
      form.elements.dosen.value = task.dosen || '';
      form.elements.deadline.value = task.deadline || '';
      form.elements.description.value = task.description || '';
      form.elements.topic.value = task.topic || '';
      courseSel.value = String(task.course_id);
      renderFolderPicker(task.submission_folder_id);
      renderAttachmentList();
    } else {
      renderFolderPicker(null);
      renderAttachmentList();
    }

    // Materi button visible hanya saat editing existing task (attachment upload butuh task ID)
    const addMateriBtn = root.querySelector('[data-add-materi]');
    if (addMateriBtn) addMateriBtn.hidden = !task;

    root.querySelector('[data-overlay]').hidden = false;
    sheet.hidden = false;
    document.body.classList.add('is-locked');
    form.elements.title.focus();
  }

  function closeForm() {
    const root = document.getElementById('page-daftar');
    if (!root) return;
    root.querySelector('[data-overlay]').hidden = true;
    root.querySelector('[data-sheet]').hidden = true;
    document.body.classList.remove('is-locked');
    editingTaskId = null;
    editingAttachments = [];
  }

  function showError(msg) {
    const el = document.querySelector('#page-daftar [data-error]');
    if (el) el.textContent = msg;
  }

  function renderAttachmentList() {
    const root = document.getElementById('page-daftar');
    if (!root) return;
    const container = root.querySelector('[data-attachment-list]');
    if (!container) return;
    if (!editingAttachments.length) {
      container.innerHTML = '<p class="card-meta">Belum ada materi.</p>';
      return;
    }
    container.innerHTML = editingAttachments.map((a, i) => {
      return '<div class="attachment-row">'
        + '<span class="attachment-icon">' + fileIcon(a.name, a.file_type) + '</span>'
        + '<span class="attachment-name">' + escape(a.name) + '</span>'
        + '<button class="icon-btn" type="button" data-remove-materi="' + i + '" aria-label="Hapus materi">✕</button>'
        + '</div>';
    }).join('');
  }

  // ---------- Folder picker (tree) ----------

  function renderFolderPicker(selectedFolderId) {
    const container = document.querySelector('#page-daftar [data-folder-picker]');
    if (!container) return;

    const folders = (data.folders || []);
    const childrenMap = {};
    folders.forEach((f) => {
      const pid = f.parent_id == null ? 'root' : f.parent_id;
      (childrenMap[pid] = childrenMap[pid] || []).push(f);
    });

    function renderNode(folder, depth) {
      const isSel = String(selectedFolderId) === String(folder.id);
      const indent = 'margin-left:' + (depth * 1.2) + 'rem;';
      const childHtml = (childrenMap[folder.id] || [])
        .map((c) => renderNode(c, depth + 1)).join('');
      return '<div class="folder-picker-node">'
        + '<label class="folder-picker-row' + (isSel ? ' is-selected' : '') + '" style="' + indent + '">'
          + '<input type="radio" name="submission_folder_id" value="' + folder.id + '" ' + (isSel ? 'checked' : '') + '>'
          + '<span class="folder-picker-icon">' + (depth === 0 ? '' : '') + '</span>'
          + '<span class="folder-picker-name">' + escape(folder.name) + '</span>'
        + '</label>'
        + childHtml
      + '</div>';
    }

    const roots = childrenMap['root'] || [];
    container.innerHTML = roots.map((f) => renderNode(f, 0)).join('')
      + '<p class="fm-hint">Pilih folder tempat mahasiswa mengumpulkan tugas. Relasi disimpan berdasarkan ID, jadi kalau folder di-rename, tugas tetap menunjuk ke folder yang sama.</p>';
  }

  // ---------- Save ----------

  async function saveTask() {
    const form = document.querySelector('#page-daftar [data-form]');
    const fd = new FormData(form);
    const input = {
      title: fd.get('title'),
      course_id: fd.get('course_id'),
      dosen: fd.get('dosen'),
      deadline: fd.get('deadline'),
      submission_folder_id: fd.get('submission_folder_id'),
      description: fd.get('description'),
      topic: fd.get('topic'),
      attachments: editingAttachments,
    };

    const api = window.SH_API;
    if (!api) return;

    const saveBtn = document.querySelector('#page-daftar [data-save]');
    if (saveBtn) saveBtn.disabled = true;

    try {
      const res = editingTaskId === null
        ? await api.createTask(input)
        : await api.updateTask(editingTaskId, input);

      if (!res.ok) {
        showError(res.error);
        return;
      }

      const fresh = await api.loadAll();
      data = fresh;

      closeForm();
      render();
      showToast(editingTaskId === null ? '✓ Tugas dibuat.' : '✓ Tugas diperbarui.');
      // Refresh PJ counters
      loadPjCounters();
    } catch (e) {
      showError('Gagal menyimpan: ' + (e && e.message ? e.message : 'unknown error'));
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function deleteTask(id) {
    const api = window.SH_API;
    if (!api) return;
    const t = await api.findTask(id);
    if (!t) return;
    if (!window.confirm('Hapus tugas "' + t.title + '"? Submission terkait juga akan dihapus.')) return;
    try {
      const res = await api.deleteTask(id);
      if (!res.ok) {
        showToast(res.error);
        return;
      }
      const fresh = await api.loadAll();
      data = fresh;
      render();
      showToast('✓ Tugas dihapus.');
    } catch (e) {
      showToast('Gagal menghapus: ' + (e && e.message ? e.message : 'unknown error'));
    }
  }

  // ---------- Mahasiswa: Kumpulkan Tugas ----------

  function onKumpulkanClick(taskId) {
    pendingSubmitTaskId = taskId;
    const input = document.getElementById('dt-submit-input');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async function onSubmitFilePicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file || !pendingSubmitTaskId) return;
    e.target.value = '';
    const taskId = pendingSubmitTaskId;
    pendingSubmitTaskId = null;

    const api = window.SH_API;
    if (!api) return;

    showToast(' Mengunggah...');
    try {
      const res = await api.submitTaskFile(taskId, file);
      if (!res.ok) {
        showToast('Gagal: ' + res.error);
        return;
      }
      // Reload data + render
      const fresh = await api.loadAll();
      data = fresh;
      render();
      showToast('✓ Tugas "' + res.task.title + '" berhasil dikumpulkan!');
    } catch (e) {
      showToast('Gagal upload: ' + (e && e.message ? e.message : 'unknown error'));
    }
  }

  // Unggah ulang = same as kumpulkan (api.submitTaskFile sudah upsert)
  function onUnggahUlangClick(taskId) {
    pendingSubmitTaskId = taskId;
    const input = document.getElementById('dt-submit-input');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  // ---------- Lihat File (download) ----------

  async function onLihatFileClick(fileId) {
    const api = window.SH_API;
    if (!api) return;
    // Cari file metadata di cache
    const file = (data.files || []).find((f) => String(f.id) === String(fileId));
    if (!file) {
      showToast('File tidak ditemukan.');
      return;
    }
    if (api.isSupabase && api.isSupabase()) {
      try {
        const url = await api.getFileDownloadUrl(fileId);
        if (url) {
          window.open(url, '_blank');
          return;
        }
        showToast('Gagal membuat URL download.');
      } catch (e) {
        showToast('Gagal: ' + (e && e.message ? e.message : 'unknown'));
      }
      return;
    }
    // Mock mode: tidak ada URL nyata — tampilkan info di toast
    showToast(' ' + file.name + ' · ' + (file.file_type || 'unknown') + ' · ' + (file.size ? Math.round(file.size / 1024) + ' KB' : '-'));
  }

  // ---------- Materi upload (admin/PJ) ----------

  function onAddMateriClick() {
    if (!editingTaskId) {
      showToast('Simpan tugas dulu sebelum menambah materi.');
      return;
    }
    const input = document.getElementById('dt-materi-input');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async function onMateriFilePicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file || !editingTaskId) return;
    e.target.value = '';
    const api = window.SH_API;
    if (!api) return;

    showToast(' Mengunggah materi...');
    try {
      const res = await api.attachMateriToTask(editingTaskId, file);
      if (!res.ok) {
        showToast('Gagal: ' + res.error);
        return;
      }
      editingAttachments = Array.isArray(res.task.attachments) ? res.task.attachments.slice() : [];
      renderAttachmentList();
      // Reload cache supaya card menampilkan materi baru saat render
      const fresh = await api.loadAll();
      data = fresh;
      showToast('✓ Materi ditambahkan.');
    } catch (e) {
      showToast('Gagal: ' + (e && e.message ? e.message : 'unknown'));
    }
  }

  async function onRemoveMateriClick(index) {
    if (!editingTaskId) return;
    const api = window.SH_API;
    if (!api) return;
    if (!window.confirm('Hapus materi ini?')) return;
    try {
      const res = await api.detachMateriFromTask(editingTaskId, index);
      if (!res.ok) {
        showToast('Gagal: ' + res.error);
        return;
      }
      editingAttachments = Array.isArray(res.task.attachments) ? res.task.attachments.slice() : [];
      renderAttachmentList();
      const fresh = await api.loadAll();
      data = fresh;
      showToast('✓ Materi dihapus.');
    } catch (e) {
      showToast('Gagal: ' + (e && e.message ? e.message : 'unknown'));
    }
  }

  // ---------- PJ/Admin: Counter "X/Y submit" per card ----------

  async function loadPjCounters() {
    const root = document.getElementById('page-daftar');
    if (!root) return;
    const me = getCurrentUser();
    if (!me || !(me.role === 'admin' || me.role === 'pj')) return;
    const api = window.SH_API;
    if (!api) return;

    const counters = root.querySelectorAll('[data-pj-counter]');
    for (const el of counters) {
      const taskId = el.dataset.pjCounter;
      try {
        const stats = await api.getTaskSubmissionStats(taskId);
        const total = stats.total_students;
        const submitted = stats.submitted;
        const late = stats.late;
        const notSub = stats.not_submitted;
        el.innerHTML = '<span class="badge badge--info"> ' + submitted + '/' + total + ' sudah submit</span>'
          + (late > 0 ? ' <span class="badge badge--danger">' + late + ' terlambat</span>' : '')
          + (notSub > 0 ? ' <span class="badge badge--warning">' + notSub + ' belum</span>' : '')
          + ' <button class="button button--ghost button--sm" type="button" data-list-mahasiswa="' + Number(taskId) + '"> List</button>';
      } catch (e) {
        el.innerHTML = '<span class="card-meta">Gagal memuat</span>';
      }
    }
  }

  // ---------- Sheet: List Mahasiswa ----------

  async function openStudentsSheet(taskId) {
    const root = document.getElementById('page-daftar');
    if (!root) return;
    const api = window.SH_API;
    if (!api) return;

    const sheet = root.querySelector('[data-sheet-students]');
    const titleEl = root.querySelector('[data-students-title]');
    const summaryEl = root.querySelector('[data-students-summary]');
    const listEl = root.querySelector('[data-students-list]');

    titleEl.textContent = 'Status Pengumpulan';
    summaryEl.innerHTML = '<p class="card-meta"> Memuat...</p>';
    listEl.innerHTML = '';
    root.querySelector('[data-overlay]').hidden = false;
    sheet.hidden = false;
    document.body.classList.add('is-locked');

    try {
      const stats = await api.getTaskSubmissionStats(taskId);
      lastStudentsTaskId = taskId;
      lastStudentsStats = stats;
      const task = (data.tasks || []).find((t) => String(t.id) === String(taskId));
      titleEl.textContent = task ? 'Status: ' + task.title : 'Status Pengumpulan';
      summaryEl.innerHTML = ''
        + '<div class="students-summary">'
          + '<span class="badge badge--success">' + stats.submitted + ' sudah</span>'
          + '<span class="badge badge--warning">' + stats.not_submitted + ' belum</span>'
          + (stats.late > 0 ? '<span class="badge badge--danger">' + stats.late + ' terlambat</span>' : '')
          + '<span class="card-meta">Total: ' + stats.total_students + ' mahasiswa</span>'
        + '</div>';

      if (!stats.students.length) {
        listEl.innerHTML = '<p class="card-meta">Belum ada mahasiswa terdaftar.</p>';
        return;
      }

      listEl.innerHTML = '<table class="students-table"><thead><tr>'
        + '<th>#</th><th>Nama</th><th>Status</th><th>File</th><th>Waktu</th>'
        + '</tr></thead><tbody>'
        + stats.students.map((s, i) => {
          const file = s.submission
            ? ((data.files || []).find((f) => String(f.id) === String(s.submission.file_id)) || null)
            : null;
          const badge = s.status === 'sudah' ? ' Sudah' : (s.status === 'terlambat' ? ' Terlambat' : ' Belum');
          return '<tr>'
            + '<td>' + (i + 1) + '</td>'
            + '<td>' + escape(s.profile.name) + '</td>'
            + '<td>' + badge + '</td>'
            + '<td>' + (file ? escape(file.name) : '-') + '</td>'
            + '<td>' + (s.submission ? escape(formatDateTime(s.submission.updated_at || s.submission.submitted_at)) : '-') + '</td>'
          + '</tr>';
        }).join('')
        + '</tbody></table>';
    } catch (e) {
      summaryEl.innerHTML = '<p class="card-meta">Gagal memuat: ' + (e && e.message ? e.message : 'unknown') + '</p>';
    }
  }

  function closeStudentsSheet() {
    const root = document.getElementById('page-daftar');
    if (!root) return;
    root.querySelector('[data-sheet-students]').hidden = true;
    // Overlay tetap hidden kalau tidak ada sheet lain yang aktif
    const formSheet = root.querySelector('[data-sheet]');
    const matrixSheet = root.querySelector('[data-sheet-matrix]');
    if (formSheet.hidden && matrixSheet.hidden) {
      root.querySelector('[data-overlay]').hidden = true;
      document.body.classList.remove('is-locked');
    }
  }

  // ---------- Sheet: Status Matrix ----------

  async function openMatrixSheet() {
    const root = document.getElementById('page-daftar');
    if (!root) return;
    const api = window.SH_API;
    if (!api) return;
    const me = getCurrentUser();
    if (!me || !(me.role === 'admin' || me.role === 'pj')) return;

    const sheet = root.querySelector('[data-sheet-matrix]');
    const wrap = root.querySelector('[data-matrix-wrap]');
    wrap.innerHTML = '<p class="card-meta"> Memuat...</p>';
    root.querySelector('[data-overlay]').hidden = false;
    sheet.hidden = false;
    document.body.classList.add('is-locked');

    // PJ: matrix untuk course sendiri; admin: pakai courseFilter (atau course pertama kalau kosong)
    let courseId;
    if (me.role === 'pj') {
      courseId = me.course_id;
    } else {
      courseId = courseFilter || (data.courses && data.courses[0] && data.courses[0].id) || null;
    }
    if (!courseId) {
      wrap.innerHTML = '<p class="card-meta">Pilih mata kuliah dulu.</p>';
      return;
    }

    try {
      const result = await api.getCourseStudentMatrix(courseId);
      const courseObj = (data.courses || []).find((c) => String(c.id) === String(courseId));
      const cName = courseObj ? courseObj.name : 'Mata Kuliah';
      lastMatrixData = {
        courseId,
        courseName: cName,
        result,
      };
      if (!result.students.length) {
        wrap.innerHTML = '<p class="card-meta">Belum ada mahasiswa terdaftar.</p>';
        return;
      }
      if (!result.tasks.length) {
        wrap.innerHTML = '<p class="card-meta">Belum ada tugas di mata kuliah ini.</p>';
        return;
      }

      const tasks = result.tasks;
      const students = result.students;
      const matrix = result.matrix;

      let html = '<table class="matrix-table"><thead><tr><th>Nama</th>'
        + tasks.map((t) => '<th title="' + escape(t.title) + '">' + escape(t.title.length > 15 ? t.title.slice(0, 13) + '…' : t.title) + '</th>').join('')
        + '</tr></thead><tbody>';
      students.forEach((s) => {
        const sid = String(s.id);
        html += '<tr><td>' + escape(s.name) + '</td>'
          + tasks.map((t) => {
            const tid = String(t.id);
            const st = matrix[sid] && matrix[sid][tid];
            let badge = '—';
            if (st === 'sudah') badge = '';
            else if (st === 'terlambat') badge = '';
            else if (st === 'belum') badge = '';
            return '<td class="matrix-cell" title="' + escape(st || '') + '">' + badge + '</td>';
          }).join('')
        + '</tr>';
      });
      html += '</tbody></table>';
      html += '<p class="fm-hint"> = sudah ·  = belum ·  = terlambat</p>';
      wrap.innerHTML = html;
    } catch (e) {
      wrap.innerHTML = '<p class="card-meta">Gagal memuat: ' + (e && e.message ? e.message : 'unknown') + '</p>';
    }
  }

  function closeMatrixSheet() {
    const root = document.getElementById('page-daftar');
    if (!root) return;
    root.querySelector('[data-sheet-matrix]').hidden = true;
    const formSheet = root.querySelector('[data-sheet]');
    const studentsSheet = root.querySelector('[data-sheet-students]');
    if (formSheet.hidden && studentsSheet.hidden) {
      root.querySelector('[data-overlay]').hidden = true;
      document.body.classList.remove('is-locked');
    }
  }

  // ---------- Init ----------

  function init() {
    const root = document.getElementById('page-daftar');
    if (!root || root.dataset.ready === '1') return;
    root.dataset.ready = '1';

    // Form sheet handlers
    root.querySelector('[data-open]').addEventListener('click', () => openForm(null));
    root.querySelector('[data-close]').addEventListener('click', closeForm);
    root.querySelector('[data-cancel]').addEventListener('click', closeForm);
    root.querySelector('[data-overlay]').addEventListener('click', () => {
      closeForm();
      closeStudentsSheet();
      closeMatrixSheet();
    });
    root.querySelector('[data-save]').addEventListener('click', saveTask);
    const form = root.querySelector('[data-form]');
    form.addEventListener('submit', (e) => { e.preventDefault(); saveTask(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!root.querySelector('[data-sheet]').hidden) closeForm();
        else if (!root.querySelector('[data-sheet-students]').hidden) closeStudentsSheet();
        else if (!root.querySelector('[data-sheet-matrix]').hidden) closeMatrixSheet();
      }
    });

    // Search + filter
    const searchEl = root.querySelector('[data-search]');
    if (searchEl) searchEl.addEventListener('input', (e) => { searchQuery = e.target.value; render(); });
    const statusSel = root.querySelector('[data-filter-status]');
    if (statusSel) statusSel.addEventListener('change', (e) => { statusFilter = e.target.value; render(); });
    const courseSel = root.querySelector('[data-filter-course]');
    if (courseSel) courseSel.addEventListener('change', (e) => { courseFilter = e.target.value; render(); });

    // Materi handlers
    root.querySelector('[data-add-materi]').addEventListener('click', onAddMateriClick);
    const materiInput = document.getElementById('dt-materi-input');
    if (materiInput) materiInput.addEventListener('change', onMateriFilePicked);
    // Delegate remove-materi clicks
    root.querySelector('[data-attachment-list]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-materi]');
      if (btn) onRemoveMateriClick(Number(btn.dataset.removeMateri));
    });

    // Student submit input (Kumpulkan / Unggah Ulang)
    const submitInput = document.getElementById('dt-submit-input');
    if (submitInput) submitInput.addEventListener('change', onSubmitFilePicked);

    // Students sheet close
    root.querySelectorAll('[data-students-close]').forEach((btn) => btn.addEventListener('click', closeStudentsSheet));

    // Matrix sheet
    root.querySelector('[data-open-matrix]').addEventListener('click', openMatrixSheet);
    root.querySelectorAll('[data-matrix-close]').forEach((btn) => btn.addEventListener('click', closeMatrixSheet));

    // Export CSV handlers
    const exportTaskBtn = root.querySelector('[data-export-task-csv]');
    if (exportTaskBtn) {
      exportTaskBtn.addEventListener('click', () => {
        if (!lastStudentsStats || !lastStudentsTaskId) return;
        const task = (data.tasks || []).find((t) => String(t.id) === String(lastStudentsTaskId));
        const csv = exportTaskSubmissionsToCSV(task, lastStudentsStats.students, data.files);
        const safeTitle = (task ? task.title : 'tugas').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        triggerDownloadCSV('rekap-' + safeTitle + '.csv', csv);
        showToast('Rekap tugas berhasil diekspor (CSV)');
      });
    }

    const exportMatrixBtn = root.querySelector('[data-export-matrix-csv]');
    if (exportMatrixBtn) {
      exportMatrixBtn.addEventListener('click', () => {
        if (!lastMatrixData || !lastMatrixData.result) return;
        const { courseName, result } = lastMatrixData;
        const csv = exportMatrixToCSV(courseName, result.tasks, result.students, result.matrix);
        const safeCourse = (courseName || 'matriks').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        triggerDownloadCSV('matriks-' + safeCourse + '.csv', csv);
        showToast('Matriks tugas berhasil diekspor (CSV)');
      });
    }

    // Delegasi: tombol di card (edit, delete, kumpulkan, lihat file, unggah ulang, list mahasiswa)
    root.querySelector('[data-list]').addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) {
        const api = window.SH_API;
        api.findTask(Number(editBtn.dataset.edit)).then((t) => { if (t) openForm(t); });
        return;
      }
      const delBtn = e.target.closest('[data-delete]');
      if (delBtn) { deleteTask(Number(delBtn.dataset.delete)); return; }
      const kumpBtn = e.target.closest('[data-kumpulkan]');
      if (kumpBtn) { onKumpulkanClick(Number(kumpBtn.dataset.kumpulkan)); return; }
      const ulangBtn = e.target.closest('[data-unggah-ulang]');
      if (ulangBtn) { onUnggahUlangClick(Number(ulangBtn.dataset.unggahUlang)); return; }
      const lihatBtn = e.target.closest('[data-lihat-file]');
      if (lihatBtn) {
        // Find file_id dari submission mahasiswa
        const me = getCurrentUser();
        const taskId = Number(lihatBtn.dataset.lihatFile);
        const sub = (data.task_submissions || []).find(
          (s) => String(s.task_id) === String(taskId) && String(s.student_id) === String(me.id),
        );
        if (sub) onLihatFileClick(sub.file_id);
        return;
      }
      const listBtn = e.target.closest('[data-list-mahasiswa]');
      if (listBtn) { openStudentsSheet(Number(listBtn.dataset.listMahasiswa)); return; }
    });

    // Load data
    if (!window.SH_API) {
      const listEl = root.querySelector('[data-list]');
      if (listEl) listEl.innerHTML = '<p class="card-meta">API belum siap. Coba refresh halaman.</p>';
      return;
    }
    window.SH_API.loadAll()
      .then((d) => {
        data = d;
        if (!Array.isArray(data.task_submissions)) data.task_submissions = [];
        render();
        loadPjCounters();
      })
      .catch(() => {
        const listEl = root.querySelector('[data-list]');
        if (listEl) listEl.innerHTML = '<p class="card-meta">Gagal memuat data. Buka lewat http://localhost:8000. Kalau aktif Supabase, periksa js/config.js.</p>';
      });
  }

  window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
  window.STUDENTHUB_PAGES.daftar = { init };

  window.SH_CSV = {
    csvEscapeCell,
    exportTaskSubmissionsToCSV,
    exportMatrixToCSV,
  };
})();
