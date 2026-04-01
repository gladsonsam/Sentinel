-- Persistent dashboard sessions (cookie token → user).
-- Store only a SHA-256 hash of the random token (never the plaintext).

CREATE TABLE IF NOT EXISTS dashboard_sessions (
    id BIGSERIAL PRIMARY KEY,
    token_sha256_hex TEXT NOT NULL UNIQUE, -- 64 hex chars
    user_id UUID NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    client_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_user
    ON dashboard_sessions (user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_expires
    ON dashboard_sessions (expires_at);

