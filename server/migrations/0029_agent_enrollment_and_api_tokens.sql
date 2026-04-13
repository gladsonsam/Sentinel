-- Per-agent WebSocket credentials (Argon2 hash) and one-time enrollment codes.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_token_hash TEXT;

-- SHA-256 digest (32 bytes) of the enrollment secret; constant-time match on claim.
CREATE TABLE IF NOT EXISTS agent_enrollment_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_digest    BYTEA NOT NULL UNIQUE,
    uses_remaining  INT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NULL,
    note            TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_enrollment_expires
    ON agent_enrollment_tokens (expires_at);
