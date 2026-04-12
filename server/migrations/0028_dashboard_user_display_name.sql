-- Optional display name (full name) for dashboard users; sign-in remains `username`.
ALTER TABLE dashboard_users
    ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
