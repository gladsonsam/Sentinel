-- Dashboard users (multi-user auth for the web UI).
-- Passwords are stored as Argon2id encoded hashes (PHC string format).

CREATE TABLE IF NOT EXISTS dashboard_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin', -- 'admin' | 'operator' | 'viewer'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_users_username
    ON dashboard_users (lower(username));

