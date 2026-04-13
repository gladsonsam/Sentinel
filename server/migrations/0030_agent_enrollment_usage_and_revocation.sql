-- Track enrollment token usage and allow revocation auditing.

CREATE TABLE IF NOT EXISTS agent_enrollment_token_uses (
    id          BIGSERIAL PRIMARY KEY,
    token_id    UUID NOT NULL REFERENCES agent_enrollment_tokens(id) ON DELETE CASCADE,
    used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    agent_name  TEXT NOT NULL,
    agent_id    UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
    client_ip   INET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_enrollment_uses_token_id_used_at
    ON agent_enrollment_token_uses (token_id, used_at DESC);

