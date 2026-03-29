-- Migration 002: user_profiles table for storing per-user OAuth credentials.
-- Run this in your Supabase SQL editor after 001_create_jobs.sql.

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    youtube_credentials JSONB,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security: users can only access their own profile row.
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own profile"
    ON user_profiles
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
