-- Migration 004: Team workspaces.
-- Run after 003_billing_columns.sql.

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Team members join table
CREATE TABLE IF NOT EXISTS team_members (
    team_id   UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

-- Add team_id to jobs (nullable — null = personal job)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- ── RLS: teams ────────────────────────────────────────────────────────────────
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their teams"
    ON teams FOR SELECT
    USING (id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));

CREATE POLICY "Owners can update their teams"
    ON teams FOR UPDATE
    USING (owner_id = auth.uid());

CREATE POLICY "Owners can delete their teams"
    ON teams FOR DELETE
    USING (owner_id = auth.uid());

-- ── RLS: team_members ─────────────────────────────────────────────────────────
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view co-members"
    ON team_members FOR SELECT
    USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));
