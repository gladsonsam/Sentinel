-- Password for the Windows agent's local settings UI (SHA-256 hex of plaintext, same as agent config).
-- NULL in password_hash_sha256 means "no password" (agent uses hash of empty string).

CREATE TABLE IF NOT EXISTS agent_local_ui_password (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    password_hash_sha256 TEXT
);

INSERT INTO agent_local_ui_password (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS agent_local_ui_password_override (
    agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    password_hash_sha256 TEXT
);
