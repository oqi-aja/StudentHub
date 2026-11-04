-- ============================================================
-- StudentHub — Migration: Classroom UX (Topic + Attachments)
-- ============================================================
-- STATUS: DRAFT — JANGAN DIJALANKAN OTOMATIS.
-- Tinjau dulu, jalankan manual di Supabase SQL Editor.
--
-- Tujuan:
--   Menambahkan kolom `topic` dan `attachments` ke tabel `tasks`
--   supaya UX Daftar Tugas bisa lebih mirip Google Classroom:
--     - Topic grouping (grouping tugas per topik seperti "Pertemuan 1", "UTS")
--     - Lampiran materi (dosen/PJ bisa attach file materi ke tugas)
--
-- Yang TIDAK diubah:
--   - Struktur relasi yang sudah ada (tasks.course_id, tasks.submission_folder_id)
--   - RLS yang sudah ada (tasks_write_admin, tasks_write_pj_own_course)
--     Kolom baru otomatis ter-cover oleh policy "for all" yang sudah ada
--     di tasks_write_admin dan tasks_write_pj_own_course.
--
-- Rollback:
--   alter table tasks drop column if exists topic;
--   alter table tasks drop column if exists attachments;
-- ============================================================

-- STEP 1: Tambah kolom topic (nullable, untuk grouping tugas)
alter table tasks
  add column if not exists topic text;

comment on column tasks.topic is
  'Topik/grouping tugas (mis. "Pertemuan 1", "UTS"). Null = masuk ke grup "Umum".';

-- STEP 2: Tambah kolom attachments (jsonb, array of materi metadata)
-- Format: [{ "file_id": int, "name": string, "file_type": string, "size": int, "storage_path": string|null }]
-- Catatan: file_id bisa null di mock mode (in-memory). Di Supabase mode,
-- file_id link ke files.id supaya download bisa pakai storage_path.
alter table tasks
  add column if not exists attachments jsonb default '[]'::jsonb;

comment on column tasks.attachments is
  'Array of materi/lampiran dari dosen. Format: [{file_id, name, file_type, size, storage_path}]';

-- STEP 3: Update existing tasks (set default topic = null, attachments = [])
update tasks set topic = null where topic is null;
update tasks set attachments = '[]'::jsonb where attachments is null;

-- Catatan: tidak perlu RLS baru. Policy "for all" tasks_write_admin dan
-- tasks_write_pj_own_course sudah cover INSERT/UPDATE/DELETE semua kolom
-- di tabel tasks, termasuk kolom baru topic + attachments.

-- ============================================================
-- Verifikasi (jalankan setelah apply migration)
-- ============================================================
-- select column_name, data_type from information_schema.columns
-- where table_name = 'tasks' order by ordinal_position;
-- Harus muncul: id, course_id, title, description, deadline, dosen,
--               submission_folder_id, folder_id, created_by, created_at,
--               updated_at, topic, attachments
