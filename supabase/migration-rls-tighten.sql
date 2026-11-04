-- ============================================================
-- StudentHub — Migration: Ketatkan RLS untuk folders, files,
-- task_submissions & Supabase Storage (studenthub-files / tugas)
-- ============================================================
-- STATUS: DRAFT — JANGAN DIJALANKAN OTOMATIS.
-- Tinjau dulu bersama tim sebelum apply di Supabase SQL Editor.
--
-- MASALAH YANG DITANGANI:
--   1. Policy lama (folders_write_admin_pj, files_write_admin_pj)
--      mengizinkan PJ mata kuliah mana pun untuk INSERT/UPDATE/DELETE
--      folder/file milik mata kuliah lain.
--   2. Policy task_submissions lama (submissions_write_owner) mengizinkan
--      mahasiswa untuk DELETE baris submission mereka sendiri, berisiko
--      merusak integritas bukti pengumpulan tugas.
--   3. Supabase Storage bucket ('studenthub-files' / 'tugas') belum memiliki
--      kebijakan isolasi ketat antar-PJ mata kuliah.
--
-- STRATEGI:
--   1. Tambah kolom folders.course_id (nullable) — folder root mata kuliah
--      punya course_id = X, subfolder mewarisi via trigger.
--   2. Ganti policy folders & files dengan policy ketat per course.
--   3. Kunci task_submissions: mahasiswa hanya boleh INSERT/UPDATE miliknya,
--      DELETE hanya boleh dilakukan oleh Admin atau PJ mata kuliah terkait.
--   4. Terapkan RLS Storage objects untuk bucket 'studenthub-files' dan 'tugas'.
-- ============================================================

-- ============================================================
-- STEP 1: Tambah kolom course_id ke folders
-- ============================================================

alter table folders
  add column if not exists course_id int references courses(id) on delete set null;

-- ============================================================
-- STEP 2: Trigger untuk wariskan course_id ke subfolder
-- ============================================================

create or replace function fn_folders_inherit_course_id()
returns trigger language plpgsql as $$
begin
  if new.course_id is null and new.parent_id is not null then
    select course_id into new.course_id from folders where id = new.parent_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_folders_inherit_course_id on folders;
create trigger trg_folders_inherit_course_id
  before insert on folders
  for each row execute function fn_folders_inherit_course_id();

-- ============================================================
-- STEP 3: Drop policy lama yang longgar
-- ============================================================

drop policy if exists "folders_write_admin_pj" on folders;
drop policy if exists "files_write_admin_pj" on files;

-- ============================================================
-- STEP 4: Buat policy ketat per course untuk folders & files
-- ============================================================

-- folders: PJ hanya boleh write folder yang course_id-nya = course PJ sendiri
create policy "folders_write_admin_or_pj_own_course" on folders
  for all
  using (
    is_admin()
    or (is_pj() and course_id = (select course_id from profiles where id = auth.uid()))
  )
  with check (
    is_admin()
    or (is_pj() and course_id = (select course_id from profiles where id = auth.uid()))
  );

-- files: PJ hanya boleh write file yang folder-nya punya course_id = course PJ
create policy "files_write_admin_or_pj_own_course" on files
  for all
  using (
    is_admin()
    or (is_pj() and folder_id in (
      select id from folders where course_id = (select course_id from profiles where id = auth.uid())
    ))
    or user_id = auth.uid()  -- mahasiswa tetap bisa write file miliknya sendiri
  )
  with check (
    is_admin()
    or (is_pj() and folder_id in (
      select id from folders where course_id = (select course_id from profiles where id = auth.uid())
    ))
    or user_id = auth.uid()
  );

-- ============================================================
-- STEP 5: Penguatan RLS task_submissions
-- ============================================================

drop policy if exists "submissions_write_owner" on task_submissions;
drop policy if exists "submissions_write_admin" on task_submissions;

-- Mahasiswa hanya boleh INSERT submission atas namanya sendiri (Admin bebas)
create policy "submissions_insert_owner_or_admin" on task_submissions
  for insert
  with check (
    student_id = auth.uid()
    or is_admin()
  );

-- Mahasiswa hanya boleh UPDATE submission miliknya sendiri (unggah ulang file)
create policy "submissions_update_owner_or_admin" on task_submissions
  for update
  using (
    student_id = auth.uid()
    or is_admin()
  )
  with check (
    student_id = auth.uid()
    or is_admin()
  );

-- HANYA Admin atau PJ mata kuliah yang bersangkutan yang boleh DELETE submission
create policy "submissions_delete_admin_or_pj_own_course" on task_submissions
  for delete
  using (
    is_admin()
    or (is_pj() and task_id in (
      select id from tasks where course_id = (select course_id from profiles where id = auth.uid())
    ))
  );

-- ============================================================
-- STEP 6: RLS Storage Bucket (studenthub-files & tugas)
-- ============================================================

-- Pastikan kedua bucket tersedia
insert into storage.buckets (id, name, public)
values
  ('tugas', 'tugas', false),
  ('studenthub-files', 'studenthub-files', false)
on conflict (id) do nothing;

-- 6.1 Upload (INSERT): Hanya authenticated user, wajib path diawali UUID sendiri
drop policy if exists "sh_storage_upload_owner" on storage.objects;
create policy "sh_storage_upload_owner" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id in ('tugas', 'studenthub-files')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 6.2 Read (SELECT):
--     - Pemilik file sendiri
--     - Admin (semua file)
--     - PJ matkul (hanya file di bawah folder mata kuliah miliknya)
drop policy if exists "sh_storage_read_access" on storage.objects;
create policy "sh_storage_read_access" on storage.objects
  for select
  to authenticated
  using (
    bucket_id in ('tugas', 'studenthub-files')
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or is_admin()
      or (is_pj() and exists (
        select 1 from files f
        join folders fl on fl.id = f.folder_id
        where f.storage_path = name
          and fl.course_id = (select course_id from profiles where id = auth.uid())
      ))
    )
  );

-- 6.3 Delete (DELETE):
--     - Pemilik file sendiri
--     - Admin
--     - PJ matkul (hanya file di mata kuliahnya)
drop policy if exists "sh_storage_delete_access" on storage.objects;
create policy "sh_storage_delete_access" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id in ('tugas', 'studenthub-files')
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or is_admin()
      or (is_pj() and exists (
        select 1 from files f
        join folders fl on fl.id = f.folder_id
        where f.storage_path = name
          and fl.course_id = (select course_id from profiles where id = auth.uid())
      ))
    )
  );

-- ============================================================
-- ROLLBACK (jalankan kalau perlu kembali ke policy lama)
-- ============================================================
-- alter table folders drop column if exists course_id;
-- drop trigger if exists trg_folders_inherit_course_id on folders;
-- drop function if exists fn_folders_inherit_course_id();
-- drop policy if exists "folders_write_admin_or_pj_own_course" on folders;
-- drop policy if exists "files_write_admin_or_pj_own_course" on files;
-- drop policy if exists "submissions_insert_owner_or_admin" on task_submissions;
-- drop policy if exists "submissions_update_owner_or_admin" on task_submissions;
-- drop policy if exists "submissions_delete_admin_or_pj_own_course" on task_submissions;
-- drop policy if exists "sh_storage_upload_owner" on storage.objects;
-- drop policy if exists "sh_storage_read_access" on storage.objects;
-- drop policy if exists "sh_storage_delete_access" on storage.objects;
--
-- create policy "folders_write_admin_pj" on folders
--   for all using (is_admin() or is_pj()) with check (is_admin() or is_pj());
-- create policy "files_write_admin_pj" on files
--   for all using (is_admin() or is_pj()) with check (is_admin() or is_pj());
-- create policy "submissions_write_owner" on task_submissions
--   for all using (student_id = auth.uid()) with check (student_id = auth.uid());
-- create policy "submissions_write_admin" on task_submissions
--   for all using (is_admin()) with check (is_admin());
-- ============================================================
