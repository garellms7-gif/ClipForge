-- Migration 005: Scheduled publishing.
-- Run after 004_teams.sql.

CREATE TABLE IF NOT EXISTS scheduled_publishes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platforms       TEXT[] NOT NULL DEFAULT '{}',
    scheduled_at    TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'published', 'failed', 'cancelled')),
    youtube_settings JSONB,
    rumble_settings  JSONB,
    error_message    TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE scheduled_publishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own scheduled publishes"
    ON scheduled_publishes FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
