-- Installed software snapshots per agent (replaced on each inventory upload).

CREATE TABLE IF NOT EXISTS agent_software (
    id               BIGSERIAL PRIMARY KEY,
    agent_id         UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name             TEXT        NOT NULL,
    version          TEXT,
    publisher        TEXT,
    install_location TEXT,
    install_date     TEXT,
    captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_software_agent_captured
    ON agent_software (agent_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_software_agent_name
    ON agent_software (agent_id, lower(name));
