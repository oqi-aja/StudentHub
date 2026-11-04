// js/detail-tugas.js
// Halaman Detail Tugas — fungsional, UX ala Google Classroom.
// URL format: #detail-tugas?id=<task_id>
//
// Layout (mirip Classroom):
//   - Header: title, course + dosen, deadline + topic, status badge (mahasiswa)
//   - Card "Instruksi Tugas": description + materi (attachments dari dosen/PJ)
//   - Card "Your Work" (mahasiswa): file submitted + tombol Upload/Unggah Ulang/Hapus
//   - Card "Status Pengumpulan" (PJ/Admin): counter + list mahasiswa

(function () {
  'use strict';

  let toastTimer = null;

  // ---------- Helpers ----------

  function escape(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Inline SVG — tidak ada emoji di antarmuka.
  const SVG_BASE = 'width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
  function svg(paths, cls) {
    return '<svg class="' + (cls || 'ico') + '" ' + SVG_BASE + '>' + paths + '</svg>';
  }
  const FILE_ICONS = {
    archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.35-4.35a1 1 0 0 0-1.42 0L7 19"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>',
    slide: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    video: '<path d="m22 8-6 4 6 4V8z"/><rect x="2" y="6" width="14" height="12" rx="2"/>'
  };

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
    const el = document.querySelector('#page-detail-tugas [data-detail-toast]');
    if (!el) return;
    el.textContent = text;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
  }

  function fileIcon(name) {
    const ext = (String(name || '').split('.').pop() || '').toLowerCase();
    if (['zip', 'rar', '7z'].includes(ext)) return svg(FILE_ICONS.archive, 'file-ico');
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return svg(FILE_ICONS.image, 'file-ico');
    if (['doc', 'docx', 'odt'].includes(ext)) return svg(FILE_ICONS.doc, 'file-ico');
    if (['xls', 'xlsx', 'csv'].includes(ext)) return svg(FILE_ICONS.sheet, 'file-ico');
    if (['ppt', 'pptx'].includes(ext)) return svg(FILE_ICONS.slide, 'file-ico');
    if (['pdf'].includes(ext)) return svg(FILE_ICONS.doc, 'file-ico');
    if (['mp3', 'wav'].includes(ext)) return svg(FILE_ICONS.audio, 'file-ico');
    if (['mp4', 'mkv', 'mov'].includes(ext)) return svg(FILE_ICONS.video, 'file-ico');
    if (['txt', 'md'].includes(ext)) return svg(FILE_ICONS.doc, 'file-ico');
    return svg(FILE_ICONS.doc, 'file-ico');
  }

  // Parse task ID dari hash: #detail-tugas?id=1
  function parseTaskId() {
    const hash = window.location.hash || '';
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return null;
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    const id = params.get('id');
    return id ? Number(id) : null;
  }

  // ---------- State ----------

  let task = null;
  let data = null; // cache dari loadAll
  let pendingSubmit = false;

  // ---------- Render ----------

  async function loadAndRender() {
    const api = window.SH_API;
    const root = document.getElementById('page-detail-tugas');
    if (!root || !api) return;

    const taskId = parseTaskId();
    if (!taskId) {
      root.querySelector('[data-detail-title]').textContent = 'Tugas tidak ditemukan';
      root.querySelector('[data-detail-subtitle]').textContent = 'ID tugas tidak valid.';
      root.querySelector('[data-detail-body]').innerHTML = '<p class="card-meta"><a href="#daftar"><svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg> Kembali ke Daftar Tugas</a></p>';
      return;
    }

    // Load all + find task
    try {
      data = await api.loadAll();
      task = (data.tasks || []).find((t) => String(t.id) === String(taskId)) || null;
    } catch (e) {
      root.querySelector('[data-detail-title]').textContent = 'Gagal memuat';
      root.querySelector('[data-detail-body]').innerHTML = '<p class="card-meta">Gagal: ' + escape(e && e.message ? e.message : 'unknown') + '</p>';
      return;
    }

    if (!task) {
      root.querySelector('[data-detail-title]').textContent = 'Tugas tidak ditemukan';
      root.querySelector('[data-detail-subtitle]').textContent = 'Tugas dengan ID ' + taskId + ' tidak ada.';
      root.querySelector('[data-detail-body]').innerHTML = '<p class="card-meta"><a href="#daftar"><svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg> Kembali ke Daftar Tugas</a></p>';
      return;
    }

    const me = getCurrentUser();
    const course = ((data.courses || []).find((c) => String(c.id) === String(task.course_id)) || {}).name || '-';
    const dl = daysUntil(task.deadline);

    // Header
    root.querySelector('[data-detail-title]').textContent = task.title;
    root.querySelector('[data-detail-subtitle]').textContent = course + ' • Dosen: ' + (task.dosen || '-');

    // Body
    const body = root.querySelector('[data-detail-body]');
    const isMahasiswa = me && (me.role === 'student' || me.role === 'mahasiswa');
    const isPjOrAdmin = me && (me.role === 'admin' || me.role === 'pj');
    const canEdit = isPjOrAdmin && (me.role === 'admin' || String(me.course_id) === String(task.course_id));

    let statusBadgeHtml = '';
    let submittedFile = null;
    if (isMahasiswa) {
      const sub = (data.task_submissions || []).find(
        (s) => String(s.task_id) === String(task.id) && String(s.student_id) === String(me.id),
      );
      if (sub) {
        submittedFile = (data.files || []).find((f) => String(f.id) === String(sub.file_id)) || null;
        statusBadgeHtml = '<span class="badge badge--success"><span class="status-dot status-dot--success"></span>Sudah dikumpulkan</span>';
      } else if (dl !== null && dl < 0) {
        statusBadgeHtml = '<span class="badge badge--danger"><span class="status-dot status-dot--danger"></span>Terlambat ' + Math.abs(dl) + ' hari</span>';
      } else {
        statusBadgeHtml = '<span class="badge badge--warning"><span class="status-dot status-dot--warning"></span>Belum dikumpulkan</span>';
      }
    }

    // Card 1: Informasi Tugas
    const infoCard = '<article class="card">'
      + '<header class="card-header"><h3 class="card-title">Informasi Tugas</h3></header>'
      + '<div class="card-body">'
        + '<div class="info-row">'
          + '<div><span class="list-item-subtitle">Deadline</span>'
            + '<p class="card-title">' + escape(formatDate(task.deadline)) + '</p></div>'
          + (statusBadgeHtml || '<span class="badge badge--info">' + (canEdit ? 'Kelola' : 'Lihat') + '</span>')
        + '</div>'
        + (task.topic ? '<div><span class="list-item-subtitle">Topik</span><p class="card-meta">' + escape(task.topic) + '</p></div>' : '')
        + (task.description ? '<div><span class="list-item-subtitle">Instruksi</span><p class="card-meta">' + escape(task.description) + '</p></div>' : '')
        + '<div><span class="list-item-subtitle">Dikumpulkan di folder</span><p class="card-meta">' + escape(window.SH_API.folderLocation(task.submission_folder_id)) + '</p></div>'
      + '</div></article>';

    // Card 2: Lampiran Materi
    const attachments = Array.isArray(task.attachments) ? task.attachments : [];
    const materiCard = '<article class="card">'
      + '<header class="card-header"><h3 class="card-title">Lampiran Materi</h3></header>'
      + '<div class="card-body">'
        + (attachments.length
          ? attachments.map((a) => '<div class="materi-row">'
              + '<span class="materi-icon">' + fileIcon(a.name) + '</span>'
              + '<div class="materi-info">'
                + '<p class="card-meta">' + escape(a.name) + '</p>'
                + '<p class="list-item-subtitle">' + (a.size ? Math.round(a.size / 1024) + ' KB' : '-') + '</p>'
              + '</div>'
              + (a.file_id ? '<button class="button button--ghost button--sm" type="button" data-materi-download="' + Number(a.file_id) + '">Unduh</button>' : '')
            + '</div>').join('')
          : '<p class="card-meta">Tidak ada materi.</p>')
      + '</div></article>';

    // Card 3: Your Work (mahasiswa only)
    const yourWorkCard = isMahasiswa ? '<article class="card">'
      + '<header class="card-header"><h3 class="card-title">Tugas Kamu</h3></header>'
      + '<div class="card-body">'
        + (submittedFile
          ? '<div class="submitted-detail-row">'
              + '<span class="materi-icon">' + fileIcon(submittedFile.name) + '</span>'
              + '<div class="materi-info">'
                + '<p class="card-meta">' + escape(submittedFile.name) + '</p>'
                + '<p class="list-item-subtitle">Dikumpulkan: ' + escape(formatDateTime(
                    ((data.task_submissions || []).find((s) => String(s.task_id) === String(task.id) && String(s.student_id) === String(me.id)) || {}).updated_at
                  )) + '</p>'
              + '</div>'
              + '<button class="button button--ghost button--sm" type="button" data-lihat-file="' + Number(submittedFile.id) + '">Lihat</button>'
              + '<button class="button button--sm" type="button" data-unggah-ulang="1">Unggah Ulang</button>'
            + '</div>'
            + '<p class="fm-hint">Upload ulang akan menggantikan file sebelumnya. Status tetap "Sudah dikumpulkan".</p>'
          : '<div class="empty-work">'
              + '<p class="card-meta">Belum ada file yang dikumpulkan.</p>'
              + '<button class="button" type="button" data-kumpulkan="1">Kumpulkan Tugas</button>'
            + '</div>')
      + '</div></article>' : '';

    // Card 4: Status Pengumpulan (PJ/Admin only, canEdit)
    const statusCard = canEdit ? '<article class="card">'
      + '<header class="card-header"><h3 class="card-title">Status Pengumpulan</h3></header>'
      + '<div class="card-body" data-pj-status><span class="skeleton-line"></span></div></article>' : '';

    body.innerHTML = '<div class="grid two">'
        + infoCard
        + materiCard
      + '</div>'
      + yourWorkCard
      + statusCard;

    // Load PJ status if applicable
    if (canEdit) loadPjStatus();
  }

  async function loadPjStatus() {
    const api = window.SH_API;
    if (!api || !task) return;
    const wrap = document.querySelector('#page-detail-tugas [data-pj-status]');
    if (!wrap) return;
    try {
      const stats = await api.getTaskSubmissionStats(task.id);
      const summary = ''
        + '<div class="students-summary">'
          + '<span class="badge badge--success">' + stats.submitted + ' sudah</span>'
          + '<span class="badge badge--warning">' + stats.not_submitted + ' belum</span>'
          + (stats.late > 0 ? '<span class="badge badge--danger">' + stats.late + ' terlambat</span>' : '')
          + '<span class="card-meta">Total: ' + stats.total_students + ' mahasiswa</span>'
        + '</div>';
      const table = '<div class="table-scroll"><table class="students-table"><thead><tr>'
        + '<th>#</th><th>Nama</th><th>Status</th><th>File</th><th>Waktu</th>'
        + '</tr></thead><tbody>'
        + stats.students.map((s, i) => {
          const file = s.submission
            ? ((data.files || []).find((f) => String(f.id) === String(s.submission.file_id)) || null)
            : null;
          const badge = s.status === 'sudah' ? '<span class="status-dot status-dot--success"></span>Sudah' : (s.status === 'terlambat' ? '<span class="status-dot status-dot--danger"></span>Terlambat' : '<span class="status-dot status-dot--warning"></span>Belum');
          return '<tr>'
            + '<td>' + (i + 1) + '</td>'
            + '<td>' + escape(s.profile.name) + '</td>'
            + '<td>' + badge + '</td>'
            + '<td>' + (file ? escape(file.name) : '-') + '</td>'
            + '<td>' + (s.submission ? escape(formatDateTime(s.submission.updated_at || s.submission.submitted_at)) : '-') + '</td>'
          + '</tr>';
        }).join('')
        + '</tbody></table></div>';
      wrap.innerHTML = summary + table;
    } catch (e) {
      wrap.innerHTML = '<p class="card-meta">Gagal memuat: ' + escape(e && e.message ? e.message : 'unknown') + '</p>';
    }
  }

  // ---------- Action handlers ----------

  function triggerFilePicker() {
    const input = document.getElementById('dt-detail-submit-input');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async function onFilePicked(e) {
    if (!task) return;
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const api = window.SH_API;
    if (!api) return;

    showToast('Mengunggah...');
    try {
      const res = await api.submitTaskFile(task.id, file);
      if (!res.ok) {
        showToast('Gagal: ' + res.error);
        return;
      }
      showToast('Tugas berhasil dikumpulkan!');
      // Reload + re-render
      await loadAndRender();
    } catch (e) {
      showToast('Gagal upload: ' + (e && e.message ? e.message : 'unknown'));
    }
  }

  async function onLihatFile(fileId) {
    const api = window.SH_API;
    if (!api) return;
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
    const file = (data.files || []).find((f) => String(f.id) === String(fileId));
    if (file) {
      showToast(file.name + ' · ' + (file.file_type || 'unknown') + ' · ' + (file.size ? Math.round(file.size / 1024) + ' KB' : '-'));
    }
  }

  // ---------- Init ----------

  function initDetailTugasPage() {
    const root = document.getElementById('page-detail-tugas');
    if (!root || root.dataset.ready === '1') return;
    root.dataset.ready = '1';

    // File input listener
    const input = document.getElementById('dt-detail-submit-input');
    if (input) input.addEventListener('change', onFilePicked);

    // Delegate clicks
    root.addEventListener('click', (e) => {
      const kumpBtn = e.target.closest('[data-kumpulkan]');
      if (kumpBtn) { triggerFilePicker(); return; }
      const ulangBtn = e.target.closest('[data-unggah-ulang]');
      if (ulangBtn) { triggerFilePicker(); return; }
      const lihatBtn = e.target.closest('[data-lihat-file]');
      if (lihatBtn) { onLihatFile(Number(lihatBtn.dataset.lihatFile)); return; }
      const materiDlBtn = e.target.closest('[data-materi-download]');
      if (materiDlBtn) { onLihatFile(Number(materiDlBtn.dataset.materiDownload)); return; }
    });

    loadAndRender();
  }

  window.STUDENTHUB_PAGES = window.STUDENTHUB_PAGES || {};
  window.STUDENTHUB_PAGES['detail-tugas'] = { init: initDetailTugasPage };
})();
