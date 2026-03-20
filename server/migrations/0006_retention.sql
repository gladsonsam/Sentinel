-- Global and per-agent telemetry retention (days). NULL = keep forever (no auto-prune).

CREATE TABLE IF NOT EXISTS retention_global (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    keylog_days INTEGER CHECK (keylog_days IS NULL OR (keylog_days >= 1 AND keylog_days <= 36500)),
    window_days INTEGER CHECK (window_days IS NULL OR (window_days >= 1 AND window_days <= 36500)),
    url_days INTEGER CHECK (url_days IS NULL OR (url_days >= 1 AND url_days <= 36500))
);

INSERT INTO retention_global (id) VALUES (1)
    ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS retention_agent (
    agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    keylog_days INTEGER CHECK (keylog_days IS NULL OR (keylog_days >= 1 AND keylog_days <= 36500)),
    window_days INTEGER CHECK (window_days IS NULL OR (window_days >= 1 AND window_days <= 36500)),
    url_days INTEGER CHECK (url_days IS NULL OR (url_days >= 1 AND url_days <= 36500))
);
