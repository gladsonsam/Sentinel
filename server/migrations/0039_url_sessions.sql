-- URL sessions (time-on-site) from agents.

CREATE TABLE IF NOT EXISTS url_sessions (
    id BIGSERIAL PRIMARY KEY,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    url TEXT NOT NULL DEFAULT '',
    hostname TEXT NOT NULL DEFAULT '',
    title TEXT,
    browser TEXT,
    ts_start TIMESTAMPTZ NOT NULL,
    ts_end TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    category_id BIGINT REFERENCES url_categories(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_url_sessions_agent_start
    ON url_sessions (agent_id, ts_start DESC);

CREATE INDEX IF NOT EXISTS idx_url_sessions_agent_category_start
    ON url_sessions (agent_id, category_id, ts_start DESC);

-- Aggregates: per-site time and per-category time for fast analytics.
CREATE TABLE IF NOT EXISTS url_site_stats (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    hostname TEXT NOT NULL,
    time_ms BIGINT NOT NULL DEFAULT 0,
    visit_count BIGINT NOT NULL DEFAULT 0,
    last_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, hostname)
);

CREATE INDEX IF NOT EXISTS idx_url_site_stats_agent_time
    ON url_site_stats (agent_id, time_ms DESC);

CREATE TABLE IF NOT EXISTS url_category_time_stats (
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    category_id BIGINT REFERENCES url_categories(id) ON DELETE CASCADE,
    time_ms BIGINT NOT NULL DEFAULT 0,
    visit_count BIGINT NOT NULL DEFAULT 0,
    last_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_url_category_time_stats_agent_time
    ON url_category_time_stats (agent_id, time_ms DESC);

