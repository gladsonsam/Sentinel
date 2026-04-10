-- Agent auto-update policy (Tauri updater).
--
-- Global default + per-agent override. When set, the server pushes `set_auto_update`
-- to connected agents (and on connect).

CREATE TABLE IF NOT EXISTS agent_auto_update (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO agent_auto_update (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS agent_auto_update_override (
    agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL
);

