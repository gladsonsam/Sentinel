-- History of alert-rule matches per agent (dashboard “what fired” trail).
CREATE TABLE IF NOT EXISTS alert_rule_events (
    id          BIGSERIAL PRIMARY KEY,
    agent_id    UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    rule_id     BIGINT      REFERENCES alert_rules(id) ON DELETE SET NULL,
    rule_name   TEXT        NOT NULL DEFAULT '',
    channel     TEXT        NOT NULL CHECK (channel IN ('url', 'keys')),
    snippet     TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rule_events_agent_created
    ON alert_rule_events (agent_id, created_at DESC);
