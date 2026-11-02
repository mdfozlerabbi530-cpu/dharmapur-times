-- Dharmapur Times — Supabase schema
-- Run this ONCE in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It creates the three tables the server expects. No keys, secrets, or
-- credentials are included in this file.
--
-- SECURITY NOTE: Row Level Security (RLS) is deliberately NOT enabled
-- on these tables. The server talks to Supabase with the SERVICE key
-- (SUPABASE_SERVICE_KEY), which bypasses RLS by design, and the key is
-- kept server-side only (Render env var, never in frontend code or in
-- this repo). Do NOT expose the service key to browsers, and do NOT
-- use the anon key for the server: with RLS off, anyone holding a key
-- could read/write these tables directly. If you later enable RLS,
-- you must add policies that allow the service role full access, or
-- the server will start returning 401/403 from PostgREST.

CREATE TABLE IF NOT EXISTS posts (
  id text PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'স্থানীয় সংবাদ',
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  imageurl text NOT NULL DEFAULT '',
  breaking boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT true,
  createdat timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_settings (
  id int PRIMARY KEY,
  sitename text NOT NULL DEFAULT 'ধর্মপুর টাইমস',
  tagline text NOT NULL DEFAULT 'সত্যের পক্ষে, জনতার পাশে',
  breaking text NOT NULL DEFAULT 'ধর্মপুর টাইমসে স্বাগতম — স্থানীয় সংবাদ, জনতার কণ্ঠস্বর আর উন্নয়নের খবর এখানে পাবেন।',
  facebook text NOT NULL DEFAULT '',
  youtube text NOT NULL DEFAULT '',
  contact text NOT NULL DEFAULT 'যোগাযোগের তথ্য অ্যাডমিন প্যানেল থেকে বসান।',
  adcode text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS admin_account (
  id int PRIMARY KEY,
  salt text NOT NULL,
  hash text NOT NULL
);

-- Visitor analytics (added 2026-11-02). Counts only — no IP or personal data.
-- Run these two statements in the Supabase SQL Editor BEFORE deploying
-- the analytics code, or the stats page will show the table-missing note.
CREATE TABLE IF NOT EXISTS post_views (
  post_id text PRIMARY KEY,
  views bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS site_stats (
  id int PRIMARY KEY,
  home_views bigint NOT NULL DEFAULT 0
);

-- The server seeds site_settings (id = 1) and the welcome post itself
-- on first use when the tables are empty, so no INSERTs are needed here.
-- If you re-run this file, existing rows are left untouched
-- (CREATE TABLE IF NOT EXISTS does not drop or truncate anything).
