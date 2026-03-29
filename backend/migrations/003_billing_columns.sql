-- Migration 003: Add billing and usage tracking columns to user_profiles.
-- Run this after 002_create_user_profiles.sql.

ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS plan                  TEXT        NOT NULL DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS videos_this_month     INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS usage_month           TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS stripe_customer_id    TEXT        NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT       NOT NULL DEFAULT '';
