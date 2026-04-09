-- Per-agent app icons (captured from the Windows agent).
-- Stored as PNG bytes keyed by (agent_id, exe_name).

CREATE TABLE IF NOT EXISTS app_icons (
    agent_id  UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    exe_name  TEXT NOT NULL,
    png_bytes BYTEA NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, exe_name)
);

CREATE INDEX IF NOT EXISTS idx_app_icons_agent ON app_icons(agent_id);

