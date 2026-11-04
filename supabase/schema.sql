-- ============================================================
-- StudentHub — Supabase PostgreSQL schema + RLS
-- ============================================================
-- Run this SQL in your Supabase project's SQL Editor.
-- Mirrors the mock structure used by js/api.js (localStorage),
-- so swapping the data layer from mock → Supabase needs no UI changes.
--
-- Table mapping (mock → Supabase):
--   data.users             → profiles (link ke auth.users)
--   data.courses           → courses
--   data.folders           → folders (self-reference parent_id)
--   data.files             → files (metadata + storage_path)
--   data.tasks             → tasks (submission_folder_id = link inti)
--   data.task_submissions  → task_submissions (unique task_id+student_id)
-- ============================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ---------- profiles ----------
-- Dipisah dari auth.users Supabase. id = auth.users.id (link)
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  name        text not null,
  role        text not null check (role in ('admin','pj','student')),
  course_id   int,  -- wajib untuk pj; null untuk admin/student
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- courses ----------
create table if not exists courses (
  id          int primary key,
  name        text not null unique,
  code        text,
  created_at  timestamptz not null default now()
);

-- ---------- folders (pohon tak terbatas) ----------
create table if not exists folders (
  id          int primary key,
  parent_id   int references folders(id) on delete cascade,  -- null = root
  name        text not null,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_folders_parent on folders(parent_id);

-- ---------- files (metadata + storage_path) ----------
create table if not exists files (
  id            int primary key,
  folder_id     int references folders(id) on delete cascade,
  user_id       uuid references profiles(id),
  name          text not null,
  file_type     text not null default 'application/octet-stream',
  visibility    text not null default 'private' check (visibility in ('public','private')),
  size          bigint not null default 0,
  storage_path  text,  -- path di Supabase Storage bucket "tugas"
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_files_folder on files(folder_id);
create index if not exists idx_files_user on files(user_id);

-- ---------- tasks (DAFTAR TUGAS) ----------
create table if not exists tasks (
  id                    int primary key,
  course_id             int not null references courses(id),
  title                 text not null,
  description           text not null default '',
  deadline              date not null,
  dosen                 text not null default '',
  submission_folder_id  int not null references folders(id),  -- LOKASI PENGUMPULAN
  folder_id             int references folders(id),  -- untuk display di file manager (lama)
  topic                 text,  -- grouping tugas (mis. "Pertemuan 1", "UTS"). Null = "Umum"
  attachments           jsonb not null default '[]'::jsonb,  -- array of materi metadata
  created_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_tasks_course on tasks(course_id);
create index if not exists idx_tasks_submission_folder on tasks(submission_folder_id);

-- ---------- task_submissions (PROOF OF SUBMISSION) ----------
create table if not exists task_submissions (
  id           int primary key,
  task_id      int not null references tasks(id) on delete cascade,
  student_id   uuid not null references profiles(id) on delete cascade,
  file_id      int not null references files(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (task_id, student_id)  -- 1 submission aktif per task per student
);
create index if not exists idx_submissions_task on task_submissions(task_id);
create index if not exists idx_submissions_student on task_submissions(student_id);

-- ============================================================
-- Row Level Security (RLS) — turn on in Supabase dashboard
-- ============================================================

alter table profiles enable row level security;
alter table courses enable row level security;
alter table folders enable row level security;
alter table files enable row level security;
alter table tasks enable row level security;
alter table task_submissions enable row level security;

-- Helper functions
create or replace function current_profile()
returns profiles language sql stable security definer as $$
  select * from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function is_pj()
returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'pj');
$$;

create or replace function is_student()
returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'student');
$$;

-- ---------- profiles policies ----------
create policy "profiles_select_logged_in" on profiles
  for select using (auth.uid() is not null);
create policy "profiles_write_admin" on profiles
  for all using (is_admin()) with check (is_admin());

-- ---------- courses policies ----------
create policy "courses_select_logged_in" on courses
  for select using (auth.uid() is not null);
create policy "courses_write_admin" on courses
  for all using (is_admin()) with check (is_admin());

-- ---------- folders policies ----------
create policy "folders_select_logged_in" on folders
  for select using (auth.uid() is not null);
create policy "folders_write_admin_pj" on folders
  for all using (is_admin() or is_pj()) with check (is_admin() or is_pj());

-- ---------- files policies ----------
create policy "files_select_logged_in" on files
  for select using (auth.uid() is not null);
create policy "files_write_admin_pj" on files
  for all using (is_admin() or is_pj()) with check (is_admin() or is_pj());
create policy "files_write_owner_student" on files
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- tasks policies ----------
create policy "tasks_select_logged_in" on tasks
  for select using (auth.uid() is not null);
create policy "tasks_write_admin" on tasks
  for all using (is_admin()) with check (is_admin());
create policy "tasks_write_pj_own_course" on tasks
  for all using (
    is_pj() and course_id = (select course_id from profiles where id = auth.uid())
  )
  with check (
    is_pj() and course_id = (select course_id from profiles where id = auth.uid())
  );

-- ---------- task_submissions policies ----------
create policy "submissions_select_owner_or_admin_pj" on task_submissions
  for select using (
    student_id = auth.uid()
    or is_admin()
    or (is_pj() and task_id in (
      select id from tasks where course_id = (select course_id from profiles where id = auth.uid())
    ))
  );

create policy "submissions_insert_owner_or_admin" on task_submissions
  for insert with check (
    student_id = auth.uid()
    or is_admin()
  );

create policy "submissions_update_owner_or_admin" on task_submissions
  for update using (
    student_id = auth.uid()
    or is_admin()
  ) with check (
    student_id = auth.uid()
    or is_admin()
  );

create policy "submissions_delete_admin_or_pj_own_course" on task_submissions
  for delete using (
    is_admin()
    or (is_pj() and task_id in (
      select id from tasks where course_id = (select course_id from profiles where id = auth.uid())
    ))
  );

-- ============================================================
-- Storage bucket & policies (run in Supabase SQL editor)
-- ============================================================
-- insert into storage.buckets (id, name, public) values
--   ('tugas', 'tugas', false),
--   ('studenthub-files', 'studenthub-files', false)
-- on conflict (id) do nothing;
--
-- create policy "sh_storage_upload_owner" on storage.objects
--   for insert to authenticated with check (
--     bucket_id in ('tugas', 'studenthub-files')
--     and (storage.foldername(name))[1] = auth.uid()::text
--   );
--
-- create policy "sh_storage_read_access" on storage.objects
--   for select to authenticated using (
--     bucket_id in ('tugas', 'studenthub-files')
--     and (
--       (storage.foldername(name))[1] = auth.uid()::text
--       or is_admin()
--       or (is_pj() and exists (
--         select 1 from files f
--         join folders fl on fl.id = f.folder_id
--         where f.storage_path = name
--           and fl.course_id = (select course_id from profiles where id = auth.uid())
--       ))
--     )
--   );
--
-- create policy "sh_storage_delete_access" on storage.objects
--   for delete to authenticated using (
--     bucket_id in ('tugas', 'studenthub-files')
--     and (
--       (storage.foldername(name))[1] = auth.uid()::text
--       or is_admin()
--       or (is_pj() and exists (
--         select 1 from files f
--         join folders fl on fl.id = f.folder_id
--         where f.storage_path = name
--           and fl.course_id = (select course_id from profiles where id = auth.uid())
--       ))
--     )
--   );

-- ============================================================
-- Seed data (jalankan sekali untuk data awal)
-- ============================================================
-- insert into courses (id, name, code) values
--   (1, 'Pemrograman', 'IF-101'),
--   (2, 'Basis Data', 'IF-102'),
--   (3, 'Jaringan', 'IF-103')
-- on conflict (id) do nothing;

-- Untuk profiles, signup dulu via Supabase Auth, lalu insert dengan UUID asli:
-- insert into profiles (id, username, name, role, course_id) values
--   ('<admin-uuid>', 'admin', 'Oqi', 'admin', null),
--   ('<budi-uuid>', 'budi', 'Budi', 'student', null),
--   ('<andi-uuid>', 'andi', 'Andi', 'student', null),
--   ('<dina-uuid>', 'dina', 'Dina', 'pj', 2)
-- on conflict (id) do nothing;

-- insert into folders (id, parent_id, name, created_by) values
--   (1, null, 'Semester 1', '<admin-uuid>'),
--   (2, 1, 'Pemrograman', '<admin-uuid>'),
--   (3, 1, 'Basis Data', '<admin-uuid>'),
--   (4, 1, 'Jaringan', '<admin-uuid>')
-- on conflict (id) do nothing;

-- insert into tasks (id, course_id, title, description, deadline, dosen, submission_folder_id, folder_id, created_by) values
--   (1, 1, 'Tugas 1 - Algoritma', 'Buat program sorting beserta laporan singkat.', '2026-10-10', 'Pak A', 2, 2, '<admin-uuid>')
-- on conflict (id) do nothing;
