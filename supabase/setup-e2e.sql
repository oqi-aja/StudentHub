-- ============================================================
-- StudentHub — Setup Data Awal & Akun Demo (Otomatis)
-- ============================================================
-- Skrip ini otomatis membuat akun di auth.users (dengan password hash),
-- profiles terkait, courses, folders, dan contoh tasks.
-- Aman dijalankan berulang kali (idempotent / clean reset).
-- ============================================================

DO $$
DECLARE
  uid_admin uuid := gen_random_uuid();
  uid_budi  uuid := gen_random_uuid();
  uid_andi  uuid := gen_random_uuid();
BEGIN
  -- Bersihkan akun demo lama
  DELETE FROM auth.users WHERE email IN ('admin@supabase.local', 'budi@supabase.local', 'andi@supabase.local');

  -- 1. Insert Admin (Ketua Kelas)
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
  ) VALUES (
    uid_admin, '00000000-0000-0000-0000-000000000000', 'admin@supabase.local',
    crypt('admin123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"name":"Admin"}', now(), now(), 'authenticated', 'authenticated'
  );

  -- 2. Insert Budi (Mahasiswa)
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
  ) VALUES (
    uid_budi, '00000000-0000-0000-0000-000000000000', 'budi@supabase.local',
    crypt('budi123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"name":"Budi"}', now(), now(), 'authenticated', 'authenticated'
  );

  -- 3. Insert Andi (PJ Matkul)
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, role, aud
  ) VALUES (
    uid_andi, '00000000-0000-0000-0000-000000000000', 'andi@supabase.local',
    crypt('andi123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"name":"Andi"}', now(), now(), 'authenticated', 'authenticated'
  );

  -- 4. Insert Profiles
  INSERT INTO profiles (id, username, name, role, course_id) VALUES
    (uid_admin, 'admin', 'Ketua Kelas (Admin)', 'admin', null),
    (uid_budi,  'budi',  'Budi Mahasiswa',     'student', null),
    (uid_andi,  'andi',  'Andi PJ Matkul',     'pj', 1);

END $$;

-- 5. Storage Bucket 'tugas'
INSERT INTO storage.buckets (id, name, public)
VALUES ('tugas', 'tugas', false)
ON CONFLICT (id) DO NOTHING;

-- 6. Contoh Mata Kuliah
INSERT INTO courses (id, name, code) VALUES
(1, 'Pemrograman Web', 'IF401'),
(2, 'Basis Data', 'IF402')
ON CONFLICT (id) DO NOTHING;

-- 7. Folder Pengumpulan Tugas
INSERT INTO folders (id, parent_id, name) VALUES
(1, null, 'Semester 1'),
(2, 1, 'Tugas Pemrograman Web'),
(3, 1, 'Tugas Basis Data')
ON CONFLICT (id) DO NOTHING;

-- 8. Contoh Tugas
INSERT INTO tasks (id, course_id, title, description, deadline, submission_folder_id) VALUES
(1, 1, 'Membuat Landing Page Responsif', 'Buat halaman web responsif menggunakan HTML dan CSS murni.', (CURRENT_DATE + INTERVAL '7 days')::date, 2),
(2, 2, 'Normalisasi Database 3NF', 'Selesaikan studi kasus normalisasi tabel basis data universitas.', (CURRENT_DATE + INTERVAL '3 days')::date, 3)
ON CONFLICT (id) DO NOTHING;
