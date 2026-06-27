-- ═══════════════════════════════════════════════════════════
-- RIDE INSTRUCTOR PATHWAY — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

-- ── PROFILES ──────────────────────────────────────────────
CREATE TABLE profiles (
  id         UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('student', 'coach')),
  email      TEXT,
  location   TEXT,
  start_date DATE,
  coach_id   UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup (name + role passed as user_metadata)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, name, role, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student'),
    NEW.email
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── TASK PROGRESS ─────────────────────────────────────────
CREATE TABLE task_progress (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  stage_idx  SMALLINT NOT NULL,
  day_idx    SMALLINT NOT NULL,
  task_idx   SMALLINT NOT NULL,
  completed  BOOLEAN DEFAULT FALSE NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (student_id, stage_idx, day_idx, task_idx)
);

-- ── DAY DATA (reflection, video, open date) ───────────────
CREATE TABLE day_data (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id  UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  stage_idx   SMALLINT NOT NULL,
  day_idx     SMALLINT NOT NULL,
  reflection  TEXT,
  video_url   TEXT,
  opened_at   TIMESTAMPTZ,
  UNIQUE (student_id, stage_idx, day_idx)
);

-- ── COACH REMARKS ─────────────────────────────────────────
CREATE TABLE coach_remarks (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  coach_id   UUID REFERENCES profiles(id) NOT NULL,
  stage_idx  SMALLINT NOT NULL,
  day_idx    SMALLINT NOT NULL,
  remark     TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, stage_idx, day_idx)
);

-- ── STAGE SIGN-OFFS ───────────────────────────────────────
CREATE TABLE stage_signoffs (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  coach_id   UUID REFERENCES profiles(id) NOT NULL,
  stage_idx  SMALLINT NOT NULL,
  note       TEXT,
  signed_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, stage_idx)
);

-- ── MESSAGES (async chat) ─────────────────────────────────
CREATE TABLE messages (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sender_id  UUID REFERENCES profiles(id) NOT NULL,
  from_role  TEXT NOT NULL CHECK (from_role IN ('student', 'coach')),
  text       TEXT NOT NULL,
  stage_ref  SMALLINT,
  day_ref    SMALLINT,
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── SESSION LOGS ──────────────────────────────────────────
CREATE TABLE session_logs (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  ended_at     TIMESTAMPTZ,
  duration_mins INT
);

-- ═══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════
ALTER TABLE profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_data     ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_remarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY "profiles_read" ON profiles FOR SELECT USING (
  auth.uid() = id OR
  coach_id = auth.uid() OR
  id IN (SELECT coach_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- TASK PROGRESS
CREATE POLICY "task_read" ON task_progress FOR SELECT USING (
  auth.uid() = student_id OR
  auth.uid() IN (SELECT coach_id FROM profiles WHERE id = student_id)
);
CREATE POLICY "task_write" ON task_progress FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "task_update" ON task_progress FOR UPDATE USING (auth.uid() = student_id);

-- DAY DATA
CREATE POLICY "day_read" ON day_data FOR SELECT USING (
  auth.uid() = student_id OR
  auth.uid() IN (SELECT coach_id FROM profiles WHERE id = student_id)
);
CREATE POLICY "day_write" ON day_data FOR INSERT WITH CHECK (auth.uid() = student_id);
CREATE POLICY "day_update" ON day_data FOR UPDATE USING (auth.uid() = student_id);

-- COACH REMARKS
CREATE POLICY "remarks_read" ON coach_remarks FOR SELECT USING (
  auth.uid() = student_id OR auth.uid() = coach_id
);
CREATE POLICY "remarks_write" ON coach_remarks FOR INSERT WITH CHECK (
  auth.uid() = coach_id AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'coach')
);
CREATE POLICY "remarks_update" ON coach_remarks FOR UPDATE USING (auth.uid() = coach_id);

-- STAGE SIGN-OFFS
CREATE POLICY "signoffs_read" ON stage_signoffs FOR SELECT USING (
  auth.uid() = student_id OR auth.uid() = coach_id
);
CREATE POLICY "signoffs_write" ON stage_signoffs FOR INSERT WITH CHECK (
  auth.uid() = coach_id AND
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'coach')
);
CREATE POLICY "signoffs_update" ON stage_signoffs FOR UPDATE USING (auth.uid() = coach_id);

-- MESSAGES
CREATE POLICY "messages_read" ON messages FOR SELECT USING (
  auth.uid() = student_id OR
  auth.uid() = sender_id OR
  auth.uid() IN (SELECT coach_id FROM profiles WHERE id = student_id)
);
CREATE POLICY "messages_write" ON messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id AND (
    (from_role = 'student' AND auth.uid() = student_id) OR
    (from_role = 'coach' AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'coach'))
  )
);
CREATE POLICY "messages_mark_read" ON messages FOR UPDATE USING (
  auth.uid() = student_id OR
  auth.uid() IN (SELECT coach_id FROM profiles WHERE id = student_id)
);

-- SESSION LOGS
CREATE POLICY "sessions_own" ON session_logs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "sessions_coach_view" ON session_logs FOR SELECT USING (
  auth.uid() IN (SELECT coach_id FROM profiles WHERE id = user_id)
);

-- ── REALTIME (enable for messages table) ──────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
