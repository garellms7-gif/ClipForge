-- ClipForge: initial jobs table
-- Run this in your Supabase SQL editor (or via psql against your project DB).

CREATE TABLE IF NOT EXISTS jobs (
    id          UUID         PRIMARY KEY,
    user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status      TEXT         NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    settings    JSONB,
    summary     JSONB
);

-- Index for fast per-user job lookups
CREATE INDEX IF NOT EXISTS jobs_user_id_idx ON jobs (user_id);

-- Row-Level Security (optional — backend uses service role key which bypasses RLS,
-- but enabling RLS prevents accidental direct client access)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own rows when using the anon/user JWT
CREATE POLICY "Users access own jobs"
    ON jobs
    FOR ALL
    USING (auth.uid() = user_id);
