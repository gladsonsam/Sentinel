-- Long-lived aggregate tables so operators can keep "top" insights
-- even after raw telemetry is pruned by retention.

CREATE TABLE IF NOT EXISTS url_top_stats (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    visit_count BIGINT NOT NULL DEFAULT 0,
    last_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, url)
);

CREATE INDEX IF NOT EXISTS idx_url_top_stats_agent_count
    ON url_top_stats (agent_id, visit_count DESC);

CREATE TABLE IF NOT EXISTS window_top_stats (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    app TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    focus_count BIGINT NOT NULL DEFAULT 0,
    last_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, app, title)
);

CREATE INDEX IF NOT EXISTS idx_window_top_stats_agent_count
    ON window_top_stats (agent_id, focus_count DESC);

-- Nice default for this deployment profile: keep raw telemetry 30 days.
UPDATE retention_global
SET keylog_days = COALESCE(keylog_days, 30),
    window_days = COALESCE(window_days, 30),
    url_days = COALESCE(url_days, 30)
WHERE id = 1;
