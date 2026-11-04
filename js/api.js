// js/api.js
// ============================================================
// StudentHub — Abstraction layer untuk semua operasi data.
// ============================================================
// Mendukung dua mode:
//   - mock   : pakai data/contoh.json + localStorage (default).
//              Cocok untuk development lokal, demo, dan test suite.
//   - supabase : pakai Supabase (Postgres + Storage + RLS).
//              Aktif ketika js/config.js set window.SH_SUPABASE.enabled = true.
//
// Kontrak API:
//   - Semua method publik return Promise (async). Mock resolve langsung.
//   - Caller (js/tugas.js, js/daftar-tugas.js) pakai `await` di semua pemanggilan.
//   - ID comparison pakai String(id) agar kompatibel:
//       mock: integer (1, 2, 3, 4)
//       supabase: UUID string (auth.users.id)
//   - PJ gating diterapkan 2 lapis:
//       Lapis 1 (JS):   cek role + course_id sebelum query ke DB
//       Lapis 2 (RLS):  policy tasks_write_pj_own_course menolak mutation
//                       kalau task.course_id !== profiles.course_id PJ
//
// Catatan Penting:
//   - JANGAN pernah taruh service_role/secret key di frontend.
//     Frontend hanya pakai publishable/anon key (publik aman).
//   - Saat window.SH_SUPABASE tidak ada atau enabled=false,
//     api otomatis fallback ke mock tanpa error.
// ============================================================

(function () {
  'use strict';

  // ---------- Constants ----------
  const SUBMISSIONS_KEY = 'sh_mock_task_submissions';
  const TASKS_KEY = 'sh_mock_tasks_extra';
  const FOLDERS_KEY = 'sh_mock_folders_extra';

  // ---------- State ----------
  let _data = null;            // cache data mock (atau hasil loadAll di Supabase mode)
  let _mode = 'mock';          // 'mock' | 'supabase'
  let _supabaseClient = null;  // instance window.supabase.createClient

  // ---------- Helpers: ID ----------
  // Pakai String(id) agar komparasi kompatibel mock (int) vs Supabase (UUID).
  function idEq(a, b) { return String(a) === String(b); }
  function asId(x) { return x == null ? '' : String(x); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function now() { return new Date().toISOString(); }
  function nextId(list) {
    return list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
  }

  // ---------- Helpers: current user (passthrough ke auth.js) ----------
  function currentUser() {
    if (typeof getCurrentUser === 'function') return getCurrentUser();
    if (typeof window !== 'undefined' && typeof window.getCurrentUser === 'function') {
      return window.getCurrentUser();
    }
    return null;
  }

  // ---------- Mock persistence (localStorage) ----------

  function readStoredSubmissions() {
    try {
      const raw = localStorage.getItem(SUBMISSIONS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function persistSubmissions() {
    try {
      localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(_data.task_submissions || []));
    } catch (e) { /* localStorage bisa diblokir — mock tetap jalan di memori */ }
  }

  function readStoredTasks() {
    try {
      const raw = localStorage.getItem(TASKS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function persistTasks() {
    try {
      const extra = (_data.tasks || []).filter((t) => t.submission_folder_id != null);
      localStorage.setItem(TASKS_KEY, JSON.stringify(extra));
    } catch (e) { /* ignore */ }
  }

  const FOLDERS_KEY_LOCAL = FOLDERS_KEY;
  function readStoredFolders() {
    try {
      const raw = localStorage.getItem(FOLDERS_KEY_LOCAL);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function persistFolders() {
    try {
      localStorage.setItem(FOLDERS_KEY_LOCAL, JSON.stringify(_data.folders || []));
    } catch (e) { /* ignore */ }
  }

  function loadFoldersOverride() {
    try {
      const raw = localStorage.getItem(FOLDERS_KEY_LOCAL);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length ? arr : null;
    } catch (e) { return null; }
  }

  // ---------- Mock data attach ----------
  // Dipakai oleh js/tugas.js & js/daftar-tugas.js untuk share cache yang sama.
  // Di Supabase mode, ini juga dipakai sebagai cache hasil loadAll() supaya
  // validation sync (findCourseMock/findFolderMock) tetap jalan.
  function apiAttachData(dataObj) {
    _data = dataObj;
    if (_data && !Array.isArray(_data.task_submissions)) _data.task_submissions = [];
    const extra = readStoredTasks();
    if (extra.length) {
      const existingIds = new Set((_data.tasks || []).map((t) => asId(t.id)));
      extra.forEach((t) => { if (!existingIds.has(asId(t.id))) _data.tasks.push(t); });
    }
    const subs = readStoredSubmissions();
    if (subs.length) {
      const existingSubIds = new Set(_data.task_submissions.map((s) => asId(s.id)));
      subs.forEach((s) => { if (!existingSubIds.has(asId(s.id))) _data.task_submissions.push(s); });
    }
  }

  // ---------- Supabase init ----------
  // Dipanggil sekali di akhir IIFE. Deteksi konfigurasi dari window.SH_SUPABASE.
  // Kalau gagal (config hilang / URL kosong / SDK tidak load), fallback ke mock.
  function initSupabase() {
    const cfg = (typeof window !== 'undefined' && window.SH_SUPABASE) || null;
    if (!cfg || !cfg.enabled || !cfg.url || !cfg.anonKey) {
      _mode = 'mock';
      _supabaseClient = null;
      return false;
    }
    if (typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        _supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey, cfg.clientOptions || {});
        _mode = 'supabase';
        // eslint-disable-next-line no-console
        console.info('[SH_API] Supabase mode aktif. URL:', cfg.url);
        return true;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[SH_API] Supabase init gagal, fallback ke mock:', e);
        _mode = 'mock';
        _supabaseClient = null;
        return false;
      }
    }
    _mode = 'mock';
    _supabaseClient = null;
    return false;
  }

  function getMode() { return _mode; }
  function isSupabase() { return _mode === 'supabase' && _supabaseClient !== null; }

  // ---------- Mock read helpers (sync, internal use) ----------
  function getFoldersMock() { return _data ? _data.folders : []; }
  function getFilesMock() { return _data ? _data.files : []; }
  function getTasksMock() { return _data ? _data.tasks : []; }
  function getCoursesMock() { return _data ? _data.courses : []; }
  function getUsersMock() { return _data ? _data.users : []; }
  function getSubmissionsMock() { return _data ? _data.task_submissions : []; }
  function findFolderMock(id) { return getFoldersMock().find((f) => idEq(f.id, id)) || null; }
  function findFileMock(id) { return getFilesMock().find((f) => idEq(f.id, id)) || null; }
  function findTaskMock(id) { return getTasksMock().find((t) => idEq(t.id, id)) || null; }
  function findCourseMock(id) { return getCoursesMock().find((c) => idEq(c.id, id)) || null; }

  function folderPathMock(folderId) {
    const chain = [];
    let cur = findFolderMock(folderId);
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_id != null ? findFolderMock(cur.parent_id) : null;
    }
    return chain;
  }
  function findTaskBySubmissionFolderMock(folderId) {
    return getTasksMock().find((t) => idEq(t.submission_folder_id, folderId));
  }
  function getSubmissionMock(taskId, studentId) {
    return getSubmissionsMock().find(
      (s) => idEq(s.task_id, taskId) && idEq(s.student_id, studentId),
    ) || null;
  }

  // ---------- Public READ (async) ----------

  async function getFolders() {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient.from('folders').select('*');
      if (error) throw error;
      return data || [];
    }
    return getFoldersMock();
  }
  async function getFiles() {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient.from('files').select('*');
      if (error) throw error;
      return data || [];
    }
    return getFilesMock();
  }
  async function getTasks() {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient.from('tasks').select('*');
      if (error) throw error;
      return data || [];
    }
    return getTasksMock();
  }
  async function getCourses() {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient.from('courses').select('*');
      if (error) throw error;
      return data || [];
    }
    return getCoursesMock();
  }
  async function getUsers() {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient.from('profiles').select('*');
      if (error) throw error;
      return data || [];
    }
    return getUsersMock();
  }
  async function getSubmissions() {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient.from('task_submissions').select('*');
      if (error) throw error;
      return data || [];
    }
    return getSubmissionsMock();
  }

  async function findFolder(id) {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient
        .from('folders').select('*').eq('id', Number(id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    return findFolderMock(id);
  }
  async function findFile(id) {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient
        .from('files').select('*').eq('id', Number(id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    return findFileMock(id);
  }
  async function findTask(id) {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient
        .from('tasks').select('*').eq('id', Number(id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    return findTaskMock(id);
  }
  async function findCourse(id) {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient
        .from('courses').select('*').eq('id', Number(id)).maybeSingle();
      if (error) throw error;
      return data;
    }
    return findCourseMock(id);
  }

  // Sync folder path/location: pakai cache _data (populated oleh loadAll/attachData
  // di kedua mode). Kalau folder tidak ada di cache, return [] / ''.
  // Dipakai oleh daftar-tugas.js saat render task card (sync rendering).
  function folderPath(folderId) {
    if (!_data) return [];
    return folderPathMock(folderId);
  }
  function folderLocation(folderId) {
    if (!_data) return '';
    const chain = folderPathMock(folderId);
    return ['Tugas', ...chain.map((f) => f.name)].join(' / ');
  }

  // Async version: kalau perlu refresh dari DB (Supabase mode).
  // Untuk Tahap 1, caller sinkron pakai folderLocation(); async version
  // disediakan untuk future use (mis. setelah edit folder tree).
  async function folderLocationAsync(folderId) {
    if (isSupabase()) {
      const chain = [];
      let curId = folderId;
      const seen = new Set();
      while (curId != null && !seen.has(asId(curId))) {
        seen.add(asId(curId));
        const folder = await findFolder(curId);
        if (!folder) break;
        chain.unshift(folder);
        curId = folder.parent_id;
      }
      return ['Tugas', ...chain.map((f) => f.name)].join(' / ');
    }
    return folderLocation(folderId);
  }

  async function findTaskBySubmissionFolder(folderId) {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient
        .from('tasks')
        .select('*')
        .eq('submission_folder_id', Number(folderId))
        .maybeSingle();
      if (error) throw error;
      return data;
    }
    return findTaskBySubmissionFolderMock(folderId);
  }

  async function getSubmission(taskId, studentId) {
    if (isSupabase()) {
      const { data, error } = await _supabaseClient
        .from('task_submissions')
        .select('*')
        .eq('task_id', Number(taskId))
        .eq('student_id', studentId) // UUID string dari currentUser().id
        .maybeSingle();
      if (error) throw error;
      return data;
    }
    return getSubmissionMock(taskId, studentId);
  }

  async function getTaskStatusForStudent(taskId, studentId) {
    const sub = await getSubmission(taskId, studentId);
    return sub ? 'sudah' : 'belum';
  }

  // ---------- Submission recording ----------

  async function recordSubmission(taskId, studentId, fileId) {
    const user = currentUser();
    if (!user) return { ok: false, error: 'Wajib login.' };
    if (user.role !== 'student') return { ok: false, error: 'Hanya mahasiswa yang bisa submit.' };

    if (isSupabase()) {
      // student_id di Supabase = UUID (auth.uid). RLS submissions_write_owner
      // memaksa student_id = auth.uid(), jadi kita pakai user.id (UUID).
      const { data, error } = await _supabaseClient
        .from('task_submissions')
        .upsert({
          task_id: Number(taskId),
          student_id: user.id,
          file_id: Number(fileId),
          updated_at: now(),
        }, {
          onConflict: 'task_id,student_id',
          merge: ['file_id', 'updated_at'],
        })
        .select()
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, submission: data };
    }

    // Mock path
    if (!_data) return { ok: false, error: 'Data belum dimuat.' };
    const task = findTaskMock(taskId);
    if (!task) return { ok: false, error: 'Task tidak ditemukan.' };
    if (!findFileMock(fileId)) return { ok: false, error: 'File tidak ditemukan (gagal upload?).' };
    const existing = getSubmissionMock(taskId, studentId);
    let sub;
    if (existing) {
      // Update file_id di baris yang sama (pilihan a, no versioning)
      existing.file_id = Number(fileId);
      existing.updated_at = now();
      sub = existing;
    } else {
      sub = {
        id: nextId(getSubmissionsMock()),
        task_id: Number(taskId),
        student_id: Number(studentId),
        file_id: Number(fileId),
        submitted_at: now(),
        updated_at: now(),
      };
      _data.task_submissions.push(sub);
    }
    persistSubmissions();
    return { ok: true, submission: sub };
  }

  async function detectSubmissionOnUpload(fileRow) {
    if (!fileRow) return null;
    const user = currentUser();
    if (!user || user.role !== 'student') return null;
    const task = await findTaskBySubmissionFolder(fileRow.folder_id);
    if (!task) return null;
    const res = await recordSubmission(task.id, user.id, fileRow.id);
    return res.ok ? { task, submission: res.submission } : null;
  }

  // ---------- File upload ----------
  // Upload file binary ke Supabase Storage (mode supabase) atau in-memory (mock),
  // lalu insert row ke tabel files. Return { ok, file }.
  async function uploadFile(file, folderId) {
    const user = currentUser();
    if (!user) return { ok: false, error: 'Wajib login.' };

    if (isSupabase()) {
      const bucket = window.SH_SUPABASE.storageBucket;
      const safeName = String(file.name).replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const path = `${user.id}/${folderId}/${Date.now()}-${safeName}`;

      // Upload binary ke Supabase Storage
      const { error: upErr } = await _supabaseClient
        .storage
        .from(bucket)
        .upload(path, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        });
      if (upErr) return { ok: false, error: 'Storage: ' + upErr.message };

      // Insert row ke tabel files
      const visibility = (user.role === 'admin' || user.role === 'pj') ? 'public' : 'private';
      const { data: fileRow, error: dbErr } = await _supabaseClient
        .from('files')
        .insert({
          folder_id: Number(folderId),
          user_id: user.id,
          name: file.name,
          file_type: file.type || 'application/octet-stream',
          visibility,
          size: file.size,
          storage_path: path,
        })
        .select()
        .single();
      if (dbErr) {
        // Rollback: hapus file dari Storage supaya tidak jadi yatim
        try { await _supabaseClient.storage.from(bucket).remove([path]); } catch (_) { /* ignore */ }
        return { ok: false, error: 'DB: ' + dbErr.message };
      }
      return { ok: true, file: fileRow };
    }

    // Mock
    if (!_data) return { ok: false, error: 'Data belum dimuat.' };
    const newFile = {
      id: nextId(getFilesMock()),
      folder_id: Number(folderId),
      user_id: user.id,
      name: file.name,
      file_type: file.type || 'application/octet-stream',
      visibility: (user.role === 'admin' || user.role === 'pj') ? 'public' : 'private',
      size: file.size,
      created_at: today(),
      updated_at: today(),
    };
    _data.files.push(newFile);
    return { ok: true, file: newFile };
  }

  // ---------- File download URL (Supabase Storage) ----------
  async function getFileDownloadUrl(fileId) {
    if (isSupabase()) {
      const file = await findFile(fileId);
      if (!file || !file.storage_path) return null;
      const bucket = window.SH_SUPABASE.storageBucket;
      const { data, error } = await _supabaseClient.storage
        .from(bucket).createSignedUrl(file.storage_path, 60 * 5); // 5 menit
      if (error) return null;
      return data ? data.signedUrl : null;
    }
    // Mock: tidak ada URL nyata, return null
    return null;
  }

  // ---------- Task CRUD ----------

  // Sync validation; memakai cache _data (populated oleh loadAll/attachData
  // di kedua mode). Untuk Supabase mode, pastikan loadAll() sudah dipanggil
  // sebelum create/update task.
  function validateTask(input) {
    const title = String(input.title || '').trim();
    if (!title) return { error: 'Nama tugas wajib diisi.' };
    const courseId = Number(input.course_id);
    if (!courseId) return { error: 'Mata kuliah wajib dipilih.' };
    if (!findCourseMock(courseId)) return { error: 'Mata kuliah tidak dikenal.' };
    const dosen = String(input.dosen || '').trim();
    if (!dosen) return { error: 'Dosen wajib diisi.' };
    const deadline = String(input.deadline || '').trim();
    if (!deadline) return { error: 'Deadline wajib diisi.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return { error: 'Deadline wajib format YYYY-MM-DD.' };
    const submissionFolderId = Number(input.submission_folder_id);
    if (!submissionFolderId) return { error: 'Folder pengumpulan wajib dipilih.' };
    if (!findFolderMock(submissionFolderId)) return { error: 'Folder pengumpulan tidak dikenal.' };
    // Topic (opsional, untuk grouping seperti Google Classroom)
    const topic = String(input.topic || '').trim();
    // Attachments (opsional, array of materi metadata)
    let attachments = Array.isArray(input.attachments) ? input.attachments : [];
    // Sanitize: pastikan setiap attachment punya name + file_type
    attachments = attachments
      .filter((a) => a && a.name)
      .map((a) => ({
        file_id: a.file_id != null ? Number(a.file_id) : null,
        name: String(a.name),
        file_type: String(a.file_type || 'application/octet-stream'),
        size: Number(a.size) || 0,
        storage_path: a.storage_path != null ? String(a.storage_path) : null,
      }));
    return {
      value: {
        title,
        course_id: courseId,
        dosen,
        deadline,
        submission_folder_id: submissionFolderId,
        description: String(input.description || '').trim(),
        folder_id: submissionFolderId,
        topic: topic || null,
        attachments,
      },
    };
  }

  async function createTask(input) {
    if (!_data && !isSupabase()) return { ok: false, error: 'Data belum dimuat.' };
    const user = currentUser();
    if (!user) return { ok: false, error: 'Wajib login.' };
    // Lapis 1 (JS): permission + PJ gating per course
    if (user.role !== 'admin' && user.role !== 'pj') {
      return { ok: false, error: 'Tidak punya hak menambah tugas.' };
    }
    if (user.role === 'pj' && Number(input.course_id) !== Number(user.course_id)) {
      return { ok: false, error: 'PJ hanya boleh membuat tugas untuk mata kuliah sendiri.' };
    }
    const v = validateTask(input);
    if (v.error) return { ok: false, error: v.error };

    if (isSupabase()) {
      const { data, error } = await _supabaseClient
        .from('tasks')
        .insert({
          ...v.value,
          created_by: user.id,
        })
        .select()
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, task: data };
    }

    // Mock
    const t = {
      id: nextId(getTasksMock()),
      ...v.value,
      created_by: user.id,
      created_at: today(),
      updated_at: today(),
    };
    // Pastikan attachments + topic ada (untuk konsistensi)
    if (!Array.isArray(t.attachments)) t.attachments = [];
    if (t.topic == null) t.topic = null;
    _data.tasks.push(t);
    persistTasks();
    return { ok: true, task: t };
  }

  async function updateTask(id, input) {
    if (!_data && !isSupabase()) return { ok: false, error: 'Data belum dimuat.' };
    const user = currentUser();
    if (!user) return { ok: false, error: 'Wajib login.' };

    let existingTask;
    if (isSupabase()) {
      existingTask = await findTask(id);
    } else {
      existingTask = findTaskMock(id);
    }
    if (!existingTask) return { ok: false, error: 'Tugas tidak ditemukan.' };

    // Lapis 1 (JS): permission + PJ gating per course
    if (user.role !== 'admin' && user.role !== 'pj') {
      return { ok: false, error: 'Tidak punya hak mengubah tugas.' };
    }
    if (user.role === 'pj' && Number(existingTask.course_id) !== Number(user.course_id)) {
      return { ok: false, error: 'Tidak punya hak mengubah tugas ini.' };
    }
    const v = validateTask(input);
    if (v.error) return { ok: false, error: v.error };
    if (user.role === 'pj' && Number(v.value.course_id) !== Number(user.course_id)) {
      return { ok: false, error: 'PJ tidak boleh memindahkan tugas ke mata kuliah lain.' };
    }

    if (isSupabase()) {
      const { data, error } = await _supabaseClient
        .from('tasks')
        .update({ ...v.value, updated_at: now() })
        .eq('id', Number(id))
        .select()
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, task: data };
    }

    Object.assign(existingTask, v.value, { updated_at: today() });
    persistTasks();
    return { ok: true, task: existingTask };
  }

  async function deleteTask(id) {
    if (!_data && !isSupabase()) return { ok: false, error: 'Data belum dimuat.' };
    const user = currentUser();
    if (!user) return { ok: false, error: 'Wajib login.' };

    let existingTask;
    if (isSupabase()) {
      existingTask = await findTask(id);
    } else {
      existingTask = findTaskMock(id);
    }
    if (!existingTask) return { ok: false, error: 'Tugas tidak ditemukan.' };

    // Lapis 1 (JS): permission + PJ gating
    if (user.role !== 'admin' && user.role !== 'pj') {
      return { ok: false, error: 'Tidak punya hak menghapus tugas.' };
    }
    if (user.role === 'pj' && Number(existingTask.course_id) !== Number(user.course_id)) {
      return { ok: false, error: 'Tidak punya hak menghapus tugas ini.' };
    }

    if (isSupabase()) {
      // FK tasks.id ON DELETE CASCADE ke task_submissions akan hapus otomatis
      const { error } = await _supabaseClient
        .from('tasks')
        .delete()
        .eq('id', Number(id));
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    // Mock
    const idx = _data.tasks.indexOf(existingTask);
    _data.tasks.splice(idx, 1);
    _data.task_submissions = _data.task_submissions.filter((s) => !idEq(s.task_id, id));
    persistTasks();
    persistSubmissions();
    return { ok: true };
  }

  // ---------- Load all initial data ----------
  // Dipanggil oleh js/tugas.js & js/daftar-tugas.js saat init page.
  // Return: { folders, files, tasks, courses, users, task_submissions,
  //           announcements, schedules, notes }
  // Field announcements/schedules/notes di-SET [] di Supabase mode (di luar
  // scope Tahap 1). Halaman lain yang pakai field tersebut tetap fetch dari
  // sumbernya sendiri (data/contoh.json untuk mock, atau nantinya Supabase).
  async function loadAll() {
    if (isSupabase()) {
      try {
        const [folders, files, tasks, courses, users, subs] = await Promise.all([
          getFolders(), getFiles(), getTasks(), getCourses(), getUsers(), getSubmissions(),
        ]);
        const d = {
          folders: folders || [],
          files: files || [],
          tasks: tasks || [],
          courses: courses || [],
          users: users || [],
          task_submissions: subs || [],
          announcements: [],
          schedules: [],
          notes: [],
        };
        // Cache ke _data supaya validateTask (sync) jalan di Supabase mode
        apiAttachData(d);
        return d;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[SH_API] loadAll Supabase gagal:', e);
        throw e;
      }
    }

    // Mock: fetch contoh.json + apply localStorage overrides
    try {
      const res = await fetch('data/contoh.json');
      const d = await res.json();
      if (!Array.isArray(d.task_submissions)) d.task_submissions = [];

      // Override folders dari localStorage (kalau user sudah modified)
      const override = loadFoldersOverride();
      if (override && override.length) {
        const seedIds = new Set(d.folders.map((f) => asId(f.id)));
        const hasExtra = override.some((f) => !seedIds.has(asId(f.id)));
        if (hasExtra) d.folders = override;
      }
      // Apply task extras
      const extra = readStoredTasks();
      if (extra.length) {
        const ids = new Set(d.tasks.map((t) => asId(t.id)));
        extra.forEach((t) => { if (!ids.has(asId(t.id))) d.tasks.push(t); });
      }
      // Apply submissions
      const storedSubs = readStoredSubmissions();
      if (storedSubs.length) {
        const ids = new Set(d.task_submissions.map((s) => asId(s.id)));
        storedSubs.forEach((s) => { if (!ids.has(asId(s.id))) d.task_submissions.push(s); });
      }
      apiAttachData(d);
      return d;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[SH_API] loadAll mock gagal:', e);
      return {
        folders: [], files: [], tasks: [], courses: [], users: [],
        task_submissions: [], announcements: [], schedules: [], notes: [],
      };
    }
  }

  // ---------- Classroom-style submission (direct from card/detail) ----------
  // Dipakai oleh tombol "Kumpulkan Tugas" di card daftar-tugas atau di detail-tugas.
  // Beda dengan fmAddFile + detectSubmissionOnUpload: ini langsung pakai task
  // yang ditentukan, tanpa perlu navigate ke folder pengumpulan.
  async function submitTaskFile(taskId, file) {
    const user = currentUser();
    if (!user) return { ok: false, error: 'Wajib login.' };
    if (user.role !== 'student') return { ok: false, error: 'Hanya mahasiswa yang bisa submit.' };

    let task;
    if (isSupabase()) {
      task = await findTask(taskId);
    } else {
      task = findTaskMock(taskId);
    }
    if (!task) return { ok: false, error: 'Tugas tidak ditemukan.' };

    // Upload file ke submission_folder_id milik task
    const uploadRes = await uploadFile(file, task.submission_folder_id);
    if (!uploadRes.ok) return uploadRes;

    // Catat submission (upsert — update file_id kalau sudah ada)
    const subRes = await recordSubmission(task.id, user.id, uploadRes.file.id);
    if (!subRes.ok) return subRes;

    return { ok: true, task, file: uploadRes.file, submission: subRes.submission };
  }

  // ---------- Attachment materi (dosen/PJ lampirkan materi ke task) ----------
  // Dosen/PJ upload file ke folder_id task (folder_id = submission_folder_id untuk
  // konsistensi dengan Page Tugas), lalu tambah metadata ke tasks.attachments.
  async function attachMateriToTask(taskId, file) {
    const user = currentUser();
    if (!user) return { ok: false, error: 'Wajib login.' };
    if (user.role !== 'admin' && user.role !== 'pj') {
      return { ok: false, error: 'Hanya admin/PJ yang bisa menambah materi.' };
    }

    let task;
    if (isSupabase()) {
      task = await findTask(taskId);
    } else {
      task = findTaskMock(taskId);
    }
    if (!task) return { ok: false, error: 'Tugas tidak ditemukan.' };
    // PJ gating lapis 1 (JS)
    if (user.role === 'pj' && Number(task.course_id) !== Number(user.course_id)) {
      return { ok: false, error: 'Tidak punya hak menambah materi ke tugas ini.' };
    }

    // Upload file ke folder_id (folder materi = submission_folder)
    const uploadRes = await uploadFile(file, task.submission_folder_id);
    if (!uploadRes.ok) return uploadRes;

    // Push ke attachments array
    const newAttachment = {
      file_id: uploadRes.file.id,
      name: uploadRes.file.name,
      file_type: uploadRes.file.file_type || 'application/octet-stream',
      size: uploadRes.file.size || 0,
      storage_path: uploadRes.file.storage_path || null,
    };

    if (isSupabase()) {
      // Get current attachments, append new, save
      const currentAttachments = Array.isArray(task.attachments) ? task.attachments : [];
      const { data: updated, error } = await _supabaseClient
        .from('tasks')
        .update({
          attachments: [...currentAttachments, newAttachment],
          updated_at: now(),
        })
        .eq('id', Number(taskId))
        .select()
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, task: updated, attachment: newAttachment };
    }

    // Mock
    if (!Array.isArray(task.attachments)) task.attachments = [];
    task.attachments.push(newAttachment);
    persistTasks();
    return { ok: true, task, attachment: newAttachment };
  }

  async function detachMateriFromTask(taskId, attachmentIndex) {
    const user = currentUser();
    if (!user) return { ok: false, error: 'Wajib login.' };
    if (user.role !== 'admin' && user.role !== 'pj') {
      return { ok: false, error: 'Hanya admin/PJ yang bisa menghapus materi.' };
    }

    let task;
    if (isSupabase()) {
      task = await findTask(taskId);
    } else {
      task = findTaskMock(taskId);
    }
    if (!task) return { ok: false, error: 'Tugas tidak ditemukan.' };
    if (user.role === 'pj' && Number(task.course_id) !== Number(user.course_id)) {
      return { ok: false, error: 'Tidak punya hak menghapus materi dari tugas ini.' };
    }

    const attachments = Array.isArray(task.attachments) ? task.attachments : [];
    if (attachmentIndex < 0 || attachmentIndex >= attachments.length) {
      return { ok: false, error: 'Index materi tidak valid.' };
    }
    const removed = attachments.splice(attachmentIndex, 1)[0];

    if (isSupabase()) {
      const { data: updated, error } = await _supabaseClient
        .from('tasks')
        .update({ attachments, updated_at: now() })
        .eq('id', Number(taskId))
        .select()
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, task: updated, attachment: removed };
    }

    persistTasks();
    return { ok: true, task, attachment: removed };
  }

  // ---------- PJ/Admin: submission stats per task ----------
  // Return: { total_students, submitted, late, not_submitted,
  //          students: [{ profile, submission, status }] }
  // status: 'sudah' | 'belum' | 'terlambat'
  async function getTaskSubmissionStats(taskId) {
    if (!_data && !isSupabase()) return { total_students: 0, submitted: 0, late: 0, not_submitted: 0, students: [] };

    let task;
    let allStudents;
    let submissions;
    if (isSupabase()) {
      const [taskRes, studsRes, subsRes] = await Promise.all([
        findTask(taskId),
        _supabaseClient.from('profiles').select('*').eq('role', 'student'),
        _supabaseClient.from('task_submissions').select('*').eq('task_id', Number(taskId)),
      ]);
      task = taskRes;
      allStudents = (studsRes && studsRes.data) || [];
      submissions = (subsRes && subsRes.data) || [];
    } else {
      task = findTaskMock(taskId);
      allStudents = (getUsersMock() || []).filter((u) => u.role === 'student');
      submissions = (getSubmissionsMock() || []).filter((s) => idEq(s.task_id, taskId));
    }

    if (!task) return { total_students: 0, submitted: 0, late: 0, not_submitted: 0, students: [] };

    // Determine lateness: deadline < submission.updated_at
    function parseDate(s) {
      if (!s) return null;
      const d = new Date(String(s).slice(0, 10));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const deadlineDate = parseDate(task.deadline);

    const students = allStudents.map((student) => {
      const sub = submissions.find((s) => idEq(s.student_id, student.id));
      let status = 'belum';
      if (sub) {
        status = 'sudah';
        // Check late
        if (deadlineDate) {
          const subDate = parseDate(String(sub.updated_at || sub.submitted_at).slice(0, 10));
          if (subDate && subDate > deadlineDate) status = 'terlambat';
        }
      }
      return { profile: student, submission: sub || null, status };
    });

    const submitted = students.filter((s) => s.status === 'sudah').length;
    const late = students.filter((s) => s.status === 'terlambat').length;
    const not_submitted = students.filter((s) => s.status === 'belum').length;

    return {
      total_students: students.length,
      submitted,
      late,
      not_submitted,
      students,
    };
  }

  // ---------- PJ/Admin: matrix student × task status (untuk sheet Status Matrix) ----------
  // Return: { students: [...], tasks: [...], matrix: Map(studentId -> Map(taskId -> status)) }
  async function getCourseStudentMatrix(courseId) {
    if (!_data && !isSupabase()) return { students: [], tasks: [], matrix: {} };

    let allStudents;
    let courseTasks;
    let subs;
    if (isSupabase()) {
      const { data: studs } = await _supabaseClient.from('profiles').select('*').eq('role', 'student');
      const { data: tasks } = await _supabaseClient.from('tasks').select('*').eq('course_id', Number(courseId));
      const { data: submissions } = await _supabaseClient
        .from('task_submissions')
        .select('*')
        .in('task_id', (tasks || []).map((t) => Number(t.id)));
      allStudents = studs || [];
      courseTasks = tasks || [];
      subs = submissions || [];
    } else {
      allStudents = (getUsersMock() || []).filter((u) => u.role === 'student');
      courseTasks = (getTasksMock() || []).filter((t) => idEq(t.course_id, courseId));
      subs = (getSubmissionsMock() || []).filter((s) =>
        courseTasks.some((t) => idEq(t.id, s.task_id))
      );
    }

    function parseDate(s) {
      if (!s) return null;
      const d = new Date(String(s).slice(0, 10));
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const matrix = {};
    for (const student of allStudents) {
      const sid = asId(student.id);
      matrix[sid] = {};
      for (const task of courseTasks) {
        const tid = asId(task.id);
        const sub = subs.find((s) => idEq(s.student_id, student.id) && idEq(s.task_id, task.id));
        let status = 'belum';
        if (sub) {
          status = 'sudah';
          const deadlineDate = parseDate(task.deadline);
          if (deadlineDate) {
            const subDate = parseDate(String(sub.updated_at || sub.submitted_at).slice(0, 10));
            if (subDate && subDate > deadlineDate) status = 'terlambat';
          }
        }
        matrix[sid][tid] = status;
      }
    }

    return { students: allStudents, tasks: courseTasks, matrix };
  }

  // ---------- Init ----------
  initSupabase();

  // ---------- Export ----------
  window.SH_API = {
    // State
    attachData: apiAttachData,
    loadFoldersOverride,
    getMode,
    isSupabase,

    // Read
    loadAll,
    getFolders, getFiles, getTasks, getCourses, getUsers, getSubmissions,
    findFolder, findFile, findTask, findCourse,
    folderPath, folderLocation, folderLocationAsync,
    findTaskBySubmissionFolder,
    getSubmission,
    getTaskStatusForStudent,

    // Submission (mahasiswa)
    recordSubmission,
    detectSubmissionOnUpload,
    uploadFile,
    submitTaskFile,
    getFileDownloadUrl,

    // Materi (admin/PJ)
    attachMateriToTask,
    detachMateriFromTask,

    // Task CRUD
    validateTask, createTask, updateTask, deleteTask,

    // PJ/Admin views
    getTaskSubmissionStats,
    getCourseStudentMatrix,

    // Folder CRUD (persistence mock)
    persistFolders,
  };
})();
