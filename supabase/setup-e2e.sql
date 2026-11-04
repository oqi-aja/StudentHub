-- ============================================================
-- StudentHub — Setup SQL untuk E2E Testing di Supabase
-- ============================================================
-- File ini BERISI SQL yang Anda copy-paste ke Supabase SQL Editor.
-- Aman: hanya pakai anon/publishable key di frontend (tidak butuh service_role).
--
-- Prasyarat:
--   1. Project Supabase sudah dibuat di dashboard.supabase.com
--   2. js/config.js sudah diisi URL + anonKey (enabled: true)
--   3. Anda sudah buat 4 user di Authentication → Users:
--        - admin@supabase.local  → role admin
--        - budi@supabase.local   → role student
--        - andi@supabase.local   → role student
--        - dina@supabase.local   → role pj, course_id = 2 (Basis Data)
--
-- LANGKAH EKSEKUSI:
--   A. Jalankan supabase/schema.sql (semua tabel + RLS)
--   B. Buat Storage bucket "tugas" + policies (lihat section B di bawah)
--   C. Buat 4 user di Authentication → Users → Add user (manual via Dashboard)
--   D. Catat UUID masing-masing user, isi ke variabel di section C
--   E. Jalankan section C (insert profiles + courses + folders + tasks)
--   F. Test login di StudentHub
-- ============================================================


-- ============================================================
-- SECTION A: Skema utama
-- ============================================================
-- Jalankan isi file supabase/schema.sql seluruhnya di SQL Editor.
-- Skema itu sudah mencakup: profiles, courses, folders, files, tasks,
-- task_submissions + RLS policies + helper functions (is_admin, is_pj, dll).
--
-- Catatan: baris insert into storage.buckets di schema.sql di-comment.
-- Anda jalankan terpisah di section B di bawah.


-- ============================================================
-- SECTION B: Storage bucket + policies
-- ============================================================
-- StudentHub menyimpan file upload mahasiswa di bucket bernama "tugas".
-- Bucket ini PRIVATE (tidak public) supaya hanya authenticated user
-- yang punya akses. File disurvey lewat signed URL.

-- B.1 Buat bucket (jalankan sekali)
insert into storage.buckets (id, name, public)
values ('tugas', 'tugas', false)
on conflict (id) do nothing;

-- B.2 Policy: hanya authenticated user yang bisa upload ke bucket "tugas"
--    File path format: <user_id>/<folder_id>/<timestamp>-<safe_name>
--    Pembatasan path user_id/<...> = user hanya bisa upload file di folder miliknya
drop policy if exists "tugas_upload_owner" on storage.objects;
create policy "tugas_upload_owner" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'tugas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- B.3 Policy: user bisa read file miliknya sendiri
drop policy if exists "tugas_read_owner" on storage.objects;
create policy "tugas_read_owner" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'tugas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- B.4 Policy: admin & PJ bisa read semua file di bucket "tugas"
drop policy if exists "tugas_read_admin_pj" on storage.objects;
create policy "tugas_read_admin_pj" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'tugas'
    and (
      exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      or exists (select 1 from profiles where id = auth.uid() and role = 'pj')
    )
  );

-- B.5 Policy: user bisa delete file miliknya sendiri
drop policy if exists "tugas_delete_owner" on storage.objects;
create policy "tugas_delete_owner" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'tugas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- B.6 Policy: admin bisa delete semua file di bucket "tugas"
drop policy if exists "tugas_delete_admin" on storage.objects;
create policy "tugas_delete_admin" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'tugas'
    and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );


-- ============================================================
-- SECTION C: Data seed (profiles + courses + folders + tasks)
-- ============================================================
-- SEBELUM MENJALANKAN: ganti placeholder <ADMIN_UUID>, <BUDI_UUID>,
-- <ANDI_UUID>, <DINA_UUID> dengan UUID asli dari Authentication → Users
-- di dashboard Supabase Anda.
--
-- Cara ambil UUID:
--   1. Buka Supabase Dashboard → Authentication → Users
--   2. Klik user "admin@supabase.local"
--   3. Copy nilai "User UID" (format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
--   4. Paste ke placeholder di bawah
--   5. Ulangi untuk budi, andi, dina

-- C.1 Insert 4 row profiles (id = auth.users.id UUID, role, course_id)
--     ⚠️ Ganti placeholder dulu!
insert into profiles (id, username, name, role, course_id) values
  ('<ADMIN_UUID>', 'admin', 'Oqi', 'admin', null),
  ('<BUDI_UUID>',  'budi',  'Budi', 'student', null),
  ('<ANDI_UUID>',  'andi',  'Andi', 'student', null),
  ('<DINA_UUID>',  'dina',  'Dina', 'pj', 2)
on conflict (id) do update set
  username = excluded.username,
  name = excluded.name,
  role = excluded.role,
  course_id = excluded.course_id,
  updated_at = now();

-- C.2 Insert 3 courses (id, name, code)
insert into courses (id, name, code) values
  (1, 'Pemrograman', 'IF-101'),
  (2, 'Basis Data', 'IF-102'),
  (3, 'Jaringan', 'IF-103')
on conflict (id) do update set
  name = excluded.name,
  code = excluded.code;

-- C.3 Insert folder tree: Semester 1 → Pemrograman / Basis Data / Jaringan
--     Parent: 1 = "Semester 1" (root)
--     Anak:   2 = Pemrograman, 3 = Basis Data, 4 = Jaringan
--     created_by pakai UUID admin
insert into folders (id, parent_id, name, created_by) values
  (1, null, 'Semester 1', '<ADMIN_UUID>'),
  (2, 1,    'Pemrograman', '<ADMIN_UUID>'),
  (3, 1,    'Basis Data',   '<ADMIN_UUID>'),
  (4, 1,    'Jaringan',     '<ADMIN_UUID>')
on conflict (id) do update set
  name = excluded.name,
  parent_id = excluded.parent_id;

-- C.4 Insert 1 task sample (course_id=1 = Pemrograman, submission_folder_id=2 = Pemrograman folder)
--     Tugas ini untuk mahasiswa Pemrograman test upload
insert into tasks (id, course_id, title, description, deadline, dosen, submission_folder_id, folder_id, created_by) values
  (1, 1, 'Tugas 1 - Algoritma', 'Buat program sorting (bubble, selection, insertion) beserta laporan singkat.', '2026-12-31', 'Pak A', 2, 2, '<ADMIN_UUID>')
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  deadline = excluded.deadline,
  dosen = excluded.dosen,
  submission_folder_id = excluded.submission_folder_id,
  updated_at = now();

-- C.5 (Opsional) Insert task untuk course 2 (Basis Data, milik PJ Dina)
--     PJ Dina seharusnya bisa edit/hapus task ini; tidak bisa untuk task course 1.
insert into tasks (id, course_id, title, description, deadline, dosen, submission_folder_id, folder_id, created_by) values
  (2, 2, 'Tugas 1 - ERD Perpustakaan', 'Buat ERD untuk sistem perpustakaan beserta normalization 3NF.', '2026-12-15', 'Bu B', 3, 3, '<ADMIN_UUID>')
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  deadline = excluded.deadline,
  dosen = excluded.dosen,
  submission_folder_id = excluded.submission_folder_id,
  updated_at = now();


-- ============================================================
-- SECTION D: Verifikasi
-- ============================================================

-- D.1 Cek jumlah row di tiap tabel (harus 4 profiles, 3 courses, 4 folders, 2 tasks)
select 'profiles' as t, count(*) from profiles
union all select 'courses', count(*) from courses
union all select 'folders', count(*) from folders
union all select 'tasks', count(*) from tasks;

-- D.2 Cek RLS aktif di semua tabel (harus semua true)
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('profiles','courses','folders','files','tasks','task_submissions');

-- D.3 Cek policy yang aktif
select tablename, policyname, per, roles, cmd, qual from pg_policies where schemaname = 'public' order by tablename, policyname;

-- D.4 Cek storage bucket + policies
select * from storage.buckets where id = 'tugas';
select policyname, cmd, qual from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname;


-- ============================================================
-- SECTION E: Setelah E2E test, cek hasil submission
-- ============================================================

-- E.1 Lihat semua submission (jalankan setelah mahasiswa upload file)
select
  ts.id,
  ts.task_id,
  t.title as task_title,
  ts.student_id,
  p.name as student_name,
  ts.file_id,
  f.name as file_name,
  f.storage_path,
  ts.submitted_at,
  ts.updated_at
from task_submissions ts
join tasks t on t.id = ts.task_id
join profiles p on p.id = ts.student_id
join files f on f.id = ts.file_id
order by ts.id desc;

-- E.2 Verifikasi: setelah upload ulang, tidak ada duplicate submission
--     (task_id + student_id harus unik)
select task_id, student_id, count(*) as dup_count
from task_submissions
group by task_id, student_id
having count(*) > 1;
-- Harus return 0 rows (no duplicates)


-- ============================================================
-- SECTION F: Cleanup (opsional, untuk reset)
-- ============================================================

-- F.1 Hapus semua submission (kalau mau reset test)
-- truncate table task_submissions cascade;

-- F.2 Hapus semua file metadata (Storage bucket file tetap ada, hapus manual)
-- truncate table files cascade;

-- F.3 Drop semua tabel (DANGER! reset total)
-- drop table if exists task_submissions cascade;
-- drop table if exists tasks cascade;
-- drop table if exists files cascade;
-- drop table if exists folders cascade;
-- drop table if exists courses cascade;
-- drop table if exists profiles cascade;
-- drop function if exists is_admin() cascade;
-- drop function if exists is_pj() cascade;
-- drop function if exists is_student() cascade;
-- drop function if exists current_profile() cascade;
